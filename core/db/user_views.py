"""
Per-user view management: remove downloads/extractions from user's list.
"""
from core.db.connection import _conn


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
