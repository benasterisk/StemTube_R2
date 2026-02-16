"""
Recording CRUD operations.

Manages user recordings stored alongside extracted stems.
Each recording belongs to a user and is associated with a global download.
"""

import uuid

from core.db.connection import _conn


def init_recordings_table():
    """Create the recordings table if it does not exist."""
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS recordings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                download_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_offset REAL NOT NULL DEFAULT 0.0,
                filename TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (download_id) REFERENCES global_downloads(id)
            )
        """)
        conn.commit()


def create_recording(user_id, download_id, name, start_offset, filename):
    """Insert a new recording and return its id."""
    rec_id = uuid.uuid4().hex[:16]
    with _conn() as conn:
        conn.execute(
            """INSERT INTO recordings (id, user_id, download_id, name, start_offset, filename)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (rec_id, str(user_id), str(download_id), name, start_offset, filename),
        )
        conn.commit()
    return rec_id


def list_recordings(user_id, download_id):
    """Return all recordings for a given user and download."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, user_id, download_id, name, start_offset, filename, created_at
               FROM recordings
               WHERE user_id = ? AND download_id = ?
               ORDER BY created_at ASC""",
            (str(user_id), str(download_id)),
        ).fetchall()
    return [dict(r) for r in rows]


def get_recording(recording_id):
    """Return a single recording by id, or None."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    return dict(row) if row else None


def rename_recording(recording_id, user_id, new_name):
    """Rename a recording. Only the owner can rename."""
    with _conn() as conn:
        conn.execute(
            "UPDATE recordings SET name = ? WHERE id = ? AND user_id = ?",
            (new_name, recording_id, str(user_id)),
        )
        conn.commit()


def delete_recording(recording_id, user_id):
    """Delete a recording row. Only the owner can delete. Returns True if deleted."""
    with _conn() as conn:
        cursor = conn.execute(
            "DELETE FROM recordings WHERE id = ? AND user_id = ?",
            (recording_id, str(user_id)),
        )
        conn.commit()
    return cursor.rowcount > 0
