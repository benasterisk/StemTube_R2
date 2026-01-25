"""
File cleanup utilities for admin operations.
"""
import os
import shutil
from pathlib import Path
from core.config import ensure_valid_downloads_directory


def format_file_size(bytes_size):
    """Format file size in bytes to human readable format."""
    if bytes_size is None or bytes_size == 0:
        return "0 B"
    
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} PB"


def get_downloads_directory_usage():
    """Get total disk usage statistics for the downloads directory."""
    try:
        downloads_dir = ensure_valid_downloads_directory()
        
        if not os.path.exists(downloads_dir):
            return {
                'total_size': 0,
                'total_files': 0,
                'total_folders': 0,
                'error': None
            }
        
        total_size = 0
        total_files = 0
        total_folders = 0
        
        for root, dirs, files in os.walk(downloads_dir):
            total_folders += len(dirs)
            for file in files:
                try:
                    file_path = os.path.join(root, file)
                    if os.path.exists(file_path):
                        total_size += os.path.getsize(file_path)
                        total_files += 1
                except (OSError, IOError):
                    # Skip files that can't be accessed
                    continue
        
        return {
            'total_size': total_size,
            'total_files': total_files,
            'total_folders': total_folders,
            'error': None
        }
        
    except Exception as e:
        return {
            'total_size': 0,
            'total_files': 0,
            'total_folders': 0,
            'error': str(e)
        }


def delete_download_files(download_info):
    """Delete all files associated with a download including stems."""
    try:
        files_deleted = []
        total_size_freed = 0
        errors = []
        
        # Get the download directory path based on title
        downloads_dir = ensure_valid_downloads_directory()
        if not download_info.get('title'):
            return False, "No title found for download", {
                'files_deleted': files_deleted,
                'total_size_freed': total_size_freed, 
                'errors': ['No title found']
            }
        
        # Try multiple possible directory name formats
        title = download_info['title']
        possible_dirs = [title]  # Start with original title
        
        # If we have a file_path, extract the folder name from it (most reliable)
        if download_info.get('file_path'):
            file_path = download_info['file_path']
            # Extract folder name from file path like: /path/to/downloads/FolderName/audio/file.mp3
            if '/audio/' in file_path:
                folder_part = file_path.split('/audio/')[0]  # Get everything before /audio/
                folder_name = os.path.basename(folder_part)  # Get just the folder name
                if folder_name and folder_name not in possible_dirs:
                    possible_dirs.insert(0, folder_name)  # Try this first
        
        # Add other variations
        possible_dirs.extend([
            title.replace('|', '_').replace('/', '_').replace('\\', '_'),  # Basic sanitization
            title.replace(' ', '_'),  # Spaces to underscores
            "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip(),  # Remove special chars
            "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip().replace(' ', '_'),  # Remove special + spaces to underscores
            title + '_',  # Original + trailing underscore (common pattern)
        ])
        
        # Remove duplicates while preserving order
        seen = set()
        unique_dirs = []
        for d in possible_dirs:
            if d not in seen:
                seen.add(d)
                unique_dirs.append(d)
        possible_dirs = unique_dirs
        
        download_folder = None
        for possible_dir in possible_dirs:
            candidate_path = Path(downloads_dir) / possible_dir
            if candidate_path.exists():
                download_folder = candidate_path
                break
        
        if not download_folder:
            return False, f"Download folder not found for '{download_info['title']}'", {
                'files_deleted': files_deleted,
                'total_size_freed': total_size_freed,
                'errors': [f"Download folder not found for '{download_info['title']}'"]
            }
        
        # Calculate total size before deletion
        for root, dirs, files in os.walk(download_folder):
            for file in files:
                try:
                    file_path = os.path.join(root, file)
                    if os.path.exists(file_path):
                        file_size = os.path.getsize(file_path)
                        total_size_freed += file_size
                        files_deleted.append(file_path)
                except (OSError, IOError) as e:
                    errors.append(f"Error accessing {file_path}: {e}")
        
        # Delete the entire folder
        try:
            shutil.rmtree(download_folder)
            return True, f"Deleted folder '{download_folder}' ({format_file_size(total_size_freed)})", {
                'files_deleted': files_deleted,
                'total_size_freed': total_size_freed,
                'errors': errors
            }
        except Exception as e:
            errors.append(f"Error deleting folder '{download_folder}': {e}")
            return False, f"Failed to delete folder: {e}", {
                'files_deleted': [],
                'total_size_freed': 0,
                'errors': errors
            }
            
    except Exception as e:
        return False, f"Error during file cleanup: {e}", {
            'files_deleted': [],
            'total_size_freed': 0,
            'errors': [str(e)]
        }


