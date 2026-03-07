"""
Blueprint for user recording CRUD API.

Handles upload, listing, renaming, and deletion of user recordings
associated with a specific download/extraction.
Includes server-side de-bleed via Demucs stem separation.
"""

import os
import sys
import shutil
import subprocess
import tempfile
import threading

from flask import Blueprint, request, jsonify, send_from_directory
from flask_login import current_user
from werkzeug.utils import secure_filename

from extensions import api_login_required, socketio
from core.config import ensure_valid_downloads_directory, get_ffmpeg_path, get_setting
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


# ── De-bleed via Demucs ───────────────────────────────────────────

VALID_DEBLEED_STEMS = {'vocals', 'bass', 'drums', 'other'}


def _run_debleed(recording_id: str, user_id: int, stem_type: str):
    """Run Demucs on a recording and replace it with the requested stem.

    Executed in a background thread. Emits socketio progress to the user.
    """
    import torch

    rec = get_recording(recording_id)
    if not rec:
        logger.error(f"[DEBLEED] Recording {recording_id} not found")
        socketio.emit('debleed_error', {
            'recording_id': recording_id,
            'error': 'Recording not found',
        }, room=f'user_{user_id}')
        return

    filepath = rec.get('filename', '')
    if not filepath or not os.path.exists(filepath):
        logger.error(f"[DEBLEED] File missing: {filepath}")
        socketio.emit('debleed_error', {
            'recording_id': recording_id,
            'error': 'Recording file not found',
        }, room=f'user_{user_id}')
        return

    temp_dir = tempfile.mkdtemp(prefix='debleed_')
    try:
        ffmpeg_path = get_ffmpeg_path()
        device = 'cuda' if torch.cuda.is_available() and get_setting(
            'use_gpu_for_extraction', True) else 'cpu'

        wrap_script = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), '..', 'core', 'wrap_demucs.py')

        cmd = [
            sys.executable, wrap_script, ffmpeg_path,
            '-n', 'htdemucs',
            '-o', temp_dir,
            '-d', device,
            '--two-stems', stem_type,
            filepath,
        ]

        logger.info(f"[DEBLEED] Running: {' '.join(cmd)}")
        socketio.emit('debleed_progress', {
            'recording_id': recording_id,
            'status': 'processing',
            'message': f'Separating {stem_type}...',
        }, room=f'user_{user_id}')

        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            logger.error(f"[DEBLEED] Demucs failed: {result.stderr[-500:]}")
            socketio.emit('debleed_error', {
                'recording_id': recording_id,
                'error': 'Demucs separation failed',
            }, room=f'user_{user_id}')
            return

        # Find the output stem file
        # Demucs outputs to: temp_dir/htdemucs/<input_name>/<stem>.wav
        input_name = os.path.splitext(os.path.basename(filepath))[0]
        stem_file = None
        for ext in ('.wav', '.mp3'):
            candidate = os.path.join(temp_dir, 'htdemucs', input_name, f'{stem_type}{ext}')
            if os.path.exists(candidate):
                stem_file = candidate
                break

        if not stem_file:
            # Try finding it more broadly
            for root, _dirs, files in os.walk(temp_dir):
                for f in files:
                    if f.startswith(stem_type):
                        stem_file = os.path.join(root, f)
                        break
                if stem_file:
                    break

        if not stem_file:
            logger.error(f"[DEBLEED] Stem file not found in {temp_dir}")
            socketio.emit('debleed_error', {
                'recording_id': recording_id,
                'error': f'Stem "{stem_type}" not found in output',
            }, room=f'user_{user_id}')
            return

        # Replace the original recording with the de-bleeded stem
        shutil.copy2(stem_file, filepath)
        logger.info(f"[DEBLEED] Replaced {filepath} with {stem_type} stem")

        socketio.emit('debleed_complete', {
            'recording_id': recording_id,
            'stem_type': stem_type,
            'url': f'/api/recordings/{recording_id}/file',
        }, room=f'user_{user_id}')

    except subprocess.TimeoutExpired:
        logger.error(f"[DEBLEED] Timeout for recording {recording_id}")
        socketio.emit('debleed_error', {
            'recording_id': recording_id,
            'error': 'De-bleed timed out (5 min limit)',
        }, room=f'user_{user_id}')
    except Exception as e:
        logger.error(f"[DEBLEED] Error: {e}", exc_info=True)
        socketio.emit('debleed_error', {
            'recording_id': recording_id,
            'error': str(e),
        }, room=f'user_{user_id}')
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@recordings_bp.route('/api/recordings/<recording_id>/debleed', methods=['POST'])
@api_login_required
def debleed_recording(recording_id):
    """Apply Demucs stem separation to isolate a specific instrument from a recording."""
    data = request.get_json(silent=True) or {}
    stem_type = data.get('stem_type', '').strip().lower()

    if stem_type not in VALID_DEBLEED_STEMS:
        return jsonify({
            'error': f'Invalid stem_type. Must be one of: {", ".join(sorted(VALID_DEBLEED_STEMS))}'
        }), 400

    rec = get_recording(recording_id)
    if not rec:
        return jsonify({'error': 'Recording not found'}), 404

    if str(rec['user_id']) != str(current_user.id):
        return jsonify({'error': 'Access denied'}), 403

    filepath = rec.get('filename', '')
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'Recording file not found'}), 404

    # Run in background thread
    thread = threading.Thread(
        target=_run_debleed,
        args=(recording_id, current_user.id, stem_type),
        daemon=True,
    )
    thread.start()

    logger.info(f"[DEBLEED] Started for recording {recording_id}, stem={stem_type}")
    return jsonify({'success': True, 'message': f'De-bleed started ({stem_type})'})
