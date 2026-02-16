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

import subprocess
from flask import Flask
from flask_session import Session

# Setup logging first (before other imports)
from core.logging_config import setup_logging, get_logger

# Initialize logging system
log_config = setup_logging(app_name="stemtube", log_level="INFO")
logger = get_logger(__name__)

logger.info("StemTube Web application starting up...")

# Core modules
from core.config import (
    ensure_ffmpeg_available, ensure_valid_downloads_directory,
    validate_and_fix_config_paths,
    PORT, HOST,
)
from core.auth_db import init_db, get_user_by_id
from core.auth_models import User
from core.downloads_db import (
    init_table as init_downloads_table,
    comprehensive_cleanup,
)

# Shared extensions
from extensions import socketio, login_manager, init_aiotube_client

# ------------------------------------------------------------------
# yt-dlp Auto-Update at Startup
# ------------------------------------------------------------------
def check_ytdlp_update():
    """Check and update yt-dlp nightly at startup to avoid YouTube blocks."""
    try:
        print("[STARTUP] Checking for yt-dlp nightly updates...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "--pre", "--quiet", "yt-dlp[default]"],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode == 0:
            import yt_dlp
            print(f"[STARTUP] yt-dlp nightly is up to date: {yt_dlp.version.__version__}")
        else:
            print(f"[STARTUP] Warning: yt-dlp update check failed: {result.stderr}")
    except Exception as e:
        print(f"[STARTUP] Warning: Could not check yt-dlp updates: {e}")

check_ytdlp_update()

# ------------------------------------------------------------------
# Bootstrap
# ------------------------------------------------------------------
logger.info("Initializing application components...")

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

app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 86400
app.config['SESSION_FILE_DIR'] = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'flask_session')
os.makedirs(app.config['SESSION_FILE_DIR'], exist_ok=True)

# Cookie configuration for cross-browser compatibility
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = False
app.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
app.config['REMEMBER_COOKIE_HTTPONLY'] = True

Session(app)

# Initialize extensions with the app
login_manager.init_app(app)

@login_manager.user_loader
def load_user(user_id):
    user_data = get_user_by_id(user_id)
    return User(user_data) if user_data else None

socketio.init_app(
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

# Initialize global YouTube client
init_aiotube_client()

# ------------------------------------------------------------------
# Register all blueprints
# ------------------------------------------------------------------
from routes import register_all_blueprints
register_all_blueprints(app)

# Mobile routes (existing standalone blueprint)
from mobile_routes import register_mobile_routes
register_mobile_routes(app)

logger.info("All routes registered successfully")

# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------
if __name__ == '__main__':
    import socket
    logger.info(f"Starting StemTube Web server on {HOST}:{PORT}")
    logger.info("Logging system active - all events will be recorded")
    socketio.run(app, host=HOST, port=PORT, debug=False, allow_unsafe_werkzeug=True)
