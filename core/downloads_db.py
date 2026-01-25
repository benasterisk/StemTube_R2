"""
Persistent per-user library (table: user_downloads)
"""
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "stemtubes.db"
APP_ROOT = Path(__file__).parent.parent  # Application root directory
DOWNLOADS_ROOT = APP_ROOT / "core" / "downloads"

def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def resolve_file_path(stored_path):
    """
    Convert stored file paths to absolute paths based on current application directory.

    Handles migration from old absolute paths (e.g., /opt/stemtube/StemTube-dev/..., 
    /home/.../stemtube_v1.0/..., /home/.../stemtube_dev_v1.1/...) to the current
    installation by extracting the relative downloads path and rebasing it on
    the current app root.

    Args:
        stored_path: Path string from database (can be absolute with old prefix or relative)

    Returns:
        Absolute path string resolved from current application directory, or None if invalid
    """
    if not stored_path:
        return None

    path_str = str(stored_path)
    normalized = path_str.replace('\\', '/')
    downloads_root_str = str(DOWNLOADS_ROOT).replace('\\', '/')
    anchor = "core/downloads/"
    normalized_lower = normalized.lower()

    # If path already points inside the current downloads directory, keep it
    if normalized.startswith(downloads_root_str):
        return str(Path(path_str))

    # Rebase any path that contains the downloads anchor (covers all previous installs)
    anchor_idx = normalized_lower.find(anchor)
    if anchor_idx != -1:
        relative_part = normalized[anchor_idx + len(anchor):]
        resolved = DOWNLOADS_ROOT / relative_part
        return str(resolved)

    # If it's an absolute path that exists, use it as-is
    path_obj = Path(path_str)
    if path_obj.is_absolute() and path_obj.exists():
        return str(path_obj)

    # Last resort: try treating it as relative to app root
    resolved = APP_ROOT / path_str
    if resolved.exists():
        return str(resolved)

    # Return the original path if nothing worked (will fail later with clear error)
    return path_str

def _resolve_paths_in_record(record):
    """
    Helper function to resolve file paths in a database record dictionary.

    Modifies the record in-place to replace stored paths with resolved paths.
    """
    import json

    if not record:
        return record

    # Resolve simple file paths
    if record.get('file_path'):
        record['file_path'] = resolve_file_path(record['file_path'])

    if record.get('stems_zip_path'):
        record['stems_zip_path'] = resolve_file_path(record['stems_zip_path'])

    # Resolve individual stem paths in JSON
    if record.get('stems_paths'):
        try:
            stems_dict = json.loads(record['stems_paths'])
            resolved_stems = {k: resolve_file_path(v) for k, v in stems_dict.items()}
            record['stems_paths'] = json.dumps(resolved_stems)
        except (json.JSONDecodeError, TypeError):
            pass  # Leave as-is if not valid JSON

    return record

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

def add_or_update(user_id, meta):
    """Insert or update a download record for a user."""
    with _conn() as conn:
        video_id = meta["video_id"]
        media_type = meta.get("download_type", "audio")
        quality = meta["quality"]
        file_path = meta["file_path"]
        
        # DEBUG: Log the video_id being stored in database
        print(f"[DB DEBUG] add_or_update called with video_id: '{video_id}' (length: {len(video_id)})")
        print(f"[DB DEBUG] Full meta: {meta}")
        
        # First, check if this file already exists globally
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id FROM global_downloads 
            WHERE video_id=? AND media_type=? AND quality=?
        """, (video_id, media_type, quality))
        
        global_download = cursor.fetchone()
        
        if global_download:
            # File already exists globally - just add user access
            global_download_id = global_download[0]
        else:
            # File doesn't exist - create global record
            cursor.execute("""
                INSERT INTO global_downloads
                    (video_id, title, thumbnail, file_path, media_type, quality, file_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                video_id,
                meta["title"],
                meta.get("thumbnail_url") or None,  # Store NULL instead of empty string
                file_path,
                media_type,
                quality,
                meta.get("file_size", 0)
            ))
            global_download_id = cursor.lastrowid
        
        # Add/update user access record
        conn.execute("""
            INSERT INTO user_downloads
                (user_id, global_download_id, video_id, title, thumbnail, file_path, media_type, quality)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, video_id, media_type) DO UPDATE SET
                global_download_id = excluded.global_download_id,
                title              = excluded.title,
                thumbnail          = excluded.thumbnail,
                file_path          = excluded.file_path,
                quality            = excluded.quality
        """, (
            user_id,
            global_download_id,
            video_id,
            meta["title"],
            meta.get("thumbnail_url") or None,  # Store NULL instead of empty string
            file_path,
            media_type,
            quality
        ))
        conn.commit()
        
        # Return the global_download_id for use in WebSocket events
        return global_download_id

