"""
Blueprint-based route modules for StemTube.

Each module registers a Flask Blueprint covering a logical group of endpoints.
"""

from .auth import auth_bp
from .pages import pages_bp
from .admin import admin_bp
from .admin_api import admin_api_bp
from .downloads import downloads_bp
from .extractions import extractions_bp
from .media import media_bp
from .library import library_bp
from .files import files_bp
from .config_routes import config_bp
from .logging_routes import logging_bp
from .jam import jam_bp, register_jam_socketio_events
from .recordings import recordings_bp

ALL_BLUEPRINTS = [
    auth_bp,
    pages_bp,
    admin_bp,
    admin_api_bp,
    downloads_bp,
    extractions_bp,
    media_bp,
    library_bp,
    files_bp,
    config_bp,
    logging_bp,
    jam_bp,
    recordings_bp,
]


def register_all_blueprints(app):
    """Register every blueprint with the Flask app."""
    for bp in ALL_BLUEPRINTS:
        app.register_blueprint(bp)
    # SocketIO jam events need the socketio instance
    from extensions import socketio
    register_jam_socketio_events(socketio)
    print("[Blueprints] All route blueprints registered successfully")
