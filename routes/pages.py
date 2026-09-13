"""
Core page routes: index, mobile, mixer, service worker.
"""

import os
import json
import time

from flask import Blueprint, render_template, request
from flask_login import login_required, current_user

from core.config import get_setting, APP_VERSION
from extensions import (
    user_session_manager,
    get_model_display_name, is_mobile_user_agent,
)
from core.logging_config import get_logger

logger = get_logger(__name__)

pages_bp = Blueprint('pages', __name__)


@pages_bp.app_context_processor
def inject_app_version():
    """Expose the single application version to every template."""
    return {'app_version': APP_VERSION}


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

    cache_buster = int(time.time())
    return render_template(
        'index.html',
        current_username=current_user.username,
        current_user=current_user,
        enable_youtube=enable_youtube,
        cache_buster=cache_buster
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
    video_id_hint = getattr(extraction, 'video_id', None) if extraction else None

    # Analysis (BPM, chords, beat grid, Skip Intro, structure) only lives in the
    # database: an in-memory extraction item (a song extracted since the server
    # started) carries none of it, so the database record is looked up either way.
    db_extraction = None
    try:
        from core.downloads_db import list_extractions_for
        # Exact id / video_id matches win over the filename-prefix fallback.
        prefix_match = None
        for candidate in list_extractions_for(current_user.id):
            video_id = candidate.get('video_id', '')
            if (f"download_{candidate['id']}" == extraction_id or video_id == extraction_id
                    or (video_id_hint and video_id == video_id_hint)):
                db_extraction = candidate
                break
            file_path = candidate.get('file_path', '')
            filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''
            if prefix_match is None and filename and extraction_id.startswith(filename):
                prefix_match = candidate
        db_extraction = db_extraction or prefix_match
    except Exception as e:
        print(f"[MIXER] Error loading historical extraction data: {e}")

    if extraction or db_extraction:
        db = db_extraction or {}
        output_paths = {}
        stems_paths_json = db.get('stems_paths')
        if stems_paths_json:
            try:
                output_paths = json.loads(stems_paths_json)
            except (json.JSONDecodeError, TypeError):
                pass
        if extraction and extraction.output_paths:
            output_paths = extraction.output_paths

        extraction_info = {
            'extraction_id': extraction.extraction_id if extraction else extraction_id,
            'video_id': video_id_hint or db.get('video_id'),
            'status': extraction.status.value if extraction else 'completed',
            'output_paths': output_paths,
            'audio_path': extraction.audio_path if extraction else db.get('file_path'),
            'title': (getattr(extraction, 'title', None) if extraction else None) or db.get('title'),
            'extraction_model': get_model_display_name(
                getattr(extraction, 'model_name', None) if extraction
                else db.get('extraction_model', 'htdemucs')),
            'detected_bpm': db.get('detected_bpm'),
            'detected_key': db.get('detected_key'),
            'analysis_confidence': db.get('analysis_confidence'),
            'chords_data': db.get('chords_data'),
            'beat_offset': db.get('beat_offset') or 0.0,
            'beat_times': db.get('beat_times'),
            'beat_positions': db.get('beat_positions'),
            'music_start_time': db.get('music_start_time') or 0.0,
            'metronome_offset_ms': db.get('metronome_offset_ms') or 0.0,
            'structure_data': db.get('structure_data'),
        }

    cache_buster = int(time.time())
    return render_template('mixer.html', extraction_id=extraction_id, extraction_info=extraction_info, cache_buster=cache_buster)
