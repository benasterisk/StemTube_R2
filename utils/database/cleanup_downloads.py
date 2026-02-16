#!/usr/bin/env python3
"""
StemTube Cleanup Utility
========================

This script cleans up downloads and extractions from both the database and filesystem
while preserving user accounts. Use with caution as this operation cannot be undone.

Features:
- Remove all downloads from user_downloads and global_downloads tables
- Delete corresponding directories in core/downloads/
- Preserve user accounts and authentication data
- Safety checks and confirmation prompts
- Detailed logging of cleanup operations

Usage:
    python cleanup_downloads.py [options]

Options:
    --dry-run       Show what would be deleted without actually deleting
    --force         Skip confirmation prompts (dangerous!)
    --backup-db     Create database backup before cleanup
    --keep-recent   Keep downloads from last N days (default: 0)
"""

import os
import sys
import sqlite3
import shutil
import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Tuple

# Add the project root to Python path so we can import core modules
PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from core.config import ensure_valid_downloads_directory
    from core.downloads_db import DB_PATH
except ImportError as e:
    print(f"Error importing core modules: {e}")
    print("Make sure you're running this script from the StemTube root directory")
    sys.exit(1)

class StemTubeCleanup:
    """Main cleanup utility class."""
    
    def __init__(self, dry_run=False, keep_recent_days=0):
        self.dry_run = dry_run
        self.keep_recent_days = keep_recent_days
        self.db_path = DB_PATH
        self.downloads_dir = Path(ensure_valid_downloads_directory())
        
        # Statistics
        self.stats = {
            'global_downloads_deleted': 0,
            'user_downloads_deleted': 0,
            'directories_deleted': 0,
            'files_deleted': 0,
            'total_size_freed': 0,
            'errors': []
        }
        
        print(f"StemTube Cleanup Utility")
        print(f"Database: {self.db_path}")
        print(f"Downloads directory: {self.downloads_dir}")
        if dry_run:
            print("🔍 DRY RUN MODE - No actual changes will be made")
        if keep_recent_days > 0:
            cutoff_date = datetime.now() - timedelta(days=keep_recent_days)
            print(f"📅 Keeping downloads newer than: {cutoff_date.strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 60)
    
    def backup_database(self) -> bool:
        """Create a backup of the database before cleanup."""
        try:
            backup_path = self.db_path.parent / f"stemtubes_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
            print(f"📦 Creating database backup: {backup_path}")
            
            if not self.dry_run:
                shutil.copy2(self.db_path, backup_path)
            
            print(f"✅ Database backed up successfully")
            return True
        except Exception as e:
            print(f"❌ Error creating database backup: {e}")
            return False
    
    def get_database_info(self) -> Dict:
        """Get information about downloads in the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # Count records
                cursor.execute("SELECT COUNT(*) FROM global_downloads")
                global_count = cursor.fetchone()[0]
                
                cursor.execute("SELECT COUNT(*) FROM user_downloads") 
                user_count = cursor.fetchone()[0]
                
                cursor.execute("SELECT COUNT(*) FROM users")
                user_accounts = cursor.fetchone()[0]
                
                # Get size estimates
                cursor.execute("SELECT SUM(COALESCE(file_size, 0)) FROM global_downloads")
                total_size = cursor.fetchone()[0] or 0
                
                # Count extractions
                cursor.execute("SELECT COUNT(*) FROM global_downloads WHERE extracted=1")
                extractions_count = cursor.fetchone()[0]
                
                # Apply date filter if specified
                downloads_to_delete = global_count
                user_downloads_to_delete = user_count
                
                if self.keep_recent_days > 0:
                    cutoff_date = datetime.now() - timedelta(days=self.keep_recent_days)
                    cutoff_str = cutoff_date.strftime('%Y-%m-%d %H:%M:%S')
                    
                    cursor.execute("""
                        SELECT COUNT(*) FROM global_downloads 
                        WHERE created_at < ?
                    """, (cutoff_str,))
                    downloads_to_delete = cursor.fetchone()[0]
                    
                    cursor.execute("""
                        SELECT COUNT(*) FROM user_downloads 
                        WHERE created_at < ?
                    """, (cutoff_str,))
                    user_downloads_to_delete = cursor.fetchone()[0]
                
                return {
                    'global_downloads': global_count,
                    'user_downloads': user_count,
                    'user_accounts': user_accounts,
                    'total_size_bytes': total_size,
                    'total_size_mb': round(total_size / (1024*1024), 2),
                    'extractions': extractions_count,
                    'downloads_to_delete': downloads_to_delete,
                    'user_downloads_to_delete': user_downloads_to_delete
                }
                
        except Exception as e:
            print(f"❌ Error getting database info: {e}")
            return {}
    
    def get_filesystem_info(self) -> Dict:
        """Get information about files in the downloads directory."""
        try:
            total_size = 0
            file_count = 0
            dir_count = 0
            
            if self.downloads_dir.exists():
                for item in self.downloads_dir.rglob('*'):
                    if item.is_file():
                        try:
                            total_size += item.stat().st_size
                            file_count += 1
                        except (OSError, PermissionError):
                            pass
                    elif item.is_dir():
                        dir_count += 1
            
            return {
                'total_size_bytes': total_size,
                'total_size_mb': round(total_size / (1024*1024), 2),
                'total_size_gb': round(total_size / (1024*1024*1024), 2),
                'file_count': file_count,
                'directory_count': dir_count,
                'downloads_dir_exists': self.downloads_dir.exists()
            }
            
        except Exception as e:
            print(f"❌ Error getting filesystem info: {e}")
            return {}
    
    def cleanup_database(self) -> bool:
        """Clean up downloads from the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                print("🗃️  Cleaning up database...")
                
                # Build WHERE clause for date filtering
                where_clause = ""
                params = []
                if self.keep_recent_days > 0:
                    cutoff_date = datetime.now() - timedelta(days=self.keep_recent_days)
                    cutoff_str = cutoff_date.strftime('%Y-%m-%d %H:%M:%S')
                    where_clause = "WHERE created_at < ?"
                    params = [cutoff_str]
                
                if not self.dry_run:
                    # Delete user downloads
                    query = f"DELETE FROM user_downloads {where_clause}"
                    cursor.execute(query, params)
                    user_deleted = cursor.rowcount
                    
                    # Delete global downloads
                    query = f"DELETE FROM global_downloads {where_clause}"
                    cursor.execute(query, params)
                    global_deleted = cursor.rowcount
                    
                    conn.commit()
                    
                    self.stats['user_downloads_deleted'] = user_deleted
                    self.stats['global_downloads_deleted'] = global_deleted
                    
                    print(f"✅ Deleted {global_deleted} global downloads")
                    print(f"✅ Deleted {user_deleted} user download records")
                else:
                    # Dry run - just count what would be deleted
                    query = f"SELECT COUNT(*) FROM user_downloads {where_clause}"
                    cursor.execute(query, params)
                    user_count = cursor.fetchone()[0]
                    
                    query = f"SELECT COUNT(*) FROM global_downloads {where_clause}"
                    cursor.execute(query, params)
                    global_count = cursor.fetchone()[0]
                    
                    print(f"🔍 Would delete {global_count} global downloads")
                    print(f"🔍 Would delete {user_count} user download records")
                
                return True
                
        except Exception as e:
            print(f"❌ Error cleaning up database: {e}")
            self.stats['errors'].append(f"Database cleanup error: {e}")
            return False
    
    def cleanup_filesystem(self) -> bool:
        """Clean up files and directories from the filesystem."""
        try:
            print("📁 Cleaning up filesystem...")
            
            if not self.downloads_dir.exists():
                print("📁 Downloads directory doesn't exist - nothing to clean")
                return True
            
            # Get list of directories to potentially delete
            directories_to_delete = []
            for item in self.downloads_dir.iterdir():
                if item.is_dir():
                    # Apply date filtering if specified
                    if self.keep_recent_days > 0:
                        try:
                            dir_mtime = datetime.fromtimestamp(item.stat().st_mtime)
                            cutoff_date = datetime.now() - timedelta(days=self.keep_recent_days)
                            if dir_mtime >= cutoff_date:
                                continue  # Skip recent directories
                        except (OSError, PermissionError):
                            pass
                    
                    directories_to_delete.append(item)
            
            # Delete directories
            for dir_path in directories_to_delete:
                try:
                    # Calculate size before deletion
                    dir_size = self._get_directory_size(dir_path)
                    file_count = self._count_files_in_directory(dir_path)
                    
                    if not self.dry_run:
                        shutil.rmtree(dir_path)
                        self.stats['directories_deleted'] += 1
                        self.stats['files_deleted'] += file_count
                        self.stats['total_size_freed'] += dir_size
                        print(f"🗑️  Deleted: {dir_path.name} ({self._format_size(dir_size)}, {file_count} files)")
                    else:
                        print(f"🔍 Would delete: {dir_path.name} ({self._format_size(dir_size)}, {file_count} files)")
                        
                except Exception as e:
                    error_msg = f"Error deleting {dir_path}: {e}"
                    print(f"❌ {error_msg}")
                    self.stats['errors'].append(error_msg)
            
            return True
            
        except Exception as e:
            print(f"❌ Error cleaning up filesystem: {e}")
            self.stats['errors'].append(f"Filesystem cleanup error: {e}")
            return False
    
    def _get_directory_size(self, path: Path) -> int:
        """Get the total size of a directory."""
        total_size = 0
        try:
            for item in path.rglob('*'):
                if item.is_file():
                    try:
                        total_size += item.stat().st_size
                    except (OSError, PermissionError):
                        pass
        except Exception:
            pass
        return total_size
    
    def _count_files_in_directory(self, path: Path) -> int:
        """Count files in a directory."""
        count = 0
        try:
            for item in path.rglob('*'):
                if item.is_file():
                    count += 1
        except Exception:
            pass
        return count
    
    def _format_size(self, size_bytes: int) -> str:
        """Format file size in human readable format."""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024
        return f"{size_bytes:.1f} TB"
    
    def run_cleanup(self, backup_db=False, force=False) -> bool:
        """Run the complete cleanup process."""
        try:
            # Get initial information
            db_info = self.get_database_info()
            fs_info = self.get_filesystem_info()
            
            print("📊 Current Status:")
            print(f"   Database:")
            print(f"     • Global downloads: {db_info.get('global_downloads', 'Unknown')}")
            print(f"     • User downloads: {db_info.get('user_downloads', 'Unknown')}")
            print(f"     • User accounts: {db_info.get('user_accounts', 'Unknown')} (will be preserved)")
            print(f"     • Extractions: {db_info.get('extractions', 'Unknown')}")
            print(f"   Filesystem:")
            print(f"     • Files: {fs_info.get('file_count', 'Unknown')}")
            print(f"     • Directories: {fs_info.get('directory_count', 'Unknown')}")
            print(f"     • Total size: {fs_info.get('total_size_gb', 0):.2f} GB")
            print()
            
            # Show what will be deleted
            if self.keep_recent_days > 0:
                print(f"📅 Will delete items older than {self.keep_recent_days} days:")
                print(f"   • Global downloads to delete: {db_info.get('downloads_to_delete', 'Unknown')}")
                print(f"   • User downloads to delete: {db_info.get('user_downloads_to_delete', 'Unknown')}")
            else:
                print("🧹 Will delete ALL downloads and extractions:")
                print(f"   • Global downloads: {db_info.get('global_downloads', 'Unknown')}")
                print(f"   • User downloads: {db_info.get('user_downloads', 'Unknown')}")
            print()
            
            # Confirmation prompt
            if not force and not self.dry_run:
                print("⚠️  WARNING: This operation cannot be undone!")
                print("⚠️  All downloads and extractions will be permanently deleted!")
                print("✅ User accounts will be preserved.")
                print()
                
                response = input("Are you sure you want to continue? (type 'yes' to confirm): ")
                if response.lower() != 'yes':
                    print("❌ Operation cancelled by user")
                    return False
            
            # Create backup if requested
            if backup_db and not self.backup_database():
                if not force:
                    response = input("Database backup failed. Continue anyway? (type 'yes' to confirm): ")
                    if response.lower() != 'yes':
                        print("❌ Operation cancelled due to backup failure")
                        return False
            
            print("🚀 Starting cleanup...")
            print()
            
            # Run database cleanup
            if not self.cleanup_database():
                print("❌ Database cleanup failed")
                return False
            
            # Run filesystem cleanup
            if not self.cleanup_filesystem():
                print("❌ Filesystem cleanup failed")
                return False
            
            # Show final statistics
            self.print_final_stats()
            
            return True
            
        except KeyboardInterrupt:
            print("\n❌ Operation cancelled by user (Ctrl+C)")
            return False
        except Exception as e:
            print(f"❌ Unexpected error during cleanup: {e}")
            return False
    
    def print_final_stats(self):
        """Print final cleanup statistics."""
        print()
        print("📈 Cleanup Statistics:")
        print(f"   • Global downloads deleted: {self.stats['global_downloads_deleted']}")
        print(f"   • User downloads deleted: {self.stats['user_downloads_deleted']}")
        print(f"   • Directories deleted: {self.stats['directories_deleted']}")
        print(f"   • Files deleted: {self.stats['files_deleted']}")
        if not self.dry_run:
            print(f"   • Disk space freed: {self._format_size(self.stats['total_size_freed'])}")
        
        if self.stats['errors']:
            print(f"   • Errors: {len(self.stats['errors'])}")
            print("     Errors encountered:")
            for error in self.stats['errors']:
                print(f"       - {error}")
        
        if not self.dry_run:
            print()
            print("✅ Cleanup completed successfully!")
            print("ℹ️  User accounts have been preserved.")
            print()
            print("⚠️  IMPORTANT: If the StemTube application is currently running,")
            print("   you need to restart it to clear cached extraction data from memory.")
            print("   Otherwise, old extractions may still appear in the UI.")
        else:
            print()
            print("🔍 Dry run completed. Use --force to execute the actual cleanup.")


def main():
    """Main function with command line argument parsing."""
    parser = argparse.ArgumentParser(
        description="StemTube Downloads Cleanup Utility",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python cleanup_downloads.py --dry-run                 # Preview what would be deleted
  python cleanup_downloads.py --backup-db               # Create backup before cleanup
  python cleanup_downloads.py --keep-recent 7          # Keep downloads from last 7 days
  python cleanup_downloads.py --force --backup-db      # Force cleanup with backup
        """
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be deleted without actually deleting'
    )
    
    parser.add_argument(
        '--force',
        action='store_true',
        help='Skip confirmation prompts (use with caution!)'
    )
    
    parser.add_argument(
        '--backup-db',
        action='store_true',
        help='Create database backup before cleanup'
    )
    
    parser.add_argument(
        '--keep-recent',
        type=int,
        default=0,
        metavar='DAYS',
        help='Keep downloads from last N days (default: 0 = delete all)'
    )
    
    args = parser.parse_args()
    
    # Create cleanup instance
    cleanup = StemTubeCleanup(
        dry_run=args.dry_run,
        keep_recent_days=args.keep_recent
    )
    
    # Run cleanup
    success = cleanup.run_cleanup(
        backup_db=args.backup_db,
        force=args.force
    )
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()