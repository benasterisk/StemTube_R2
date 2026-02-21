"""
Shared extensions and objects used across all blueprints.

This module holds singleton instances (socketio, login_manager, etc.)
and the UserSessionManager class so that every blueprint can import them
without circular dependencies.
"""

import os
import re
import uuid
import time
import logging
from functools import wraps

from flask import session, jsonify, redirect, url_for, flash
from flask_socketio import SocketIO
from flask_login import LoginManager, current_user

from core.logging_config import get_logger, get_processing_logger, log_with_context
from core.download_manager import DownloadManager, DownloadItem, DownloadType, DownloadStatus
from core.stems_extractor import StemsExtractor, ExtractionItem, ExtractionStatus
from core.config import get_setting
from core.downloads_db import (
    find_global_download as db_find_global_download,
    add_user_access as db_add_user_access,
    get_user_download_id_by_video_id as db_get_user_download_id,
    find_global_extraction as db_find_global_extraction,
    add_user_extraction_access as db_add_user_extraction_access,
    mark_extraction_complete as db_mark_extraction_complete,
    list_extractions_for as db_list_extractions,
    clear_extraction_in_progress as db_clear_extraction_in_progress,
    add_or_update as db_add_download,
)

logger = get_logger(__name__)
processing_logger = get_processing_logger()

# ── Singleton instances (initialized in create_app) ──────────────────

socketio = SocketIO()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'
login_manager.login_message = 'Please log in to access this page.'
login_manager.login_message_category = 'error'

# ── Constants ────────────────────────────────────────────────────────

COOKIES_FILE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'core', 'youtube_cookies.txt'
)

# ── Utility functions ────────────────────────────────────────────────

def get_model_display_name(model_key):
    """Convert model key to display name."""
    from core.config import STEM_MODELS
    if model_key in STEM_MODELS:
        return STEM_MODELS[model_key]["name"]
    return model_key


def is_valid_youtube_video_id(video_id):
    """Validate a YouTube video ID."""
    if not video_id or not isinstance(video_id, str):
        return False
    if len(video_id) != 11:
        return False
    if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        return False
    return True


def is_mobile_user_agent(user_agent: str) -> bool:
    """Simple heuristic to detect mobile browsers from the user-agent string."""
    if not user_agent:
        return False

    ua = user_agent.lower()

    mobile_indicators = (
        "iphone", "android", "ipad", "ipod", "mobile",
        "blackberry", "opera mini", "opera mobi", "windows phone",
        "webos", "fennec", "kindle", "silk", "palm", "phone",
    )

    if any(indicator in ua for indicator in mobile_indicators):
        if "windows" in ua and "phone" not in ua:
            return False
        if "macintosh" in ua and "mobile" not in ua and "ipad" not in ua:
            return False
        return True

    return False


# ── Decorators ───────────────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('You do not have permission to access this page.', 'error')
            return redirect(url_for('pages.index'))
        return f(*args, **kwargs)
    return decorated_function


def api_admin_required(f):
    """Admin required decorator for API endpoints - returns JSON error instead of redirect."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({
                'error': 'Forbidden',
                'message': 'Admin access required'
            }), 403
        return f(*args, **kwargs)
    return decorated_function


def api_login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({
                'error': 'Unauthorized',
                'message': 'Authentication required',
                'redirect': url_for('auth.login')
            }), 401
        return f(*args, **kwargs)
    return decorated_function


def youtube_access_required(f):
    """Decorator to check both global and per-user YouTube access."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not get_setting('enable_youtube_features', False):
            return jsonify({'error': 'YouTube features are disabled globally'}), 403
        if not current_user.youtube_enabled:
            return jsonify({'error': 'You do not have YouTube access'}), 403
        return f(*args, **kwargs)
    return decorated_function


# ── UserSessionManager ───────────────────────────────────────────────

