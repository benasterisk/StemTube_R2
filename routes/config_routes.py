from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required, api_admin_required, user_session_manager
from core.config import get_setting, update_setting, get_ffmpeg_path, get_ffprobe_path, ensure_valid_downloads_directory

config_bp = Blueprint('config_routes', __name__)


@config_bp.route('/api/config', methods=['GET'])
@api_login_required
def get_config():
    se = user_session_manager.get_stems_extractor()
    return jsonify({
        'downloads_directory': ensure_valid_downloads_directory(),
        'max_concurrent_downloads': get_setting('max_concurrent_downloads', 3),
        'preferred_video_quality': get_setting('preferred_video_quality', 'best'),
        'preferred_audio_quality': get_setting('preferred_audio_quality', 'best'),
        'use_gpu_for_extraction': get_setting('use_gpu_for_extraction', True),
        'default_stem_model': get_setting('default_stem_model', 'htdemucs'),
        'ffmpeg_path': get_ffmpeg_path(),
        'ffprobe_path': get_ffprobe_path(),
        'using_gpu': se.using_gpu
    })


@config_bp.route('/api/config', methods=['POST'])
@api_login_required
def update_config():
    data = request.json or {}
    for k, v in data.items():
        update_setting(k, v)

        # Apply GPU setting immediately without restart
        if k == 'use_gpu_for_extraction':
            se = user_session_manager.get_stems_extractor()
            se.set_use_gpu(v)
            print(f"GPU setting updated to {v}, using GPU: {se.using_gpu}")

    return jsonify({'success': True})


@config_bp.route('/api/config/ffmpeg/check', methods=['GET'])
@api_login_required
def check_ffmpeg():
    return jsonify({'ffmpeg_available': True, 'ffmpeg_path': get_ffmpeg_path()})


@config_bp.route('/api/config/ffmpeg/download', methods=['POST'])
@api_login_required
def download_ffmpeg_route():
    return jsonify({'error': 'Not implemented'}), 501


@config_bp.route('/api/config/browser-logging', methods=['GET'])
@api_login_required
def get_browser_logging_config():
    """Get browser logging configuration (available to all authenticated users)."""
    return jsonify({
        'enabled': get_setting('browser_logging_enabled', False),
        'min_log_level': get_setting('browser_logging_level', 'error'),
        'flush_interval_seconds': get_setting('browser_logging_flush_interval', 60),
        'max_buffer_size': get_setting('browser_logging_buffer_size', 50)
    })


@config_bp.route('/api/config/browser-logging', methods=['POST'])
@api_login_required
@api_admin_required
def update_browser_logging_config():
    """Update browser logging configuration (admin only)."""
    data = request.json or {}

    # Validate inputs
    valid_levels = ['debug', 'info', 'warn', 'error']

    if 'enabled' in data:
        enabled = bool(data['enabled'])
        update_setting('browser_logging_enabled', enabled)

    if 'min_log_level' in data:
        level = data['min_log_level']
        if level not in valid_levels:
            return jsonify({'error': f'Invalid log level. Must be one of: {", ".join(valid_levels)}'}), 400
        update_setting('browser_logging_level', level)

    if 'flush_interval_seconds' in data:
        interval = int(data['flush_interval_seconds'])
        if interval < 10 or interval > 300:
            return jsonify({'error': 'Flush interval must be between 10 and 300 seconds'}), 400
        update_setting('browser_logging_flush_interval', interval)

    if 'max_buffer_size' in data:
        buffer_size = int(data['max_buffer_size'])
        if buffer_size < 50 or buffer_size > 500:
            return jsonify({'error': 'Buffer size must be between 50 and 500'}), 400
        update_setting('browser_logging_buffer_size', buffer_size)

    return jsonify({
        'success': True,
        'config': {
            'enabled': get_setting('browser_logging_enabled', False),
            'min_log_level': get_setting('browser_logging_level', 'error'),
            'flush_interval_seconds': get_setting('browser_logging_flush_interval', 60),
            'max_buffer_size': get_setting('browser_logging_buffer_size', 50)
        }
    })