def update_download_analysis(video_id, detected_bpm, detected_key, analysis_confidence, chords_data=None, beat_offset=0.0, structure_data=None, lyrics_data=None):
    """Update audio analysis results for a download."""
    with _conn() as conn:
        print(f"[DB DEBUG] Updating analysis for video_id='{video_id}': BPM={detected_bpm}, Key={detected_key}, Chords={bool(chords_data)}, BeatOffset={beat_offset:.3f}s, Structure={bool(structure_data)}, Lyrics={bool(lyrics_data)}")

        # Convert structure_data and lyrics_data to JSON if necessary
        import json
        structure_json = json.dumps(structure_data) if structure_data else None
        lyrics_json = json.dumps(lyrics_data) if lyrics_data else None

        # Update global_downloads table
        cursor = conn.execute("""
            UPDATE global_downloads
            SET detected_bpm=?, detected_key=?, analysis_confidence=?, chords_data=?, beat_offset=?, structure_data=?, lyrics_data=?
            WHERE video_id=?
        """, (detected_bpm, detected_key, analysis_confidence, chords_data, beat_offset, structure_json, lyrics_json, video_id))

        rows_updated = cursor.rowcount
        print(f"[DB DEBUG] Updated {rows_updated} rows in global_downloads")

        # Update all user_downloads entries for this video_id
        cursor2 = conn.execute("""
            UPDATE user_downloads
            SET detected_bpm=?, detected_key=?, analysis_confidence=?, chords_data=?, beat_offset=?, structure_data=?, lyrics_data=?
            WHERE video_id=?
        """, (detected_bpm, detected_key, analysis_confidence, chords_data, beat_offset, structure_json, lyrics_json, video_id))

        rows_updated2 = cursor2.rowcount
        print(f"[DB DEBUG] Updated {rows_updated2} rows in user_downloads")

        conn.commit()

        if rows_updated == 0:
            print(f"[DB DEBUG] WARNING: No rows updated! Video_id '{video_id}' not found in global_downloads")
        else:
            print(f"[DB DEBUG] Analysis updated successfully for video_id='{video_id}'")

def update_download_lyrics(video_id, lyrics_data):
    """Update lyrics data for a download."""
    import json
    with _conn() as conn:
        print(f"[LYRICS] Saving lyrics data for video_id='{video_id}': {len(lyrics_data)} segments")

        # Convert to JSON string
        lyrics_json = json.dumps(lyrics_data) if lyrics_data else None

        # Update global_downloads
        cursor = conn.execute("""
            UPDATE global_downloads
            SET lyrics_data=?
            WHERE video_id=?
        """, (lyrics_json, video_id))

        rows_updated = cursor.rowcount
        print(f"[LYRICS] Updated {rows_updated} rows in global_downloads")

        # Update user_downloads
        cursor2 = conn.execute("""
            UPDATE user_downloads
            SET lyrics_data=?
            WHERE video_id=?
        """, (lyrics_json, video_id))

        rows_updated2 = cursor2.rowcount
        print(f"[LYRICS] Updated {rows_updated2} rows in user_downloads")

        conn.commit()

        if rows_updated == 0:
            print(f"[LYRICS] WARNING: No rows updated! Video_id '{video_id}' not found")
        else:
            print(f"[LYRICS] Lyrics saved successfully for video_id='{video_id}'")

def update_download_structure(video_id, structure_data):
    """Update LLM-analyzed structure data for a download."""
    import json
    with _conn() as conn:
        print(f"[STRUCTURE] Saving structure data for video_id='{video_id}'")

        # Convert to JSON string
        structure_json = json.dumps(structure_data) if structure_data else None

        # Update global_downloads
        cursor = conn.execute("""
            UPDATE global_downloads
            SET structure_data=?
            WHERE video_id=?
        """, (structure_json, video_id))

        rows_updated = cursor.rowcount
        print(f"[STRUCTURE] Updated {rows_updated} rows in global_downloads")

        # Update user_downloads
        cursor2 = conn.execute("""
            UPDATE user_downloads
            SET structure_data=?
            WHERE video_id=?
        """, (structure_json, video_id))

        rows_updated2 = cursor2.rowcount
        print(f"[STRUCTURE] Updated {rows_updated2} rows in user_downloads")

        conn.commit()

        if rows_updated == 0:
            print(f"[STRUCTURE] WARNING: No rows updated! Video_id '{video_id}' not found")
        else:
            print(f"[STRUCTURE] Structure saved successfully for video_id='{video_id}'")

