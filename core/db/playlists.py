"""
Playlist CRUD operations for Spotify integration.

Uses SQLAlchemy ORM — tracks_json is JSONB, no manual json.dumps/loads needed.
"""
from datetime import datetime, timezone
from core.models import db, Playlist, model_to_dict


def init_playlists_table():
    """No-op — table created by SQLAlchemy models via db.create_all()."""
    pass


def save_playlist(user_id, spotify_id, name, description, thumbnail_url, tracks, track_count=None):
    """Insert or update a playlist. tracks is a list of dicts."""
    count = track_count if track_count is not None else (len(tracks) if isinstance(tracks, list) else 0)
    now = datetime.now(timezone.utc)

    # Try update first
    existing = Playlist.query.filter_by(user_id=user_id, spotify_id=spotify_id).first()
    if existing:
        existing.name = name
        existing.description = description
        existing.thumbnail_url = thumbnail_url
        existing.track_count = count
        existing.tracks_json = tracks
        existing.last_synced_at = now
        db.session.commit()
        return existing.id

    playlist = Playlist(
        user_id=user_id,
        spotify_id=spotify_id,
        name=name,
        description=description,
        thumbnail_url=thumbnail_url,
        track_count=count,
        tracks_json=tracks,
        last_synced_at=now,
    )
    db.session.add(playlist)
    db.session.commit()
    return playlist.id


def list_playlists(user_id):
    """List all playlists for a user."""
    rows = (
        Playlist.query
        .filter_by(user_id=user_id)
        .order_by(Playlist.created_at.desc())
        .all()
    )
    return [
        {
            'id': p.id,
            'spotify_id': p.spotify_id,
            'name': p.name,
            'description': p.description,
            'thumbnail_url': p.thumbnail_url,
            'track_count': p.track_count,
            'last_synced_at': p.last_synced_at,
            'created_at': p.created_at,
        }
        for p in rows
    ]


def get_playlist(user_id, playlist_id):
    """Get a single playlist with tracks."""
    row = Playlist.query.filter_by(id=playlist_id, user_id=user_id).first()
    if not row:
        return None
    result = model_to_dict(row)
    # JSONB column returns Python objects directly — no json.loads needed
    result['tracks'] = result.get('tracks_json') or []
    return result


def update_track_video_id(playlist_id, title, artist, video_id):
    """Update a single track's video_id after YouTube match. Matches by title+artist."""
    playlist = db.session.get(Playlist, playlist_id)
    if not playlist or not playlist.tracks_json:
        return
    tracks = list(playlist.tracks_json)  # shallow copy so ORM detects mutation
    for track in tracks:
        if track.get('title') == title and track.get('artist') == artist:
            track['video_id'] = video_id
            break
    playlist.tracks_json = tracks
    db.session.commit()


def delete_playlist(user_id, playlist_id):
    """Delete a playlist."""
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=user_id).first()
    if playlist:
        db.session.delete(playlist)
        db.session.commit()
