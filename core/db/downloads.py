"""
Global and per-user download CRUD operations.
"""
import json

from core.db.connection import _conn, _resolve_paths_in_record


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


def update_download_analysis(video_id, detected_bpm, detected_key, analysis_confidence, chords_data=None, beat_offset=0.0, structure_data=None, lyrics_data=None, beat_times=None, beat_positions=None):
    """Update audio analysis results for a download."""
    with _conn() as conn:
        print(f"[DB DEBUG] Updating analysis for video_id='{video_id}': BPM={detected_bpm}, Key={detected_key}, Chords={bool(chords_data)}, BeatOffset={beat_offset:.3f}s, Structure={bool(structure_data)}, Lyrics={bool(lyrics_data)}, BeatTimes={len(beat_times) if beat_times else 0}, BeatPositions={len(beat_positions) if beat_positions else 0}")

        # Convert structure_data, lyrics_data, beat_times, beat_positions to JSON if necessary
        structure_json = json.dumps(structure_data) if structure_data else None
        lyrics_json = json.dumps(lyrics_data) if lyrics_data else None
        beat_times_json = json.dumps(beat_times) if beat_times else None
        beat_positions_json = json.dumps(beat_positions) if beat_positions else None

        # Update global_downloads table
        cursor = conn.execute("""
            UPDATE global_downloads
            SET detected_bpm=?, detected_key=?, analysis_confidence=?, chords_data=?, beat_offset=?, structure_data=?, lyrics_data=?, beat_times=?, beat_positions=?
            WHERE video_id=?
        """, (detected_bpm, detected_key, analysis_confidence, chords_data, beat_offset, structure_json, lyrics_json, beat_times_json, beat_positions_json, video_id))

        rows_updated = cursor.rowcount
        print(f"[DB DEBUG] Updated {rows_updated} rows in global_downloads")

        # Update all user_downloads entries for this video_id
        cursor2 = conn.execute("""
            UPDATE user_downloads
            SET detected_bpm=?, detected_key=?, analysis_confidence=?, chords_data=?, beat_offset=?, structure_data=?, lyrics_data=?, beat_times=?, beat_positions=?
            WHERE video_id=?
        """, (detected_bpm, detected_key, analysis_confidence, chords_data, beat_offset, structure_json, lyrics_json, beat_times_json, beat_positions_json, video_id))

        rows_updated2 = cursor2.rowcount
        print(f"[DB DEBUG] Updated {rows_updated2} rows in user_downloads")

        conn.commit()

        if rows_updated == 0:
            print(f"[DB DEBUG] WARNING: No rows updated! Video_id '{video_id}' not found in global_downloads")
        else:
            print(f"[DB DEBUG] Analysis updated successfully for video_id='{video_id}'")


def update_download_lyrics(video_id, lyrics_data):
    """Update lyrics data for a download."""
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
                COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data,
                COALESCE(gd.beat_times, ud.beat_times) as beat_times,
                COALESCE(gd.beat_positions, ud.beat_positions) as beat_positions
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
                COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data,
                COALESCE(gd.beat_times, ud.beat_times) as beat_times,
                COALESCE(gd.beat_positions, ud.beat_positions) as beat_positions
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