def find_global_download(video_id, media_type, quality):
    """Check if a download already exists globally."""
    with _conn() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM global_downloads 
            WHERE video_id=? AND media_type=? AND quality=?
        """, (video_id, media_type, quality))
        result = cursor.fetchone()
        return dict(result) if result else None

def add_user_access(user_id, global_download):
    """Give a user access to an existing global download."""
    with _conn() as conn:
        conn.execute("""
            INSERT INTO user_downloads
                (user_id, global_download_id, video_id, title, thumbnail, file_path, media_type, quality)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, video_id, media_type) DO NOTHING
        """, (
            user_id,
            global_download["id"],
            global_download["video_id"],
            global_download["title"],
            global_download["thumbnail"],
            global_download["file_path"],
            global_download["media_type"],
            global_download["quality"]
        ))
        conn.commit()

def list_for(user_id):
    """Return all downloads for a given user, newest first."""
    with _conn() as conn:
        cur = conn.execute("""
            SELECT
                ud.id,
                ud.user_id,
                ud.global_download_id,
                ud.video_id,
                ud.title,
                COALESCE(gd.thumbnail, ud.thumbnail) as thumbnail,
                ud.file_path,
                ud.media_type,
                ud.quality,
                ud.created_at,
                ud.extracted,
                ud.extracting,
                ud.extracted_at,
                ud.extraction_model,
                ud.stems_paths,
                ud.stems_zip_path,
                COALESCE(gd.detected_bpm, ud.detected_bpm) as detected_bpm,
                COALESCE(gd.detected_key, ud.detected_key) as detected_key,
                COALESCE(gd.analysis_confidence, ud.analysis_confidence) as analysis_confidence,
                COALESCE(gd.chords_data, ud.chords_data) as chords_data,
                COALESCE(gd.beat_offset, ud.beat_offset) as beat_offset,
                COALESCE(gd.structure_data, ud.structure_data) as structure_data,
                COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data
            FROM user_downloads ud
            LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
            WHERE ud.user_id=?
            ORDER BY ud.created_at DESC
        """, (user_id,))
        return [_resolve_paths_in_record(dict(row)) for row in cur.fetchall()]

def get_download_by_id(user_id, download_id):
    """Get a specific download by ID for a user."""
    with _conn() as conn:
        cur = conn.execute("""
            SELECT
                ud.id,
                ud.user_id,
                ud.global_download_id,
                ud.video_id,
                ud.title,
                COALESCE(gd.thumbnail, ud.thumbnail) as thumbnail,
                ud.file_path,
                ud.media_type,
                ud.quality,
                ud.created_at,
                ud.extracted,
                ud.extracting,
                ud.extracted_at,
                ud.extraction_model,
                ud.stems_paths,
                ud.stems_zip_path,
                COALESCE(gd.detected_bpm, ud.detected_bpm) as detected_bpm,
                COALESCE(gd.detected_key, ud.detected_key) as detected_key,
                COALESCE(gd.analysis_confidence, ud.analysis_confidence) as analysis_confidence,
                COALESCE(gd.chords_data, ud.chords_data) as chords_data,
                COALESCE(gd.beat_offset, ud.beat_offset) as beat_offset,
                COALESCE(gd.structure_data, ud.structure_data) as structure_data,
                COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data
            FROM user_downloads ud
            LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
            WHERE ud.user_id=? AND ud.id=?
        """, (user_id, download_id))
        row = cur.fetchone()
        return _resolve_paths_in_record(dict(row)) if row else None

def get_user_download_id_by_video_id(user_id, video_id):
    """Get user's download_id (user_downloads.id) for a specific video_id.

    This is needed for WebSocket events to update the correct UI element.
    Returns None if user doesn't have access to this video.
    """
    with _conn() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id FROM user_downloads
            WHERE user_id=? AND video_id=?
            ORDER BY created_at DESC
            LIMIT 1
        """, (user_id, video_id))
        row = cursor.fetchone()
        return row[0] if row else None

def delete_from(user_id, video_id):
    """Delete a specific download record for a user."""
    with _conn() as conn:
        conn.execute(
            "DELETE FROM user_downloads WHERE user_id=? AND video_id=?",
            (user_id, video_id)
        )
        conn.commit()

# ============ EXTRACTION FUNCTIONS ============

def find_global_extraction(video_id, model_name):
    """Check if an extraction already exists globally for a video with a specific model."""
    with _conn() as conn:
        cursor = conn.cursor()
        print(f"[DB DEBUG] Searching for extraction: video_id='{video_id}', model='{model_name}'")
        cursor.execute("""
            SELECT * FROM global_downloads
            WHERE video_id=? AND extracted=1 AND extraction_model=?
        """, (video_id, model_name))
        result = cursor.fetchone()
        if result:
            print(f"[DB DEBUG] Found global extraction: id={result[0]}, extracted={result['extracted']}")
        else:
            print(f"[DB DEBUG] No global extraction found for video_id='{video_id}', model='{model_name}'")
            # Debug: Check what extractions DO exist for this video_id
            cursor.execute("SELECT id, video_id, extracted, extraction_model FROM global_downloads WHERE video_id=?", (video_id,))
            debug_results = cursor.fetchall()
            print(f"[DB DEBUG] All records for video_id '{video_id}': {[(r[0], r[1], r[2], r[3]) for r in debug_results]}")
        return dict(result) if result else None

def find_any_global_extraction(video_id):
    """Check if ANY extraction exists for a video_id, regardless of model.

    This is useful for UI detection where users don't care which model was used.
    Returns the first extraction found.
    """
    with _conn() as conn:
        cursor = conn.cursor()
        print(f"[DB DEBUG] Searching for any extraction: video_id='{video_id}'")
        cursor.execute("""
            SELECT * FROM global_downloads
            WHERE video_id=? AND extracted=1
            LIMIT 1
        """, (video_id,))
        result = cursor.fetchone()
        if result:
            print(f"[DB DEBUG] Found extraction: id={result[0]}, model={result['extraction_model']}")
        else:
            print(f"[DB DEBUG] No extraction found for video_id='{video_id}'")
        return dict(result) if result else None

