"""
SQLAlchemy ORM models for StemTube.

All 6 tables defined as declarative models. JSON TEXT columns upgraded to
PostgreSQL JSONB for native querying. Thread-safe session management via
thread_session() context manager for background workers.
"""
from contextlib import contextmanager
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, Float, DateTime,
    ForeignKey, UniqueConstraint, Index, func, text
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

db = SQLAlchemy()


# ── Models ───────────────────────────────────────────────────────────

class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    username = Column(String(255), unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    email = Column(String(255))
    is_admin = Column(Boolean, default=False)
    disclaimer_accepted = Column(Boolean, default=False)
    disclaimer_accepted_at = Column(DateTime)
    youtube_enabled = Column(Boolean, default=False)
    jam_code = Column(String(50))
    spotify_client_id = Column(Text)
    spotify_client_secret = Column(Text)
    spotify_access_token = Column(Text)
    spotify_refresh_token = Column(Text)
    spotify_token_expires_at = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())

    user_downloads = relationship('UserDownload', backref='user', lazy='dynamic')
    playlists = relationship('Playlist', backref='user', lazy='dynamic')


class GlobalDownload(db.Model):
    __tablename__ = 'global_downloads'
    __table_args__ = (
        UniqueConstraint('video_id', 'media_type', 'quality', name='uq_global_video'),
    )

    id = Column(Integer, primary_key=True)
    video_id = Column(String(50), nullable=False, index=True)
    title = Column(Text)
    thumbnail = Column(Text)
    file_path = Column(Text)
    media_type = Column(String(20))
    quality = Column(String(20))
    file_size = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())

    # Extraction
    extracted = Column(Boolean, default=False)
    extraction_model = Column(String(50))
    stems_paths = Column(JSONB)
    stems_zip_path = Column(Text)
    extracted_at = Column(DateTime)
    extracting = Column(Boolean, default=False)

    # Audio analysis
    detected_bpm = Column(Float)
    detected_key = Column(String(20))
    analysis_confidence = Column(Float)
    chords_data = Column(JSONB)
    beat_offset = Column(Float, default=0.0)
    structure_data = Column(JSONB)
    lyrics_data = Column(JSONB)
    beat_times = Column(JSONB)
    beat_positions = Column(JSONB)
    music_start_time = Column(Float, default=0.0)

    # Library metadata
    artist = Column(Text)
    album = Column(Text)
    duration = Column(Float)
    album_id = Column(Integer, ForeignKey('albums.id'))

    # Relationships
    user_downloads = relationship('UserDownload', backref='global_download', lazy='dynamic')
    album_ref = relationship('Album', backref='downloads')


class UserDownload(db.Model):
    __tablename__ = 'user_downloads'
    __table_args__ = (
        UniqueConstraint('user_id', 'video_id', 'media_type', name='uq_user_video'),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    global_download_id = Column(Integer, ForeignKey('global_downloads.id'), nullable=False)
    video_id = Column(String(50), nullable=False, index=True)
    title = Column(Text)
    thumbnail = Column(Text)
    file_path = Column(Text)
    media_type = Column(String(20))
    quality = Column(String(20))
    created_at = Column(DateTime, server_default=func.now())

    # Denormalized extraction/analysis fields (COALESCE with global in queries)
    extracted = Column(Boolean, default=False)
    extraction_model = Column(String(50))
    stems_paths = Column(JSONB)
    stems_zip_path = Column(Text)
    extracted_at = Column(DateTime)
    extracting = Column(Boolean, default=False)
    detected_bpm = Column(Float)
    detected_key = Column(String(20))
    analysis_confidence = Column(Float)
    chords_data = Column(JSONB)
    beat_offset = Column(Float, default=0.0)
    structure_data = Column(JSONB)
    lyrics_data = Column(JSONB)
    beat_times = Column(JSONB)
    beat_positions = Column(JSONB)
    music_start_time = Column(Float, default=0.0)
    artist = Column(Text)
    album = Column(Text)
    duration = Column(Float)
    album_id = Column(Integer, ForeignKey('albums.id'))


class Album(db.Model):
    __tablename__ = 'albums'
    __table_args__ = (
        # Case-insensitive unique constraint
        Index('ix_albums_name_artist_ci',
              func.lower(Column('name')),
              func.coalesce(func.lower(Column('artist')), text("''")),
              unique=True),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(500), nullable=False)
    artist = Column(String(500))
    thumbnail_url = Column(Text)
    year = Column(Integer)
    track_count = Column(Integer, default=0)
    source = Column(String(50))
    source_id = Column(String(255))
    created_at = Column(DateTime, server_default=func.now())


class Playlist(db.Model):
    __tablename__ = 'playlists'
    __table_args__ = (
        UniqueConstraint('user_id', 'spotify_id', name='uq_user_spotify'),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    spotify_id = Column(String(255))
    name = Column(String(500), nullable=False)
    description = Column(Text)
    thumbnail_url = Column(Text)
    track_count = Column(Integer, default=0)
    tracks_json = Column(JSONB)
    last_synced_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())


class Recording(db.Model):
    __tablename__ = 'recordings'

    id = Column(String(32), primary_key=True)
    user_id = Column(String(50), nullable=False)
    download_id = Column(String(50), nullable=False)
    name = Column(String(500), nullable=False)
    start_offset = Column(Float, nullable=False, default=0.0)
    filename = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


# ── Thread-safe session management ───────────────────────────────────

@contextmanager
def thread_session():
    """Context manager for DB operations in background threads.

    Creates a Flask app context if none exists, ensures proper
    session cleanup after the block completes.
    """
    from flask import current_app
    try:
        # Already in app context — use existing session
        current_app._get_current_object()
        yield db.session
    except RuntimeError:
        # No app context — create one (for background threads)
        import importlib
        app_module = importlib.import_module('app')
        app = app_module.app
        with app.app_context():
            try:
                yield db.session
                db.session.commit()
            except Exception:
                db.session.rollback()
                raise
            finally:
                db.session.remove()


# ── Helpers ──────────────────────────────────────────────────────────

def model_to_dict(obj):
    """Convert a SQLAlchemy model instance to a dict (matches old dict(row) pattern)."""
    if obj is None:
        return None
    d = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        d[col.name] = val
    return d
