"""
Admin-facing queries and bulk operations.

Uses SQLAlchemy ORM and PostgreSQL-compatible constructs.
"""
from sqlalchemy import text

from core.models import db, GlobalDownload, UserDownload, model_to_dict


def get_all_downloads_for_admin():
    """Return all downloads across all users for admin cleanup interface."""
    result = db.session.execute(text("""
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
            gd.beat_times,
            COUNT(ud.id) as user_count,
            STRING_AGG(u.username, ', ') as users
        FROM global_downloads gd
        LEFT JOIN user_downloads ud ON gd.id = ud.global_download_id
        LEFT JOIN users u ON ud.user_id = u.id
        GROUP BY gd.id
        ORDER BY gd.created_at DESC
    """))
    return [dict(row._mapping) for row in result.fetchall()]


def get_user_ids_for_video(video_id):
    """Return distinct user IDs that have access to a given video."""
    records = UserDownload.query.with_entities(
        UserDownload.user_id
    ).filter_by(video_id=video_id).distinct().all()
    return [r.user_id for r in records]


def delete_download_completely(global_download_id):
    """Delete a download completely from both global and user tables."""
    try:
        # Get download info before deletion for file cleanup
        download = GlobalDownload.query.filter_by(id=global_download_id).first()

        if not download:
            return False, "Download not found"

        download_info = model_to_dict(download)

        # Delete from user_downloads first (foreign key constraint)
        affected_users = UserDownload.query.filter_by(
            global_download_id=global_download_id
        ).delete()

        # Delete from global_downloads
        db.session.delete(download)

        db.session.commit()
        return True, f"Deleted download from database (affected {affected_users} users)", download_info

    except Exception as e:
        db.session.rollback()
        return False, f"Database error: {str(e)}", None


def reset_extraction_status(global_download_id):
    """Reset extraction status for a download while keeping the download record."""
    try:
        # Reset extraction fields in global_downloads
        rows_updated = GlobalDownload.query.filter_by(id=global_download_id).update({
            'extracted': False,
            'extracting': False,
            'extraction_model': None,
            'stems_paths': None,
            'stems_zip_path': None,
            'extracted_at': None,
        })

        if rows_updated == 0:
            db.session.rollback()
            return False, "Download not found"

        # Reset extraction fields in user_downloads
        affected_users = UserDownload.query.filter_by(
            global_download_id=global_download_id
        ).update({
            'extracted': False,
            'extracting': False,
            'extraction_model': None,
            'stems_paths': None,
            'stems_zip_path': None,
            'extracted_at': None,
        })

        db.session.commit()
        return True, f"Reset extraction status (affected {affected_users} users)"

    except Exception as e:
        db.session.rollback()
        return False, f"Database error: {str(e)}"


def reset_extraction_status_by_video_id(video_id):
    """Reset extraction status for ALL downloads with a given video_id.

    This ensures all records (different qualities/media types) are reset,
    not just the first one found.
    """
    print(f"[RESET DEBUG] reset_extraction_status_by_video_id called with video_id='{video_id}'")

    try:
        # Reset extraction fields in ALL global_downloads with this video_id
        global_affected = GlobalDownload.query.filter_by(video_id=video_id).update({
            'extracted': False,
            'extracting': False,
            'extraction_model': None,
            'stems_paths': None,
            'stems_zip_path': None,
            'extracted_at': None,
        })
        print(f"[RESET DEBUG] global_downloads affected: {global_affected}")

        if global_affected == 0:
            db.session.rollback()
            print(f"[RESET DEBUG] No downloads found, rolling back")
            return False, "No downloads found with this video_id"

        # Reset extraction fields in user_downloads
        user_affected = UserDownload.query.filter_by(video_id=video_id).update({
            'extracted': False,
            'extracting': False,
            'extraction_model': None,
            'stems_paths': None,
            'stems_zip_path': None,
            'extracted_at': None,
        })
        print(f"[RESET DEBUG] user_downloads affected: {user_affected}")

        db.session.commit()
        print(f"[RESET DEBUG] Commit successful")
        return True, f"Reset {global_affected} global record(s), {user_affected} user record(s)"

    except Exception as e:
        db.session.rollback()
        print(f"[RESET DEBUG] Error: {e}")
        return False, f"Database error: {str(e)}"


def get_storage_usage_stats():
    """Get storage usage statistics for admin dashboard."""
    result = db.session.execute(text("""
        SELECT
            COUNT(*) as total_downloads,
            SUM(COALESCE(file_size, 0)) as total_download_size,
            COUNT(CASE WHEN extracted = true THEN 1 END) as total_extractions
        FROM global_downloads
    """))
    stats = dict(result.fetchone()._mapping)

    # Get user distribution
    user_result = db.session.execute(text("""
        SELECT
            COUNT(DISTINCT ud.user_id) as users_with_downloads,
            AVG(user_download_counts.download_count) as avg_downloads_per_user
        FROM (
            SELECT user_id, COUNT(*) as download_count
            FROM user_downloads
            GROUP BY user_id
        ) as user_download_counts
        JOIN user_downloads ud ON ud.user_id = user_download_counts.user_id
    """))
    user_stats = user_result.fetchone()
    if user_stats:
        stats.update(dict(user_stats._mapping))

    return stats
