"""
Startup integrity checks and database maintenance.

Uses SQLAlchemy ORM and PostgreSQL-compatible constructs.
"""
from sqlalchemy import text

from core.models import db, GlobalDownload, UserDownload


def cleanup_stuck_extractions():
    """Clean up stuck extractions on application startup."""
    stuck_count = GlobalDownload.query.filter_by(
        extracting=True, extracted=False
    ).count()

    if stuck_count > 0:
        print(f"[STARTUP] Found {stuck_count} stuck extractions - cleaning up...")

        # Reset stuck extractions in global_downloads
        GlobalDownload.query.filter_by(
            extracting=True, extracted=False
        ).update({
            'extracting': False,
            'extraction_model': None,
        })

        # Reset stuck extractions in user_downloads
        UserDownload.query.filter_by(
            extracting=True, extracted=False
        ).update({
            'extracting': False,
            'extraction_model': None,
        })

        db.session.commit()
        print(f"[STARTUP] Cleaned up {stuck_count} stuck extractions")
    else:
        print("[STARTUP] No stuck extractions found")


def cleanup_duplicate_user_downloads():
    """Clean up duplicate user_downloads records on application startup."""
    print("[STARTUP] Checking for duplicate user_downloads records...")

    # Find users with multiple records for the same video_id
    result = db.session.execute(text("""
        SELECT user_id, video_id, COUNT(*) as count
        FROM user_downloads
        GROUP BY user_id, video_id
        HAVING COUNT(*) > 1
    """))
    duplicates = result.fetchall()

    if not duplicates:
        print("[STARTUP] No duplicate user_downloads records found")
        return

    print(f"[STARTUP] Found {len(duplicates)} sets of duplicate records to clean up")

    for dup in duplicates:
        user_id = dup.user_id
        video_id = dup.video_id
        count = dup.count
        print(f"[STARTUP] Cleaning up {count} duplicate records for user {user_id}, video {video_id}")

        # Get all records for this user/video combination, ordered by creation date
        records = UserDownload.query.filter_by(
            user_id=user_id, video_id=video_id
        ).order_by(UserDownload.created_at.asc()).all()

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
                if record.file_path and not best_record.file_path:
                    records_to_delete.append(best_record.id)
                    best_record = record
                # If both have file_path or both don't, prefer the newer one
                elif bool(record.file_path) == bool(best_record.file_path):
                    if record.created_at > best_record.created_at:
                        records_to_delete.append(best_record.id)
                        best_record = record
                    else:
                        records_to_delete.append(record.id)
                else:
                    records_to_delete.append(record.id)

        # Update the best record with any missing data from other records
        for record in records:
            if record.id != best_record.id:
                # Merge extraction data if missing in best record
                if record.extracted and not best_record.extracted:
                    best_record.extracted = record.extracted
                    best_record.extraction_model = record.extraction_model
                    best_record.stems_paths = record.stems_paths
                    best_record.stems_zip_path = record.stems_zip_path
                    best_record.extracted_at = record.extracted_at
                    print(f"[STARTUP] Merged extraction data into record {best_record.id}")

                # Merge download data if missing in best record
                if record.file_path and not best_record.file_path:
                    best_record.file_path = record.file_path
                    best_record.media_type = record.media_type
                    best_record.quality = record.quality
                    print(f"[STARTUP] Merged download data into record {best_record.id}")

        # Delete duplicate records
        for record_id in records_to_delete:
            UserDownload.query.filter_by(id=record_id).delete()
            print(f"[STARTUP] Deleted duplicate record {record_id}")

    db.session.commit()
    print(f"[STARTUP] Cleaned up duplicate user_downloads records")


def cleanup_orphaned_records():
    """Clean up orphaned or inconsistent records."""
    print("[CLEANUP] Checking for orphaned or inconsistent records...")

    # Clean up user_downloads records that reference non-existent global_downloads
    orphaned_result = db.session.execute(text("""
        SELECT COUNT(*) FROM user_downloads ud
        LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
        WHERE ud.global_download_id IS NOT NULL AND gd.id IS NULL
    """))
    orphaned_user_downloads = orphaned_result.scalar()

    if orphaned_user_downloads > 0:
        print(f"[CLEANUP] Found {orphaned_user_downloads} orphaned user_downloads records")
        result = db.session.execute(text("""
            DELETE FROM user_downloads
            WHERE global_download_id IS NOT NULL
            AND global_download_id NOT IN (SELECT id FROM global_downloads)
        """))
        print(f"[CLEANUP] Removed {result.rowcount} orphaned user_downloads records")

    # Find records with extracted=1 but no extraction_model
    orphaned_extractions = UserDownload.query.filter(
        UserDownload.extracted == True,  # noqa: E712
        (UserDownload.extraction_model.is_(None)) | (UserDownload.extraction_model == '')
    ).count()

    if orphaned_extractions > 0:
        print(f"[CLEANUP] Found {orphaned_extractions} extracted records without extraction_model")
        rows_updated = UserDownload.query.filter(
            UserDownload.extracted == True,  # noqa: E712
            (UserDownload.extraction_model.is_(None)) | (UserDownload.extraction_model == '')
        ).update({
            'extracted': False,
            'stems_paths': None,
            'stems_zip_path': None,
            'extracted_at': None,
            'extracting': False,
        }, synchronize_session='fetch')
        print(f"[CLEANUP] Reset {rows_updated} orphaned extraction records")

    # Find records with extracting=1 but extracted=1 (inconsistent state)
    inconsistent_extractions = UserDownload.query.filter_by(
        extracting=True, extracted=True
    ).count()

    if inconsistent_extractions > 0:
        print(f"[CLEANUP] Found {inconsistent_extractions} records with inconsistent extraction state")
        rows_updated = UserDownload.query.filter_by(
            extracting=True, extracted=True
        ).update({'extracting': False})
        print(f"[CLEANUP] Fixed {rows_updated} inconsistent extraction states")

    db.session.commit()
    print("[CLEANUP] Orphaned record cleanup complete")


def comprehensive_cleanup():
    """Run all cleanup functions for database integrity."""
    print("[CLEANUP] Starting comprehensive database cleanup...")
    cleanup_stuck_extractions()
    cleanup_duplicate_user_downloads()
    cleanup_orphaned_records()
    print("[CLEANUP] Comprehensive cleanup complete")
