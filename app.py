"""
Main Flask application for StemTube Web.
Provides a web interface for YouTube browsing, downloading, and stem extraction.
"""
# CRITICAL: Configure GPU libraries BEFORE any imports
# LD_LIBRARY_PATH must be set before Python's dynamic linker loads libraries
import os
import sys

def configure_gpu_and_restart():
    """
    Configure LD_LIBRARY_PATH for CUDA/cuDNN and restart Python if needed.

    This MUST be the very first code that runs, before ANY imports.
    The dynamic linker needs LD_LIBRARY_PATH set before loading libraries.
    """
    # Check if already configured (prevent infinite restart loop)
    if os.environ.get('_STEMTUBE_GPU_CONFIGURED') == '1':
        print(f"[INIT] ✅ GPU libraries configured: LD_LIBRARY_PATH={os.environ.get('LD_LIBRARY_PATH', 'NOT SET')}")
        return  # Already configured, continue normal startup

    try:
        # Get site-packages directory
        import site
        site_packages = site.getsitepackages()[0]
        cudnn_lib_path = os.path.join(site_packages, 'nvidia', 'cudnn', 'lib')

        if os.path.exists(cudnn_lib_path):
            current_ld_path = os.environ.get('LD_LIBRARY_PATH', '')

            # Only restart if cuDNN path not already in LD_LIBRARY_PATH
            if cudnn_lib_path not in current_ld_path:
                # Prepend cuDNN path
                if current_ld_path:
                    os.environ['LD_LIBRARY_PATH'] = f"{cudnn_lib_path}:{current_ld_path}"
                else:
                    os.environ['LD_LIBRARY_PATH'] = cudnn_lib_path

                # Mark as configured
                os.environ['_STEMTUBE_GPU_CONFIGURED'] = '1'

                print(f"[INIT] 🔄 Restarting with GPU library path: {cudnn_lib_path}")

                # Re-execute Python with updated environment
                os.execv(sys.executable, [sys.executable] + sys.argv)
            else:
                print(f"[INIT] ✅ GPU libraries already configured")
        else:
            print(f"[INIT] ℹ️  No GPU libraries found (CPU mode)")

    except Exception as e:
        print(f"[INIT] ⚠️  Could not configure GPU: {e}")

# Run configuration check and potentially restart
configure_gpu_and_restart()

# If we reach here, LD_LIBRARY_PATH is configured (or not needed)
# Now safe to import everything else
import ssl
ssl._create_default_https_context = ssl._create_unverified_context

import json
import time
import uuid
import subprocess
import tempfile
import shutil
import re
import mimetypes
from datetime import datetime
from functools import wraps

# Setup logging first (before other imports)
from core.logging_config import (
    setup_logging, get_logger, get_access_logger, get_database_logger, get_processing_logger,
    log_request, log_user_action, log_database_operation, log_processing_event, log_with_context
)

# Initialize logging system
log_config = setup_logging(app_name="stemtube", log_level="INFO")
logger = get_logger(__name__)
access_logger = get_access_logger()
db_logger = get_database_logger()
processing_logger = get_processing_logger()

logger.info("StemTube Web application starting up...")

from flask import (
    Flask, render_template, request, jsonify, send_from_directory,
    redirect, url_for, flash, session
)
from werkzeug.utils import secure_filename
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_login import (
    LoginManager, login_user, logout_user, login_required, current_user
)
from flask_session import Session

# Core modules
from core.aiotube_client import get_aiotube_client
from core.download_manager import (
    DownloadManager, DownloadItem, DownloadType, DownloadStatus
)
from core.stems_extractor import (
    StemsExtractor, ExtractionItem, ExtractionStatus
)
from core.config import (
    get_setting, update_setting, get_ffmpeg_path, get_ffprobe_path,
    ensure_ffmpeg_available, ensure_valid_downloads_directory,
    PORT, HOST, DOWNLOADS_DIR
)
from core.auth_db import (
    init_db, authenticate_user, get_user_by_id, get_user_by_username,
    create_user, update_user, change_password, delete_user, get_all_users,
    add_user, reset_user_password, set_user_youtube_access
)
from core.auth_models import User

# Persistent downloads DB
from core.downloads_db import (
    init_table as init_downloads_table,
    add_or_update as db_add_download,
    delete_from as db_delete_download,
    list_for as db_list_downloads,
    find_global_download as db_find_global_download,
    add_user_access as db_add_user_access,
    get_user_download_id_by_video_id as db_get_user_download_id,
    # Extraction functions from same table
    find_global_extraction as db_find_global_extraction,
    find_any_global_extraction as db_find_any_global_extraction,
    find_or_reserve_extraction as db_find_or_reserve_extraction,
    mark_extraction_complete as db_mark_extraction_complete,
    add_user_extraction_access as db_add_user_extraction_access,
    list_extractions_for as db_list_extractions,
    set_extraction_in_progress as db_set_extraction_in_progress,
    set_user_extraction_in_progress as db_set_user_extraction_in_progress,
    clear_extraction_in_progress as db_clear_extraction_in_progress,
    cleanup_stuck_extractions,
    cleanup_duplicate_user_downloads,
    comprehensive_cleanup
)

# ------------------------------------------------------------------
# yt-dlp Auto-Update at Startup
# ------------------------------------------------------------------
def check_ytdlp_update():
    """Check and update yt-dlp nightly at startup to avoid YouTube blocks."""
    try:
        print("[STARTUP] Checking for yt-dlp nightly updates...")
        # Use nightly build (--pre) for latest YouTube fixes
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "--pre", "--quiet", "yt-dlp[default]"],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode == 0:
            # Get installed version
            import yt_dlp
            print(f"[STARTUP] yt-dlp nightly is up to date: {yt_dlp.version.__version__}")
        else:
            print(f"[STARTUP] Warning: yt-dlp update check failed: {result.stderr}")
    except Exception as e:
        print(f"[STARTUP] Warning: Could not check yt-dlp updates: {e}")

# Run yt-dlp update check at startup
check_ytdlp_update()

# Helper function to get model display name
def get_model_display_name(model_key):
    """Convert model key to display name."""
    from core.config import STEM_MODELS
    if model_key in STEM_MODELS:
        return STEM_MODELS[model_key]["name"]
    return model_key  # fallback to raw key

# ------------------------------------------------------------------
# Utility Functions
# ------------------------------------------------------------------
def is_valid_youtube_video_id(video_id):
    """Validate a YouTube video ID."""
    if not video_id or not isinstance(video_id, str):
        return False
    
    # YouTube video IDs are exactly 11 characters
    if len(video_id) != 11:
        return False
    
    # Only alphanumeric, hyphen, and underscore are allowed
    if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        return False

    return True


def is_mobile_user_agent(user_agent: str) -> bool:
    """Simple heuristic to detect mobile browsers from the user-agent string."""
    if not user_agent:
        return False

    ua = user_agent.lower()

    # Treat common mobile and tablet identifiers as mobile clients
    mobile_indicators = (
        "iphone",
        "android",
        "ipad",
        "ipod",
        "mobile",
        "blackberry",
        "opera mini",
        "opera mobi",
        "windows phone",
        "webos",
        "fennec",
        "kindle",
        "silk",
        "palm",
        "phone",
    )

    if any(indicator in ua for indicator in mobile_indicators):
        # Guard against desktop spoofing strings that include "mobile" for other reasons
        if "windows" in ua and "phone" not in ua:
            return False
        if "macintosh" in ua and "mobile" not in ua and "ipad" not in ua:
            return False
        return True

    return False

# ------------------------------------------------------------------
# Bootstrap
# ------------------------------------------------------------------
logger.info("Initializing application components...")

# Validate and fix cross-platform path issues
from core.config import validate_and_fix_config_paths
validate_and_fix_config_paths()

ensure_ffmpeg_available()
logger.info("FFmpeg availability ensured")

init_db()
logger.info("Authentication database initialized")

init_downloads_table()
logger.info("Downloads database initialized")

comprehensive_cleanup()
logger.info("Database cleanup completed")

# ------------------------------------------------------------------
# Flask & SocketIO setup
# ------------------------------------------------------------------
logger.info("Setting up Flask application and SocketIO...")
app = Flask(__name__)

# Security: FLASK_SECRET_KEY is MANDATORY for all environments
# Since all instances (dev/prod) are exposed via ngrok, we enforce strict security
SECRET_KEY = os.environ.get('FLASK_SECRET_KEY')
if not SECRET_KEY:
    logger.error("=" * 80)
    logger.error("FATAL ERROR: FLASK_SECRET_KEY environment variable is not set!")
    logger.error("=" * 80)
    logger.error("")
    logger.error("All StemTube instances must use secure credentials.")
    logger.error("")
    logger.error("Quick Fix:")
    logger.error("  1. cp .env.example .env")
    logger.error("  2. python -c \"import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))\" >> .env")
    logger.error("  3. chmod 600 .env")
    logger.error("  4. Restart application")
    logger.error("")
    logger.error("See SECURITY_NOTICE.md for detailed instructions")
    logger.error("=" * 80)
    raise RuntimeError("Missing required environment variable: FLASK_SECRET_KEY")

app.config['SECRET_KEY'] = SECRET_KEY
logger.info("Flask SECRET_KEY loaded from environment ✓")

app.config['TEMPLATES_AUTO_RELOAD'] = True  # Force template reload on change
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 86400
app.config['SESSION_FILE_DIR'] = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'flask_session')
os.makedirs(app.config['SESSION_FILE_DIR'], exist_ok=True)

# Cookie configuration for cross-browser compatibility (Firefox, Chrome, Safari)
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True only if using HTTPS
app.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
app.config['REMEMBER_COOKIE_HTTPONLY'] = True

sess = Session(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'
login_manager.login_message_category = 'error'

@login_manager.user_loader
def load_user(user_id):
    user_data = get_user_by_id(user_id)
    return User(user_data) if user_data else None

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    async_mode='threading',
    manage_session=False
)

# Setup request logging middleware
from core.request_logging import setup_request_logging
setup_request_logging(app)
logger.info("Request logging middleware configured")

