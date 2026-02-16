#!/usr/bin/env python3
"""
Optional script to update database paths to current environment.
Run this AFTER migration if you want to clean up old absolute paths.
"""
import sqlite3
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "stemtubes.db"
APP_ROOT = Path(__file__).parent
NEW_ROOT = str(APP_ROOT)

def update_paths():
    """Update all old absolute paths to current environment paths."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("=" * 80)
    print("DATABASE PATH CLEANUP UTILITY")
    print("=" * 80)
    print(f"Database: {DB_PATH}")
    print(f"New root: {NEW_ROOT}")
    print()
    
    # Get counts before
    cursor.execute("SELECT COUNT(*) FROM global_downloads WHERE file_path LIKE '%/StemTube-dev/%'")
    old_global = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM user_downloads WHERE file_path LIKE '%/StemTube-dev/%'")
    old_user = cursor.fetchone()[0]
    
    print(f"Found {old_global} old paths in global_downloads")
    print(f"Found {old_user} old paths in user_downloads")
    print()
    
    if old_global == 0 and old_user == 0:
        print("✅ No old paths found - database is already clean!")
        conn.close()
        return
    
    # Ask for confirmation
    response = input("Update these paths to current environment? (yes/no): ").strip().lower()
    if response not in ['yes', 'y']:
        print("❌ Cancelled - no changes made")
        conn.close()
        return
    
    print("\nUpdating paths...")
    
    # Update global_downloads
    cursor.execute("""
        UPDATE global_downloads 
        SET file_path = REPLACE(
            file_path,
            SUBSTR(file_path, 1, INSTR(file_path, '/StemTube-dev/') + 13),
            ? || '/'
        )
        WHERE file_path LIKE '%/StemTube-dev/%'
    """, (NEW_ROOT,))
    updated_global_file = cursor.rowcount
    
    cursor.execute("""
        UPDATE global_downloads 
        SET stems_paths = REPLACE(
            stems_paths,
            SUBSTR(stems_paths, 1, INSTR(stems_paths, '/StemTube-dev/') + 13),
            ? || '/'
        )
        WHERE stems_paths LIKE '%/StemTube-dev/%'
    """, (NEW_ROOT,))
    updated_global_stems = cursor.rowcount
    
    cursor.execute("""
        UPDATE global_downloads 
        SET stems_zip_path = REPLACE(
            stems_zip_path,
            SUBSTR(stems_zip_path, 1, INSTR(stems_zip_path, '/StemTube-dev/') + 13),
            ? || '/'
        )
        WHERE stems_zip_path LIKE '%/StemTube-dev/%'
    """, (NEW_ROOT,))
    updated_global_zip = cursor.rowcount
    
    # Update user_downloads
    cursor.execute("""
        UPDATE user_downloads 
        SET file_path = REPLACE(
            file_path,
            SUBSTR(file_path, 1, INSTR(file_path, '/StemTube-dev/') + 13),
            ? || '/'
        )
        WHERE file_path LIKE '%/StemTube-dev/%'
    """, (NEW_ROOT,))
    updated_user_file = cursor.rowcount
    
    cursor.execute("""
        UPDATE user_downloads 
        SET stems_paths = REPLACE(
            stems_paths,
            SUBSTR(stems_paths, 1, INSTR(stems_paths, '/StemTube-dev/') + 13),
            ? || '/'
        )
        WHERE stems_paths LIKE '%/StemTube-dev/%'
    """, (NEW_ROOT,))
    updated_user_stems = cursor.rowcount
    
    cursor.execute("""
        UPDATE user_downloads 
        SET stems_zip_path = REPLACE(
            stems_zip_path,
            SUBSTR(stems_zip_path, 1, INSTR(stems_zip_path, '/StemTube-dev/') + 13),
            ? || '/'
        )
        WHERE stems_zip_path LIKE '%/StemTube-dev/%'
    """, (NEW_ROOT,))
    updated_user_zip = cursor.rowcount
    
    conn.commit()
    
    print(f"✅ Updated global_downloads.file_path: {updated_global_file} rows")
    print(f"✅ Updated global_downloads.stems_paths: {updated_global_stems} rows")
    print(f"✅ Updated global_downloads.stems_zip_path: {updated_global_zip} rows")
    print(f"✅ Updated user_downloads.file_path: {updated_user_file} rows")
    print(f"✅ Updated user_downloads.stems_paths: {updated_user_stems} rows")
    print(f"✅ Updated user_downloads.stems_zip_path: {updated_user_zip} rows")
    
    # Verify
    cursor.execute("SELECT COUNT(*) FROM global_downloads WHERE file_path LIKE '%/StemTube-dev/%'")
    remaining_global = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM user_downloads WHERE file_path LIKE '%/StemTube-dev/%'")
    remaining_user = cursor.fetchone()[0]
    
    print()
    print(f"Remaining old paths in global_downloads: {remaining_global}")
    print(f"Remaining old paths in user_downloads: {remaining_user}")
    
    if remaining_global == 0 and remaining_user == 0:
        print("\n🎉 Database cleanup complete - all paths updated!")
    else:
        print("\n⚠️ Some paths remain - may need manual inspection")
    
    conn.close()

if __name__ == '__main__':
    try:
        update_paths()
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