def find_or_reserve_extraction(video_id, model_name):
    """Atomically check for existing extraction or reserve it for processing.
    
    Returns:
        tuple: (existing_extraction_dict or None, reserved_successfully: bool)
        - If existing extraction found: (extraction_dict, False)  
        - If successfully reserved: (None, True)
        - If already reserved by another process: (None, False)
    """
    with _conn() as conn:
        cursor = conn.cursor()
        print(f"[DB DEBUG] Atomic check/reserve for video_id='{video_id}', model='{model_name}'")
        
        # Start transaction for atomicity
        conn.execute("BEGIN IMMEDIATE")
        
        try:
            # First check for completed extraction
            cursor.execute("""
                SELECT * FROM global_downloads 
                WHERE video_id=? AND extracted=1 AND extraction_model=?
            """, (video_id, model_name))
            existing = cursor.fetchone()
            
            if existing:
                print(f"[DB DEBUG] Found existing completed extraction")
                conn.commit()
                return dict(existing), False
            
            # Check for in-progress extraction
            cursor.execute("""
                SELECT * FROM global_downloads 
                WHERE video_id=? AND extracting=1 AND extraction_model=?
            """, (video_id, model_name))
            in_progress = cursor.fetchone()
            
            if in_progress:
                print(f"[DB DEBUG] Found extraction already in progress")
                conn.commit()
                return None, False
            
            # No existing or in-progress extraction - try to reserve it
            cursor.execute("""
                UPDATE global_downloads 
                SET extracting=1, extraction_model=?
                WHERE video_id=? AND (extracting=0 OR extracting IS NULL)
            """, (model_name, video_id))
            
            if cursor.rowcount > 0:
                print(f"[DB DEBUG] Successfully reserved extraction")
                conn.commit()
                return None, True
            else:
                print(f"[DB DEBUG] Could not reserve - no matching download record found")
                conn.commit()
                return None, False
                
        except Exception as e:
            print(f"[DB DEBUG] Error in atomic operation: {e}")
            conn.rollback()
            raise

