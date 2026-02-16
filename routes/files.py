import os
import uuid
import json
import mimetypes
import subprocess

from flask import Blueprint, request, jsonify, send_from_directory
from flask_login import current_user
from werkzeug.utils import secure_filename

from extensions import api_login_required, user_session_manager
from core.config import get_ffmpeg_path, ensure_valid_downloads_directory
from core.downloads_db import add_or_update as db_add_download
from core.logging_config import get_logger

logger = get_logger(__name__)

files_bp = Blueprint('files', __name__)


@files_bp.route('/api/open-folder', methods=['POST'])
@api_login_required
def open_folder_route():
    data = request.json or {}
    folder_path = data.get('folderPath', '')

    if not folder_path or not os.path.exists(folder_path):
        return jsonify({'error': 'Invalid folder path'}), 400

    try:
        import platform
        import subprocess

        system = platform.system()
        if system == "Windows":
            # Open folder in Windows Explorer
            subprocess.run(['explorer', os.path.abspath(folder_path)], check=True)
        elif system == "Darwin":  # macOS
            # Open folder in Finder
            subprocess.run(['open', os.path.abspath(folder_path)], check=True)
        elif system == "Linux":
            # Open folder in default file manager
            subprocess.run(['xdg-open', os.path.abspath(folder_path)], check=True)
        else:
            return jsonify({'error': f'Unsupported operating system: {system}'}), 500

        return jsonify({'success': True, 'message': 'Folder opened successfully'})

    except subprocess.CalledProcessError as e:
        return jsonify({'error': f'Failed to open folder: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Error opening folder: {str(e)}'}), 500


