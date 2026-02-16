"""
Startup integrity checks and database maintenance.
"""
from core.db.connection import _conn


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
