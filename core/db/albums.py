"""
Album CRUD operations.

Normalized album table for library views. Tracks link to albums via album_id FK.
Uses SQLAlchemy ORM — all queries go through db.session.
"""
from sqlalchemy import func
from core.models import db, Album, GlobalDownload, UserDownload, model_to_dict


def init_albums_table():
    """No-op — table created by SQLAlchemy models via db.create_all()."""
    pass


def find_or_create_album(name, artist=None, thumbnail_url=None, year=None, source=None, source_id=None):
    """Find an existing album or create a new one. Returns album_id.

    Uses case-insensitive matching to avoid duplicates like
    'Amy Winehouse' vs 'AMY WINEHOUSE'.
    """
    if not name:
        return None

    # Case-insensitive search
    query = Album.query.filter(func.lower(Album.name) == func.lower(name))
    if artist is not None:
        query = query.filter(func.lower(Album.artist) == func.lower(artist))
    else:
        query = query.filter(Album.artist.is_(None))

    existing = query.first()
    if existing:
        # Update thumbnail if we have one and existing doesn't
        if thumbnail_url and not existing.thumbnail_url:
            existing.thumbnail_url = thumbnail_url
            db.session.commit()
        return existing.id

    try:
        album = Album(
            name=name,
            artist=artist,
            thumbnail_url=thumbnail_url,
            year=year,
            source=source,
            source_id=source_id,
        )
        db.session.add(album)
        db.session.commit()
        return album.id
    except Exception:
        # UNIQUE constraint violation — race condition, re-fetch
        db.session.rollback()
        query = Album.query.filter(func.lower(Album.name) == func.lower(name))
        if artist is not None:
            query = query.filter(func.lower(Album.artist) == func.lower(artist))
        else:
            query = query.filter(Album.artist.is_(None))
        existing = query.first()
        return existing.id if existing else None


def list_albums_for_user(user_id):
    """Return albums for a user's library with track counts."""
    rows = (
        db.session.query(
            Album.id,
            Album.name,
            Album.artist,
            Album.thumbnail_url,
            Album.year,
            func.count(func.distinct(UserDownload.video_id)).label('track_count'),
        )
        .join(GlobalDownload, GlobalDownload.album_id == Album.id)
        .join(
            UserDownload,
            (UserDownload.global_download_id == GlobalDownload.id)
            & (UserDownload.user_id == user_id),
        )
        .group_by(Album.id)
        .order_by(func.lower(Album.artist), func.lower(Album.name))
        .all()
    )
    return [
        {
            'id': r.id,
            'name': r.name,
            'artist': r.artist,
            'thumbnail_url': r.thumbnail_url,
            'year': r.year,
            'track_count': r.track_count,
        }
        for r in rows
    ]


def list_global_albums():
    """Return all albums in the global library with track counts."""
    rows = (
        db.session.query(
            Album.id,
            Album.name,
            Album.artist,
            Album.thumbnail_url,
            Album.year,
            func.count(func.distinct(GlobalDownload.video_id)).label('track_count'),
        )
        .join(GlobalDownload, GlobalDownload.album_id == Album.id)
        .filter(GlobalDownload.file_path.isnot(None))
        .group_by(Album.id)
        .order_by(func.lower(Album.artist), func.lower(Album.name))
        .all()
    )
    return [
        {
            'id': r.id,
            'name': r.name,
            'artist': r.artist,
            'thumbnail_url': r.thumbnail_url,
            'year': r.year,
            'track_count': r.track_count,
        }
        for r in rows
    ]


def get_album_tracks(album_id, user_id=None):
    """Return all tracks in an album. If user_id given, filter to user's tracks."""
    if user_id:
        rows = (
            db.session.query(
                GlobalDownload.video_id,
                GlobalDownload.title,
                GlobalDownload.artist,
                GlobalDownload.album,
                GlobalDownload.duration,
                GlobalDownload.thumbnail,
                GlobalDownload.extracted,
                GlobalDownload.extraction_model,
                GlobalDownload.detected_bpm,
                GlobalDownload.detected_key,
                GlobalDownload.file_path,
                UserDownload.id.label('download_id'),
            )
            .join(
                UserDownload,
                (UserDownload.global_download_id == GlobalDownload.id)
                & (UserDownload.user_id == user_id),
            )
            .filter(GlobalDownload.album_id == album_id)
            .order_by(func.lower(GlobalDownload.title))
            .all()
        )
    else:
        rows = (
            db.session.query(
                GlobalDownload.id,
                GlobalDownload.video_id,
                GlobalDownload.title,
                GlobalDownload.artist,
                GlobalDownload.album,
                GlobalDownload.duration,
                GlobalDownload.thumbnail,
                GlobalDownload.extracted,
                GlobalDownload.extraction_model,
                GlobalDownload.detected_bpm,
                GlobalDownload.detected_key,
                GlobalDownload.file_path,
                GlobalDownload.media_type,
                GlobalDownload.created_at,
            )
            .filter(
                GlobalDownload.album_id == album_id,
                GlobalDownload.file_path.isnot(None),
            )
            .order_by(func.lower(GlobalDownload.title))
            .all()
        )
    return [r._asdict() for r in rows]


def update_album_track_count(album_id):
    """Recalculate and update track_count for an album."""
    cnt = (
        db.session.query(func.count(GlobalDownload.id))
        .filter(
            GlobalDownload.album_id == album_id,
            GlobalDownload.file_path.isnot(None),
        )
        .scalar()
    )
    album = db.session.get(Album, album_id)
    if album:
        album.track_count = cnt
        db.session.commit()
