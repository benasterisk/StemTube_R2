"""
Core page routes: index, mobile, mixer, service worker.
"""

import os
import json
import time

from flask import Blueprint, render_template, request
from flask_login import login_required, current_user

from core.config import get_setting
from extensions import (
    user_session_manager,
    get_model_display_name, is_mobile_user_agent,
)
from core.logging_config import get_logger

logger = get_logger(__name__)

pages_bp = Blueprint('pages', __name__)


@pages_bp.route('/sw.js')
def service_worker():
    """Serve Service Worker from root with proper scope header."""
    from flask import send_from_directory, current_app
    response = send_from_directory(
        os.path.join(current_app.static_folder),
        'sw.js',
        mimetype='application/javascript'
    )
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Cache-Control'] = 'no-cache'
    return response


@pages_bp.route('/')
@login_required
def index():
    mobile_enabled = get_setting('mobile_optimized_mode', True)
    user_agent = request.headers.get('User-Agent', '')

    global_youtube = get_setting('enable_youtube_features', False)
    user_youtube = current_user.youtube_enabled
    enable_youtube = global_youtube and user_youtube

    if mobile_enabled and is_mobile_user_agent(user_agent):
        cache_buster = int(time.time())
        return render_template(
            'mobile-index.html',
            current_username=current_user.username,
            current_user=current_user,
            cache_buster=cache_buster,
            enable_youtube=enable_youtube
        )

    return render_template(
        'index.html',
        current_username=current_user.username,
        current_user=current_user,
        enable_youtube=enable_youtube
    )


@pages_bp.route('/mobile')
@login_required
def mobile():
    """Explicit mobile interface route for direct access."""
    cache_buster = int(time.time())
    global_youtube = get_setting('enable_youtube_features', False)
    user_youtube = current_user.youtube_enabled
    enable_youtube = global_youtube and user_youtube
    return render_template(
        'mobile-index.html',
        current_username=current_user.username,
        current_user=current_user,
        cache_buster=cache_buster,
        enable_youtube=enable_youtube
    )


@pages_bp.route('/mixer')
@login_required
def mixer():
    extraction_id = request.args.get('extraction_id', '')

    extraction_info = None
    se = user_session_manager.get_stems_extractor()
    extraction = se.get_extraction_status(extraction_id)

    if extraction:
        extraction_info = {
            'extraction_id': extraction.extraction_id,
            'status': extraction.status.value,
            'output_paths': extraction.output_paths or {},
            'audio_path': extraction.audio_path,
            'title': getattr(extraction, 'title', None),
            'extraction_model': get_model_display_name(getattr(extraction, 'model_name', 'htdemucs')),
            'detected_bpm': getattr(extraction, 'detected_bpm', None),
            'detected_key': getattr(extraction, 'detected_key', None),
            'analysis_confidence': getattr(extraction, 'analysis_confidence', None),
            'chords_data': getattr(extraction, 'chords_data', None),
            'beat_offset': getattr(extraction, 'beat_offset', 0.0),
            'beat_times': getattr(extraction, 'beat_times', None)
        }
    else:
        try:
            from core.downloads_db import list_extractions_for
            db_extractions = list_extractions_for(current_user.id)

            for db_extraction in db_extractions:
                db_id = f"download_{db_extraction['id']}"
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''

                matches = (
                    db_id == extraction_id or
                    video_id == extraction_id or
                    (filename and extraction_id.startswith(filename))
                )

                if matches:
                    output_paths = {}
                    stems_paths_json = db_extraction.get('stems_paths')
                    if stems_paths_json:
                        try:
                            output_paths = json.loads(stems_paths_json)
                        except (json.JSONDecodeError, TypeError):
                            pass

                    extraction_info = {
                        'extraction_id': extraction_id,
                        'status': 'completed',
                        'output_paths': output_paths,
                        'audio_path': db_extraction['file_path'],
                        'title': db_extraction.get('title'),
                        'extraction_model': get_model_display_name(db_extraction.get('extraction_model', 'htdemucs')),
                        'detected_bpm': db_extraction.get('detected_bpm'),
                        'detected_key': db_extraction.get('detected_key'),
                        'analysis_confidence': db_extraction.get('analysis_confidence'),
                        'chords_data': db_extraction.get('chords_data'),
                        'beat_offset': db_extraction.get('beat_offset', 0.0),
                        'beat_times': db_extraction.get('beat_times')
                    }
                    break
        except Exception as e:
            print(f"[MIXER] Error loading historical extraction data: {e}")

    return render_template('mixer.html', extraction_id=extraction_id, extraction_info=extraction_info)
