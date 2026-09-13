"""
Blueprint for user recording CRUD API.

Handles upload, listing, renaming, and deletion of user recordings
associated with a specific download/extraction.
"""

import os
import shutil
import subprocess
import tempfile

from flask import Blueprint, Response, request, jsonify, send_from_directory
from flask_login import current_user
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

from extensions import api_login_required
from core.config import ensure_valid_downloads_directory, get_ffmpeg_path
from core.logging_config import get_logger
from core.db.recordings import (
    create_recording,
    list_recordings,
    get_recording,
    rename_recording,
    delete_recording,
)

logger = get_logger(__name__)

recordings_bp = Blueprint('recordings', __name__)

# /api/recordings/convert limits. A MediaRecorder take (Opus/AAC) runs ~1 MB per minute,
# so 64 MB is well over half an hour; the WAV cap bounds what we load into memory.
CONVERT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024
CONVERT_MAX_OUTPUT_BYTES = 512 * 1024 * 1024
CONVERT_TIMEOUT_SECONDS = 120

# Container types MediaRecorder produces across browsers. Chrome/Firefox label WebM/Ogg
# takes audio/*, Safari uses audio/mp4 but some builds report video/mp4; an empty type or
# octet-stream happens when the Blob loses its type, so ffmpeg's probe decides there.
_CONVERT_ALLOWED_MIME_PREFIXES = ('audio/',)
_CONVERT_ALLOWED_MIME_TYPES = {
    'video/webm', 'video/mp4', 'video/quicktime', 'video/ogg',
    'application/ogg', 'application/octet-stream', '',
}

# Demuxers ffmpeg may use on the upload. Whitelisting blocks playlist/concat demuxers
# (hls, concat, ...) that could make ffmpeg read other local files or URLs.
_CONVERT_FORMAT_WHITELIST = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg,wav,aac,mp3,flac,caf'


def _resolve_download(extraction_id):
    """Resolve an extraction_id to a download record.

    Handles multiple formats: download_<id>, video_id, or filename prefix.
    Returns the download dict or None.
    """
    from core.downloads_db import get_download_by_id, list_extractions_for

    # Try download_<id> format first
    if extraction_id.startswith('download_'):
        numeric_id = extraction_id.replace('download_', '')
        dl = get_download_by_id(current_user.id, numeric_id)
        if dl:
            return dl

    # Search by video_id or filename
    db_extractions = list_extractions_for(current_user.id)
    for ext in db_extractions:
        vid = ext.get('video_id', '')
        fp = ext.get('file_path', '')
        fname = os.path.basename(fp).replace('.mp3', '') if fp else ''
        if vid == extraction_id or (fname and extraction_id.startswith(fname)):
            return ext

    return None


def _get_download_dir(extraction_id):
    """Resolve the download directory for a given extraction_id."""
    dl = _resolve_download(extraction_id)
    if not dl or not dl.get('file_path'):
        return None
    return os.path.dirname(dl['file_path'])