def find_global_extraction_in_progress(video_id, model_name):
    """Check if an extraction is currently in progress for a video with a specific model."""
    with _conn() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM global_downloads 
            WHERE video_id=? AND extracting=1 AND extraction_model=?
        """, (video_id, model_name))
        result = cursor.fetchone()
        return dict(result) if result else None

def set_extraction_in_progress(video_id, model_name):
    """Mark an extraction as in progress."""
    with _conn() as conn:
        conn.execute("""
            UPDATE global_downloads 
            SET extracting=1, extraction_model=?
            WHERE video_id=?
        """, (model_name, video_id))
        conn.commit()

def clear_extraction_in_progress(video_id, user_id=None):
    """Clear the extraction in progress flag from both global and user tables.

    Args:
        video_id: The video ID to clear extraction status for
        user_id: Optional user ID. If provided, clears only that user's flag.
                 If None, clears flags for all users.
    """
    with _conn() as conn:
        # Clear global flag
        conn.execute("""
            UPDATE global_downloads
            SET extracting=0
            WHERE video_id=?
        """, (video_id,))

        # Also clear user-specific flag(s)
        if user_id:
            conn.execute("""
                UPDATE user_downloads
                SET extracting=0
                WHERE video_id=? AND user_id=?
            """, (video_id, user_id))
        else:
            # Clear for all users if no specific user provided
            conn.execute("""
                UPDATE user_downloads
                SET extracting=0
                WHERE video_id=?
            """, (video_id,))

        conn.commit()

def mark_extraction_complete(video_id, extraction_data):
    """Mark a global download as extracted with stems information."""
    with _conn() as conn:
        import json
        print(f"[DB DEBUG] Marking extraction complete for video_id='{video_id}', model='{extraction_data['model_name']}'")
        
        # Use transaction to ensure atomicity
        conn.execute("BEGIN IMMEDIATE")
        
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id, video_id, title FROM global_downloads WHERE video_id=?", (video_id,))
            existing = cursor.fetchone()
            if existing:
                print(f"[DB DEBUG] Found existing global download: id={existing[0]}, video_id='{existing[1]}'")
            else:
                print(f"[DB DEBUG] WARNING: No global download found for video_id='{video_id}'")
            
            result = conn.execute("""
                UPDATE global_downloads 
                SET extracted=1, 
                    extracting=0,
                    extraction_model=?, 
                    stems_paths=?, 
                    stems_zip_path=?, 
                    extracted_at=CURRENT_TIMESTAMP
                WHERE video_id=?
            """, (
                extraction_data["model_name"],
                json.dumps(extraction_data["stems_paths"]),
                extraction_data.get("zip_path", ""),
                video_id
            ))
            rows_affected = result.rowcount
            print(f"[DB DEBUG] Updated {rows_affected} rows in global_downloads")
            
            # Also update all user_downloads records for this video
            conn.execute("""
                UPDATE user_downloads 
                SET extracted=1,
                    extracting=0,
                    extraction_model=?,
                    stems_paths=?,
                    stems_zip_path=?,
                    extracted_at=CURRENT_TIMESTAMP
                WHERE video_id=?
            """, (
                extraction_data["model_name"],
                json.dumps(extraction_data["stems_paths"]),
                extraction_data.get("zip_path", ""),
                video_id
            ))
            
            # Commit transaction
            conn.commit()
            print(f"[DB DEBUG] Successfully marked extraction complete and committed transaction")
            
        except Exception as e:
            print(f"[DB DEBUG] Error marking extraction complete: {e}")
            conn.rollback()
            raise

def add_user_extraction_access(user_id, global_download):
    """Give a user access to an existing extraction by updating their user_downloads record."""
    with _conn() as conn:
        print(f"[DB DEBUG] Adding user extraction access: user_id={user_id}, video_id='{global_download['video_id']}'")
        cursor = conn.cursor()
        
        # Check if user already has any records for this video_id
        cursor.execute("""
            SELECT id, file_path, extracted FROM user_downloads 
            WHERE user_id=? AND video_id=?
            ORDER BY created_at DESC
        """, (user_id, global_download["video_id"]))
        existing_records = cursor.fetchall()
        print(f"[DB DEBUG] Found {len(existing_records)} existing records for this video")
        
        if existing_records:
            # Update the most recent record with extraction data
            best_record = existing_records[0]  # Most recent record
            print(f"[DB DEBUG] Updating existing record ID {best_record['id']} with extraction data")
            
            conn.execute("""
                UPDATE user_downloads 
                SET extracted=1,
                    extracting=0,
                    extraction_model=?,
                    stems_paths=?,
                    stems_zip_path=?,
                    extracted_at=?
                WHERE id=?
            """, (
                global_download["extraction_model"],
                global_download["stems_paths"],
                global_download["stems_zip_path"],
                global_download["extracted_at"],
                best_record['id']
            ))
            
            # Delete any duplicate records for the same user/video
            if len(existing_records) > 1:
                duplicate_ids = [record['id'] for record in existing_records[1:]]
                print(f"[DB DEBUG] Cleaning up {len(duplicate_ids)} duplicate records: {duplicate_ids}")
                for dup_id in duplicate_ids:
                    cursor.execute("DELETE FROM user_downloads WHERE id=?", (dup_id,))
                    
        else:
            # Create new user access record (extraction-only, no download data)
            print(f"[DB DEBUG] Creating new extraction-only record")
            conn.execute("""
                INSERT INTO user_downloads
                    (user_id, global_download_id, video_id, title, thumbnail, file_path, media_type, quality, 
                     extracted, extraction_model, stems_paths, stems_zip_path, extracted_at)
                VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, ?, ?)
            """, (
                user_id,
                global_download["id"],
                global_download["video_id"],
                global_download["title"],
                global_download["thumbnail"],
                global_download["extraction_model"],
                global_download["stems_paths"],
                global_download["stems_zip_path"],
                global_download["extracted_at"]
            ))
        conn.commit()

def set_user_extraction_in_progress(user_id, video_id, model_name):
    """Mark an extraction as in progress for a specific user."""
    with _conn() as conn:
        conn.execute("""
            UPDATE user_downloads 
            SET extracting=1, extraction_model=?
            WHERE user_id=? AND video_id=?
        """, (model_name, user_id, video_id))
        conn.commit()

def list_extractions_for(user_id):
    """Return all downloads with extractions for a given user, newest first."""
    with _conn() as conn:
        cur = conn.execute("""
            SELECT
                ud.id,
                ud.user_id,
                ud.video_id,
                ud.title,
                ud.file_path,
                ud.media_type,
                ud.quality,
                COALESCE(gd.thumbnail, ud.thumbnail) as thumbnail,
                ud.created_at,
                ud.extracted,
                ud.extracting,
                ud.extracted_at,
                ud.extraction_model,
                ud.stems_paths,
                ud.stems_zip_path,
                ud.global_download_id,
                COALESCE(gd.detected_bpm, ud.detected_bpm) as detected_bpm,
                COALESCE(gd.detected_key, ud.detected_key) as detected_key,
                COALESCE(gd.analysis_confidence, ud.analysis_confidence) as analysis_confidence,
                COALESCE(gd.chords_data, ud.chords_data) as chords_data,
                COALESCE(gd.beat_offset, ud.beat_offset) as beat_offset,
                COALESCE(gd.structure_data, ud.structure_data) as structure_data,
                COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data
            FROM user_downloads ud
            LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
            WHERE ud.user_id=? AND ud.extracted=1
            ORDER BY ud.extracted_at DESC
        """, (user_id,))
        return [_resolve_paths_in_record(dict(row)) for row in cur.fetchall()]

# ============ ADMIN CLEANUP FUNCTIONS ============

def get_all_downloads_for_admin():
    """Return all downloads across all users for admin cleanup interface."""
    with _conn() as conn:
        cur = conn.execute("""
            SELECT 
                gd.id as global_id,
                gd.video_id,
                gd.title,
                gd.file_path,
                gd.media_type,
                gd.quality,
                gd.file_size,
                gd.created_at,
                gd.extracted,
                gd.extraction_model,
                gd.extracting,
                gd.extracted_at,
                COUNT(ud.id) as user_count,
                GROUP_CONCAT(u.username, ', ') as users
            FROM global_downloads gd
            LEFT JOIN user_downloads ud ON gd.id = ud.global_download_id
            LEFT JOIN users u ON ud.user_id = u.id
            GROUP BY gd.id
            ORDER BY gd.created_at DESC
        """)
        return [dict(row) for row in cur.fetchall()]

def get_user_ids_for_video(video_id):
    """Return distinct user IDs that have access to a given video."""
    with _conn() as conn:
        cur = conn.execute("""
            SELECT DISTINCT user_id FROM user_downloads
            WHERE video_id=?
        """, (video_id,))
        return [row[0] for row in cur.fetchall()]

def delete_download_completely(global_download_id):
    """Delete a download completely from both global and user tables."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        # Start transaction for atomicity
        conn.execute("BEGIN IMMEDIATE")
        
        try:
            # Get download info before deletion for file cleanup
            cursor.execute("SELECT * FROM global_downloads WHERE id=?", (global_download_id,))
            download_info = cursor.fetchone()
            
            if not download_info:
                return False, "Download not found"
            
            # Delete from user_downloads first (foreign key constraint)
            cursor.execute("DELETE FROM user_downloads WHERE global_download_id=?", (global_download_id,))
            affected_users = cursor.rowcount
            
            # Delete from global_downloads
            cursor.execute("DELETE FROM global_downloads WHERE id=?", (global_download_id,))
            
            conn.commit()
            return True, f"Deleted download from database (affected {affected_users} users)", dict(download_info)
            
        except Exception as e:
            conn.rollback()
            return False, f"Database error: {str(e)}", None