def delete_extraction_files_only(download_info):
    """Delete only the extraction/stems files, keeping the original download."""
    try:
        files_deleted = []
        total_size_freed = 0
        errors = []
        
        # Get the download directory path based on title
        downloads_dir = ensure_valid_downloads_directory()
        if not download_info.get('title'):
            return False, "No title found for download", {
                'files_deleted': files_deleted,
                'total_size_freed': total_size_freed,
                'errors': ['No title found']
            }
        
        # Try multiple possible directory name formats
        title = download_info['title']
        possible_dirs = [title]  # Start with original title
        
        # If we have a file_path, extract the folder name from it (most reliable)
        if download_info.get('file_path'):
            file_path = download_info['file_path']
            # Extract folder name from file path like: /path/to/downloads/FolderName/audio/file.mp3
            if '/audio/' in file_path:
                folder_part = file_path.split('/audio/')[0]  # Get everything before /audio/
                folder_name = os.path.basename(folder_part)  # Get just the folder name
                if folder_name and folder_name not in possible_dirs:
                    possible_dirs.insert(0, folder_name)  # Try this first
        
        # Add other variations
        possible_dirs.extend([
            title.replace('|', '_').replace('/', '_').replace('\\', '_'),  # Basic sanitization
            title.replace(' ', '_'),  # Spaces to underscores
            "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip(),  # Remove special chars
            "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip().replace(' ', '_'),  # Remove special + spaces to underscores
            title + '_',  # Original + trailing underscore (common pattern)
        ])
        
        # Remove duplicates while preserving order
        seen = set()
        unique_dirs = []
        for d in possible_dirs:
            if d not in seen:
                seen.add(d)
                unique_dirs.append(d)
        possible_dirs = unique_dirs
        
        download_folder = None
        for possible_dir in possible_dirs:
            candidate_path = Path(downloads_dir) / possible_dir
            if candidate_path.exists():
                download_folder = candidate_path
                break
        
        if not download_folder:
            return False, f"Download folder not found for '{download_info['title']}'", {
                'files_deleted': files_deleted,
                'total_size_freed': total_size_freed,
                'errors': [f"Download folder not found for '{download_info['title']}'"]
            }
        
        # Look for stems folders and files
        stems_folders = []
        
        # Check for stems in audio/stems/ (common structure)
        audio_stems_dir = download_folder / "audio" / "stems"
        if audio_stems_dir.exists():
            stems_folders.append(audio_stems_dir)
        
        # Check for stems in root/stems/ (alternative structure)  
        root_stems_dir = download_folder / "stems"
        if root_stems_dir.exists():
            stems_folders.append(root_stems_dir)
        
        if not stems_folders:
            return False, "No stems folders found", {
                'files_deleted': files_deleted,
                'total_size_freed': total_size_freed,
                'errors': ['No stems folders found']
            }
        
        # Delete stems files and folders
        for stems_dir in stems_folders:
            try:
                for root, dirs, files in os.walk(stems_dir):
                    for file in files:
                        try:
                            file_path = os.path.join(root, file)
                            if os.path.exists(file_path):
                                file_size = os.path.getsize(file_path)
                                total_size_freed += file_size
                                files_deleted.append(file_path)
                        except (OSError, IOError) as e:
                            errors.append(f"Error accessing {file_path}: {e}")
                
                # Delete the stems directory
                shutil.rmtree(stems_dir)
                
            except Exception as e:
                errors.append(f"Error deleting stems directory '{stems_dir}': {e}")
        
        return True, f"Deleted stems files ({format_file_size(total_size_freed)})", {
            'files_deleted': files_deleted,
            'total_size_freed': total_size_freed,
            'errors': errors
        }
        
    except Exception as e:
        return False, f"Error during stems cleanup: {e}", {
            'files_deleted': [],
            'total_size_freed': 0,
            'errors': [str(e)]
        }