class UserSessionManager:
    """Stable per-user (or per-anonymous) managers keyed by a deterministic id."""

    def __init__(self):
        self.download_managers: dict[str, DownloadManager] = {}
        self.stems_extractors: dict[str, StemsExtractor] = {}
        self.pending_reload_users: dict[str, set[int]] = {}

    # ---------- internal helper ----------
    def _key(self) -> str:
        """Return stable key: 'user_<id>' or consistent anonymous key."""
        from flask import has_request_context
        if has_request_context():
            if current_user.is_authenticated:
                return f"user_{current_user.id}"
            if 'anon_key' not in session:
                session['anon_key'] = str(uuid.uuid4())
            return session['anon_key']
        return "background_fallback"

    # ---------- download manager ----------
    def get_download_manager(self) -> DownloadManager:
        key = self._key()
        if key not in self.download_managers:
            dm = DownloadManager()
            room_key = key
            user_id = current_user.id if current_user and current_user.is_authenticated else None
            dm.on_download_progress = (
                lambda item_id, progress, speed=None, eta=None, rk=room_key:
                    self._emit_progress_with_room(item_id, progress, speed, eta, rk)
            )
            dm.on_download_complete = (
                lambda item_id, title=None, file_path=None, download_item=None,
                       rk=room_key, uid=user_id, dm_ref=dm, manager_key=key:
                    self._emit_complete_with_room(
                        item_id, title, file_path, rk, uid,
                        dm_instance=dm_ref, dm_key=manager_key,
                        download_item=download_item
                    )
            )
            dm.on_download_error = (
                lambda item_id, error, rk=room_key:
                    self._emit_error_with_room(item_id, error, rk)
            )
            self.download_managers[key] = dm
        return self.download_managers[key]

    def schedule_reload_user_access(self, video_id: str, user_ids):
        """Store user IDs that should regain access once a video is reloaded."""
        if not video_id:
            return
        existing = self.pending_reload_users.get(video_id, set())
        for user_id in user_ids or []:
            if user_id:
                existing.add(user_id)
        if existing:
            self.pending_reload_users[video_id] = existing
        elif video_id in self.pending_reload_users:
            del self.pending_reload_users[video_id]

    def clear_download_from_all_sessions(self, video_id: str):
        """Remove a download from all active user download managers."""
        print(f"[CLEANUP] Clearing video_id={video_id} from {len(self.download_managers)} active sessions")
        for key, dm in self.download_managers.items():
            removed = dm.remove_download_by_video_id(video_id)
            if removed:
                print(f"[CLEANUP] Removed from session: {key}")

    def clear_extraction_from_all_sessions(self, video_id: str):
        """Remove an extraction from all active user session extractors."""
        print(f"[CLEANUP] Clearing extraction for video_id={video_id} from {len(self.stems_extractors)} active sessions")
        for key, se in self.stems_extractors.items():
            for collection_name in ['queued_extractions', 'active_extractions', 'failed_extractions', 'completed_extractions']:
                collection = getattr(se, collection_name, {})
                keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                for item_key in keys_to_remove:
                    del collection[item_key]
                    print(f"[CLEANUP] Removed {item_key} from {collection_name} in session {key}")

    # ---------- stems extractor ----------
    def get_stems_extractor(self) -> StemsExtractor:
        key = self._key()
        if key not in self.stems_extractors:
            se = StemsExtractor()
            room_key = key
            user_id = current_user.id if current_user and current_user.is_authenticated else None
            se.on_extraction_progress = (
                lambda item_id, progress, status_msg=None, video_id=None, title=None:
                    self._emit_extraction_progress_with_room(item_id, progress, status_msg, room_key, user_id, video_id, title)
            )
            se.on_extraction_complete = (
                lambda item_id, title=None, video_id=None, item=None:
                    self._emit_extraction_complete_with_room(item_id, title, video_id, room_key, user_id, item)
            )
            se.on_extraction_error = (
                lambda item_id, error, video_id=None:
                    self._emit_extraction_error_with_room(item_id, error, room_key, video_id, user_id)
            )
            self.stems_extractors[key] = se
        return self.stems_extractors[key]

    # ---------- safe emitters with room keys ----------
    def _emit_progress_with_room(self, item_id, progress, speed_or_msg=None, eta=None, room_key=None):
        socketio.emit('download_progress', {
            'download_id': item_id,
            'progress': progress,
            'speed': speed_or_msg,
            'eta': eta
        }, room=room_key or self._key())

    def _emit_extraction_progress_with_room(self, item_id, progress, status_msg=None, room_key=None, user_id=None, video_id=None, title=None):
        logger.info(f"[EXTRACTION PROGRESS] Emitting progress for extraction_id={item_id}, progress={progress:.1f}%")
        logger.debug(f"[EXTRACTION PROGRESS] Received data: video_id={video_id}, title={title}, user_id={user_id}")

        download_id = None
        if user_id and video_id is not None and video_id != "":
            try:
                download_id = db_get_user_download_id(user_id, video_id)
                logger.debug(f"[EXTRACTION PROGRESS] Found download_id {download_id} for user {user_id}, video {video_id}")
            except Exception as e:
                logger.warning(f"[EXTRACTION PROGRESS] Could not get download_id for user {user_id}, video {video_id}: {e}")
        else:
            logger.debug(f"[EXTRACTION PROGRESS] Skipping download_id lookup: user_id={user_id}, video_id={video_id}")

        emission_data = {
            'extraction_id': item_id,
            'video_id': video_id,
            'download_id': download_id,
            'progress': progress,
            'status_message': status_msg or "Extracting stems..."
        }

        logger.info(f"[EXTRACTION PROGRESS] Emitting WebSocket event: {emission_data}")
        socketio.emit('extraction_progress', emission_data, room=room_key or self._key())

    def _emit_complete_with_room(self, item_id, title=None, file_path=None, room_key=None, user_id=None, dm_instance=None, dm_key=None, download_item=None):
        if title:
            video_id = getattr(download_item, "video_id", None)

            if not download_item or not video_id:
                candidate_managers = []
                seen_ids = set()

                def _add_candidate(manager):
                    if manager and id(manager) not in seen_ids:
                        candidate_managers.append(manager)
                        seen_ids.add(id(manager))

                _add_candidate(dm_instance)
                if dm_key:
                    _add_candidate(self.download_managers.get(dm_key))
                if user_id:
                    _add_candidate(self.download_managers.get(f"user_{user_id}"))
                if not candidate_managers:
                    for manager in self.download_managers.values():
                        _add_candidate(manager)

                for manager in candidate_managers:
                    if not manager:
                        continue
                    for status in ['active', 'completed', 'failed']:
                        for item in manager.get_all_downloads().get(status, []):
                            if item.download_id == item_id:
                                download_item = item
                                video_id = item.video_id
                                break
                        if download_item:
                            break
                    if download_item:
                        break

            if not video_id:
                logger.warning(f"Could not find video_id for download {item_id}, using fallback extraction")
                if '_' in item_id:
                    parts = item_id.split('_')
                    video_id = '_'.join(parts[:-1])
                else:
                    video_id = item_id

            with log_with_context(logger, video_id=video_id):
                logger.debug(f"Download completion: item_id={item_id}, found_in_manager={download_item is not None}")

            global_download_id = None
            if user_id and download_item:
                file_size = 0
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                    except:
                        file_size = 0

                global_download_id = db_add_download(user_id, {
                    "video_id": download_item.video_id,
                    "title": download_item.title,
                    "thumbnail_url": download_item.thumbnail_url or None,
                    "file_path": file_path,
                    "download_type": download_item.download_type.value,
                    "quality": download_item.quality,
                    "file_size": file_size
                })

                pending_reload_users = self.pending_reload_users.pop(download_item.video_id, set()) if download_item.video_id in self.pending_reload_users else set()
                if pending_reload_users:
                    try:
                        global_download = db_find_global_download(download_item.video_id, download_item.download_type.value, download_item.quality)
                        if global_download:
                            restored = 0
                            for reload_user_id in pending_reload_users:
                                if not reload_user_id or reload_user_id == user_id:
                                    continue
                                try:
                                    db_add_user_access(reload_user_id, global_download)
                                    restored += 1
                                except Exception as e:
                                    logger.warning(f"Failed to restore access for user {reload_user_id} on video {download_item.video_id}: {e}")
                            if restored:
                                logger.info(f"Restored access for {restored} user(s) after reload of video {download_item.video_id}")
                    except Exception as e:
                        logger.error(f"Failed to restore reload access for video {download_item.video_id}: {e}", exc_info=True)
            elif user_id:
                file_size = 0
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                    except:
                        file_size = 0

                if '_' in item_id:
                    parts = item_id.split('_')
                    fallback_video_id = '_'.join(parts[:-1])
                else:
                    fallback_video_id = item_id

                with log_with_context(logger, video_id=fallback_video_id):
                    logger.debug(f"Fallback db save: item_id={item_id}")

                global_download_id = db_add_download(user_id, {
                    "video_id": fallback_video_id,
                    "title": title,
                    "thumbnail_url": "",
                    "file_path": file_path,
                    "download_type": "audio",
                    "quality": "best",
                    "file_size": file_size
                })

            socketio.emit('download_complete', {
                'download_id': item_id,
                'title': title,
                'file_path': file_path,
                'video_id': video_id,
                'global_download_id': global_download_id
            }, room=room_key or self._key())

    def _emit_error_with_room(self, item_id, error, room_key=None):
        socketio.emit('download_error', {'download_id': item_id, 'error_message': error}, room=room_key or self._key())

    def _emit_extraction_error_with_room(self, item_id, error, room_key=None, video_id=None, user_id=None):
        logger.error(f"Extraction error: item_id={item_id}, error={error}, video_id={video_id}, user_id={user_id}")
        socketio.emit('extraction_error', {'extraction_id': item_id, 'error_message': error}, room=room_key or self._key())

        if video_id:
            with log_with_context(logger, video_id=video_id, user_id=user_id):
                logger.info("Clearing extracting flag for failed extraction (global and user-specific)")
            try:
                db_clear_extraction_in_progress(video_id, user_id)
                logger.debug("Successfully cleared extracting flags")
            except Exception as db_error:
                logger.error(f"Error clearing extracting flag: {db_error}")

    def _emit_extraction_complete_with_room(self, item_id, title=None, video_id=None, room_key=None, user_id=None, item=None):
        """Handle extraction completion - always emits extraction_complete event."""
        with log_with_context(processing_logger, user_id=user_id, video_id=video_id):
            processing_logger.info(f"Extraction finished: {title}")

        logger.debug(f"Extraction complete for {item_id}: video_id='{video_id}', user_id={user_id}")

        if user_id and video_id and item:
            with log_with_context(logger, user_id=user_id, video_id=video_id):
                logger.debug("Processing extraction completion context")
            with log_with_context(processing_logger, video_id=item.video_id):
                processing_logger.debug(f"Extraction details: status={item.status.value}, model={item.model_name}")
            print(f"[CALLBACK DEBUG] Stems paths: {item.output_paths}")
            print(f"[CALLBACK DEBUG] Zip path: {item.zip_path}")

            if item and item.video_id:
                print(f"[CALLBACK DEBUG] Persisting extraction to database...")
                try:
                    db_mark_extraction_complete(item.video_id, {
                        "model_name": item.model_name,
                        "stems_paths": item.output_paths or {},
                        "zip_path": item.zip_path or ""
                    })
                    print(f"[CALLBACK DEBUG] Global download marked as extracted")

                    global_download = db_find_global_extraction(item.video_id, item.model_name)
                    if global_download:
                        db_add_user_extraction_access(user_id, global_download)
                        print(f"[CALLBACK DEBUG] User access granted to extraction")

                        user_extractions = db_list_extractions(user_id)
                        print(f"[CALLBACK DEBUG] User now has {len(user_extractions)} extractions in database")
                    else:
                        print(f"[CALLBACK DEBUG] ERROR: Could not find global extraction after marking complete")
                except Exception as e:
                    print(f"[CALLBACK DEBUG] ERROR: Failed to persist extraction to database: {e}")
                    import traceback
                    traceback.print_exc()

                # AUTO-DETECT LYRICS after stems are ready
                try:
                    vocals_path = item.output_paths.get('vocals') if item.output_paths else None
                    if vocals_path and os.path.exists(vocals_path):
                        logger.info(f"[LYRICS] Auto-detecting lyrics using vocals stem: {vocals_path}")
                        socketio.emit('lyrics_progress', {
                            'extraction_id': item_id,
                            'step': 'auto_start',
                            'message': 'Auto-detecting lyrics...',
                            'video_id': video_id
                        }, room=room_key or self._key())

                        from core.lyrics_detector import detect_lyrics_unified
                        from core.downloads_db import update_download_lyrics

                        model_size = get_setting('lyrics_model_size') or 'medium'
                        use_gpu = get_setting('use_gpu_for_extraction', False)

                        result = detect_lyrics_unified(
                            audio_path=vocals_path,
                            title=title,
                            model_size=model_size,
                            use_gpu=use_gpu,
                            progress_callback=lambda step, msg: socketio.emit('lyrics_progress', {
                                'extraction_id': item_id,
                                'step': step,
                                'message': msg,
                                'video_id': video_id
                            }, room=room_key or self._key())
                        )

                        if result.get('lyrics'):
                            update_download_lyrics(video_id, result['lyrics'])
                            logger.info(f"[LYRICS] Auto-detected: {len(result['lyrics'])} segments ({result.get('source')})")
                            socketio.emit('lyrics_progress', {
                                'extraction_id': item_id,
                                'step': 'auto_complete',
                                'message': f"Lyrics ready: {len(result['lyrics'])} segments",
                                'video_id': video_id,
                                'source': result.get('source')
                            }, room=room_key or self._key())
                        else:
                            logger.warning("[LYRICS] Auto-detection failed - no lyrics found")
                    else:
                        logger.debug("[LYRICS] No vocals stem available for auto-detection")
                except Exception as lyrics_error:
                    logger.warning(f"[LYRICS] Auto-detection error (non-fatal): {lyrics_error}")

                # AUTO-DETECT BEATS after stems are ready (madmom downbeat detection)
                try:
                    audio_path = item.audio_path if hasattr(item, 'audio_path') else None
                    if audio_path and os.path.exists(audio_path):
                        logger.info(f"[BEATS] Running madmom downbeat detection on {audio_path}")
                        socketio.emit('extraction_progress', {
                            'extraction_id': item_id,
                            'progress': 90,
                            'message': 'Detecting beats...',
                            'video_id': video_id
                        }, room=room_key or self._key())

                        from core.madmom_chord_detector import MadmomChordDetector
                        from core.downloads_db import update_download_analysis

                        detector = MadmomChordDetector()

                        # Get existing BPM as hint from global_downloads
                        known_bpm = None
                        try:
                            from core.db.connection import _conn
                            with _conn() as conn:
                                row = conn.execute(
                                    "SELECT detected_bpm, detected_key, analysis_confidence, chords_data, structure_data, lyrics_data FROM global_downloads WHERE video_id=?",
                                    (video_id,)
                                ).fetchone()
                                if row:
                                    known_bpm = row['detected_bpm']
                                    existing_key = row['detected_key']
                                    existing_confidence = row['analysis_confidence']
                                    existing_chords = row['chords_data']
                                    existing_structure = row['structure_data']
                                    existing_lyrics = row['lyrics_data']
                                else:
                                    existing_key = None
                                    existing_confidence = None
                                    existing_chords = None
                                    existing_structure = None
                                    existing_lyrics = None
                        except Exception:
                            existing_key = None
                            existing_confidence = None
                            existing_chords = None
                            existing_structure = None
                            existing_lyrics = None

                        beat_offset, beats, beat_positions = detector._detect_beats(audio_path, known_bpm=known_bpm)
                        beat_times_list = [round(float(t), 4) for t in beats] if len(beats) > 0 else []

                        if beat_times_list:
                            # Preserve existing chords/structure/lyrics — parse JSON back since update_download_analysis re-serializes
                            import json as _json
                            _existing_structure = _json.loads(existing_structure) if existing_structure else None
                            _existing_lyrics = _json.loads(existing_lyrics) if existing_lyrics else None
                            update_download_analysis(
                                video_id,
                                detected_bpm=known_bpm,
                                detected_key=existing_key,
                                analysis_confidence=existing_confidence,
                                chords_data=existing_chords,
                                structure_data=_existing_structure,
                                lyrics_data=_existing_lyrics,
                                beat_offset=beat_offset,
                                beat_times=beat_times_list,
                                beat_positions=beat_positions
                            )
                            logger.info(f"[BEATS] Detected {len(beat_times_list)} beats, "
                                        f"{sum(1 for p in beat_positions if p == 1)} downbeats")
                        else:
                            logger.warning("[BEATS] No beats detected")

                        socketio.emit('extraction_progress', {
                            'extraction_id': item_id,
                            'progress': 98,
                            'message': 'Beat detection complete',
                            'video_id': video_id
                        }, room=room_key or self._key())
                    else:
                        logger.debug("[BEATS] No audio file available for beat detection")
                except Exception as beat_error:
                    logger.warning(f"[BEATS] Beat detection error (non-fatal): {beat_error}")
        else:
            print(f"[CALLBACK DEBUG] Missing user_id, video_id, or item data")

        # Emit socket events (after database is updated)
        download_id = None
        if user_id and video_id:
            try:
                download_id = db_get_user_download_id(user_id, video_id)
                logger.debug(f"Found download_id {download_id} for user {user_id}, video {video_id}")
            except Exception as e:
                logger.warning(f"Could not get download_id for user {user_id}, video {video_id}: {e}")

        socketio.emit('extraction_complete', {
            'extraction_id': item_id,
            'video_id': video_id,
            'download_id': download_id,
            'title': title
        }, room=room_key or self._key())

        logger.debug("Broadcasting extraction completion to ALL connected clients")
        try:
            socketio.emit('extraction_completed_global', {
                'extraction_id': item_id,
                'video_id': video_id,
                'title': title
            }, namespace='/')
            logger.debug("Global broadcast sent to all clients")
        except Exception as e:
            logger.error(f"Error sending global broadcast: {e}")

        try:
            socketio.emit('extraction_refresh_needed', {
                'extraction_id': item_id,
                'video_id': video_id,
                'title': title,
                'message': 'New extraction available - please refresh'
            })
            logger.debug("Alternative global event sent")
        except Exception as e:
            logger.error(f"Error sending alternative event: {e}")

    # ---------- legacy emitters (kept for compatibility) ----------
    def _emit_progress(self, item_id, progress, speed_or_msg=None, eta=None):
        self._emit_progress_with_room(item_id, progress, speed_or_msg, eta, self._key())

    def _emit_complete(self, item_id, title=None, file_path=None):
        user_id = current_user.id if current_user and current_user.is_authenticated else None
        dm = self.get_download_manager()
        self._emit_complete_with_room(
            item_id, title, file_path, self._key(), user_id,
            dm_instance=dm, dm_key=self._key()
        )

    def _emit_error(self, item_id, error):
        self._emit_error_with_room(item_id, error, self._key())


# ── Singleton instances ──────────────────────────────────────────────

user_session_manager = UserSessionManager()
active_jam_sessions = {}  # {code: {host_sid, host_user_id, host_name, ...}}
aiotube_client = None  # Initialized in create_app

def init_aiotube_client():
    """Initialize the aiotube client (called from create_app)."""
    global aiotube_client
    from core.aiotube_client import get_aiotube_client
    aiotube_client = get_aiotube_client()
    return aiotube_client
