"""
Admin-facing queries and bulk operations.
"""
from core.db.connection import _conn


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