def reset_extraction_status(global_download_id):
    """Reset extraction status for a download while keeping the download record."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        # Start transaction for atomicity
        conn.execute("BEGIN IMMEDIATE")
        
        try:
            # Reset extraction fields in global_downloads
            cursor.execute("""
                UPDATE global_downloads 
                SET extracted=0, extracting=0, extraction_model=NULL, 
                    stems_paths=NULL, stems_zip_path=NULL, extracted_at=NULL
                WHERE id=?
            """, (global_download_id,))
            
            if cursor.rowcount == 0:
                conn.rollback()
                return False, "Download not found"
            
            # Reset extraction fields in user_downloads
            cursor.execute("""
                UPDATE user_downloads 
                SET extracted=0, extracting=0, extraction_model=NULL,
                    stems_paths=NULL, stems_zip_path=NULL, extracted_at=NULL
                WHERE global_download_id=?
            """, (global_download_id,))
            affected_users = cursor.rowcount
            
            conn.commit()
            return True, f"Reset extraction status (affected {affected_users} users)"
            
        except Exception as e:
            conn.rollback()
            return False, f"Database error: {str(e)}"

def reset_extraction_status_by_video_id(video_id):
    """Reset extraction status for ALL downloads with a given video_id.

    This ensures all records (different qualities/media types) are reset,
    not just the first one found.
    """
    print(f"[RESET DEBUG] reset_extraction_status_by_video_id called with video_id='{video_id}'")
    with _conn() as conn:
        cursor = conn.cursor()

        # Start transaction for atomicity
        conn.execute("BEGIN IMMEDIATE")

        try:
            # Reset extraction fields in ALL global_downloads with this video_id
            cursor.execute("""
                UPDATE global_downloads
                SET extracted=0, extracting=0, extraction_model=NULL,
                    stems_paths=NULL, stems_zip_path=NULL, extracted_at=NULL
                WHERE video_id=?
            """, (video_id,))

            global_affected = cursor.rowcount
            print(f"[RESET DEBUG] global_downloads affected: {global_affected}")

            if global_affected == 0:
                conn.rollback()
                print(f"[RESET DEBUG] No downloads found, rolling back")
                return False, "No downloads found with this video_id"

            # Reset extraction fields in user_downloads
            cursor.execute("""
                UPDATE user_downloads
                SET extracted=0, extracting=0, extraction_model=NULL,
                    stems_paths=NULL, stems_zip_path=NULL, extracted_at=NULL
                WHERE video_id=?
            """, (video_id,))
            user_affected = cursor.rowcount
            print(f"[RESET DEBUG] user_downloads affected: {user_affected}")

            conn.commit()
            print(f"[RESET DEBUG] Commit successful")
            return True, f"Reset {global_affected} global record(s), {user_affected} user record(s)"

        except Exception as e:
            conn.rollback()
            print(f"[RESET DEBUG] Error: {e}")
            return False, f"Database error: {str(e)}"

def get_storage_usage_stats():
    """Get storage usage statistics for admin dashboard."""
    with _conn() as conn:
        cur = conn.cursor()
        
        # Get total downloads count and estimated size
        cur.execute("""
            SELECT 
                COUNT(*) as total_downloads,
                SUM(COALESCE(file_size, 0)) as total_download_size,
                COUNT(CASE WHEN extracted=1 THEN 1 END) as total_extractions
            FROM global_downloads
        """)
        stats = dict(cur.fetchone())
        
        # Get user distribution
        cur.execute("""
            SELECT 
                COUNT(DISTINCT ud.user_id) as users_with_downloads,
                AVG(user_download_counts.download_count) as avg_downloads_per_user
            FROM (
                SELECT user_id, COUNT(*) as download_count 
                FROM user_downloads 
                GROUP BY user_id
            ) as user_download_counts
            JOIN user_downloads ud ON ud.user_id = user_download_counts.user_id
        """)
        user_stats = cur.fetchone()
        if user_stats:
            stats.update(dict(user_stats))
        
        return stats

def cleanup_stuck_extractions():
    """Clean up stuck extractions on application startup."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        # Find stuck extractions (extracting=1 but not completed within reasonable time)
        # For now, we'll just reset all stuck extractions
        cursor.execute("""
            SELECT COUNT(*) FROM global_downloads 
            WHERE extracting=1 AND extracted=0
        """)
        stuck_count = cursor.fetchone()[0]
        
        if stuck_count > 0:
            print(f"[STARTUP] Found {stuck_count} stuck extractions - cleaning up...")
            
            # Reset stuck extractions
            cursor.execute("""
                UPDATE global_downloads 
                SET extracting=0, extraction_model=NULL
                WHERE extracting=1 AND extracted=0
            """)
            
            cursor.execute("""
                UPDATE user_downloads 
                SET extracting=0, extraction_model=NULL
                WHERE extracting=1 AND extracted=0
            """)
            
            conn.commit()
            print(f"[STARTUP] Cleaned up {stuck_count} stuck extractions")
        else:
            print("[STARTUP] No stuck extractions found")