# ------------------------------------------------------------------
# Global YouTube client
# ------------------------------------------------------------------
aiotube_client = get_aiotube_client()
# ------------------------------------------------------------------
# UserSessionManager  (replaces the old one)
# ------------------------------------------------------------------
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
            # anonymous – keep same UUID across refresh
            if 'anon_key' not in session:
                session['anon_key'] = str(uuid.uuid4())
            return session['anon_key']
        # background thread (no request context) – dummy fallback
        return "background_fallback"

    # ---------- download manager ----------
    def get_download_manager(self) -> DownloadManager:
        key = self._key()
        if key not in self.download_managers:
            dm = DownloadManager()
            # Capture the room key for background callbacks
            room_key = key
            user_id = current_user.id if current_user and current_user.is_authenticated else None
            dm.on_download_progress = (
                lambda item_id, progress, speed=None, eta=None, rk=room_key: self._emit_progress_with_room(item_id, progress, speed, eta, rk)
            )
            dm.on_download_complete = (
                lambda item_id, title=None, file_path=None, download_item=None, rk=room_key, uid=user_id, dm_ref=dm, manager_key=key: self._emit_complete_with_room(
                    item_id,
                    title,
                    file_path,
                    rk,
                    uid,
                    dm_instance=dm_ref,
                    dm_key=manager_key,
                    download_item=download_item
                )
            )
            dm.on_download_error = lambda item_id, error, rk=room_key: self._emit_error_with_room(item_id, error, rk)
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
        """Remove a download from all active user download managers.

        Called when admin deletes a download via cleanup to ensure it
        disappears from user libraries immediately.
        """
        print(f"[CLEANUP] Clearing video_id={video_id} from {len(self.download_managers)} active sessions")
        for key, dm in self.download_managers.items():
            removed = dm.remove_download_by_video_id(video_id)
            if removed:
                print(f"[CLEANUP] Removed from session: {key}")

    def clear_extraction_from_all_sessions(self, video_id: str):
        """Remove an extraction from all active user session extractors.

        Called when admin resets extraction to ensure the in-memory
        state matches the database state.
        """
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
            # Capture the room key for background callbacks
            room_key = key
            user_id = current_user.id if current_user and current_user.is_authenticated else None
            # FIX: Pass video_id and title in progress callback to avoid lookup issues in background threads
            se.on_extraction_progress = lambda item_id, progress, status_msg=None, video_id=None, title=None: self._emit_extraction_progress_with_room(item_id, progress, status_msg, room_key, user_id, video_id, title)
            se.on_extraction_complete = lambda item_id, title=None, video_id=None, item=None: self._emit_extraction_complete_with_room(item_id, title, video_id, room_key, user_id, item)
            se.on_extraction_error   = lambda item_id, error, video_id=None: self._emit_extraction_error_with_room(item_id, error, room_key, video_id, user_id)
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
        # FIX: video_id and title are now passed directly from the extraction item
        # This avoids the background thread issue where get_stems_extractor() returns wrong instance

        # Debug logging for extraction progress
        logger.info(f"[EXTRACTION PROGRESS] Emitting progress for extraction_id={item_id}, progress={progress:.1f}%")
        logger.debug(f"[EXTRACTION PROGRESS] Received data: video_id={video_id}, title={title}, user_id={user_id}")

        # Get user's download_id for this video to update the correct DOM element
        download_id = None
        # IMPORTANT: Check for None explicitly, not falsiness (empty string "" is valid)
        if user_id and video_id is not None and video_id != "":
            try:
                download_id = db_get_user_download_id(user_id, video_id)
                logger.debug(f"[EXTRACTION PROGRESS] Found download_id {download_id} for user {user_id}, video {video_id}")
            except Exception as e:
                logger.warning(f"[EXTRACTION PROGRESS] Could not get download_id for user {user_id}, video {video_id}: {e}")
        else:
            logger.debug(f"[EXTRACTION PROGRESS] Skipping download_id lookup: user_id={user_id}, video_id={video_id}")

        # Prepare emission data
        emission_data = {
            'extraction_id': item_id,
            'video_id': video_id,  # Primary identifier for finding elements
            'download_id': download_id,  # User-specific download record ID
            'progress': progress,
            'status_message': status_msg or "Extracting stems..."
        }

        logger.info(f"[EXTRACTION PROGRESS] Emitting WebSocket event: {emission_data}")

        socketio.emit('extraction_progress', emission_data, room=room_key or self._key())

    def _emit_complete_with_room(self, item_id, title=None, file_path=None, room_key=None, user_id=None, dm_instance=None, dm_key=None, download_item=None):
        if title:  # download finished
            video_id = getattr(download_item, "video_id", None)
            
            if not download_item or not video_id:
                # Build candidate manager list so we can locate the finished download safely
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

                # As a last resort, scan every known manager to find the item
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
                                video_id = item.video_id  # Use the original video_id directly!
                                break
                        if download_item:
                            break
                    if download_item:
                        break
            
            # Fallback only if we couldn't find the item (shouldn't happen)
            if not video_id:
                logger.warning(f"Could not find video_id for download {item_id}, using fallback extraction")
                if '_' in item_id:
                    parts = item_id.split('_')
                    video_id = '_'.join(parts[:-1])
                else:
                    video_id = item_id
                
            with log_with_context(logger, video_id=video_id):
                logger.debug(f"Download completion: item_id={item_id}, found_in_manager={download_item is not None}")
            
            # persist to database first to get global_download_id
            global_download_id = None
            if user_id and download_item:
                # Get file size if possible
                file_size = 0
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                    except:
                        file_size = 0
                
                # Use download_item metadata for database persistence
                global_download_id = db_add_download(user_id, {
                    "video_id": download_item.video_id,
                    "title": download_item.title,
                    "thumbnail_url": download_item.thumbnail_url or None,  # Use None instead of empty string
                    "file_path": file_path,
                    "download_type": download_item.download_type.value,
                    "quality": download_item.quality,
                    "file_size": file_size
                })

                # Restore user access for any admin-triggered reloads
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
                # Fallback if download item not found (shouldn't happen normally)
                file_size = 0
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                    except:
                        file_size = 0
                        
                # Extract video_id properly from item_id (remove only the timestamp)
                if '_' in item_id:
                    parts = item_id.split('_')
                    fallback_video_id = '_'.join(parts[:-1])  # Remove only timestamp
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
            
            # Emit WebSocket event with global_download_id included
            socketio.emit('download_complete', {
                'download_id': item_id, 
                'title': title, 
                'file_path': file_path,
                'video_id': video_id,  # Add video_id for extraction deduplication
                'global_download_id': global_download_id  # Add for remove functionality
            }, room=room_key or self._key())

    def _emit_error_with_room(self, item_id, error, room_key=None):
        socketio.emit('download_error', {'download_id': item_id, 'error_message': error}, room=room_key or self._key())
    
    def _emit_extraction_error_with_room(self, item_id, error, room_key=None, video_id=None, user_id=None):
        logger.error(f"Extraction error: item_id={item_id}, error={error}, video_id={video_id}, user_id={user_id}")
        socketio.emit('extraction_error', {'extraction_id': item_id, 'error_message': error}, room=room_key or self._key())

        # Clear the extracting flag for failed extractions (both global and user-specific)
        # FIX: Use video_id passed directly from the callback instead of looking it up
        # (lookup fails in background threads due to wrong extractor instance)
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

        # DEBUG: Log what we received
        logger.debug(f"Extraction complete for {item_id}: video_id='{video_id}', user_id={user_id}")

        # IMPORTANT: Persist to database FIRST, before emitting socket events
        # This prevents race condition where user clicks "Open Mixer" before DB is updated
        if user_id and video_id and item:
            with log_with_context(logger, user_id=user_id, video_id=video_id):
                logger.debug("Processing extraction completion context")
            with log_with_context(processing_logger, video_id=item.video_id):
                processing_logger.debug(f"Extraction details: status={item.status.value}, model={item.model_name}")
            print(f"[CALLBACK DEBUG] Stems paths: {item.output_paths}")
            print(f"[CALLBACK DEBUG] Zip path: {item.zip_path}")
            
            # Now we have direct access to the extraction item data
            if item and item.video_id:
                print(f"[CALLBACK DEBUG] Persisting extraction to database...")
                try:
                    # Mark the global download as extracted
                    db_mark_extraction_complete(item.video_id, {
                        "model_name": item.model_name,
                        "stems_paths": item.output_paths or {},
                        "zip_path": item.zip_path or ""
                    })
                    print(f"[CALLBACK DEBUG] Global download marked as extracted")
                    
                    # Ensure transaction is committed by using a fresh connection
                    
                    # Give user access to the extraction
                    global_download = db_find_global_extraction(item.video_id, item.model_name)
                    if global_download:
                        db_add_user_extraction_access(user_id, global_download)
                        print(f"[CALLBACK DEBUG] User access granted to extraction")
                        
                        # Verify the database update was successful
                        user_extractions = db_list_extractions(user_id)
                        print(f"[CALLBACK DEBUG] User now has {len(user_extractions)} extractions in database")
                    else:
                        print(f"[CALLBACK DEBUG] ERROR: Could not find global extraction after marking complete")
                except Exception as e:
                    print(f"[CALLBACK DEBUG] ERROR: Failed to persist extraction to database: {e}")
                    import traceback
                    traceback.print_exc()
        else:
            print(f"[CALLBACK DEBUG] Missing user_id, video_id, or item data")

        # NOW emit socket events (after database is updated)
        # Get user's download_id for this video to update the correct DOM element
        download_id = None
        if user_id and video_id:
            try:
                download_id = db_get_user_download_id(user_id, video_id)
                logger.debug(f"Found download_id {download_id} for user {user_id}, video {video_id}")
            except Exception as e:
                logger.warning(f"Could not get download_id for user {user_id}, video {video_id}: {e}")

        # Send to the specific user who initiated the extraction
        socketio.emit('extraction_complete', {
            'extraction_id': item_id,
            'video_id': video_id,
            'download_id': download_id,  # User-specific download record ID
            'title': title
        }, room=room_key or self._key())

        # BROADCAST to ALL connected clients (no room restriction)
        logger.debug("Broadcasting extraction completion to ALL connected clients")
        try:
            # Use namespace='/' to broadcast to all connected clients
            socketio.emit('extraction_completed_global', {
                'extraction_id': item_id,
                'video_id': video_id,
                'title': title
            }, namespace='/')
            logger.debug("Global broadcast sent to all clients")
        except Exception as e:
            logger.error(f"Error sending global broadcast: {e}")

        # Alternative approach: try sending without any room parameter
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
            item_id,
            title,
            file_path,
            self._key(),
            user_id,
            dm_instance=dm,
            dm_key=self._key()
        )

    def _emit_error(self, item_id, error):
        self._emit_error_with_room(item_id, error, self._key())
# Instantiate global manager
user_session_manager = UserSessionManager()

# ------------------------------------------------------------------
# WebSocket helpers
# ------------------------------------------------------------------
@socketio.on('connect')
def handle_connect():
    if not current_user.is_authenticated:
        emit('auth_error', {'redirect': url_for('login')})
        return False
    room = user_session_manager._key()
    join_room(room)
    emit('connection_established', {'session_key': room})

@socketio.on('disconnect')
def handle_disconnect():
    leave_room(user_session_manager._key())


# ------------------------------------------------------------------
# Decorators (must appear BEFORE any route uses them)
# ------------------------------------------------------------------
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('You do not have permission to access this page.', 'error')
            return redirect(url_for('index'))
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
                'redirect': url_for('login')
            }), 401
        return f(*args, **kwargs)
    return decorated_function