@files_bp.route('/api/upload-file', methods=['POST'])
@api_login_required
def upload_file_route():
    """Handle file uploads and integrate them into the existing download workflow."""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Secure the filename
        original_filename = secure_filename(file.filename)
        file_extension = os.path.splitext(original_filename)[1].lower()
        filename_without_ext = os.path.splitext(original_filename)[0]

        # Validate file type
        allowed_extensions = {'.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma',
                            '.mp4', '.avi', '.mkv', '.mov', '.webm'}
        if file_extension not in allowed_extensions:
            return jsonify({'error': f'File type {file_extension} not supported'}), 400

        # Generate a unique video_id for the uploaded file
        video_id = f"upload_{uuid.uuid4().hex[:12]}"

        # Create directory structure (same as YouTube downloads)
        downloads_dir = ensure_valid_downloads_directory()
        video_dir = os.path.join(downloads_dir, filename_without_ext)
        audio_dir = os.path.join(video_dir, 'audio')
        os.makedirs(audio_dir, exist_ok=True)

        # Save the uploaded file
        # Convert to MP3 if needed using ffmpeg
        temp_path = os.path.join(audio_dir, f"temp_{original_filename}")
        file.save(temp_path)

        # If not MP3, convert it
        if file_extension != '.mp3':
            output_filename = f"{filename_without_ext}.mp3"
            output_path = os.path.join(audio_dir, output_filename)

            # Convert using ffmpeg
            ffmpeg_path = get_ffmpeg_path()
            cmd = [
                ffmpeg_path, '-i', temp_path,
                '-vn',  # No video
                '-ar', '44100',  # Audio sample rate
                '-ac', '2',  # Stereo
                '-b:a', '320k',  # High quality audio
                output_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                # If conversion fails, just use the original file
                os.rename(temp_path, os.path.join(audio_dir, original_filename))
                final_path = os.path.join(audio_dir, original_filename)
            else:
                # Conversion succeeded, remove temp file
                os.remove(temp_path)
                final_path = output_path
        else:
            # Already MP3, just rename
            final_path = os.path.join(audio_dir, original_filename)
            os.rename(temp_path, final_path)

        # Get file size
        file_size = os.path.getsize(final_path)

        # Add to database using existing download management system
        # This handles deduplication automatically
        meta = {
            'video_id': video_id,
            'title': filename_without_ext,
            'thumbnail_url': None,  # Use None instead of empty string for proper NULL handling
            'file_path': final_path,
            'file_size': file_size,
            'download_type': 'audio',
            'quality': 'original'
        }

        # Add to database (handles both global and user records)
        db_add_download(current_user.id, meta)

        logger.info(f"File uploaded successfully: {original_filename} -> {video_id}")

        return jsonify({
            'success': True,
            'video_id': video_id,
            'title': filename_without_ext,
            'file_path': final_path,
            'message': 'File uploaded and processed successfully'
        })

    except Exception as e:
        logger.error(f"Error uploading file: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@files_bp.route('/api/download-file', methods=['GET'])
@api_login_required
def download_file_route():
    file_path = request.args.get('file_path', '')

    if not file_path:
        return jsonify({'error': 'No file path provided'}), 400

    # Resolve the path to handle old absolute paths from migrations
    from core.downloads_db import resolve_file_path
    file_path = resolve_file_path(file_path)

    # Security check: ensure the file path is within allowed directories
    abs_file_path = os.path.abspath(file_path)
    downloads_dir = os.path.abspath(ensure_valid_downloads_directory())

    if not abs_file_path.startswith(downloads_dir):
        return jsonify({'error': 'Access denied: file is outside downloads directory'}), 403

    if not os.path.exists(abs_file_path):
        return jsonify({'error': 'File not found'}), 404

    if not os.path.isfile(abs_file_path):
        return jsonify({'error': 'Path is not a file'}), 400

    try:
        # Get the directory and filename
        directory = os.path.dirname(abs_file_path)
        filename = os.path.basename(abs_file_path)

        # Use Flask's send_from_directory for secure file serving
        return send_from_directory(directory, filename, as_attachment=True)

    except Exception as e:
        return jsonify({'error': f'Error serving file: {str(e)}'}), 500


@files_bp.route('/api/stream-audio', methods=['GET'])
@api_login_required
def stream_audio_route():
    """Stream audio for in-app playback without forcing download."""
    file_path = request.args.get('file_path', '')

    if not file_path:
        return jsonify({'error': 'No file path provided'}), 400

    from core.downloads_db import resolve_file_path
    file_path = resolve_file_path(file_path)

    abs_file_path = os.path.abspath(file_path)
    downloads_dir = os.path.abspath(ensure_valid_downloads_directory())

    if not abs_file_path.startswith(downloads_dir):
        return jsonify({'error': 'Access denied: file is outside downloads directory'}), 403

    if not os.path.exists(abs_file_path):
        return jsonify({'error': 'File not found'}), 404

    if not os.path.isfile(abs_file_path):
        return jsonify({'error': 'Path is not a file'}), 400

    directory = os.path.dirname(abs_file_path)
    filename = os.path.basename(abs_file_path)

    mimetype, _ = mimetypes.guess_type(filename)
    if not mimetype:
        mimetype = 'audio/mpeg'

    try:
        return send_from_directory(directory, filename, mimetype=mimetype, as_attachment=False)
    except Exception as e:
        return jsonify({'error': f'Error streaming file: {str(e)}'}), 500


@files_bp.route('/api/list-files', methods=['POST'])
@api_login_required
def list_files_route():
    data = request.json or {}
    folder_path = data.get('folder_path', '')

    if not folder_path:
        return jsonify({'error': 'No folder path provided', 'success': False}), 400

    # Security check: ensure the folder path is within allowed directories
    abs_folder_path = os.path.abspath(folder_path)
    downloads_dir = os.path.abspath(ensure_valid_downloads_directory())

    if not abs_folder_path.startswith(downloads_dir):
        return jsonify({'error': 'Access denied: folder is outside downloads directory', 'success': False}), 403

    if not os.path.exists(abs_folder_path):
        return jsonify({'error': 'Folder not found', 'success': False}), 404

    if not os.path.isdir(abs_folder_path):
        return jsonify({'error': 'Path is not a directory', 'success': False}), 400

    try:
        files = []
        for item in os.listdir(abs_folder_path):
            item_path = os.path.join(abs_folder_path, item)
            if os.path.isfile(item_path):
                files.append({
                    'name': item,
                    'path': item_path,
                    'size': os.path.getsize(item_path)
                })

        return jsonify({'success': True, 'files': files})

    except Exception as e:
        return jsonify({'error': f'Error listing files: {str(e)}', 'success': False}), 500


@files_bp.route('/api/extracted_stems/<extraction_id>/<stem_name>', methods=['GET', 'HEAD'])
@api_login_required
def serve_extracted_stem(extraction_id, stem_name):
    """Serve individual stem files for the mixer. Supports HEAD requests for existence checking."""
    try:
        # First check current session's stems extractor
        se = user_session_manager.get_stems_extractor()
        extraction = se.get_extraction_status(extraction_id)

        # If not found in current session, check database
        if not extraction:
            try:
                from core.downloads_db import get_download_by_id, list_extractions_for, resolve_file_path
                import json

                download_data = None

                # Check if it's a download_ID format
                if extraction_id.startswith('download_'):
                    download_id = extraction_id.replace('download_', '')
                    download_data = get_download_by_id(current_user.id, download_id)
                    logger.debug(f"[Stems API] Searching by download_id: {download_id}")
                else:
                    # Search by video_id or filename (same logic as /api/extractions/<id>)
                    db_extractions = list_extractions_for(current_user.id)
                    logger.debug(f"[Stems API] Searching for extraction_id: {extraction_id} in {len(db_extractions)} extractions")

                    for db_extraction in db_extractions:
                        video_id = db_extraction.get('video_id', '')
                        file_path = db_extraction.get('file_path', '')
                        filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''

                        # Match by video_id or filename
                        if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                            download_data = db_extraction
                            logger.info(f"[Stems API] Found extraction by {'video_id' if video_id == extraction_id else 'filename'}: {extraction_id}")
                            break

                if download_data and download_data.get('extracted') and download_data.get('stems_paths'):
                    stems_paths = json.loads(download_data['stems_paths']) if isinstance(download_data['stems_paths'], str) else download_data['stems_paths']
                    logger.debug(f"[Stems API] Stems paths for {extraction_id}: {list(stems_paths.keys())}")

                    # Get the requested stem path
                    stem_file_path = stems_paths.get(stem_name)
                    logger.debug(f"[Stems API] Requested stem '{stem_name}' path: {stem_file_path}")

                    # Resolve the path to handle old absolute paths from migrations
                    if stem_file_path:
                        stem_file_path = resolve_file_path(stem_file_path)
                        logger.debug(f"[Stems API] Resolved stem path: {stem_file_path}")

                    if stem_file_path and os.path.exists(stem_file_path):
                        # Security check: ensure the file path is within allowed directories
                        abs_file_path = os.path.abspath(stem_file_path)
                        downloads_dir = os.path.abspath(ensure_valid_downloads_directory())

                        if abs_file_path.startswith(downloads_dir):
                            logger.info(f"[Stems API] Serving stem '{stem_name}' for {extraction_id}: {abs_file_path}")

                            # For HEAD requests, just return 200 to confirm existence
                            if request.method == 'HEAD':
                                return '', 200

                            directory = os.path.dirname(abs_file_path)
                            filename = os.path.basename(abs_file_path)
                            _mt, _ = mimetypes.guess_type(filename)
                            response = send_from_directory(directory, filename, mimetype=_mt or 'audio/mpeg')
                            response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
                            return response
                        else:
                            logger.error(f"[Stems API] Security violation: {abs_file_path} not in {downloads_dir}")
                    else:
                        logger.warning(f"[Stems API] Stem file not found: {stem_file_path}")

                    return jsonify({'error': f'Stem file not found: {stem_name}'}), 404

                logger.warning(f"[Stems API] Extraction not found or not extracted: {extraction_id}")
                return jsonify({'error': 'Extraction not found or not completed'}), 404

            except Exception as e:
                logger.error(f"[Stems API] Error loading database extraction {extraction_id}: {e}", exc_info=True)
                # Fall through to session check

        # If not found in database or session, return error - filesystem scanning disabled
        if not extraction:
            return jsonify({'error': f'Stem file not found in your records: {stem_name}'}), 404

        if extraction.status.value != 'completed':
            return jsonify({'error': 'Extraction not completed'}), 400

        # Look for the stem file in the extraction output paths
        stem_file_path = None
        if extraction.output_paths:
            stem_file_path = extraction.output_paths.get(stem_name)

        if not stem_file_path or not os.path.exists(stem_file_path):
            return jsonify({'error': f'Stem file not found: {stem_name}'}), 404

        # Security check: ensure the file path is within allowed directories
        abs_file_path = os.path.abspath(stem_file_path)
        downloads_dir = os.path.abspath(ensure_valid_downloads_directory())

        if not abs_file_path.startswith(downloads_dir):
            return jsonify({'error': 'Access denied: file is outside downloads directory'}), 403

        # For HEAD requests, just return 200 to confirm existence
        if request.method == 'HEAD':
            return '', 200

        # Get the directory and filename
        directory = os.path.dirname(abs_file_path)
        filename = os.path.basename(abs_file_path)

        # Serve the file with appropriate MIME type for audio streaming
        _mt, _ = mimetypes.guess_type(filename)
        response = send_from_directory(directory, filename, mimetype=_mt or 'audio/mpeg')
        response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
        return response

    except Exception as e:
        return jsonify({'error': f'Error serving stem file: {str(e)}'}), 500