def cleanup_duplicate_user_downloads():
    """Clean up duplicate user_downloads records on application startup."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        print("[STARTUP] Checking for duplicate user_downloads records...")
        
        # Find users with multiple records for the same video_id
        cursor.execute("""
            SELECT user_id, video_id, COUNT(*) as count
            FROM user_downloads
            GROUP BY user_id, video_id
            HAVING COUNT(*) > 1
        """)
        duplicates = cursor.fetchall()
        
        if not duplicates:
            print("[STARTUP] No duplicate user_downloads records found")
            return
        
        print(f"[STARTUP] Found {len(duplicates)} sets of duplicate records to clean up")
        
        for dup in duplicates:
            user_id, video_id, count = dup
            print(f"[STARTUP] Cleaning up {count} duplicate records for user {user_id}, video {video_id}")
            
            # Get all records for this user/video combination, ordered by creation date
            cursor.execute("""
                SELECT * FROM user_downloads 
                WHERE user_id=? AND video_id=?
                ORDER BY created_at ASC
            """, (user_id, video_id))
            
            records = cursor.fetchall()
            if len(records) <= 1:
                continue
                
            # Merge all records into the most complete one (preferring records with file_path)
            best_record = None
            records_to_delete = []
            
            for record in records:
                if best_record is None:
                    best_record = record
                else:
                    # Prefer record with file_path (download data)
                    if record['file_path'] and not best_record['file_path']:
                        records_to_delete.append(best_record['id'])
                        best_record = record
                    # If both have file_path or both don't, prefer the newer one
                    elif bool(record['file_path']) == bool(best_record['file_path']):
                        if record['created_at'] > best_record['created_at']:
                            records_to_delete.append(best_record['id'])
                            best_record = record
                        else:
                            records_to_delete.append(record['id'])
                    else:
                        records_to_delete.append(record['id'])
            
            # Update the best record with any missing data from other records
            for record in records:
                if record['id'] != best_record['id']:
                    # Merge extraction data if missing in best record
                    if record['extracted'] and not best_record['extracted']:
                        cursor.execute("""
                            UPDATE user_downloads 
                            SET extracted=?, extraction_model=?, stems_paths=?, 
                                stems_zip_path=?, extracted_at=?
                            WHERE id=?
                        """, (
                            record['extracted'], record['extraction_model'], 
                            record['stems_paths'], record['stems_zip_path'], 
                            record['extracted_at'], best_record['id']
                        ))
                        print(f"[STARTUP] Merged extraction data into record {best_record['id']}")
                    
                    # Merge download data if missing in best record
                    if record['file_path'] and not best_record['file_path']:
                        cursor.execute("""
                            UPDATE user_downloads 
                            SET file_path=?, media_type=?, quality=?
                            WHERE id=?
                        """, (
                            record['file_path'], record['media_type'], 
                            record['quality'], best_record['id']
                        ))
                        print(f"[STARTUP] Merged download data into record {best_record['id']}")
            
            # Delete duplicate records
            for record_id in records_to_delete:
                cursor.execute("DELETE FROM user_downloads WHERE id=?", (record_id,))
                print(f"[STARTUP] Deleted duplicate record {record_id}")
        
        conn.commit()
        print(f"[STARTUP] Cleaned up duplicate user_downloads records")

def cleanup_orphaned_records():
    """Clean up orphaned or inconsistent records."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        print("[CLEANUP] Checking for orphaned or inconsistent records...")

        # Clean up user_downloads records that reference non-existent global_downloads
        cursor.execute("""
            SELECT COUNT(*) FROM user_downloads ud
            LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
            WHERE ud.global_download_id IS NOT NULL AND gd.id IS NULL
        """)
        orphaned_user_downloads = cursor.fetchone()[0]

        if orphaned_user_downloads > 0:
            print(f"[CLEANUP] Found {orphaned_user_downloads} orphaned user_downloads records")
            cursor.execute("""
                DELETE FROM user_downloads
                WHERE global_download_id IS NOT NULL
                AND global_download_id NOT IN (SELECT id FROM global_downloads)
            """)
            print(f"[CLEANUP] Removed {cursor.rowcount} orphaned user_downloads records")

        # Find records with extracted=1 but no extraction_model
        cursor.execute("""
            SELECT COUNT(*) FROM user_downloads 
            WHERE extracted=1 AND (extraction_model IS NULL OR extraction_model = '')
        """)
        orphaned_extractions = cursor.fetchone()[0]
        
        if orphaned_extractions > 0:
            print(f"[CLEANUP] Found {orphaned_extractions} extracted records without extraction_model")
            cursor.execute("""
                UPDATE user_downloads 
                SET extracted=0, stems_paths=NULL, stems_zip_path=NULL, extracted_at=NULL, extracting=0
                WHERE extracted=1 AND (extraction_model IS NULL OR extraction_model = '')
            """)
            print(f"[CLEANUP] Reset {cursor.rowcount} orphaned extraction records")
        
        # Find records with extracting=1 but extracted=1 (inconsistent state)
        cursor.execute("""
            SELECT COUNT(*) FROM user_downloads 
            WHERE extracting=1 AND extracted=1
        """)
        inconsistent_extractions = cursor.fetchone()[0]
        
        if inconsistent_extractions > 0:
            print(f"[CLEANUP] Found {inconsistent_extractions} records with inconsistent extraction state")
            cursor.execute("""
                UPDATE user_downloads 
                SET extracting=0
                WHERE extracting=1 AND extracted=1
            """)
            print(f"[CLEANUP] Fixed {cursor.rowcount} inconsistent extraction states")
        
        conn.commit()
        print("[CLEANUP] Orphaned record cleanup complete")

