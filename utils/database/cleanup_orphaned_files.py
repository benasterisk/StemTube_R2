#!/usr/bin/env python3
"""
Cleanup script to remove orphaned files that exist on disk but aren't tracked in the database.
This addresses the issue where admin cleanup removes database records but files persist,
leading to users seeing items that should have been deleted.
"""

import os
import shutil
import sqlite3
from pathlib import Path
from core.config import ensure_valid_downloads_directory

def get_tracked_video_ids():
    """Get all video_ids that are tracked in the database."""
    DB_PATH = Path(__file__).parent / "stemtubes.db"
    
    if not DB_PATH.exists():
        print("Database not found. No cleanup needed.")
        return set()
    
    tracked_video_ids = set()
    
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            
            # Get all video_ids from global_downloads
            cursor.execute("SELECT DISTINCT video_id FROM global_downloads")
            for row in cursor.fetchall():
                tracked_video_ids.add(row[0])
            
            # Get all video_ids from user_downloads (may have different IDs)
            cursor.execute("SELECT DISTINCT video_id FROM user_downloads")
            for row in cursor.fetchall():
                tracked_video_ids.add(row[0])
                
    except Exception as e:
        print(f"Error reading database: {e}")
        return set()
    
    print(f"Found {len(tracked_video_ids)} tracked video IDs in database")
    return tracked_video_ids

def find_orphaned_directories():
    """Find directories in downloads folder that don't correspond to any database record."""
    try:
        downloads_dir = ensure_valid_downloads_directory()
        tracked_video_ids = get_tracked_video_ids()
        
        if not os.path.exists(downloads_dir):
            print("Downloads directory doesn't exist. No cleanup needed.")
            return []
        
        orphaned_dirs = []
        
        # List all directories in downloads folder
        for item in os.listdir(downloads_dir):
            item_path = os.path.join(downloads_dir, item)
            if os.path.isdir(item_path):
                # Check if this directory corresponds to any tracked video_id
                # We need to be careful here because folder names might be sanitized versions of titles
                is_tracked = False
                
                # Simple check: see if any tracked video_id appears in the folder name
                for video_id in tracked_video_ids:
                    if video_id in item:
                        is_tracked = True
                        break
                
                # Also check if there are any database records that might use this folder
                # by looking for file_paths that contain this folder name
                if not is_tracked:
                    try:
                        DB_PATH = Path(__file__).parent / "stemtubes.db"
                        with sqlite3.connect(DB_PATH) as conn:
                            cursor = conn.cursor()
                            
                            # Check if any file_path contains this folder name
                            cursor.execute("""
                                SELECT COUNT(*) FROM global_downloads 
                                WHERE file_path LIKE ? OR file_path LIKE ?
                            """, (f"%/{item}/%", f"%{item}%"))
                            
                            count = cursor.fetchone()[0]
                            if count > 0:
                                is_tracked = True
                                
                    except Exception as e:
                        print(f"Error checking database for folder {item}: {e}")
                        # When in doubt, don't delete
                        is_tracked = True
                
                if not is_tracked:
                    orphaned_dirs.append(item_path)
        
        return orphaned_dirs
        
    except Exception as e:
        print(f"Error finding orphaned directories: {e}")
        return []

def calculate_directory_size(dir_path):
    """Calculate total size of a directory in bytes."""
    total_size = 0
    try:
        for root, dirs, files in os.walk(dir_path):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.exists(file_path):
                    total_size += os.path.getsize(file_path)
    except Exception as e:
        print(f"Error calculating size for {dir_path}: {e}")
    return total_size

def format_size(bytes_size):
    """Format file size in bytes to human readable format."""
    if bytes_size == 0:
        return "0 B"
    
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} PB"

def main():
    print("=" * 60)
    print("StemTube Orphaned Files Cleanup")
    print("=" * 60)
    print()
    
    # Find orphaned directories
    orphaned_dirs = find_orphaned_directories()
    
    if not orphaned_dirs:
        print("✅ No orphaned directories found. Database and filesystem are in sync.")
        return
    
    print(f"🔍 Found {len(orphaned_dirs)} orphaned directories:")
    print()
    
    total_size = 0
    for i, dir_path in enumerate(orphaned_dirs, 1):
        dir_size = calculate_directory_size(dir_path)
        total_size += dir_size
        folder_name = os.path.basename(dir_path)
        print(f"{i:2d}. {folder_name} ({format_size(dir_size)})")
    
    print()
    print(f"📊 Total size of orphaned files: {format_size(total_size)}")
    print()
    
    # Ask for confirmation
    response = input("❓ Do you want to delete these orphaned directories? (yes/no): ").strip().lower()
    
    if response not in ['yes', 'y']:
        print("❌ Cleanup cancelled by user.")
        return
    
    print()
    print("🗑️  Starting cleanup...")
    
    deleted_count = 0
    deleted_size = 0
    errors = []
    
    for dir_path in orphaned_dirs:
        folder_name = os.path.basename(dir_path)
        try:
            dir_size = calculate_directory_size(dir_path)
            shutil.rmtree(dir_path)
            deleted_count += 1
            deleted_size += dir_size
            print(f"✅ Deleted: {folder_name} ({format_size(dir_size)})")
        except Exception as e:
            error_msg = f"❌ Failed to delete {folder_name}: {e}"
            errors.append(error_msg)
            print(error_msg)
    
    print()
    print("=" * 60)
    print("CLEANUP SUMMARY")
    print("=" * 60)
    print(f"✅ Directories deleted: {deleted_count}")
    print(f"📦 Space freed: {format_size(deleted_size)}")
    
    if errors:
        print(f"❌ Errors: {len(errors)}")
        for error in errors:
            print(f"   {error}")
    
    print()
    print("🎉 Cleanup completed!")
    print()
    print("NOTE: After running this cleanup, you should restart the application")
    print("to ensure any cached references are cleared.")

if __name__ == "__main__":
    main()