def youtube_access_required(f):
    """Decorator to check both global and per-user YouTube access."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check global flag first
        if not get_setting('enable_youtube_features', False):
            return jsonify({'error': 'YouTube features are disabled globally'}), 403
        # Check per-user flag
        if not current_user.youtube_enabled:
            return jsonify({'error': 'You do not have YouTube access'}), 403
        return f(*args, **kwargs)
    return decorated_function

# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@app.route('/sw.js')
def service_worker():
    """Serve Service Worker from root with proper scope header."""
    response = send_from_directory(
        os.path.join(app.static_folder),
        'sw.js',
        mimetype='application/javascript'
    )
    # Allow SW to control entire site even though it's served from /static/
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Cache-Control'] = 'no-cache'
    return response

@app.route('/')
@login_required
def index():
    mobile_enabled = get_setting('mobile_optimized_mode', True)
    user_agent = request.headers.get('User-Agent', '')

    # YouTube access requires both global flag AND per-user flag
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

    return render_template('index.html', current_username=current_user.username, current_user=current_user, enable_youtube=enable_youtube)

@app.route('/mobile')
@login_required
def mobile():
    """Explicit mobile interface route for direct access."""
    cache_buster = int(time.time())
    # YouTube access requires both global flag AND per-user flag
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

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        remember = 'remember' in request.form
        if not username or not password:
            error = 'Username and password are required.'
        else:
            user_data = authenticate_user(username, password)
            if user_data:
                login_user(User(user_data), remember=remember)
                next_page = request.args.get('next') or url_for('index')
                if not next_page.startswith('/'):
                    next_page = url_for('index')
                return redirect(next_page)
            else:
                error = 'Invalid username or password.'
    return render_template('login.html', error=error, current_year=datetime.now().year)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('login'))

@app.route('/admin')
@login_required
@admin_required
def admin():
    return render_template('admin.html', users=get_all_users())

@app.route('/admin/embedded')
@login_required
@admin_required
def admin_embedded():
    """Embedded admin interface for iframe usage."""
    return render_template('admin_embedded.html', users=get_all_users())

@app.route('/admin/add_user', methods=['POST'])
@login_required
@admin_required
def admin_add_user():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '').strip()
    email = request.form.get('email', '').strip() or None
    is_admin = 'is_admin' in request.form
    
    if not username or not password:
        flash('Username and password are required', 'error')
        return redirect(url_for('admin'))
    
    success, message = add_user(username, password, email, is_admin)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin'))

@app.route('/admin/edit_user', methods=['POST'])
@login_required
@admin_required
def admin_edit_user():
    user_id = request.form.get('user_id')
    username = request.form.get('username', '').strip()
    email = request.form.get('email', '').strip() or None
    is_admin = 'is_admin' in request.form
    
    if not user_id or not username:
        flash('User ID and username are required', 'error')
        return redirect(url_for('admin'))
    
    success, message = update_user(user_id, username=username, email=email, is_admin=is_admin)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin'))

@app.route('/admin/reset_password', methods=['POST'])
@login_required
@admin_required
def admin_reset_password():
    user_id = request.form.get('user_id')
    password = request.form.get('password', '').strip()
    
    if not user_id or not password:
        flash('User ID and password are required', 'error')
        return redirect(url_for('admin'))
    
    success, message = reset_user_password(user_id, password)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin'))

@app.route('/admin/delete_user', methods=['POST'])
@login_required
@admin_required
def admin_delete_user():
    user_id = request.form.get('user_id')
    
    if not user_id:
        flash('User ID is required', 'error')
        return redirect(url_for('admin'))
    
    # Don't allow users to delete themselves
    if str(current_user.id) == str(user_id):
        flash('You cannot delete your own account', 'error')
        return redirect(url_for('admin'))
    
    success, message = delete_user(user_id)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin'))

@app.route('/mixer')
@login_required
def mixer():
    extraction_id = request.args.get('extraction_id', '')
    
    # Try to get extraction info to provide to the mixer
    extraction_info = None
    se = user_session_manager.get_stems_extractor()
    extraction = se.get_extraction_status(extraction_id)
    
    if extraction:
        # Live extraction from session
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
            'beat_offset': getattr(extraction, 'beat_offset', 0.0)
        }
    else:
        # Try to get from database for historical extractions
        try:
            from core.downloads_db import list_extractions_for
            db_extractions = list_extractions_for(current_user.id)

            print(f"[MIXER DEBUG] Looking for extraction_id: {extraction_id}")
            print(f"[MIXER DEBUG] Found {len(db_extractions)} db extractions")

            # Find the extraction by ID - try multiple formats
            for db_extraction in db_extractions:
                db_id = f"download_{db_extraction['id']}"
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''

                print(f"[MIXER DEBUG] Checking db_id={db_id}, video_id={video_id}, filename={filename}")
                print(f"[MIXER DEBUG] BPM: {db_extraction.get('detected_bpm')}, Key: {db_extraction.get('detected_key')}")

                # Match by multiple criteria:
                # 1. download_{id} format
                # 2. video_id
                # 3. filename (from extraction_id like "filename_timestamp")
                matches = (
                    db_id == extraction_id or
                    video_id == extraction_id or
                    (filename and extraction_id.startswith(filename))
                )

                if matches:
                    # Parse stems_paths from JSON string to dict for output_paths
                    output_paths = {}
                    stems_paths_json = db_extraction.get('stems_paths')
                    if stems_paths_json:
                        try:
                            import json
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
                        'beat_offset': db_extraction.get('beat_offset', 0.0)
                    }
                    print(f"[MIXER DEBUG] Found match! BPM: {extraction_info['detected_bpm']}, Key: {extraction_info['detected_key']}, Chords: {bool(extraction_info.get('chords_data'))}, Stems: {list(output_paths.keys())}")
                    break
        except Exception as e:
            print(f"[MIXER] Error loading historical extraction data: {e}")
    
    return render_template('mixer.html', extraction_id=extraction_id, extraction_info=extraction_info)


# ------------------------------------------------------------------
# API routes
# ------------------------------------------------------------------
@app.route('/api/search', methods=['GET'])
@api_login_required
@youtube_access_required
def search_videos():
    query = request.args.get('query', '')
    max_results = int(request.args.get('max_results', 10))
    logger.info(f"Search request: query='{query}', max_results={max_results}")
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    try:
        response = aiotube_client.search_videos(query, max_results=max_results)
        logger.info(f"Returning {len(response.get('items', []))} search results")
        return jsonify(response)
    except Exception as e:
        logger.error(f"Search error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/video/<video_id>', methods=['GET'])
@api_login_required
@youtube_access_required
def get_video_info(video_id):
    info = aiotube_client.get_video_info(video_id)
    return jsonify(info) if info else (jsonify({'error': 'Video not found'}), 404)

# Downloads ---------------------------------------------------------
@app.route('/api/downloads', methods=['GET'])
@api_login_required
def get_all_downloads():
    """
    Returns:
        - live downloads from the current user manager
        - historical downloads from DB (completed only)
    """
    try:
        dm = user_session_manager.get_download_manager()
        
        # Get live downloads from current session
        live = []
        live_video_ids = set()  # Track video IDs in live session
        
        for status in ['active', 'queued', 'completed', 'failed']:
            for item in dm.get_all_downloads().get(status, []):
                live_item = {
                    'download_id': item.download_id,
                    'video_id': item.video_id,
                    'title': item.title,
                    'thumbnail_url': item.thumbnail_url,
                    'type': item.download_type.value,
                    'quality': item.quality,
                    'status': item.status.value,
                    'progress': item.progress,
                    'speed': item.speed,
                    'eta': item.eta,
                    'file_path': item.file_path,
                    'error_message': item.error_message,
                    'created_at': item.download_id.split('_')[1] if '_' in item.download_id else str(int(time.time())),
                    'detected_bpm': getattr(item, 'detected_bpm', None),
                    'detected_key': getattr(item, 'detected_key', None),
                    'analysis_confidence': getattr(item, 'analysis_confidence', None),
                    # Initialize extraction fields (will be populated from DB for completed downloads)
                    'extracted': False,
                    'stems_paths': None,
                    'extraction_model': None
                }

                # For completed downloads, check database for extraction status
                # This ensures extraction data is included even if download is still in live session
                if status == 'completed' and item.video_id:
                    try:
                        db_data = db_list_downloads(current_user.id)
                        for db_item in db_data:
                            if db_item.get('video_id') == item.video_id:
                                live_item['extracted'] = db_item.get('extracted', False)
                                live_item['stems_paths'] = db_item.get('stems_paths')
                                live_item['extraction_model'] = db_item.get('extraction_model')
                                live_item['global_download_id'] = db_item.get('global_download_id')
                                # Use database ID for completed items to match extraction API
                                live_item['download_id'] = db_item['id']
                                break
                    except Exception as e:
                        logger.warning(f"Could not fetch extraction data for {item.video_id}: {e}")

                live.append(live_item)
                live_video_ids.add(item.video_id)
        
        # Get historical downloads from database (excluding those in live session)
        history_raw = db_list_downloads(current_user.id)
        history = []

        # Get stems extractor to check for ongoing extractions
        se = user_session_manager.get_stems_extractor()

        for db_item in history_raw:
            # Skip if this video is already in the live session
            if db_item['video_id'] in live_video_ids:
                continue

            # Skip if download was removed (file_path is NULL but extraction might remain)
            if not db_item['file_path']:
                continue

            # Check if extraction is in progress for this download
            status = 'completed'
            progress = 100.0
            extraction_id = None

            # Check all extraction statuses for a match with this video_id
            all_active = se.get_all_extractions().get('active', [])
            all_queued = se.get_all_extractions().get('queued', [])

            # Debug: Log extraction check
            if all_active or all_queued:
                logger.debug(f"Checking extractions for video_id={db_item['video_id']}: {len(all_active)} active, {len(all_queued)} queued")

            for extraction in all_active + all_queued:
                logger.debug(f"  Comparing extraction.video_id='{extraction.video_id}' with db_item video_id='{db_item['video_id']}'")
                if extraction.video_id == db_item['video_id']:
                    # Found ongoing extraction for this download
                    status = extraction.status.value if hasattr(extraction.status, 'value') else str(extraction.status)
                    progress = extraction.progress
                    extraction_id = extraction.extraction_id  # Capture extraction_id for DOM element lookup
                    logger.info(f"Found ongoing extraction for {db_item['video_id']}: extraction_id={extraction_id}, status={status}, progress={progress}")
                    break

            # Map database fields to frontend format
            history.append({
                'download_id': db_item['id'],  # Use database ID as download_id for historical items
                'global_download_id': db_item['global_download_id'],  # Add global_download_id for remove functionality
                'video_id': db_item['video_id'],
                'title': db_item['title'],
                'thumbnail_url': db_item['thumbnail'],  # Map thumbnail -> thumbnail_url
                'type': db_item['media_type'],  # Map media_type -> type
                'quality': db_item['quality'],
                'status': status,  # Update with extraction status if in progress
                'progress': progress,  # Update with extraction progress if in progress
                'extraction_id': extraction_id,  # Include extraction_id for progress bar lookup
                'speed': '',  # No speed for completed items
                'eta': '',  # No ETA for completed items
                'file_path': db_item['file_path'],
                'error_message': '',  # No error for completed items
                'created_at': db_item['created_at'],  # Include creation time
                'detected_bpm': db_item.get('detected_bpm'),
                'detected_key': db_item.get('detected_key'),
                'analysis_confidence': db_item.get('analysis_confidence'),
                # Extraction information
                'extracted': db_item.get('extracted', False),
                'stems_paths': db_item.get('stems_paths'),
                'extraction_model': db_item.get('extraction_model')
            })

        return jsonify(live + history)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/downloads/<download_id>', methods=['GET'])
@api_login_required
def get_download_status(download_id):
    item = user_session_manager.get_download_manager().get_download_status(download_id)
    if not item:
        return jsonify({'error': 'Download not found'}), 404
    return jsonify({
        'download_id': item.download_id,
        'video_id': item.video_id,
        'title': item.title,
        'thumbnail_url': item.thumbnail_url,
        'type': item.download_type.value,
        'quality': item.quality,
        'status': item.status.value,
        'progress': item.progress,
        'speed': item.speed,
        'eta': item.eta,
        'file_path': item.file_path,
        'error_message': item.error_message
    })

@app.route('/api/downloads/<video_id>/extraction-status', methods=['GET'])
@api_login_required
def check_video_extraction_status(video_id):
    """Check extraction status for a video_id."""
    try:
        # Check if ANY extraction exists for this video_id (regardless of model)
        # This is better than checking for a specific model since users don't care which model was used
        global_extraction = db_find_any_global_extraction(video_id)

        if not global_extraction:
            return jsonify({
                'exists': False,
                'user_has_access': False,
                'status': 'not_extracted'
            })
        
        # Check if current user has access to this extraction
        user_extractions = db_list_extractions(current_user.id)
        user_has_access = any(
            ext['video_id'] == video_id and ext.get('extracted') == 1
            for ext in user_extractions
        )

        # DEBUG: Log the check results
        print(f"[API DEBUG] video_id={video_id}, user_id={current_user.id}")
        print(f"[API DEBUG] global_extraction found: model={global_extraction.get('extraction_model')}")
        print(f"[API DEBUG] user_has_access={user_has_access}")
        print(f"[API DEBUG] user_extractions count: {len(user_extractions)}")
        matching = [ext for ext in user_extractions if ext['video_id'] == video_id]
        print(f"[API DEBUG] matching extractions: {len(matching)}")
        if matching:
            print(f"[API DEBUG] first match: extracted={matching[0].get('extracted')}, model={matching[0].get('extraction_model')}")

        # Prepare response
        response_data = {
            'exists': True,
            'user_has_access': user_has_access,
            'status': 'extracted' if user_has_access else 'extracted_no_access',
            'extraction_model': global_extraction.get('extraction_model'),
            'extracted_at': global_extraction.get('extracted_at')
        }

        print(f"[API DEBUG] Returning status: {response_data['status']}")

        # If user has access, include stems information
        if user_has_access:
            # Parse stems_paths JSON if available
            stems_paths_json = global_extraction.get('stems_paths')
            if stems_paths_json:
                try:
                    import json
                    response_data['stems_paths'] = json.loads(stems_paths_json) if isinstance(stems_paths_json, str) else stems_paths_json
                    response_data['stems_available'] = True
                except:
                    response_data['stems_available'] = False
            else:
                response_data['stems_available'] = False

            # Add ZIP path if available
            zip_path = global_extraction.get('stems_zip_path')
            if zip_path:
                response_data['zip_path'] = zip_path

            # Add extraction ID for creating ZIP on-the-fly if needed
            response_data['extraction_id'] = global_extraction.get('id')

        return jsonify(response_data)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/downloads/batch-extraction-status', methods=['POST'])
@api_login_required
def batch_check_extraction_status():
    """Check extraction status for multiple video_ids at once."""
    try:
        data = request.json or {}
        video_ids = data.get('video_ids', [])

        if not video_ids or not isinstance(video_ids, list):
            return jsonify({'error': 'video_ids array required'}), 400

        # Limit to prevent abuse
        if len(video_ids) > 100:
            video_ids = video_ids[:100]

        # Get all user extractions once (instead of per video)
        user_extractions = db_list_extractions(current_user.id)
        user_extracted_videos = {
            ext['video_id']: ext
            for ext in user_extractions
            if ext.get('extracted') == 1
        }

        results = {}
        for video_id in video_ids:
            # Check if global extraction exists
            global_extraction = db_find_any_global_extraction(video_id)

            if not global_extraction:
                results[video_id] = {
                    'exists': False,
                    'user_has_access': False,
                    'status': 'not_extracted'
                }
                continue

            # Check if user has access
            user_has_access = video_id in user_extracted_videos

            response_data = {
                'exists': True,
                'user_has_access': user_has_access,
                'status': 'extracted' if user_has_access else 'extracted_no_access',
                'extraction_model': global_extraction.get('extraction_model'),
            }

            # If user has access, include stems information
            if user_has_access:
                stems_paths_json = global_extraction.get('stems_paths')
                if stems_paths_json:
                    try:
                        response_data['stems_paths'] = json.loads(stems_paths_json) if isinstance(stems_paths_json, str) else stems_paths_json
                        response_data['stems_available'] = True
                    except:
                        response_data['stems_available'] = False
                else:
                    response_data['stems_available'] = False

                if global_extraction.get('stems_zip_path'):
                    response_data['zip_path'] = global_extraction.get('stems_zip_path')
                response_data['extraction_id'] = global_extraction.get('id')

            results[video_id] = response_data

        return jsonify({'statuses': results})

    except Exception as e:
        logger.error(f"Batch extraction status error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/downloads', methods=['POST'])
@api_login_required
def add_download():
    data = request.json or {}
    required = ['video_id', 'title', 'thumbnail_url', 'download_type', 'quality']
    if any(f not in data for f in required):
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        video_id = data['video_id']
        
        # DEBUG: Log the received video_id
        with log_with_context(logger, video_id=video_id):
            logger.debug(f"Received video_id (length: {len(video_id)})")
        logger.debug(f"Download request data: {data}")
        
        # VALIDATE VIDEO ID
        if not is_valid_youtube_video_id(video_id):
            error_msg = f'Invalid YouTube video ID: "{video_id}" (length: {len(video_id)}). YouTube video IDs must be exactly 11 characters long.'
            logger.warning(f"Video ID validation failed: {error_msg}")
            return jsonify({'error': error_msg}), 400
        
        download_type = DownloadType.AUDIO if str(data['download_type']).lower() == 'audio' else DownloadType.VIDEO
        quality = data['quality']
        
        # First check if this video exists globally (any user has downloaded it)
        global_download = db_find_global_download(video_id, download_type.value, quality)
        if global_download:
            # File already exists globally - give this user access to it
            db_add_user_access(current_user.id, global_download)
            
            # Also check if there are any extractions for this video and give user access
            try:
                # Check if the global download has an extraction (using new unified system)
                if global_download.get('extracted') == 1 and global_download.get('extraction_model'):
                    # Grant user access to the existing extraction
                    db_add_user_extraction_access(current_user.id, global_download)
                    print(f"Granted user {current_user.id} access to extraction with model {global_download['extraction_model']}")
                    
            except Exception as e:
                print(f"Warning: Could not grant extraction access: {e}")
            
            return jsonify({
                'download_id': global_download['id'],
                'message': 'File already downloaded by another user - instant access granted',
                'existing': True,
                'global': True
            })
        
        # Check if this video is already downloaded by this user (fallback check)
        existing_downloads = db_list_downloads(current_user.id)
        for existing in existing_downloads:
            if existing['video_id'] == video_id and existing['media_type'] == download_type.value:
                # Video already exists for this user - return the database ID as download_id
                return jsonify({
                    'download_id': existing['id'],
                    'message': 'Video already downloaded by you',
                    'existing': True,
                    'global': False
                })
        
        # Also check current session downloads
        dm = user_session_manager.get_download_manager()
        all_downloads = dm.get_all_downloads()
        for status_list in all_downloads.values():
            for item in status_list:
                if item.video_id == video_id and item.download_type == download_type:
                    # Already in current session
                    return jsonify({
                        'download_id': item.download_id,
                        'message': 'Download already in progress or completed',
                        'existing': True
                    })
        
        # No existing download found - proceed with new download
        item = DownloadItem(
            video_id=video_id,
            title=data['title'],
            thumbnail_url=data['thumbnail_url'],
            download_type=download_type,
            quality=data['quality']
        )
        dl_id = dm.add_download(item)
        return jsonify({'download_id': dl_id, 'existing': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/downloads/<download_id>', methods=['DELETE'])
@api_login_required
def cancel_download(download_id):
    ok = user_session_manager.get_download_manager().cancel_download(download_id)
    return jsonify({'success': ok})

@app.route('/api/downloads/<download_id>/retry', methods=['POST'])
@api_login_required
def retry_download(download_id):
    try:
        dm = user_session_manager.get_download_manager()
        download = dm.get_download_status(download_id)
        
        if not download:
            return jsonify({'error': 'Download not found'}), 404
        
        if download.status.value not in ['failed', 'cancelled', 'error']:
            return jsonify({'error': 'Can only retry failed or cancelled downloads'}), 400
        
        # Reset download status and re-add to queue
        download.status = DownloadStatus.QUEUED
        download.progress = 0.0
        download.speed = ""
        download.eta = ""
        download.error_message = ""
        download.file_path = ""
        
        # Reset cancel event
        if download.cancel_event:
            download.cancel_event.clear()
        
        # Move from failed to queued
        dm.failed_downloads.pop(download_id, None)
        dm.queued_downloads[download_id] = download
        
        # Re-add to the download queue so the worker picks it up
        dm.download_queue.put(download)
        
        return jsonify({'success': True, 'download_id': download_id})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/downloads/<download_id>/delete', methods=['DELETE'])
@api_login_required
def delete_download(download_id):
    try:
        dm = user_session_manager.get_download_manager()
        
        # Remove from all possible locations
        removed = False
        if download_id in dm.queued_downloads:
            del dm.queued_downloads[download_id]
            removed = True
        if download_id in dm.active_downloads:
            del dm.active_downloads[download_id]
            removed = True
        if download_id in dm.failed_downloads:
            del dm.failed_downloads[download_id]
            removed = True
        if download_id in dm.completed_downloads:
            del dm.completed_downloads[download_id]
            removed = True
        
        # Also remove from database if user is authenticated
        db_removed = False
        if current_user and current_user.is_authenticated:
            try:
                # Handle both live downloads (download_id format) and database downloads (id format)
                if download_id.isdigit():
                    # This is a database ID, find the video_id from database first
                    import sqlite3
                    from pathlib import Path
                    DB_PATH = Path("stemtubes.db")
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute('SELECT video_id FROM user_downloads WHERE user_id = ? AND id = ?', 
                                  (current_user.id, download_id))
                    result = cursor.fetchone()
                    if result:
                        video_id = result[0]
                        db_delete_download(current_user.id, video_id)
                        db_removed = True
                    conn.close()
                else:
                    # This is a download_id format, extract video_id
                    video_id = download_id.split('_')[0]
                    db_delete_download(current_user.id, video_id)
                    db_removed = True
            except Exception as e:
                print(f"Database delete error: {e}")
                pass  # Ignore database errors
        
        if not removed and not db_removed:
            return jsonify({'error': 'Download not found or cannot be deleted'}), 404
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/downloads/clear-all', methods=['DELETE'])
@api_login_required
def clear_all_downloads():
    try:
        dm = user_session_manager.get_download_manager()
        se = user_session_manager.get_stems_extractor()
        
        # Clear all downloads from in-memory manager
        queued_count = len(dm.queued_downloads)
        active_count = len(dm.active_downloads)
        completed_count = len(dm.completed_downloads)
        failed_count = len(dm.failed_downloads)
        
        dm.queued_downloads.clear()
        dm.active_downloads.clear()
        dm.completed_downloads.clear()
        dm.failed_downloads.clear()
        
        # Clear all extractions from in-memory manager
        extraction_active_count = len(se.active_extractions)
        extraction_completed_count = len(se.completed_extractions)
        extraction_failed_count = len(se.failed_extractions)
        
        se.active_extractions.clear()
        se.completed_extractions.clear()
        se.failed_extractions.clear()
        
        # Clear database for current user
        if current_user and current_user.is_authenticated:
            # Clear downloads from database
            import sqlite3
            from pathlib import Path
            DB_PATH = Path("stemtubes.db")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('DELETE FROM user_downloads WHERE user_id = ?', (current_user.id,))
            db_deleted_count = cursor.rowcount
            conn.commit()
            conn.close()
        else:
            db_deleted_count = 0
        
        total_cleared = queued_count + active_count + completed_count + failed_count + extraction_active_count + extraction_completed_count + extraction_failed_count
        
        return jsonify({
            'success': True,
            'cleared': {
                'downloads': {
                    'queued': queued_count,
                    'active': active_count,
                    'completed': completed_count,
                    'failed': failed_count
                },
                'extractions': {
                    'active': extraction_active_count,
                    'completed': extraction_completed_count,
                    'failed': extraction_failed_count
                },
                'database': db_deleted_count,
                'total': total_cleared
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Extractions -------------------------------------------------------
@app.route('/api/extractions', methods=['GET'])
@api_login_required
def get_all_extractions():
    """
    Returns:
        - live extractions from the current user manager
        - historical extractions from DB (completed only)
    """
    try:
        se = user_session_manager.get_stems_extractor()
        
        # Get live extractions from current session
        live = []
        live_video_model_pairs = set()  # Track (video_id, model_name) pairs in live session
        
        for status in ['active', 'queued', 'completed', 'failed']:
            for item in se.get_all_extractions().get(status, []):
                live.append({
                    'extraction_id': item.extraction_id,
                    'video_id': item.video_id,
                    'title': item.title,
                    'audio_path': item.audio_path,
                    'model_name': get_model_display_name(item.model_name),
                    'selected_stems': item.selected_stems,
                    'two_stem_mode': item.two_stem_mode,
                    'primary_stem': item.primary_stem,
                    'status': item.status.value,
                    'progress': item.progress,
                    'error_message': item.error_message,
                    'output_paths': item.output_paths,
                    'zip_path': item.zip_path,
                    'created_at': item.extraction_id.split('_')[1] if '_' in item.extraction_id else str(int(time.time())),
                    'detected_bpm': getattr(item, 'detected_bpm', None),
                    'detected_key': getattr(item, 'detected_key', None),
                    'analysis_confidence': getattr(item, 'analysis_confidence', None)
                })
                live_video_model_pairs.add((item.video_id, item.model_name))
        
        # Get historical extractions from database (excluding those in live session)
        history_raw = db_list_extractions(current_user.id)
        with log_with_context(logger, user_id=current_user.id):
            logger.debug(f"Found {len(history_raw)} historical extractions")
        for item in history_raw:
            with log_with_context(logger, video_id=item['video_id']):
                logger.debug(f"Historical extraction: model={item['extraction_model']}, extracted_at={item['extracted_at']}")
        history = []
        
        for db_item in history_raw:
            # Skip if this extraction is already in the live session
            if (db_item['video_id'], db_item['extraction_model']) in live_video_model_pairs:
                continue
                
            # Parse JSON fields
            import json
            try:
                stems_paths = json.loads(db_item['stems_paths']) if db_item['stems_paths'] else {}
                # Try to infer selected stems from the paths
                selected_stems = list(stems_paths.keys()) if stems_paths else ['vocals', 'drums', 'bass', 'other']
            except:
                selected_stems = ['vocals', 'drums', 'bass', 'other']
                stems_paths = {}
            
            # Map database fields to frontend format
            history.append({
                'extraction_id': f"download_{db_item['id']}",  # Use download ID as extraction_id
                'global_download_id': db_item['global_download_id'],  # Add global_download_id for remove functionality
                'video_id': db_item['video_id'],
                'title': db_item['title'],
                'audio_path': db_item['file_path'],  # Use the download file path as audio path
                'model_name': get_model_display_name(db_item['extraction_model']),
                'selected_stems': selected_stems,
                'two_stem_mode': False,  # Not stored in DB, assume false
                'primary_stem': 'vocals',  # Not stored in DB, assume vocals
                'status': 'completed',  # Database items are always completed
                'progress': 100.0,  # Completed items have 100% progress
                'error_message': '',  # No error for completed items
                'output_paths': stems_paths,
                'zip_path': db_item['stems_zip_path'],
                'created_at': db_item['extracted_at'] or db_item['created_at'],
                'detected_bpm': db_item.get('detected_bpm'),
                'detected_key': db_item.get('detected_key'),
                'analysis_confidence': db_item.get('analysis_confidence')
            })
        
        # Combine live and historical extractions
        all_extractions = live + history
        
        # Sort by creation time (newest first)
        all_extractions.sort(key=lambda x: x['created_at'], reverse=True)
        
        return jsonify(all_extractions)
        
    except Exception as e:
        print(f"Error getting extractions: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/extractions/<extraction_id>', methods=['GET'])
@api_login_required
def get_extraction_status(extraction_id):
    # For mixer usage: Always get from database since mixer only loads completed extractions
    from core.downloads_db import get_download_by_id, list_extractions_for

    try:
        # Try direct ID lookup first (download_123 format)
        download_id = extraction_id
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download_data = get_download_by_id(current_user.id, download_id)
        else:
            # Search by multiple criteria for filename-based extraction_id
            download_data = None
            db_extractions = list_extractions_for(current_user.id)

            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''

                # Match by video_id or filename
                if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                    download_data = db_extraction
                    print(f"[API] Found extraction by {'video_id' if video_id == extraction_id else 'filename'}: {extraction_id}")
                    break

        if download_data and download_data.get('extracted'):
            response_data = {
                'extraction_id': extraction_id,
                'video_id': download_data.get('video_id'),
                'audio_path': download_data.get('file_path', ''),
                'file_path': download_data.get('file_path', ''),  # Add for mobile compatibility
                'title': download_data.get('title', 'Unknown Track'),  # Add title
                'stems_paths': download_data.get('stems_paths'),  # Add stems paths JSON
                'model_name': download_data.get('extraction_model', ''),
                'status': 'completed',
                'progress': 100,
                'detected_bpm': download_data.get('detected_bpm'),
                'detected_key': download_data.get('detected_key'),
                'analysis_confidence': download_data.get('analysis_confidence'),
                'chords_data': download_data.get('chords_data'),
                'beat_offset': download_data.get('beat_offset', 0.0),
                'structure_data': download_data.get('structure_data'),
                'lyrics_data': download_data.get('lyrics_data')
            }
            print(f"[API] Returning analysis data for {extraction_id}: BPM={response_data['detected_bpm']}, Key={response_data['detected_key']}, Chords={bool(response_data['chords_data'])}, Structure={bool(response_data['structure_data'])}, Lyrics={bool(response_data['lyrics_data'])}")
            return jsonify(response_data)


    except Exception as e:
        print(f"Error fetching database extraction: {e}")
    
    # Fallback: try session for active extractions (non-mixer usage)
    item = user_session_manager.get_stems_extractor().get_extraction_status(extraction_id)
    if item:
        response_data = {
            'extraction_id': item.extraction_id,
            'video_id': getattr(item, 'video_id', None),
            'audio_path': item.audio_path,
            'model_name': item.model_name,
            'selected_stems': item.selected_stems,
            'two_stem_mode': item.two_stem_mode,
            'primary_stem': item.primary_stem,
            'status': item.status.value,
            'progress': item.progress,
            'error_message': item.error_message,
            'output_paths': item.output_paths,
            'zip_path': item.zip_path
        }
        return jsonify(response_data)
    
    return jsonify({'error': 'Extraction not found'}), 404

@app.route('/api/extractions', methods=['POST'])
@api_login_required
def add_extraction():
    data = request.json or {}
    
    # Add retry logic for race conditions
    import time
    import random
    
    max_retries = 3
    base_delay = 0.1  # 100ms
    
    for attempt in range(max_retries + 1):
        try:
            video_id = data.get('video_id')
            model_name = data.get('model_name', 'htdemucs')  # Default model
            grant_access_only = data.get('grant_access_only', False)
            
            print(f"=== EXTRACTION DEBUG START (Attempt {attempt + 1}/{max_retries + 1}) ===")
            print(f"User: {current_user.username} (ID: {current_user.id})")
            print(f"Received data: {data}")
            print(f"Video ID: {video_id}")
            print(f"Model: {model_name}")
            print(f"Grant access only: {grant_access_only}")
            print(f"Audio path: {data.get('audio_path')}")
            
            # Special case: only grant access to existing extraction
            if grant_access_only:
                if not video_id:
                    return jsonify({'error': 'video_id required for grant_access_only'}), 400
                    
                existing_extraction = db_find_global_extraction(video_id, model_name)
                if existing_extraction:
                    print(f"Granting access to existing extraction for user {current_user.id}")
                    db_add_user_extraction_access(current_user.id, existing_extraction)
                    return jsonify({
                        'extraction_id': f"download_{existing_extraction['id']}",
                        'message': f'Access granted to existing extraction',
                        'existing': True
                    })
                else:
                    return jsonify({'error': 'No extraction found for this video'}), 404
            
            # Use atomic check/reserve operation to prevent race conditions
            if video_id:
                print(f"Checking/reserving extraction for video_id='{video_id}', model='{model_name}'")
                existing_extraction, reserved = db_find_or_reserve_extraction(video_id, model_name)
                
                if existing_extraction:
                    print(f"Found existing global extraction! Granting access to user {current_user.id}")
                    # Extraction already exists globally - give user access to it
                    db_add_user_extraction_access(current_user.id, existing_extraction)
                    print(f"=== EXTRACTION DEBUG END (EXISTING GLOBAL) ===")
                    return jsonify({
                        'extraction_id': str(existing_extraction['id']),
                        'message': f'Stems already extracted with {model_name} model',
                        'existing': True
                    })
                elif not reserved:
                    if attempt < max_retries:
                        # Wait with exponential backoff before retrying
                        delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)
                        print(f"Extraction in progress by another user, retrying in {delay:.2f}s...")
                        time.sleep(delay)
                        continue
                    else:
                        print(f"Extraction already in progress by another user")
                        print(f"=== EXTRACTION DEBUG END (IN PROGRESS) ===")
                        return jsonify({
                            'extraction_id': 'in_progress',
                            'message': f'Extraction with {model_name} model already in progress. Please wait.',
                            'existing': True,
                            'in_progress': True
                        })
                # If reserved=True, we can proceed with new extraction
                print(f"Successfully reserved extraction slot")
            else:
                print("WARNING: No video_id provided - cannot check global deduplication!")
            
            # Since we successfully reserved the extraction slot, we can skip user-specific checks
            # The atomic reservation already handled global deduplication
            break  # Exit retry loop if we get here
            
        except Exception as e:
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)
                print(f"Database error on attempt {attempt + 1}: {e}, retrying in {delay:.2f}s...")
                time.sleep(delay)
                continue
            else:
                print(f"Failed after {max_retries + 1} attempts: {e}")
                return jsonify({'error': str(e)}), 500
    
    try:

        # Also check current session extractions (only active/queued ones matter)
        # Failed and completed extractions should be retryable
        print(f"Checking current session extractions...")
        se = user_session_manager.get_stems_extractor()
        all_extractions = se.get_all_extractions()
        print(f"Session extractions: {list(all_extractions.keys())}")

        # Only check actively running extractions (queued or active), not failed/completed
        for status_name in ['active', 'queued']:
            status_list = all_extractions.get(status_name, [])
            print(f"  {status_name}: {len(status_list)} items")
            for item in status_list:
                print(f"    - {item.audio_path} with {item.model_name}")
                # Compare based on audio path and model (since we might not have video_id for all)
                if (item.audio_path == data['audio_path'] and
                    item.model_name == model_name):
                    print(f"Found existing {status_name} session extraction!")
                    print(f"=== EXTRACTION DEBUG END (EXISTING SESSION) ===")
                    return jsonify({
                        'extraction_id': item.extraction_id,
                        'message': 'Extraction already in progress',
                        'existing': True
                    })

        # Log failed/completed counts for debugging
        print(f"  failed: {len(all_extractions.get('failed', []))} items (retryable)")
        print(f"  completed: {len(all_extractions.get('completed', []))} items")
        
        # No existing extraction found - proceed with new extraction
        print(f"No existing extraction found. Starting new extraction...")
        print(f"Creating ExtractionItem with video_id='{video_id}'")
        item = ExtractionItem(
            audio_path=data['audio_path'],
            model_name=model_name,
            output_dir=data.get('output_dir', os.path.join(
                os.path.dirname(data['audio_path']), 'stems')),
            selected_stems=data['selected_stems'],
            two_stem_mode=data.get('two_stem_mode', False),
            primary_stem=data.get('primary_stem', 'vocals'),
            video_id=video_id or "",  # Store video_id for persistence
            title=data.get('title', "")  # Store title for persistence
        )
        ex_id = se.add_extraction(item)
        print(f"New extraction started with ID: {ex_id}")
        
        # Set user extraction in progress (global extraction was already reserved)
        if video_id:
            print(f"Marking user extraction as in progress for user_id={current_user.id}, video_id='{video_id}', model='{model_name}'")
            try:
                db_set_user_extraction_in_progress(current_user.id, video_id, model_name)
                print(f"Successfully marked user extraction as in progress")
            except Exception as db_error:
                print(f"Error marking user extraction as in progress: {db_error}")
        
        print(f"=== EXTRACTION DEBUG END (NEW EXTRACTION) ===")
        return jsonify({'extraction_id': ex_id, 'existing': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/extractions/<extraction_id>', methods=['DELETE'])
@api_login_required
def cancel_extraction(extraction_id):
    ok = user_session_manager.get_stems_extractor().cancel_extraction(extraction_id)
    return jsonify({'success': ok})

@app.route('/api/extractions/<extraction_id>/retry', methods=['POST'])
@api_login_required
def retry_extraction(extraction_id):
    try:
        print(f"[DEBUG] Retry extraction requested for: {extraction_id}")
        se = user_session_manager.get_stems_extractor()
        
        # Debug: print current state
        print(f"[DEBUG] Active extractions: {list(se.active_extractions.keys())}")
        print(f"[DEBUG] Failed extractions: {list(se.failed_extractions.keys())}")
        print(f"[DEBUG] Completed extractions: {list(se.completed_extractions.keys())}")
        
        extraction = se.get_extraction_status(extraction_id)
        
        if not extraction:
            print(f"[DEBUG] Extraction not found: {extraction_id}")
            return jsonify({'error': 'Extraction not found'}), 404
        
        if extraction.status.value not in ['failed', 'cancelled']:
            return jsonify({'error': 'Can only retry failed or cancelled extractions'}), 400
        
        # Handle the case where a cancelled extraction might still be in active_extractions
        if extraction_id in se.active_extractions and extraction.status.value == 'cancelled':
            # Move it to failed_extractions first
            del se.active_extractions[extraction_id]
            se.failed_extractions[extraction_id] = extraction
        
        # Reset extraction status and re-add to queue
        extraction.status = ExtractionStatus.QUEUED
        extraction.progress = 0.0
        extraction.error_message = ""
        extraction.output_paths = {}
        extraction.zip_path = None
        
        # Move from failed to queued
        se.failed_extractions.pop(extraction_id, None)
        se.queued_extractions[extraction_id] = extraction
        se.extraction_queue.put(extraction)
        
        return jsonify({'success': True, 'extraction_id': extraction_id})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/extractions/<extraction_id>/delete', methods=['DELETE'])
@api_login_required
def delete_extraction(extraction_id):
    try:
        print(f"[DEBUG] Delete extraction requested for: {extraction_id}")
        se = user_session_manager.get_stems_extractor()
        
        # Debug: print current state
        print(f"[DEBUG] Active extractions: {list(se.active_extractions.keys())}")
        print(f"[DEBUG] Failed extractions: {list(se.failed_extractions.keys())}")
        print(f"[DEBUG] Completed extractions: {list(se.completed_extractions.keys())}")
        print(f"[DEBUG] Queued extractions: {list(se.queued_extractions.keys())}")
        
        # Remove from all possible locations
        removed = False
        if extraction_id in se.failed_extractions:
            del se.failed_extractions[extraction_id]
            removed = True
        if extraction_id in se.completed_extractions:
            del se.completed_extractions[extraction_id]
            removed = True
        if extraction_id in se.active_extractions:
            del se.active_extractions[extraction_id]
            removed = True
        if extraction_id in se.queued_extractions:
            del se.queued_extractions[extraction_id]
            removed = True
        
        if not removed:
            return jsonify({'error': 'Extraction not found or cannot be deleted'}), 404
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/extractions/<extraction_id>/create-zip', methods=['POST'])
@api_login_required
def create_zip_for_extraction(extraction_id):
    try:
        se = user_session_manager.get_stems_extractor()
        extraction = se.get_extraction_status(extraction_id)
        
        if not extraction and extraction_id:
            # Extraction not found in user records - filesystem scanning disabled for security
            return jsonify({'error': 'Extraction not found in your records', 'success': False}), 404
        
        if not extraction:
            return jsonify({'error': 'Extraction not found', 'success': False}), 404
        
        if extraction.status.value != 'completed':
            return jsonify({'error': 'Extraction not completed', 'success': False}), 400
        
        if not extraction.output_paths:
            return jsonify({'error': 'No stem files found', 'success': False}), 404
        
        # Create ZIP file
        try:
            import zipfile
            
            # Create ZIP file path
            base_name = os.path.splitext(os.path.basename(extraction.audio_path))[0]
            zip_path = os.path.join(extraction.output_dir, f"{base_name}_stems.zip")
            
            # Create ZIP file
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for stem_name, file_path in extraction.output_paths.items():
                    if os.path.exists(file_path):
                        zipf.write(file_path, os.path.basename(file_path))
            
            # Update extraction with zip path
            extraction.zip_path = zip_path
            
            return jsonify({'success': True, 'zip_path': zip_path})
            
        except Exception as zip_error:
            return jsonify({'error': f'Error creating ZIP: {str(zip_error)}', 'success': False}), 500
        
    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500

# ------------------------------------------------------------------
# Karaoke/Lyrics API Routes
# ------------------------------------------------------------------

@app.route('/api/extractions/<extraction_id>/lyrics', methods=['GET'])
@api_login_required
def get_extraction_lyrics(extraction_id):
    """Get or generate lyrics for an extraction"""
    try:
        from core.downloads_db import get_download_by_id, list_extractions_for

        # Find download using same logic as get_extraction_status
        download = None
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        else:
            # Search by video_id or filename
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path) if file_path else ''

                # Normalize extraction_id for comparison (strip timestamp suffix like _1760135361)
                normalized_extraction_id = extraction_id.rsplit('_', 1)[0] if '_' in extraction_id else extraction_id
                # Also strip .mp3 extension if present in extraction_id for comparison
                normalized_extraction_id = normalized_extraction_id.replace('.mp3', '')
                normalized_filename = filename.replace('.mp3', '')

                # Match by video_id or filename (with/without .mp3 extension)
                matches = (
                    video_id == extraction_id or
                    filename == extraction_id or
                    (normalized_filename and normalized_extraction_id.startswith(normalized_filename))
                )

                if matches:
                    download = db_extraction
                    logger.info(f"[LYRICS] Found extraction by matching {extraction_id} with video_id={video_id} or filename={filename}")
                    break

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        # Check if lyrics already exist
        if download.get('lyrics_data'):
            lyrics_json = download['lyrics_data']
            lyrics = json.loads(lyrics_json) if isinstance(lyrics_json, str) else lyrics_json
            return jsonify({
                'success': True,
                'lyrics': lyrics,
                'cached': True
            })

        # Lyrics not cached
        return jsonify({
            'success': False,
            'message': 'Lyrics not yet generated. Please request generation.',
            'cached': False
        })

    except Exception as e:
        logger.error(f"Error getting lyrics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/extractions/<extraction_id>/chords/regenerate', methods=['POST'])
@api_login_required
def regenerate_extraction_chords(extraction_id):
    """Regenerate chord timeline for an extraction."""
    try:
        from core.downloads_db import get_download_by_id, list_extractions_for, update_download_analysis
        from core.chord_detector import analyze_audio_file
        from core.config import load_config

        download = None
        download_id = extraction_id
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        if not download:
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''
                if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                    download = db_extraction
                    break

        if not download:
            download = db_find_any_global_extraction(extraction_id)

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        audio_path = download.get('file_path')
        if not audio_path or not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        config = load_config()
        use_hybrid = config.get('chords_use_hybrid', True)
        use_madmom = config.get('chords_use_madmom', True)

        chords_json, beat_offset = analyze_audio_file(
            audio_path,
            bpm=download.get('detected_bpm'),
            detected_key=download.get('detected_key'),
            use_hybrid=use_hybrid,
            use_madmom=use_madmom
        )

        if not chords_json:
            return jsonify({'error': 'Chord detection failed'}), 500

        structure_data = download.get('structure_data')
        if isinstance(structure_data, str):
            try:
                structure_data = json.loads(structure_data)
            except Exception:
                structure_data = None

        lyrics_data = download.get('lyrics_data')
        if isinstance(lyrics_data, str):
            try:
                lyrics_data = json.loads(lyrics_data)
            except Exception:
                lyrics_data = None

        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        update_download_analysis(
            video_id,
            download.get('detected_bpm'),
            download.get('detected_key'),
            download.get('analysis_confidence'),
            chords_json,
            beat_offset,
            structure_data,
            lyrics_data
        )

        parsed_chords = json.loads(chords_json)
        return jsonify({
            'success': True,
            'chords': parsed_chords,
            'beat_offset': beat_offset
        })

    except Exception as e:
        logger.error(f"Error regenerating chords: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/extractions/<extraction_id>/lyrics/generate', methods=['POST'])
@api_login_required
def generate_extraction_lyrics(extraction_id):
    """Generate lyrics for an extraction using faster-whisper"""
    try:
        from core.downloads_db import get_download_by_id, update_download_lyrics, list_extractions_for
        from core.lyrics_detector import detect_song_lyrics
        from core.config import load_config

        # Find download using same logic as get_extraction_status
        download = None
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        else:
            # Search by video_id or filename
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path) if file_path else ''

                # Normalize extraction_id for comparison (strip timestamp suffix like _1760135361)
                normalized_extraction_id = extraction_id.rsplit('_', 1)[0] if '_' in extraction_id else extraction_id
                # Also strip .mp3 extension if present in extraction_id for comparison
                normalized_extraction_id = normalized_extraction_id.replace('.mp3', '')
                normalized_filename = filename.replace('.mp3', '')

                # Match by video_id or filename (with/without .mp3 extension)
                matches = (
                    video_id == extraction_id or
                    filename == extraction_id or
                    (normalized_filename and normalized_extraction_id.startswith(normalized_filename))
                )

                if matches:
                    download = db_extraction
                    logger.info(f"[LYRICS] Found extraction by matching {extraction_id} with video_id={video_id} or filename={filename}")
                    break

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        # Get video_id for database update
        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        # Get audio path (prefer vocals stem for better accuracy)
        audio_path = None

        # Try to use vocals stem if available
        if download.get('stems_paths'):
            stems_paths_json = download['stems_paths']
            stems_paths = json.loads(stems_paths_json) if isinstance(stems_paths_json, str) else stems_paths_json
            if 'vocals' in stems_paths:
                vocals_path = stems_paths['vocals']
                if os.path.exists(vocals_path):
                    audio_path = vocals_path
                    logger.info(f"[LYRICS] Using vocals stem: {vocals_path}")

        # Fallback to original audio
        if not audio_path:
            audio_path = download.get('file_path')
            logger.info(f"[LYRICS] Using original audio: {audio_path}")

        if not audio_path or not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        # Get configuration
        config = load_config()

        # Safely parse JSON body (may be empty or malformed)
        try:
            data = request.get_json(silent=True) or {}
        except Exception as e:
            logger.warning(f"[LYRICS] Failed to parse request JSON, using defaults: {e}")
            data = {}

        default_model = config.get('lyrics_model_size', 'large-v3-int8')
        model_size = data.get('model_size') or default_model
        language = data.get('language')  # None = auto-detect
        use_gpu = config.get('use_gpu_for_extraction', False)

        # Try to use vocals stem for better transcription quality
        audio_for_lyrics = audio_path
        vocals_stem_path = os.path.join(os.path.dirname(audio_path), "stems", "vocals.mp3")

        # If we already have a vocals stem from the DB path, keep using it
        if audio_path and audio_path.endswith("stems/vocals.mp3") and os.path.exists(audio_path):
            logger.info(f"[LYRICS] Using vocals stem for transcription: {audio_path}")
        elif os.path.exists(vocals_stem_path):
            logger.info(f"[LYRICS] Using vocals stem for transcription: {vocals_stem_path}")
            audio_for_lyrics = vocals_stem_path
        else:
            logger.info(f"[LYRICS] Vocals stem not found, using original audio")

        logger.info(f"[LYRICS] Starting transcription for {extraction_id}")
        logger.info(f"[LYRICS] Model: {model_size}, GPU: {use_gpu}, Language: {language or 'auto'}")

        # Detect lyrics
        lyrics_data = detect_song_lyrics(
            audio_path=audio_for_lyrics,
            model_size=model_size,
            language=language,
            use_gpu=use_gpu
        )

        if not lyrics_data:
            return jsonify({'error': 'Failed to detect lyrics'}), 500

        # Save lyrics to database
        update_download_lyrics(video_id, lyrics_data)

        logger.info(f"[LYRICS] Successfully generated {len(lyrics_data)} segments")

        return jsonify({
            'success': True,
            'lyrics': lyrics_data,
            'segments_count': len(lyrics_data)
        })

    except Exception as e:
        logger.error(f"Error generating lyrics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/extractions/<extraction_id>/lyrics/lrclib', methods=['POST'])
@api_login_required
def fetch_lrclib_lyrics(extraction_id):
    """Fetch lyrics from LrcLib API (crowdsourced synchronized lyrics)"""
    try:
        from core.downloads_db import get_download_by_id, update_download_lyrics, list_extractions_for
        from core.lrclib_client import fetch_lyrics
        from core.metadata_extractor import extract_metadata

        # Find download using same logic as other endpoints
        download = None
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        else:
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path) if file_path else ''

                normalized_extraction_id = extraction_id.rsplit('_', 1)[0] if '_' in extraction_id else extraction_id
                normalized_extraction_id = normalized_extraction_id.replace('.mp3', '')
                normalized_filename = filename.replace('.mp3', '')

                matches = (
                    video_id == extraction_id or
                    filename == extraction_id or
                    (normalized_filename and normalized_extraction_id.startswith(normalized_filename))
                )

                if matches:
                    download = db_extraction
                    break

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        # Get request data (optional artist/track override)
        data = request.get_json(silent=True) or {}

        # Extract metadata from file and title
        file_path = download.get('file_path')
        db_title = download.get('title', '')

        # Use provided values or extract from metadata
        artist = data.get('artist_name')
        track = data.get('track_name')

        if not artist or not track:
            extracted_artist, extracted_track = extract_metadata(file_path, db_title)
            if not artist:
                artist = extracted_artist
            if not track:
                track = extracted_track

        logger.info(f"[LRCLIB] Fetching lyrics for: {artist} - {track}")

        if not artist:
            return jsonify({
                'error': 'Artist name required',
                'extracted_track': track,
                'need_artist': True
            }), 400

        # Fetch from LrcLib
        lyrics_data = fetch_lyrics(
            track_name=track,
            artist_name=artist,
            duration=data.get('duration')
        )

        if not lyrics_data:
            return jsonify({
                'error': 'Lyrics not found on LrcLib',
                'artist': artist,
                'track': track
            }), 404

        logger.info(f"[LRCLIB] Fetched {len(lyrics_data)} lyrics lines, enriching with word timestamps...")

        # Enrich LrcLib lyrics with Whisper word-level timestamps
        # This enables word-by-word karaoke highlighting and accurate chord placement
        try:
            from core.lyrics_aligner import enrich_lrclib_with_whisper
            from core.config import load_config

            # Find vocals stem for better transcription quality
            audio_for_alignment = None
            if file_path:
                vocals_stem_path = os.path.join(os.path.dirname(file_path), "stems", "vocals.mp3")
                if os.path.exists(vocals_stem_path):
                    audio_for_alignment = vocals_stem_path
                    logger.info(f"[LRCLIB] Using vocals stem for alignment: {vocals_stem_path}")
                elif os.path.exists(file_path):
                    audio_for_alignment = file_path
                    logger.info(f"[LRCLIB] Using original audio for alignment: {file_path}")

            if audio_for_alignment:
                config = load_config()
                use_gpu = config.get('use_gpu_for_extraction', False)
                model_size = config.get('lyrics_model_size', 'large-v3-int8')

                lyrics_data = enrich_lrclib_with_whisper(
                    lrclib_lyrics=lyrics_data,
                    audio_path=audio_for_alignment,
                    use_gpu=use_gpu,
                    model_size=model_size
                )
                logger.info(f"[LRCLIB] Enrichment complete with word timestamps")
            else:
                logger.warning("[LRCLIB] No audio file found, skipping word alignment")

        except Exception as align_error:
            logger.warning(f"[LRCLIB] Word alignment failed, using line-level timestamps: {align_error}")
            # Continue with original LrcLib data (line-level only)

        # Save lyrics to database
        update_download_lyrics(video_id, lyrics_data)

        logger.info(f"[LRCLIB] Successfully processed {len(lyrics_data)} lyrics lines")

        return jsonify({
            'success': True,
            'lyrics': lyrics_data,
            'source': 'lrclib',
            'artist': artist,
            'track': track,
            'segments_count': len(lyrics_data),
            'has_word_timestamps': any('words' in seg for seg in lyrics_data)
        })

    except Exception as e:
        logger.error(f"Error fetching LrcLib lyrics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# User View Management API Routes
# ------------------------------------------------------------------

@app.route('/api/user/downloads/<video_id>/remove-from-list', methods=['DELETE'])
@api_login_required
def remove_download_from_user_list(video_id):
    """Remove a download from user's personal list (keeps file and global record)."""
    try:
        from core.downloads_db import remove_user_download_access
        success, message = remove_user_download_access(current_user.id, video_id)
        
        if success:
            # Clear any session data for this video
            try:
                dm = user_session_manager.get_download_manager()
                # Remove from all session collections that might contain this video_id
                for collection_name in ['queued_downloads', 'active_downloads', 'failed_downloads', 'completed_downloads']:
                    collection = getattr(dm, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[SESSION CLEANUP] Removed {key} from {collection_name}")
            except Exception as session_error:
                print(f"[SESSION CLEANUP] Warning: {session_error}")
            
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'error': message}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/extractions/<video_id>/remove-from-list', methods=['DELETE'])
@api_login_required  
def remove_extraction_from_user_list(video_id):
    """Remove an extraction from user's personal list (keeps extraction and global record)."""
    try:
        from core.downloads_db import remove_user_extraction_access
        success, message = remove_user_extraction_access(current_user.id, video_id)
        
        if success:
            # Clear any session data for this video
            try:
                se = user_session_manager.get_stems_extractor()
                # Remove from all session collections that might contain this video_id
                for collection_name in ['queued_extractions', 'active_extractions', 'failed_extractions', 'completed_extractions']:
                    collection = getattr(se, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[SESSION CLEANUP] Removed {key} from {collection_name}")
            except Exception as session_error:
                print(f"[SESSION CLEANUP] Warning: {session_error}")
            
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'error': message}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/downloads/bulk-remove-from-list', methods=['POST'])
@api_login_required
def bulk_remove_downloads_from_user_list():
    """Remove multiple downloads from user's personal list."""
    try:
        data = request.json
        download_ids = data.get('download_ids', [])
        
        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400
        
        from core.downloads_db import remove_user_download_access
        
        results = []
        successful_removals = 0
        
        for download_id in download_ids:
            try:
                success, message = remove_user_download_access(current_user.id, download_id)
                if success:
                    successful_removals += 1
                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message
                })
            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': f'Error: {str(e)}'
                })
        
        return jsonify({
            'success': True,
            'removed_count': successful_removals,
            'total_count': len(download_ids),
            'results': results
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/extractions/bulk-remove-from-list', methods=['POST'])
@api_login_required
def bulk_remove_extractions_from_user_list():
    """Remove multiple extractions from user's personal list."""
    try:
        data = request.json
        download_ids = data.get('download_ids', [])  # Note: using download_id for extractions too
        
        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400
        
        from core.downloads_db import remove_user_extraction_access
        
        results = []
        successful_removals = 0
        
        for download_id in download_ids:
            try:
                success, message = remove_user_extraction_access(current_user.id, download_id)
                if success:
                    successful_removals += 1
                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message
                })
            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': f'Error: {str(e)}'
                })
        
        return jsonify({
            'success': True,
            'removed_count': successful_removals,
            'total_count': len(download_ids),
            'results': results
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Force removal endpoints for when regular removal doesn't work
@app.route('/api/user/downloads/<video_id>/force-remove', methods=['DELETE'])
@api_login_required
def force_remove_download_from_user_list(video_id):
    """Forcefully remove all access to a video_id (both download and extraction)."""
    try:
        from core.downloads_db import force_remove_all_user_access
        success, message = force_remove_all_user_access(current_user.id, video_id)
        
        if success:
            # Clear all session data for this video
            try:
                # Clear download manager session data
                dm = user_session_manager.get_download_manager()
                for collection_name in ['queued_downloads', 'active_downloads', 'failed_downloads', 'completed_downloads']:
                    collection = getattr(dm, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[FORCE CLEANUP] Removed {key} from {collection_name}")
                
                # Clear extraction manager session data
                se = user_session_manager.get_stems_extractor()
                for collection_name in ['queued_extractions', 'active_extractions', 'failed_extractions', 'completed_extractions']:
                    collection = getattr(se, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[FORCE CLEANUP] Removed {key} from {collection_name}")
            except Exception as session_error:
                print(f"[FORCE CLEANUP] Warning: {session_error}")
            
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'error': message}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/cleanup/comprehensive', methods=['POST'])
@api_login_required
def user_comprehensive_cleanup():
    """Run comprehensive cleanup for the current user's data."""
    try:
        from core.downloads_db import comprehensive_cleanup
        
        # Run comprehensive cleanup
        comprehensive_cleanup()
        
        # Clear current user's session data
        try:
            user_session_manager.clear_user_session(current_user.id)
        except Exception as session_error:
            print(f"[USER CLEANUP] Session clear warning: {session_error}")
        
        return jsonify({
            'success': True, 
            'message': 'Comprehensive cleanup completed for your account'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ------------------------------------------------------------------
# Browser Log Collection API Routes
# ------------------------------------------------------------------

@app.route('/api/logs/browser', methods=['POST'])
@api_login_required
def collect_browser_logs():
    """Collect browser console logs sent from frontend."""
    try:
        data = request.json or {}
        logs = data.get('logs', [])
        
        if not logs:
            return jsonify({'success': True, 'message': 'No logs received'})
        
        # Get user context
        user_id = current_user.id if current_user.is_authenticated else None
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        
        # Create browser logger
        browser_logger = get_logger('browser')
        
        # Process each log entry
        for log_entry in logs:
            level = log_entry.get('level', 'info')
            message = log_entry.get('message', '')
            timestamp = log_entry.get('timestamp', '')
            session_id = log_entry.get('sessionId', '')
            url = log_entry.get('url', '')
            
            # Add context and log the browser message
            with log_with_context(browser_logger, 
                                user_id=user_id, 
                                ip_address=client_ip,
                                browser_session_id=session_id,
                                browser_url=url):
                
                if level == 'debug':
                    browser_logger.debug(f"Browser: {message}")
                elif level == 'info':
                    browser_logger.info(f"Browser: {message}")
                elif level == 'warn':
                    browser_logger.warning(f"Browser: {message}")
                elif level == 'error':
                    browser_logger.error(f"Browser: {message}")
                else:
                    browser_logger.info(f"Browser [{level}]: {message}")
        
        logger.debug(f"Collected {len(logs)} browser log entries from user {user_id}")
        
        return jsonify({
            'success': True, 
            'message': f'Collected {len(logs)} log entries',
            'processed': len(logs)
        })
        
    except Exception as e:
        logger.error(f"Error collecting browser logs: {e}", exc_info=True)
        return jsonify({'error': 'Failed to collect logs'}), 500

@app.route('/api/logs/list', methods=['GET'])
@api_login_required
def list_log_files():
    """List available log files for admin viewing."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    
    try:
        log_dir = log_config['log_dir']
        log_files = []
        
        for log_file in log_dir.glob('*.log'):
            stat = log_file.stat()
            log_files.append({
                'name': log_file.name,
                'size': stat.st_size,
                'size_mb': round(stat.st_size / (1024 * 1024), 2),
                'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'type': 'main' if 'stemtube.log' in log_file.name else 
                        'error' if 'error' in log_file.name else
                        'access' if 'access' in log_file.name else
                        'database' if 'database' in log_file.name else
                        'processing' if 'processing' in log_file.name else 'other'
            })
        
        # Sort by modified time, newest first
        log_files.sort(key=lambda x: x['modified'], reverse=True)
        
        return jsonify({
            'success': True,
            'log_files': log_files,
            'log_directory': str(log_dir)
        })
        
    except Exception as e:
        logger.error(f"Error listing log files: {e}", exc_info=True)
        return jsonify({'error': 'Failed to list log files'}), 500

@app.route('/api/logs/view/<filename>', methods=['GET'])
@api_login_required
def view_log_file(filename):
    """View contents of a specific log file."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    
    try:
        log_dir = log_config['log_dir']
        log_file = log_dir / filename
        
        # Security check - ensure file is in log directory
        if not str(log_file.resolve()).startswith(str(log_dir.resolve())):
            return jsonify({'error': 'Invalid file path'}), 400
        
        if not log_file.exists():
            return jsonify({'error': 'Log file not found'}), 404
        
        # Get parameters
        lines = int(request.args.get('lines', 100))  # Default to last 100 lines
        offset = int(request.args.get('offset', 0))   # Skip lines from end
        
        # Read file content
        with open(log_file, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()
        
        # Calculate slice
        total_lines = len(all_lines)
        start_idx = max(0, total_lines - lines - offset)
        end_idx = total_lines - offset if offset > 0 else total_lines
        
        selected_lines = all_lines[start_idx:end_idx]
        
        # Parse JSON logs if applicable
        parsed_logs = []
        for line in selected_lines:
            line = line.strip()
            if line:
                try:
                    # Try to parse as JSON
                    log_entry = json.loads(line)
                    parsed_logs.append(log_entry)
                except json.JSONDecodeError:
                    # Fallback to plain text
                    parsed_logs.append({'message': line, 'type': 'plain'})
        
        return jsonify({
            'success': True,
            'filename': filename,
            'total_lines': total_lines,
            'returned_lines': len(selected_lines),
            'logs': parsed_logs
        })
        
    except Exception as e:
        logger.error(f"Error viewing log file {filename}: {e}", exc_info=True)
        return jsonify({'error': 'Failed to read log file'}), 500

@app.route('/api/logs/download/<filename>', methods=['GET'])
@api_login_required
def download_log_file(filename):
    """Download a log file."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    
    try:
        log_dir = log_config['log_dir']
        log_file = log_dir / filename
        
        # Security check
        if not str(log_file.resolve()).startswith(str(log_dir.resolve())):
            return jsonify({'error': 'Invalid file path'}), 400
        
        if not log_file.exists():
            return jsonify({'error': 'Log file not found'}), 404
        
        return send_from_directory(log_dir, filename, as_attachment=True)
        
    except Exception as e:
        logger.error(f"Error downloading log file {filename}: {e}", exc_info=True)
        return jsonify({'error': 'Failed to download log file'}), 500

# ------------------------------------------------------------------
# Admin Cleanup API Routes
# ------------------------------------------------------------------

@app.route('/api/admin/cleanup/downloads', methods=['GET'])
@api_login_required
def admin_get_all_downloads():
    """Get all downloads across all users for admin cleanup interface."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
        
    try:
        from core.downloads_db import get_all_downloads_for_admin
        downloads = get_all_downloads_for_admin()
        # Return downloads directly as an array for easier frontend handling
        return jsonify(downloads)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/storage-stats', methods=['GET'])
@api_login_required  
def admin_get_storage_stats():
    """Get storage usage statistics for admin dashboard."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
        
    try:
        from core.downloads_db import get_storage_usage_stats
        from core.file_cleanup import get_downloads_directory_usage, format_file_size
        
        db_stats = get_storage_usage_stats()
        fs_stats = get_downloads_directory_usage()
        
        # Format sizes for display
        stats = {
            'database': db_stats,
            'filesystem': {
                'total_size': format_file_size(fs_stats['total_size']),
                'total_size_bytes': fs_stats['total_size'],
                'total_files': fs_stats['total_files'],
                'audio_size': format_file_size(fs_stats['audio_size']),
                'audio_files': fs_stats['audio_files'], 
                'stem_size': format_file_size(fs_stats['stem_size']),
                'stem_files': fs_stats['stem_files'],
                'other_size': format_file_size(fs_stats['other_size']),
                'other_files': fs_stats['other_files']
            }
        }
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/downloads/<video_id>', methods=['DELETE'])
@api_login_required
def admin_delete_download_by_video_id(video_id):
    """Delete a download completely including all files and database records using video_id."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
        
    try:
        # Find the global download by video_id
        from core.downloads_db import get_all_downloads_for_admin, delete_download_completely
        from core.file_cleanup import delete_download_files
        
        all_downloads = get_all_downloads_for_admin()
        download_info = next((d for d in all_downloads if d['video_id'] == video_id), None)
        
        if not download_info:
            return jsonify({'error': f'Download with video_id "{video_id}" not found'}), 404
        
        global_download_id = download_info['global_id']
        
        # Delete from database first to get download info
        success, message, detailed_info = delete_download_completely(global_download_id)

        if not success:
            return jsonify({'error': message}), 400

        # Clear from all active user sessions so it disappears from their library
        user_session_manager.clear_download_from_all_sessions(video_id)

        file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}
        
        # Delete associated files if we have download info
        if detailed_info:
            file_success, file_message, file_cleanup_stats = delete_download_files(detailed_info)
            if not file_success:
                print(f"File cleanup warning: {file_message}")
        
        return jsonify({
            'success': True,
            'message': message,
            'video_id': video_id,
            'file_cleanup': file_cleanup_stats
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/downloads/<video_id>/reload', methods=['POST'])
@api_login_required
def admin_reload_download(video_id):
    """Remove existing artifacts and re-download a video from YouTube as a fresh item."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    video_id = (video_id or "").strip()
    if not video_id:
        return jsonify({'error': 'Invalid video ID'}), 400

    try:
        from core.downloads_db import (
            get_all_downloads_for_admin,
            delete_download_completely,
            get_user_ids_for_video
        )
        from core.file_cleanup import delete_download_files

        all_downloads = get_all_downloads_for_admin()
        download_info = next((d for d in all_downloads if d['video_id'] == video_id), None)

        affected_users = []
        file_cleanup_stats = None
        prev_title = None
        prev_quality = 'best'
        prev_media_type = 'audio'

        if download_info:
            prev_title = download_info.get('title')
            prev_quality = download_info.get('quality') or prev_quality
            prev_media_type = download_info.get('media_type') or prev_media_type
            affected_users = get_user_ids_for_video(video_id)

            success, message, detailed_info = delete_download_completely(download_info['global_id'])
            if not success:
                return jsonify({'error': message}), 400

            try:
                file_success, file_message, file_cleanup_stats = delete_download_files(detailed_info)
                if not file_success:
                    logger.warning(f"[ADMIN RELOAD] File cleanup warning for {video_id}: {file_message}")
            except Exception as cleanup_error:
                logger.warning(f"[ADMIN RELOAD] Error during file cleanup for {video_id}: {cleanup_error}")

        # Ensure admin regains access once reload completes
        if download_info and current_user.id not in affected_users:
            affected_users.append(current_user.id)
        if affected_users:
            user_session_manager.schedule_reload_user_access(video_id, affected_users)

        ai_client = get_aiotube_client()
        video_info = ai_client.get_video_info(video_id)
        if video_info.get('error'):
            return jsonify({'error': video_info['error']}), 400

        items = video_info.get('items') or []
        snippet = items[0].get('snippet', {}) if items else {}
        thumbnails = snippet.get('thumbnails') or {}

        title = snippet.get('title') or prev_title or video_id
        thumbnail_url = ''
        for key in ('medium', 'high', 'default'):
            thumb = thumbnails.get(key) or {}
            if thumb.get('url'):
                thumbnail_url = thumb['url']
                break
        if not thumbnail_url:
            thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

        download_type = DownloadType.VIDEO if str(prev_media_type).lower() == 'video' else DownloadType.AUDIO

        dm = user_session_manager.get_download_manager()
        item = DownloadItem(
            video_id=video_id,
            title=title,
            thumbnail_url=thumbnail_url,
            download_type=download_type,
            quality=prev_quality
        )
        download_id = dm.add_download(item)

        return jsonify({
            'success': True,
            'message': f'Reload started for {title}',
            'download_id': download_id,
            'reassigned_users': len(affected_users),
            'file_cleanup': file_cleanup_stats
        })

    except Exception as e:
        logger.error(f"[ADMIN RELOAD] Failed to reload {video_id}: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/downloads/<int:global_download_id>/reset-extraction', methods=['POST'])
@api_login_required
def admin_reset_extraction_status(global_download_id):
    """Reset extraction status for a download while keeping the download record."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
        
    try:
        from core.downloads_db import reset_extraction_status, get_all_downloads_for_admin
        from core.file_cleanup import delete_extraction_files_only
        
        # Get download info before resetting
        all_downloads = get_all_downloads_for_admin()
        download_info = next((d for d in all_downloads if d['global_id'] == global_download_id), None)
        
        if not download_info:
            return jsonify({'error': 'Download not found'}), 404
        
        # Reset database status
        success, message = reset_extraction_status(global_download_id)

        if not success:
            return jsonify({'error': message}), 400

        # CRITICAL: Clear extraction from all in-memory sessions
        video_id = download_info.get('video_id')
        if video_id:
            user_session_manager.clear_extraction_from_all_sessions(video_id)

        # Delete extraction files
        file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}
        if download_info.get('extracted'):
            file_success, file_message, file_cleanup_stats = delete_extraction_files_only(download_info)
            if not file_success:
                print(f"File cleanup warning: {file_message}")
        
        return jsonify({
            'success': True,
            'message': message,
            'file_cleanup': file_cleanup_stats
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/downloads/<video_id>/reset-extraction', methods=['POST'])
@api_login_required
def admin_reset_extraction_by_video_id(video_id):
    """Reset extraction status for ALL downloads with this video_id."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        # FIX: Use reset_extraction_status_by_video_id to reset ALL records with this video_id
        # (not just the first one found, which was causing issues when multiple qualities exist)
        from core.downloads_db import reset_extraction_status_by_video_id, get_all_downloads_for_admin
        from core.file_cleanup import delete_extraction_files_only

        # Get download info for file cleanup (get all records with this video_id)
        all_downloads = get_all_downloads_for_admin()
        matching_downloads = [d for d in all_downloads if d['video_id'] == video_id]

        if not matching_downloads:
            return jsonify({'error': f'Download with video_id "{video_id}" not found'}), 404

        # Reset database status for ALL records with this video_id
        success, message = reset_extraction_status_by_video_id(video_id)

        if not success:
            return jsonify({'error': message}), 400

        # CRITICAL: Clear extraction from all in-memory sessions
        # Without this, the session check finds the old extraction and blocks new ones
        user_session_manager.clear_extraction_from_all_sessions(video_id)

        # Delete extraction files for all matching downloads
        file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}
        for download_info in matching_downloads:
            if download_info.get('extracted'):
                file_success, file_message, single_stats = delete_extraction_files_only(download_info)
                if file_success:
                    file_cleanup_stats['files_deleted'].extend(single_stats.get('files_deleted', []))
                    file_cleanup_stats['total_size_freed'] += single_stats.get('total_size_freed', 0)
                else:
                    print(f"File cleanup warning for {download_info['global_id']}: {file_message}")
                    file_cleanup_stats['errors'].append(file_message)

        return jsonify({
            'success': True,
            'message': message,
            'video_id': video_id,
            'file_cleanup': file_cleanup_stats
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/downloads/bulk-delete', methods=['POST'])
@api_login_required
def admin_bulk_delete_downloads():
    """Bulk delete multiple downloads."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
        
    try:
        data = request.json
        download_ids = data.get('download_ids', [])
        
        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400
        
        from core.downloads_db import delete_download_completely, get_all_downloads_for_admin
        from core.file_cleanup import delete_download_files
        
        # Get all downloads info first
        all_downloads = get_all_downloads_for_admin()
        downloads_to_delete = {d['global_id']: d for d in all_downloads if d['global_id'] in download_ids}
        
        results = []
        total_freed = 0
        
        for download_id in download_ids:
            try:
                download_info_dict = downloads_to_delete.get(download_id)
                video_id = download_info_dict.get('video_id') if download_info_dict else None

                # Delete from database
                success, message, download_info = delete_download_completely(download_id)

                # Clear from all active user sessions
                if success and video_id:
                    user_session_manager.clear_download_from_all_sessions(video_id)

                file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}

                # Delete files using either the retrieved info or the pre-fetched info
                cleanup_info = download_info or download_info_dict
                if cleanup_info:
                    file_success, file_message, file_cleanup_stats = delete_download_files(cleanup_info)
                    total_freed += file_cleanup_stats['total_size_freed']

                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message,
                    'file_cleanup': file_cleanup_stats
                })
                
            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': str(e),
                    'file_cleanup': {'files_deleted': [], 'total_size_freed': 0, 'errors': [str(e)]}
                })
        
        successful_deletions = sum(1 for r in results if r['success'])
        
        return jsonify({
            'success': True,
            'deleted_count': successful_deletions,
            'total_count': len(download_ids),
            'total_size_freed': total_freed,
            'results': results
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup/downloads/bulk-reset', methods=['POST'])
@api_login_required
def admin_bulk_reset_extractions():
    """Bulk reset extraction status for multiple downloads."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
        
    try:
        data = request.json
        download_ids = data.get('download_ids', [])
        
        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400
        
        from core.downloads_db import reset_extraction_status, get_all_downloads_for_admin
        from core.file_cleanup import delete_extraction_files_only
        
        # Get all downloads info first
        all_downloads = get_all_downloads_for_admin()
        downloads_to_reset = {d['global_id']: d for d in all_downloads if d['global_id'] in download_ids}
        
        results = []
        total_freed = 0
        
        for download_id in download_ids:
            try:
                download_info_dict = downloads_to_reset.get(download_id)
                
                # Reset extraction status in database
                success, message, download_info = reset_extraction_status(download_id)
                
                file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}
                
                # Delete extraction files (stems) but keep download files
                cleanup_info = download_info or download_info_dict
                if cleanup_info and cleanup_info.get('extracted'):
                    file_success, file_message, file_cleanup_stats = delete_extraction_files_only(cleanup_info)
                    total_freed += file_cleanup_stats['total_size_freed']
                
                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message,
                    'file_cleanup': file_cleanup_stats
                })
                
            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': f'Error resetting download: {str(e)}',
                    'file_cleanup': {'files_deleted': [], 'total_size_freed': 0, 'errors': [str(e)]}
                })
        
        successful_resets = len([r for r in results if r['success']])
        
        return jsonify({
            'success': True,
            'reset_count': successful_resets,
            'total_count': len(download_ids),
            'total_size_freed': total_freed,
            'results': results
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ------------------------------------------------------------------
# Remaining API routes unchanged ...
# ------------------------------------------------------------------
@app.route('/api/config', methods=['GET'])
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

@app.route('/api/config', methods=['POST'])
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

@app.route('/api/config/ffmpeg/check', methods=['GET'])
@api_login_required
def check_ffmpeg():
    return jsonify({'ffmpeg_available': True, 'ffmpeg_path': get_ffmpeg_path()})

@app.route('/api/config/ffmpeg/download', methods=['POST'])
@api_login_required
def download_ffmpeg_route():
    return jsonify({'error': 'Not implemented'}), 501

@app.route('/api/config/browser-logging', methods=['GET'])
@api_login_required
def get_browser_logging_config():
    """Get browser logging configuration (available to all authenticated users)."""
    return jsonify({
        'enabled': get_setting('browser_logging_enabled', False),
        'min_log_level': get_setting('browser_logging_level', 'error'),
        'flush_interval_seconds': get_setting('browser_logging_flush_interval', 60),
        'max_buffer_size': get_setting('browser_logging_buffer_size', 50)
    })

@app.route('/api/config/browser-logging', methods=['POST'])
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

# ============================================
# Admin User Management API
# ============================================

@app.route('/api/admin/users', methods=['GET'])
@api_login_required
@api_admin_required
def api_get_users():
    """Get all users (admin only)."""
    users = get_all_users()
    return jsonify({
        'users': [{
            'id': u['id'],
            'username': u['username'],
            'email': u.get('email'),
            'is_admin': u.get('is_admin', False),
            'youtube_enabled': bool(u.get('youtube_enabled', False))
        } for u in users]
    })

@app.route('/api/admin/users', methods=['POST'])
@api_login_required
@api_admin_required
def api_create_user():
    """Create a new user (admin only)."""
    data = request.json or {}

    username = data.get('username', '').strip()
    password = data.get('password', '')
    email = data.get('email', '').strip() or None
    is_admin = bool(data.get('is_admin', False))
    youtube_enabled = bool(data.get('youtube_enabled', False))

    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    success, message = add_user(username, password, email, is_admin, youtube_enabled)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400

@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@api_login_required
@api_admin_required
def api_update_user(user_id):
    """Update user details (admin only)."""
    data = request.json or {}

    username = data.get('username', '').strip()
    email = data.get('email', '').strip() or None
    is_admin = bool(data.get('is_admin', False))
    youtube_enabled = bool(data.get('youtube_enabled', False))

    if not username:
        return jsonify({'error': 'Username is required'}), 400

    success, message = update_user(user_id, username, email, is_admin, youtube_enabled)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400

@app.route('/api/admin/users/<int:user_id>/password', methods=['PUT'])
@api_login_required
@api_admin_required
def api_reset_password(user_id):
    """Reset user password (admin only)."""
    data = request.json or {}
    password = data.get('password', '')

    if not password:
        return jsonify({'error': 'Password is required'}), 400

    success, message = reset_user_password(user_id, password)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@api_login_required
@api_admin_required
def api_delete_user(user_id):
    """Delete a user (admin only)."""
    # Prevent self-deletion
    if user_id == current_user.id:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    success, message = delete_user(user_id)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400

@app.route('/api/admin/users/<int:user_id>/youtube', methods=['PUT'])
@api_login_required
@api_admin_required
def api_toggle_user_youtube(user_id):
    """Toggle YouTube access for a user (admin only)."""
    data = request.json or {}
    enabled = bool(data.get('youtube_enabled', False))

    success, message = set_user_youtube_access(user_id, enabled)

    if success:
        return jsonify({'success': True, 'youtube_enabled': enabled})
    else:
        return jsonify({'error': message}), 400

# ============================================
# System Settings Admin API Routes
# ============================================

@app.route('/api/admin/system-settings', methods=['GET'])
@api_login_required
@api_admin_required
def get_system_settings():
    """Get system settings for admin panel."""
    try:
        # Get current settings from config
        downloads_directory = get_setting('downloads_directory', DOWNLOADS_DIR)
        max_concurrent_downloads = get_setting('max_concurrent_downloads', 3)
        max_concurrent_extractions = get_setting('max_concurrent_extractions', 1)
        use_gpu_for_extraction = get_setting('use_gpu_for_extraction', True)
        lyrics_model_size = get_setting('lyrics_model_size', 'large-v3')
        default_stem_model = get_setting('default_stem_model', 'htdemucs')

        # Check GPU availability
        gpu_available = False
        gpu_name = None
        try:
            import torch
            gpu_available = torch.cuda.is_available()
            if gpu_available:
                gpu_name = torch.cuda.get_device_name(0)
        except Exception:
            pass

        # Check FFmpeg availability
        ffmpeg_available = False
        ffmpeg_path = None
        try:
            import subprocess
            result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
            if result.returncode == 0:
                ffmpeg_available = True
                # Try to get path
                import shutil
                ffmpeg_path = shutil.which('ffmpeg')
        except Exception:
            pass

        return jsonify({
            'success': True,
            'settings': {
                'downloads_directory': downloads_directory,
                'max_concurrent_downloads': max_concurrent_downloads,
                'max_concurrent_extractions': max_concurrent_extractions,
                'use_gpu_for_extraction': use_gpu_for_extraction,
                'lyrics_model_size': lyrics_model_size,
                'default_stem_model': default_stem_model
            },
            'system_info': {
                'gpu_available': gpu_available,
                'gpu_name': gpu_name,
                'ffmpeg_available': ffmpeg_available,
                'ffmpeg_path': ffmpeg_path
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/system-settings', methods=['POST'])
@api_login_required
@api_admin_required
def update_system_settings():
    """Update system settings (admin only)."""
    try:
        data = request.json or {}
        requires_restart = False
        applied_changes = []

        logger.info(f"[SystemSettings] Received settings update: {data}")

        # Track if downloads directory changed
        current_downloads_dir = get_setting('downloads_directory', DOWNLOADS_DIR)
        new_downloads_dir = data.get('downloads_directory')
        if new_downloads_dir and new_downloads_dir != current_downloads_dir:
            # Validate directory exists or can be created
            try:
                os.makedirs(new_downloads_dir, exist_ok=True)
                update_setting('downloads_directory', new_downloads_dir)
                requires_restart = True
                applied_changes.append('downloads_directory')
                logger.info(f"[SystemSettings] Downloads directory changed to: {new_downloads_dir}")
            except Exception as e:
                return jsonify({'error': f'Invalid downloads directory: {str(e)}'}), 400

        # Update other settings (don't require restart)
        if 'max_concurrent_downloads' in data:
            value = int(data['max_concurrent_downloads'])
            if 1 <= value <= 10:
                update_setting('max_concurrent_downloads', value)
                applied_changes.append('max_concurrent_downloads')
                logger.info(f"[SystemSettings] Max concurrent downloads set to: {value}")

        if 'max_concurrent_extractions' in data:
            value = int(data['max_concurrent_extractions'])
            if 1 <= value <= 5:
                update_setting('max_concurrent_extractions', value)
                applied_changes.append('max_concurrent_extractions')
                logger.info(f"[SystemSettings] Max concurrent extractions set to: {value}")

        if 'use_gpu_for_extraction' in data:
            use_gpu = bool(data['use_gpu_for_extraction'])
            update_setting('use_gpu_for_extraction', use_gpu)
            applied_changes.append('use_gpu_for_extraction')
            logger.info(f"[SystemSettings] Use GPU for extraction set to: {use_gpu}")

            # Apply GPU setting to the stems extractor immediately
            try:
                from core.stems_extractor import get_stems_extractor
                extractor = get_stems_extractor()
                extractor.set_use_gpu(use_gpu)
                logger.info(f"[SystemSettings] GPU setting applied to extractor: {extractor.using_gpu}")
            except Exception as e:
                logger.warning(f"[SystemSettings] Could not apply GPU setting to extractor: {e}")

        if 'lyrics_model_size' in data:
            valid_models = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3']
            if data['lyrics_model_size'] in valid_models:
                update_setting('lyrics_model_size', data['lyrics_model_size'])
                applied_changes.append('lyrics_model_size')
                logger.info(f"[SystemSettings] Lyrics model size set to: {data['lyrics_model_size']}")

        if 'default_stem_model' in data:
            valid_stem_models = ['htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'mdx_extra', 'mdx_extra_q']
            if data['default_stem_model'] in valid_stem_models:
                update_setting('default_stem_model', data['default_stem_model'])
                applied_changes.append('default_stem_model')
                logger.info(f"[SystemSettings] Default stem model set to: {data['default_stem_model']}")

        logger.info(f"[SystemSettings] Applied changes: {applied_changes}")

        return jsonify({
            'success': True,
            'message': 'Settings updated successfully',
            'requires_restart': requires_restart,
            'applied_changes': applied_changes
        })
    except Exception as e:
        logger.error(f"[SystemSettings] Error updating settings: {e}")
        return jsonify({'error': str(e)}), 500

# ============================================
# YouTube Cookies Management API Routes
# ============================================

COOKIES_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'core', 'youtube_cookies.txt')

@app.route('/api/admin/cookies/status', methods=['GET'])
@api_login_required
@api_admin_required
def get_cookies_status():
    """Get YouTube cookies file status."""
    try:
        if os.path.exists(COOKIES_FILE_PATH):
            stat = os.stat(COOKIES_FILE_PATH)
            modified_time = datetime.fromtimestamp(stat.st_mtime)
            age_hours = (datetime.now() - modified_time).total_seconds() / 3600

            # Count cookies in file
            cookie_count = 0
            with open(COOKIES_FILE_PATH, 'r') as f:
                for line in f:
                    if line.strip() and not line.startswith('#'):
                        cookie_count += 1

            return jsonify({
                'success': True,
                'exists': True,
                'cookie_count': cookie_count,
                'modified': modified_time.isoformat(),
                'age_hours': round(age_hours, 1),
                'is_fresh': age_hours < 24,  # Consider fresh if less than 24h old
                'file_size': stat.st_size
            })
        else:
            return jsonify({
                'success': True,
                'exists': False
            })
    except Exception as e:
        logger.error(f"[Cookies] Error checking status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cookies/upload', methods=['POST', 'OPTIONS'])
def upload_cookies():
    """
    Receive cookies from bookmarklet and save as Netscape cookies.txt format.
    This endpoint doesn't require auth as it's called from youtube.com via bookmarklet.
    Instead, it uses a one-time token for security.
    """
    # Handle CORS preflight request
    if request.method == 'OPTIONS':
        response = app.make_default_options_response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    try:
        data = request.json or {}
        cookies_raw = data.get('cookies', '')
        domain = data.get('domain', '')
        token = data.get('token', '')

        # Helper to add CORS headers to response
        def cors_response(data, status=200):
            response = jsonify(data)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, status

        # Validate token (stored in session or config)
        expected_token = get_setting('cookies_upload_token', None)
        if not expected_token or token != expected_token:
            return cors_response({'success': False, 'message': 'Invalid or expired token'}, 403)

        # Clear the token after use (one-time)
        update_setting('cookies_upload_token', None)

        if not cookies_raw:
            return cors_response({'success': False, 'message': 'No cookies received'}, 400)

        if '.youtube.com' not in domain and 'youtube.com' not in domain:
            return cors_response({'success': False, 'message': 'Cookies must be from youtube.com'}, 400)

        # Parse cookies and convert to Netscape format
        # Format: domain\tinclude_subdomains\tpath\tsecure\texpiry\tname\tvalue
        lines = ['# Netscape HTTP Cookie File', '# Generated by StemTube Admin', '']

        cookie_pairs = cookies_raw.split('; ')
        for pair in cookie_pairs:
            if '=' in pair:
                name, value = pair.split('=', 1)
                # Standard YouTube cookie entry
                # Use .youtube.com for subdomains
                lines.append(f".youtube.com\tTRUE\t/\tTRUE\t0\t{name}\t{value}")

        # Write to file
        with open(COOKIES_FILE_PATH, 'w') as f:
            f.write('\n'.join(lines))

        cookie_count = len(cookie_pairs)
        logger.info(f"[Cookies] Saved {cookie_count} cookies from bookmarklet")

        return cors_response({
            'success': True,
            'message': f'{cookie_count} YouTube cookies saved!',
            'cookie_count': cookie_count
        })
    except Exception as e:
        logger.error(f"[Cookies] Error uploading: {e}")
        # cors_response is defined inside try, so manually add CORS here
        response = jsonify({'success': False, 'message': str(e)})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

@app.route('/api/admin/cookies/generate-token', methods=['POST'])
@api_login_required
@api_admin_required
def generate_cookies_token():
    """Generate a one-time token for bookmarklet authentication."""
    try:
        import secrets
        token = secrets.token_urlsafe(32)
        update_setting('cookies_upload_token', token)

        # Token expires after 5 minutes (handled by bookmarklet timeout)
        logger.info("[Cookies] Generated new upload token")

        return jsonify({
            'success': True,
            'token': token
        })
    except Exception as e:
        logger.error(f"[Cookies] Error generating token: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cookies/bookmarklet', methods=['GET'])
@api_login_required
@api_admin_required
def get_bookmarklet():
    """Generate bookmarklet code with current server URL."""
    try:
        # Detect server URL
        server_url = request.url_root.rstrip('/')

        # If behind ngrok, use the ngrok URL
        ngrok_url = os.environ.get('NGROK_URL', '')
        if ngrok_url:
            server_url = ngrok_url.rstrip('/')

        # Generate token
        import secrets
        token = secrets.token_urlsafe(32)
        update_setting('cookies_upload_token', token)

        # Bookmarklet JavaScript (minified)
        bookmarklet = f"""javascript:(function(){{
if(!location.hostname.includes('youtube.com')){{alert('Please open this page on YouTube.com first!');return;}}
fetch('{server_url}/api/admin/cookies/upload',{{
method:'POST',
headers:{{'Content-Type':'application/json'}},
body:JSON.stringify({{cookies:document.cookie,domain:location.hostname,token:'{token}'}})
}}).then(r=>r.json()).then(d=>alert(d.message||'Error')).catch(e=>alert('Error: '+e));
}})();"""

        return jsonify({
            'success': True,
            'bookmarklet': bookmarklet,
            'server_url': server_url,
            'instructions': [
                '1. Click "Generate Bookmarklet" below',
                '2. Drag the "📥 StemTube Cookies" link to your bookmarks bar',
                '3. Go to youtube.com and log in to your account',
                '4. Click the bookmarklet in your bookmarks bar',
                '5. Cookies will be automatically sent to the server'
            ]
        })
    except Exception as e:
        logger.error(f"[Cookies] Error generating bookmarklet: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cookies', methods=['DELETE'])
@api_login_required
@api_admin_required
def delete_cookies():
    """Delete the cookies file."""
    try:
        if os.path.exists(COOKIES_FILE_PATH):
            os.remove(COOKIES_FILE_PATH)
            logger.info("[Cookies] Cookies file deleted")
            return jsonify({'success': True, 'message': 'Cookies deleted'})
        else:
            return jsonify({'success': True, 'message': 'No cookies file found'})
    except Exception as e:
        logger.error(f"[Cookies] Error deleting: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/system-info', methods=['GET'])
@api_login_required
@api_admin_required
def get_system_info():
    """Get detailed system information."""
    try:
        import platform
        import psutil

        system_info = {
            'platform': platform.system(),
            'platform_version': platform.version(),
            'python_version': platform.python_version(),
            'cpu_count': psutil.cpu_count(),
            'cpu_percent': psutil.cpu_percent(interval=0.1),
            'memory_total': psutil.virtual_memory().total,
            'memory_available': psutil.virtual_memory().available,
            'memory_percent': psutil.virtual_memory().percent
        }

        # GPU info
        try:
            import torch
            system_info['pytorch_version'] = torch.__version__
            system_info['cuda_available'] = torch.cuda.is_available()
            if torch.cuda.is_available():
                system_info['cuda_version'] = torch.version.cuda
                system_info['gpu_name'] = torch.cuda.get_device_name(0)
                system_info['gpu_memory_total'] = torch.cuda.get_device_properties(0).total_memory
                system_info['gpu_memory_allocated'] = torch.cuda.memory_allocated(0)
        except Exception:
            system_info['pytorch_version'] = 'Not available'
            system_info['cuda_available'] = False

        return jsonify({
            'success': True,
            'system_info': system_info
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/restart-server', methods=['POST'])
@api_login_required
@api_admin_required
def restart_server():
    """Restart the server and ngrok (admin only)."""
    import threading
    import time
    import subprocess

    def delayed_restart():
        time.sleep(1)
        logger.info("Restarting server and ngrok...")

        # Get service name from environment (set in systemd service file)
        service_name = os.environ.get('SYSTEMD_SERVICE_NAME', '')

        if service_name:
            # Use systemctl restart - this is the only reliable method
            # since the server can't restart itself after stopping
            logger.info(f"Restarting via systemctl (service: {service_name})...")
            try:
                subprocess.Popen(['sudo', 'systemctl', 'restart', service_name],
                               start_new_session=True,
                               stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
                return
            except Exception as e:
                logger.error(f"systemctl restart failed: {e}")

        # Fallback: basic Python restart (ngrok will not be restarted)
        logger.warning("SYSTEMD_SERVICE_NAME not set - falling back to basic restart (ngrok will not be restarted)")
        os.execv(sys.executable, [sys.executable] + sys.argv)

    # Start restart in background thread
    restart_thread = threading.Thread(target=delayed_restart)
    restart_thread.daemon = True
    restart_thread.start()

    return jsonify({
        'success': True,
        'message': 'Server is restarting...'
    })

@app.route('/api/user/disclaimer-status', methods=['GET'])
@api_login_required
def get_disclaimer_status():
    """Check if current user has accepted the disclaimer."""
    from core.auth_db import get_user_disclaimer_status
    
    user_id = current_user.id
    accepted = get_user_disclaimer_status(user_id)
    
    return jsonify({'accepted': accepted})

@app.route('/api/user/accept-disclaimer', methods=['POST'])
@api_login_required
def accept_disclaimer_route():
    """Record that current user has accepted the disclaimer."""
    from core.auth_db import accept_disclaimer
    
    user_id = current_user.id
    success = accept_disclaimer(user_id)
    
    if success:
        return jsonify({'success': True, 'message': 'Disclaimer accepted'})
    else:
        return jsonify({'success': False, 'message': 'Failed to record disclaimer acceptance'}), 500

@app.route('/api/open-folder', methods=['POST'])
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

@app.route('/api/upload-file', methods=['POST'])
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

@app.route('/api/download-file', methods=['GET'])
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

@app.route('/api/stream-audio', methods=['GET'])
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

@app.route('/api/list-files', methods=['POST'])
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

@app.route('/api/extracted_stems/<extraction_id>/<stem_name>', methods=['GET', 'HEAD'])
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
                            return send_from_directory(directory, filename, mimetype='audio/mpeg')
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
        return send_from_directory(directory, filename, mimetype='audio/mpeg')
        
    except Exception as e:
        return jsonify({'error': f'Error serving stem file: {str(e)}'}), 500

# ------------------------------------------------------------------
# Library API Endpoints
# ------------------------------------------------------------------

@app.route('/api/library', methods=['GET'])
@api_login_required
def get_library():
    """Get all global downloads/extractions available to users."""
    try:
        filter_type = request.args.get('filter', 'all')  # 'all', 'downloads', 'extractions'
        search_query = request.args.get('search', '').strip()
        
        # Get all global downloads
        import sqlite3
        from pathlib import Path
        DB_PATH = Path("stemtubes.db")
        
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Base query for global downloads with user access information
            base_query = """
                SELECT 
                    gd.*,
                    COUNT(DISTINCT ud.user_id) as user_count,
                    CASE WHEN user_access.user_id IS NOT NULL THEN 1 ELSE 0 END as user_has_access,
                    user_access.file_path as user_file_path,
                    user_access.extracted as user_extracted
                FROM global_downloads gd
                LEFT JOIN user_downloads ud ON gd.id = ud.global_download_id
                LEFT JOIN user_downloads user_access ON gd.id = user_access.global_download_id 
                    AND user_access.user_id = ?
            """
            
            # Add search filter
            where_conditions = []
            params = [current_user.id]
            
            if search_query:
                where_conditions.append("(gd.title LIKE ? OR gd.video_id LIKE ?)")
                search_param = f"%{search_query}%"
                params.extend([search_param, search_param])
            
            # Add filter conditions
            if filter_type == 'downloads':
                where_conditions.append("gd.file_path IS NOT NULL")
            elif filter_type == 'extractions':
                where_conditions.append("gd.extracted = 1")
            
            if where_conditions:
                base_query += " WHERE " + " AND ".join(where_conditions)
            
            base_query += """
                GROUP BY gd.id
                ORDER BY gd.created_at DESC
            """
            
            cursor.execute(base_query, params)
            library_items = cursor.fetchall()
            
            # Format results
            formatted_items = []
            for item in library_items:
                # Determine what's available
                has_download = bool(item['file_path'])
                has_extraction = bool(item['extracted'])
                
                # Determine user's current access
                user_has_download_access = bool(item['user_has_access'] and item['user_file_path'])
                user_has_extraction_access = bool(item['user_has_access'] and item['user_extracted'])
                
                # Calculate file size if available
                file_size = None
                if item['file_path'] and os.path.exists(item['file_path']):
                    try:
                        file_size = os.path.getsize(item['file_path'])
                    except:
                        pass
                
                formatted_item = {
                    'id': item['id'],
                    'video_id': item['video_id'],
                    'title': item['title'],
                    'thumbnail_url': item['thumbnail'],
                    'media_type': item['media_type'],
                    'quality': item['quality'],
                    'created_at': item['created_at'],
                    'user_count': item['user_count'],
                    'file_size': file_size,
                    
                    # Availability flags
                    'has_download': has_download,
                    'has_extraction': has_extraction,
                    
                    # User access flags
                    'user_has_download_access': user_has_download_access,
                    'user_has_extraction_access': user_has_extraction_access,
                    
                    # Action availability
                    'can_add_download': has_download and not user_has_download_access,
                    'can_add_extraction': has_extraction and not user_has_extraction_access,
                    
                    # Badge type for display
                    'badge_type': 'both' if (has_download and has_extraction) else ('download' if has_download else 'extraction')
                }
                
                formatted_items.append(formatted_item)
            
            return jsonify({
                'success': True,
                'items': formatted_items,
                'total_count': len(formatted_items),
                'filter': filter_type,
                'search': search_query
            })
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/<int:global_download_id>/add-download', methods=['POST'])
@api_login_required
def add_library_download_to_user(global_download_id):
    """Add a download from library to user's personal downloads list."""
    try:
        # Get the global download record
        import sqlite3
        from pathlib import Path
        DB_PATH = Path("stemtubes.db")
        
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_downloads WHERE id = ?", (global_download_id,))
            global_download = cursor.fetchone()
            
            if not global_download:
                return jsonify({'error': 'Download not found in library'}), 404
            
            # Convert to dict for use with existing functions
            global_download = dict(global_download)
        
        # Check if user already has access to this download
        existing_downloads = db_list_downloads(current_user.id)
        for existing in existing_downloads:
            if existing['global_download_id'] == global_download_id and existing['file_path']:
                return jsonify({'error': 'You already have access to this download'}), 400
        
        # Add user access to the download
        db_add_user_access(current_user.id, global_download)
        
        return jsonify({
            'success': True,
            'message': f'Added "{global_download["title"]}" to your downloads'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/<int:global_download_id>/add-extraction', methods=['POST'])
@api_login_required
def add_library_extraction_to_user(global_download_id):
    """Add an extraction from library to user's personal extractions list."""
    try:
        # Get the global download record
        import sqlite3
        from pathlib import Path
        DB_PATH = Path("stemtubes.db")
        
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_downloads WHERE id = ?", (global_download_id,))
            global_download = cursor.fetchone()
            
            if not global_download:
                return jsonify({'error': 'Extraction not found in library'}), 404
            
            # Convert to dict for use with existing functions
            global_download = dict(global_download)
        
        if not global_download['extracted']:
            return jsonify({'error': 'This item has not been extracted yet'}), 400
        
        # Check if user already has access to this extraction
        user_extractions = db_list_extractions(current_user.id)
        for existing in user_extractions:
            if existing['global_download_id'] == global_download_id:
                return jsonify({'error': 'You already have access to this extraction'}), 400
        
        # Add user access to the extraction
        db_add_user_extraction_access(current_user.id, global_download)
        
        return jsonify({
            'success': True,
            'message': f'Added extraction of "{global_download["title"]}" to your list'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ------------------------------------------------------------------
# Mobile Routes
# ------------------------------------------------------------------
from mobile_routes import register_mobile_routes
register_mobile_routes(app)

# Admin route for mobile settings
@app.route('/admin/mobile-settings')
@login_required
@admin_required
def admin_mobile_settings():
    """Mobile settings configuration page"""
    return render_template('admin-mobile-settings.html')

# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------
if __name__ == '__main__':
    import socket
    # Use centralized configuration - single source of truth in core/config.py
    logger.info(f"Starting StemTube Web server on {HOST}:{PORT}")
    logger.info("Logging system active - all events will be recorded")
    socketio.run(app, host=HOST, port=PORT, debug=False, allow_unsafe_werkzeug=True)
