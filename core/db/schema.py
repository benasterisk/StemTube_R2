"""
Table creation and schema migrations.
"""
from core.db.connection import _conn


def init_table():
    """Create the downloads tables if they don't exist."""
    with _conn() as conn:
        # Global downloads table - tracks actual files on disk
        conn.execute("""
            CREATE TABLE IF NOT EXISTS global_downloads(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL,
                title TEXT,
                thumbnail TEXT,
                file_path TEXT,
                media_type TEXT,
                quality TEXT,
                file_size INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                extracted BOOLEAN DEFAULT 0,
                extraction_model TEXT,
                stems_paths TEXT,
                stems_zip_path TEXT,
                extracted_at TIMESTAMP,
                extracting BOOLEAN DEFAULT 0,
                UNIQUE(video_id, media_type, quality)
            )
        """)

        # User downloads table - tracks which users have access to which files
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_downloads(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                global_download_id INTEGER NOT NULL,
                video_id TEXT NOT NULL,
                title TEXT,
                thumbnail TEXT,
                file_path TEXT,
                media_type TEXT,
                quality TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                extracted BOOLEAN DEFAULT 0,
                extraction_model TEXT,
                stems_paths TEXT,
                stems_zip_path TEXT,
                extracted_at TIMESTAMP,
                extracting BOOLEAN DEFAULT 0,
                FOREIGN KEY (global_download_id) REFERENCES global_downloads(id),
                UNIQUE(user_id, video_id, media_type)
            )
        """)
        conn.commit()

        # Add extraction fields to existing tables if they don't exist
        _add_extraction_fields_if_missing(conn)


def _add_extraction_fields_if_missing(conn):
    """Add extraction fields to existing tables if they don't exist."""
    # List of extraction fields to add
    extraction_fields = [
        ("extracted", "BOOLEAN DEFAULT 0"),
        ("extraction_model", "TEXT"),
        ("stems_paths", "TEXT"),
        ("stems_zip_path", "TEXT"),
        ("extracted_at", "TIMESTAMP"),
        ("extracting", "BOOLEAN DEFAULT 0"),
        # Audio analysis fields
        ("detected_bpm", "REAL"),
        ("detected_key", "TEXT"),
        ("analysis_confidence", "REAL"),
        ("chords_data", "TEXT"),  # JSON array of {timestamp, chord}
        ("beat_offset", "REAL DEFAULT 0.0"),  # Time offset to first downbeat in seconds
        # Structure analysis fields
        ("structure_data", "TEXT"),  # JSON array of {start, end, label} for song sections
        # Lyrics/karaoke fields
        ("lyrics_data", "TEXT"),  # JSON array of {start, end, text, words} for karaoke
        ("beat_times", "TEXT"),  # JSON array of beat timestamps in seconds (for variable-tempo metronome)
    ]

    for table_name in ["global_downloads", "user_downloads"]:
        # Get existing columns
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        existing_columns = {row[1] for row in cursor.fetchall()}

        # Add missing extraction fields
        for field_name, field_type in extraction_fields:
            if field_name not in existing_columns:
                try:
                    conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {field_name} {field_type}")
                    print(f"Added column {field_name} to {table_name}")
                except Exception as e:
                    print(f"Error adding column {field_name} to {table_name}: {e}")

        conn.commit()
