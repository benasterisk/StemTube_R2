"""
Album CRUD operations.

Normalized album table for library views. Tracks link to albums via album_id FK.
"""
from core.db.connection import _conn


def init_albums_table():
    """Create the albums table if it does not exist."""
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS albums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                artist TEXT,
                thumbnail_url TEXT,
                year INTEGER,
                track_count INTEGER DEFAULT 0,
                source TEXT,
                source_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(name, artist)
            )
        """)
        conn.commit()


def find_or_create_album(name, artist=None, thumbnail_url=None, year=None, source=None, source_id=None):
    """Find an existing album or create a new one. Returns album_id.

    Uses case-insensitive matching to avoid duplicates like
    'Amy Winehouse' vs 'AMY WINEHOUSE'.
    """
    if not name:
        return None
    with _conn() as conn:
        # Case-insensitive search
        row = conn.execute(
            "SELECT id FROM albums WHERE name COLLATE NOCASE = ? AND "
            "(artist COLLATE NOCASE = ? OR (artist IS NULL AND ? IS NULL))",
            (name, artist, artist)
        ).fetchone()
        if row:
            # Update thumbnail if we have one and existing doesn't
            if thumbnail_url:
                conn.execute(
                    "UPDATE albums SET thumbnail_url = COALESCE(thumbnail_url, ?) WHERE id = ?",
                    (thumbnail_url, row['id'])
                )
                conn.commit()
            return row['id']
        try:
            cursor = conn.execute(
                "INSERT INTO albums (name, artist, thumbnail_url, year, source, source_id) VALUES (?, ?, ?, ?, ?, ?)",
                (name, artist, thumbnail_url, year, source, source_id)
            )
            conn.commit()
            return cursor.lastrowid
        except Exception:
            # UNIQUE constraint violation — race condition, re-fetch
            conn.rollback()
            row = conn.execute(
                "SELECT id FROM albums WHERE name COLLATE NOCASE = ? AND "
                "(artist COLLATE NOCASE = ? OR (artist IS NULL AND ? IS NULL))",
                (name, artist, artist)
            ).fetchone()
            return row['id'] if row else None


def list_albums_for_user(user_id):
    """Return albums for a user's library with track counts."""
    with _conn() as conn:
        rows = conn.execute("""
            SELECT
                a.id, a.name, a.artist, a.thumbnail_url, a.year,
                COUNT(DISTINCT ud.video_id) as track_count
            FROM albums a
            JOIN global_downloads gd ON gd.album_id = a.id
            JOIN user_downloads ud ON ud.global_download_id = gd.id AND ud.user_id = ?
            GROUP BY a.id
            ORDER BY a.artist COLLATE NOCASE, a.name COLLATE NOCASE
        """, (user_id,)).fetchall()
        return [dict(r) for r in rows]


def list_global_albums():
    """Return all albums in the global library with track counts."""
    with _conn() as conn:
        rows = conn.execute("""
            SELECT
                a.id, a.name, a.artist, a.thumbnail_url, a.year,
                COUNT(DISTINCT gd.video_id) as track_count
            FROM albums a
            JOIN global_downloads gd ON gd.album_id = a.id
            WHERE gd.file_path IS NOT NULL
            GROUP BY a.id
            ORDER BY a.artist COLLATE NOCASE, a.name COLLATE NOCASE
        """).fetchall()
        return [dict(r) for r in rows]


def get_album_tracks(album_id, user_id=None):
    """Return all tracks in an album. If user_id given, filter to user's tracks."""
    with _conn() as conn:
        if user_id:
            rows = conn.execute("""
                SELECT gd.video_id, gd.title, gd.artist, gd.album, gd.duration,
                       gd.thumbnail, gd.extracted, gd.extraction_model,
                       gd.detected_bpm, gd.detected_key, gd.file_path,
                       ud.id as download_id
                FROM global_downloads gd
                JOIN user_downloads ud ON ud.global_download_id = gd.id AND ud.user_id = ?
                WHERE gd.album_id = ?
                ORDER BY gd.title COLLATE NOCASE
            """, (user_id, album_id)).fetchall()
        else:
            rows = conn.execute("""
                SELECT gd.id, gd.video_id, gd.title, gd.artist, gd.album, gd.duration,
                       gd.thumbnail, gd.extracted, gd.extraction_model,
                       gd.detected_bpm, gd.detected_key, gd.file_path,
                       gd.media_type, gd.created_at
                FROM global_downloads gd
                WHERE gd.album_id = ? AND gd.file_path IS NOT NULL
                ORDER BY gd.title COLLATE NOCASE
            """, (album_id,)).fetchall()
        return [dict(r) for r in rows]


def update_album_track_count(album_id):
    """Recalculate and update track_count for an album."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM global_downloads WHERE album_id=? AND file_path IS NOT NULL",
            (album_id,)
        ).fetchone()
        conn.execute("UPDATE albums SET track_count=? WHERE id=?", (row['cnt'], album_id))
        conn.commit()
