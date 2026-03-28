"""
Playlist CRUD operations for Spotify integration.
"""
import json
from core.db.connection import _conn


def init_playlists_table():
    """Create the playlists table if it does not exist."""
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                spotify_id TEXT,
                name TEXT NOT NULL,
                description TEXT,
                thumbnail_url TEXT,
                track_count INTEGER DEFAULT 0,
                tracks_json TEXT,
                last_synced_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, spotify_id)
            )
        """)
        conn.commit()


def save_playlist(user_id, spotify_id, name, description, thumbnail_url, tracks, track_count=None):
    """Insert or update a playlist. tracks is a list of dicts."""
    tracks_str = json.dumps(tracks) if isinstance(tracks, list) else tracks
    count = track_count if track_count is not None else (len(tracks) if isinstance(tracks, list) else 0)
    with _conn() as conn:
        # Try update first
        cursor = conn.execute(
            "UPDATE playlists SET name=?, description=?, thumbnail_url=?, track_count=?, tracks_json=?, last_synced_at=CURRENT_TIMESTAMP WHERE user_id=? AND spotify_id=?",
            (name, description, thumbnail_url, count, tracks_str, user_id, spotify_id)
        )
        if cursor.rowcount == 0:
            conn.execute(
                "INSERT INTO playlists (user_id, spotify_id, name, description, thumbnail_url, track_count, tracks_json, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (user_id, spotify_id, name, description, thumbnail_url, count, tracks_str)
            )
        conn.commit()
        # Return the playlist id
        row = conn.execute("SELECT id FROM playlists WHERE user_id=? AND spotify_id=?", (user_id, spotify_id)).fetchone()
        return row['id'] if row else None


def list_playlists(user_id):
    """List all playlists for a user."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, spotify_id, name, description, thumbnail_url, track_count, last_synced_at, created_at FROM playlists WHERE user_id=? ORDER BY created_at DESC",
            (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_playlist(user_id, playlist_id):
    """Get a single playlist with tracks."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM playlists WHERE id=? AND user_id=?",
            (playlist_id, user_id)
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        if result.get('tracks_json'):
            try:
                result['tracks'] = json.loads(result['tracks_json'])
            except (json.JSONDecodeError, TypeError):
                result['tracks'] = []
        else:
            result['tracks'] = []
        return result


def update_track_video_id(playlist_id, spotify_track_id, video_id):
    """Update a single track's video_id after YouTube match."""
    with _conn() as conn:
        row = conn.execute("SELECT tracks_json FROM playlists WHERE id=?", (playlist_id,)).fetchone()
        if not row or not row['tracks_json']:
            return
        tracks = json.loads(row['tracks_json'])
        for track in tracks:
            if track.get('spotify_track_id') == spotify_track_id:
                track['video_id'] = video_id
                break
        conn.execute("UPDATE playlists SET tracks_json=? WHERE id=?", (json.dumps(tracks), playlist_id))
        conn.commit()


def delete_playlist(user_id, playlist_id):
    """Delete a playlist."""
    with _conn() as conn:
        conn.execute("DELETE FROM playlists WHERE id=? AND user_id=?", (playlist_id, user_id))
        conn.commit()
