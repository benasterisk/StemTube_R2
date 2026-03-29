"""
Per-user view management: remove downloads/extractions from user's list.

Uses SQLAlchemy ORM — all queries go through db.session.
"""
from core.models import db, UserDownload


def clear_user_session_data(user_id, video_id):
    """Clear any session data for a user's removed download/extraction.
    This should be called from the Flask app after database removal.
    """
    # This function will be called from app.py to clear session managers
    # after successful database removal
    pass


def force_remove_all_user_access(user_id, video_id):
    """Forcefully remove all user access to a video_id, clearing both download and extraction access."""
    try:
        print(f"[DEBUG] Force removing all access for user_id={user_id}, video_id='{video_id}'")

        # Get record info before deletion
        user_record = UserDownload.query.filter_by(user_id=user_id, video_id=video_id).first()
        if not user_record:
            return False, "No record found for this video"

        title = user_record.title

        # Delete all records for this user + video_id
        affected_rows = UserDownload.query.filter_by(user_id=user_id, video_id=video_id).delete()
        print(f"[DEBUG] Force deleted {affected_rows} user_downloads records")

        db.session.commit()
        return True, f"Completely removed '{title}' from your lists"

    except Exception as e:
        db.session.rollback()
        return False, f"Database error: {str(e)}"


def remove_user_download_access(user_id, video_id):
    """Remove user's access to a download without affecting global record or files."""
    try:
        print(f"[DEBUG] Looking for user_id={user_id}, video_id='{video_id}'")

        # Debug: log all video_ids for this user
        user_downloads = UserDownload.query.filter_by(user_id=user_id).all()
        print(f"[DEBUG] User {user_id} has video_ids: {[ud.video_id for ud in user_downloads]}")

        # Check if user has access to this download
        user_download = UserDownload.query.filter_by(user_id=user_id, video_id=video_id).first()
        if not user_download:
            return False, "Download not found in your list"

        title = user_download.title

        # Always delete the entire record to ensure clean removal
        # If the user wants the extraction later, they can re-access it through global deduplication
        affected_rows = UserDownload.query.filter_by(user_id=user_id, video_id=video_id).delete()
        print(f"[DEBUG] Deleted {affected_rows} user_downloads records for user_id={user_id}, video_id='{video_id}'")

        db.session.commit()
        return True, f"Removed '{title}' from your downloads list"

    except Exception as e:
        db.session.rollback()
        return False, f"Database error: {str(e)}"


def remove_user_extraction_access(user_id, video_id):
    """Remove user's access to an extraction without affecting global record or files."""
    try:
        print(f"[DEBUG] Looking for extraction user_id={user_id}, video_id='{video_id}'")

        # Check if user has access to this extraction
        user_extraction = UserDownload.query.filter_by(
            user_id=user_id, video_id=video_id, extracted=True,
        ).first()
        if not user_extraction:
            return False, "Extraction not found in your list"

        title = user_extraction.title

        # If the record also has a download (file_path), keep the record but clear extraction fields
        # If it's extraction-only (no file_path), delete the entire record
        if user_extraction.file_path:
            # Keep record but clear extraction-specific fields (keep download)
            user_extraction.extracted = False
            user_extraction.extraction_model = None
            user_extraction.stems_paths = None
            user_extraction.stems_zip_path = None
            user_extraction.extracted_at = None
            user_extraction.extracting = False
            print(f"[DEBUG] Cleared extraction fields, kept download record")
            affected_rows = 1
        else:
            # No download, delete entire record
            affected_rows = UserDownload.query.filter_by(
                user_id=user_id, video_id=video_id, extracted=True,
            ).delete()
            print(f"[DEBUG] Deleted entire extraction-only record")

        print(f"[DEBUG] Modified {affected_rows} user_downloads records for extraction removal")

        db.session.commit()
        return True, f"Removed '{title}' from your extractions list"

    except Exception as e:
        db.session.rollback()
        return False, f"Database error: {str(e)}"