@recordings_bp.route('/api/recordings', methods=['POST'])
@api_login_required
def upload_recording():
    """Upload a WAV recording and store metadata."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400

    download_id = request.form.get('download_id')
    name = request.form.get('name', 'Recording')
    start_offset = float(request.form.get('start_offset', 0))

    if not download_id:
        return jsonify({'error': 'download_id is required'}), 400

    # Resolve download directory
    download_dir = _get_download_dir(download_id)
    if not download_dir:
        return jsonify({'error': 'Download not found'}), 404

    # Create recordings subdirectory
    recordings_dir = os.path.join(download_dir, 'recordings')
    os.makedirs(recordings_dir, exist_ok=True)

    # Security: ensure recordings_dir is within downloads root
    downloads_root = os.path.abspath(ensure_valid_downloads_directory())
    if not os.path.abspath(recordings_dir).startswith(downloads_root):
        return jsonify({'error': 'Access denied'}), 403

    # Save file with a generated name
    rec_id = create_recording(
        user_id=current_user.id,
        download_id=download_id,
        name=name,
        start_offset=start_offset,
        filename='',  # Will update after saving
    )

    filename = f"{rec_id}.wav"
    filepath = os.path.join(recordings_dir, filename)
    file.save(filepath)

    # Update the filename in DB
    from core.db.connection import _conn
    with _conn() as conn:
        conn.execute(
            "UPDATE recordings SET filename = ? WHERE id = ?",
            (filepath, rec_id),
        )
        conn.commit()

    logger.info(f"[RECORDINGS] Saved recording {rec_id} for download {download_id}")

    return jsonify({
        'success': True,
        'id': rec_id,
        'name': name,
        'start_offset': start_offset,
        'filename': filename,
    })


@recordings_bp.route('/api/recordings/convert', methods=['POST'])
@api_login_required
def convert_recording():
    """Convert a MediaRecorder take the browser cannot decode into 16-bit PCM WAV.

    Fallback for ``RecordingUtils.decodeAudioBlob`` (mostly iOS Safari). Expects a
    multipart form with the take in the ``audio`` field and returns the WAV bytes
    (``audio/wav``) for ``AudioContext.decodeAudioData``. Nothing is persisted.
    """
    # Enforce the cap before the multipart body is parsed (Flask 3.1 per-request limit).
    request.max_content_length = CONVERT_MAX_UPLOAD_BYTES + 1024 * 1024
    try:
        upload = request.files.get('audio')
    except RequestEntityTooLarge:
        return jsonify({'error': 'Recording too large'}), 413

    if upload is None or not upload.filename:
        return jsonify({'error': 'No audio provided'}), 400

    mimetype = (upload.mimetype or '').lower()
    if not (mimetype.startswith(_CONVERT_ALLOWED_MIME_PREFIXES)
            or mimetype in _CONVERT_ALLOWED_MIME_TYPES):
        return jsonify({'error': f'Unsupported media type: {mimetype}'}), 415

    work_dir = tempfile.mkdtemp(prefix='stemtube_rec_convert_')
    try:
        # Neutral names: the client always calls the part "recording.mp4" whatever the
        # container, so the format comes from ffmpeg's content probe, not the extension.
        input_path = os.path.join(work_dir, 'input.bin')
        output_path = os.path.join(work_dir, 'output.wav')
        upload.save(input_path)

        input_size = os.path.getsize(input_path)
        if input_size == 0:
            return jsonify({'error': 'Empty recording'}), 400
        if input_size > CONVERT_MAX_UPLOAD_BYTES:
            return jsonify({'error': 'Recording too large'}), 413

        cmd = [
            get_ffmpeg_path(),
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-protocol_whitelist', 'file',
            '-format_whitelist', _CONVERT_FORMAT_WHITELIST,
            '-i', input_path,
            '-map', '0:a:0',  # fails when there is no audio stream -> non-audio input rejected
            '-vn', '-sn', '-dn',
            '-c:a', 'pcm_s16le',
            '-f', 'wav',
            output_path,
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=CONVERT_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            logger.warning("[RECORDINGS] Conversion timed out")
            return jsonify({'error': 'Conversion timed out'}), 504
        except OSError as e:
            logger.error(f"[RECORDINGS] Could not run ffmpeg: {e}")
            return jsonify({'error': 'Audio converter unavailable'}), 500

        if result.returncode != 0 or not os.path.exists(output_path):
            logger.warning(
                f"[RECORDINGS] Conversion failed (rc={result.returncode}, type={mimetype}): "
                f"{result.stderr.strip()[-500:]}"
            )
            return jsonify({'error': 'Could not decode recording as audio'}), 422

        output_size = os.path.getsize(output_path)
        if output_size > CONVERT_MAX_OUTPUT_BYTES:
            return jsonify({'error': 'Recording too long to convert'}), 413

        # Read into memory so the temp dir can be removed before the response is sent.
        with open(output_path, 'rb') as fh:
            wav_bytes = fh.read()

        logger.info(
            f"[RECORDINGS] Converted {input_size} bytes ({mimetype or 'unknown'}) "
            f"to {output_size} bytes WAV"
        )
        response = Response(wav_bytes, mimetype='audio/wav')
        response.headers['Cache-Control'] = 'no-store'
        return response
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@recordings_bp.route('/api/recordings/<download_id>', methods=['GET'])
@api_login_required
def get_recordings(download_id):
    """List all recordings for the current user and download."""
    recs = list_recordings(current_user.id, download_id)
    # Add file URLs and filter out orphaned entries
    result = []
    for rec in recs:
        filepath = rec.get('filename', '')
        if filepath and os.path.exists(filepath):
            rec['url'] = f"/api/recordings/{rec['id']}/file"
            result.append(rec)
        else:
            # Orphaned record (file missing), skip but log
            logger.warning(f"[RECORDINGS] Orphaned recording {rec['id']}: file missing at {filepath}")

    return jsonify({'success': True, 'recordings': result})


@recordings_bp.route('/api/recordings/<recording_id>/file', methods=['GET'])
@api_login_required
def serve_recording_file(recording_id):
    """Serve a recording WAV file."""
    rec = get_recording(recording_id)
    if not rec:
        return jsonify({'error': 'Recording not found'}), 404

    # Owner check
    if str(rec['user_id']) != str(current_user.id):
        return jsonify({'error': 'Access denied'}), 403

    filepath = rec.get('filename', '')
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'Recording file not found'}), 404

    # Security check
    downloads_root = os.path.abspath(ensure_valid_downloads_directory())
    abs_path = os.path.abspath(filepath)
    if not abs_path.startswith(downloads_root):
        return jsonify({'error': 'Access denied'}), 403

    directory = os.path.dirname(abs_path)
    filename = os.path.basename(abs_path)
    return send_from_directory(directory, filename, mimetype='audio/wav')


@recordings_bp.route('/api/recordings/<recording_id>', methods=['PUT'])
@api_login_required
def update_recording(recording_id):
    """Rename a recording."""
    data = request.get_json(silent=True) or {}
    new_name = data.get('name', '').strip()
    if not new_name:
        return jsonify({'error': 'Name is required'}), 400

    rec = get_recording(recording_id)
    if not rec:
        return jsonify({'error': 'Recording not found'}), 404

    if str(rec['user_id']) != str(current_user.id):
        return jsonify({'error': 'Access denied'}), 403

    rename_recording(recording_id, current_user.id, new_name)
    logger.info(f"[RECORDINGS] Renamed recording {recording_id} to '{new_name}'")
    return jsonify({'success': True})


@recordings_bp.route('/api/recordings/<recording_id>', methods=['DELETE'])
@api_login_required
def remove_recording(recording_id):
    """Delete a recording and its file."""
    rec = get_recording(recording_id)
    if not rec:
        return jsonify({'error': 'Recording not found'}), 404

    if str(rec['user_id']) != str(current_user.id):
        return jsonify({'error': 'Access denied'}), 403

    # Delete file from disk
    filepath = rec.get('filename', '')
    if filepath and os.path.exists(filepath):
        try:
            os.remove(filepath)
            logger.info(f"[RECORDINGS] Deleted file: {filepath}")
        except OSError as e:
            logger.warning(f"[RECORDINGS] Could not delete file {filepath}: {e}")

    # Delete DB row
    delete_recording(recording_id, current_user.id)
    logger.info(f"[RECORDINGS] Deleted recording {recording_id}")
    return jsonify({'success': True})