def comprehensive_cleanup():
    """Run all cleanup functions for database integrity."""
    print("[CLEANUP] Starting comprehensive database cleanup...")
    cleanup_stuck_extractions()
    cleanup_duplicate_user_downloads() 
    cleanup_orphaned_records()
    print("[CLEANUP] Comprehensive cleanup complete")

def clear_user_session_data(user_id, video_id):
    """Clear any session data for a user's removed download/extraction.
    This should be called from the Flask app after database removal.
    """
    # This function will be called from app.py to clear session managers
    # after successful database removal
    pass

def force_remove_all_user_access(user_id, video_id):
    """Forcefully remove all user access to a video_id, clearing both download and extraction access."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        try:
            print(f"[DEBUG] Force removing all access for user_id={user_id}, video_id='{video_id}'")
            
            # Get record info before deletion
            cursor.execute("""
                SELECT id, title FROM user_downloads 
                WHERE user_id=? AND video_id=?
            """, (user_id, video_id))
            
            user_record = cursor.fetchone()
            if not user_record:
                return False, "No record found for this video"
            
            # Delete the entire record regardless of state
            cursor.execute("""
                DELETE FROM user_downloads 
                WHERE user_id=? AND video_id=?
            """, (user_id, video_id))
            
            affected_rows = cursor.rowcount
            print(f"[DEBUG] Force deleted {affected_rows} user_downloads records")
            
            conn.commit()
            return True, f"Completely removed '{user_record['title']}' from your lists"
            
        except Exception as e:
            conn.rollback()
            return False, f"Database error: {str(e)}"

# ============ USER VIEW MANAGEMENT FUNCTIONS ============

def remove_user_download_access(user_id, video_id):
    """Remove user's access to a download without affecting global record or files."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        try:
            print(f"[DEBUG] Looking for user_id={user_id}, video_id='{video_id}'")
            
            # First, let's see what video_ids this user actually has
            cursor.execute("""
                SELECT video_id, title FROM user_downloads 
                WHERE user_id=?
            """, (user_id,))
            user_videos = cursor.fetchall()
            print(f"[DEBUG] User {user_id} has video_ids: {[row['video_id'] for row in user_videos]}")
            
            # Check if user has access to this download and if it has extraction
            cursor.execute("""
                SELECT id, title, extracted FROM user_downloads 
                WHERE user_id=? AND video_id=?
            """, (user_id, video_id))
            
            user_download = cursor.fetchone()
            if not user_download:
                return False, "Download not found in your list"
            
            # Always delete the entire record to ensure clean removal
            # If the user wants the extraction later, they can re-access it through global deduplication
            cursor.execute("""
                DELETE FROM user_downloads 
                WHERE user_id=? AND video_id=?
            """, (user_id, video_id))
            
            affected_rows = cursor.rowcount
            print(f"[DEBUG] Deleted {affected_rows} user_downloads records for user_id={user_id}, video_id='{video_id}'")
            
            conn.commit()
            return True, f"Removed '{user_download['title']}' from your downloads list"
            
        except Exception as e:
            conn.rollback()
            return False, f"Database error: {str(e)}"

def remove_user_extraction_access(user_id, video_id):
    """Remove user's access to an extraction without affecting global record or files."""
    with _conn() as conn:
        cursor = conn.cursor()
        
        try:
            print(f"[DEBUG] Looking for extraction user_id={user_id}, video_id='{video_id}'")
            
            # Check if user has access to this extraction
            cursor.execute("""
                SELECT id, title, file_path FROM user_downloads 
                WHERE user_id=? AND video_id=? AND extracted=1
            """, (user_id, video_id))
            
            user_extraction = cursor.fetchone()
            if not user_extraction:
                return False, "Extraction not found in your list"
            
            # If the record also has a download (file_path), keep the record but clear extraction fields
            # If it's extraction-only (no file_path), delete the entire record
            if user_extraction['file_path']:
                # Keep record but clear extraction-specific fields (keep download)
                cursor.execute("""
                    UPDATE user_downloads 
                    SET extracted=0, extraction_model=NULL, stems_paths=NULL, stems_zip_path=NULL, extracted_at=NULL, extracting=0
                    WHERE user_id=? AND video_id=? AND extracted=1
                """, (user_id, video_id))
                print(f"[DEBUG] Cleared extraction fields, kept download record")
            else:
                # No download, delete entire record
                cursor.execute("""
                    DELETE FROM user_downloads 
                    WHERE user_id=? AND video_id=? AND extracted=1
                """, (user_id, video_id))
                print(f"[DEBUG] Deleted entire extraction-only record")
            
            affected_rows = cursor.rowcount
            print(f"[DEBUG] Modified {affected_rows} user_downloads records for extraction removal")
            
            conn.commit()
            return True, f"Removed '{user_extraction['title']}' from your extractions list"
            
        except Exception as e:
            conn.rollback()
            return False, f"Database error: {str(e)}"
