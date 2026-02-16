"""
Extraction tracking and status management.
"""
import json

from core.db.connection import _conn, _resolve_paths_in_record


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
                COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data,
                COALESCE(gd.beat_times, ud.beat_times) as beat_times
            FROM user_downloads ud
            LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
            WHERE ud.user_id=? AND ud.extracted=1
            ORDER BY ud.extracted_at DESC
        """, (user_id,))
        return [_resolve_paths_in_record(dict(row)) for row in cur.fetchall()]
