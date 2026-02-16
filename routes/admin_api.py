"""
Admin API routes: cleanup, user management, system settings, cookies, system info.
"""

import os
import sys
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app
from flask_login import current_user

from extensions import (
    api_login_required,
    api_admin_required,
    user_session_manager,
    COOKIES_FILE_PATH,
)
from core.config import get_setting, update_setting, DOWNLOADS_DIR
from core.auth_db import (
    get_all_users,
    add_user,
    update_user,
    reset_user_password,
    delete_user,
    set_user_youtube_access,
)
from core.download_manager import DownloadItem, DownloadType
from core.logging_config import get_logger

logger = get_logger(__name__)

admin_api_bp = Blueprint('admin_api', __name__)


# ============================================
# Admin Cleanup Routes
# ============================================

@admin_api_bp.route('/api/admin/cleanup/downloads', methods=['GET'])
@api_login_required
def admin_get_all_downloads():
    """Get all downloads across all users for admin cleanup interface."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        from core.downloads_db import get_all_downloads_for_admin
        downloads = get_all_downloads_for_admin()
        # Return downloads directly as an array for easier frontend handling
        return jsonify(downloads)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/storage-stats', methods=['GET'])
@api_login_required
def admin_get_storage_stats():
    """Get storage usage statistics for admin dashboard."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        from core.downloads_db import get_storage_usage_stats
        from core.file_cleanup import get_downloads_directory_usage, format_file_size

        db_stats = get_storage_usage_stats()
        fs_stats = get_downloads_directory_usage()

        # Format sizes for display
        stats = {
            'database': db_stats,
            'filesystem': {
                'total_size': format_file_size(fs_stats['total_size']),
                'total_size_bytes': fs_stats['total_size'],
                'total_files': fs_stats['total_files'],
                'audio_size': format_file_size(fs_stats['audio_size']),
                'audio_files': fs_stats['audio_files'],
                'stem_size': format_file_size(fs_stats['stem_size']),
                'stem_files': fs_stats['stem_files'],
                'other_size': format_file_size(fs_stats['other_size']),
                'other_files': fs_stats['other_files']
            }
        }

        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/downloads/<video_id>', methods=['DELETE'])
@api_login_required
def admin_delete_download_by_video_id(video_id):
    """Delete a download completely including all files and database records using video_id."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        # Find the global download by video_id
        from core.downloads_db import get_all_downloads_for_admin, delete_download_completely
        from core.file_cleanup import delete_download_files

        all_downloads = get_all_downloads_for_admin()
        download_info = next((d for d in all_downloads if d['video_id'] == video_id), None)

        if not download_info:
            return jsonify({'error': f'Download with video_id "{video_id}" not found'}), 404

        global_download_id = download_info['global_id']

        # Delete from database first to get download info
        success, message, detailed_info = delete_download_completely(global_download_id)

        if not success:
            return jsonify({'error': message}), 400

        # Clear from all active user sessions so it disappears from their library
        user_session_manager.clear_download_from_all_sessions(video_id)

        file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}

        # Delete associated files if we have download info
        if detailed_info:
            file_success, file_message, file_cleanup_stats = delete_download_files(detailed_info)
            if not file_success:
                print(f"File cleanup warning: {file_message}")

        return jsonify({
            'success': True,
            'message': message,
            'video_id': video_id,
            'file_cleanup': file_cleanup_stats
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/downloads/<video_id>/reload', methods=['POST'])
@api_login_required
def admin_reload_download(video_id):
    """Remove existing artifacts and re-download a video from YouTube as a fresh item."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    video_id = (video_id or "").strip()
    if not video_id:
        return jsonify({'error': 'Invalid video ID'}), 400

    try:
        from core.downloads_db import (
            get_all_downloads_for_admin,
            delete_download_completely,
            get_user_ids_for_video
        )
        from core.file_cleanup import delete_download_files
        from core.aiotube_client import get_aiotube_client

        all_downloads = get_all_downloads_for_admin()
        download_info = next((d for d in all_downloads if d['video_id'] == video_id), None)

        affected_users = []
        file_cleanup_stats = None
        prev_title = None
        prev_quality = 'best'
        prev_media_type = 'audio'

        if download_info:
            prev_title = download_info.get('title')
            prev_quality = download_info.get('quality') or prev_quality
            prev_media_type = download_info.get('media_type') or prev_media_type
            affected_users = get_user_ids_for_video(video_id)

            success, message, detailed_info = delete_download_completely(download_info['global_id'])
            if not success:
                return jsonify({'error': message}), 400

            try:
                file_success, file_message, file_cleanup_stats = delete_download_files(detailed_info)
                if not file_success:
                    logger.warning(f"[ADMIN RELOAD] File cleanup warning for {video_id}: {file_message}")
            except Exception as cleanup_error:
                logger.warning(f"[ADMIN RELOAD] Error during file cleanup for {video_id}: {cleanup_error}")

        # Ensure admin regains access once reload completes
        if download_info and current_user.id not in affected_users:
            affected_users.append(current_user.id)
        if affected_users:
            user_session_manager.schedule_reload_user_access(video_id, affected_users)

        ai_client = get_aiotube_client()
        video_info = ai_client.get_video_info(video_id)
        if video_info.get('error'):
            return jsonify({'error': video_info['error']}), 400

        items = video_info.get('items') or []
        snippet = items[0].get('snippet', {}) if items else {}
        thumbnails = snippet.get('thumbnails') or {}

        title = snippet.get('title') or prev_title or video_id
        thumbnail_url = ''
        for key in ('medium', 'high', 'default'):
            thumb = thumbnails.get(key) or {}
            if thumb.get('url'):
                thumbnail_url = thumb['url']
                break
        if not thumbnail_url:
            thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

        download_type = DownloadType.VIDEO if str(prev_media_type).lower() == 'video' else DownloadType.AUDIO

        dm = user_session_manager.get_download_manager()
        item = DownloadItem(
            video_id=video_id,
            title=title,
            thumbnail_url=thumbnail_url,
            download_type=download_type,
            quality=prev_quality
        )
        download_id = dm.add_download(item)

        return jsonify({
            'success': True,
            'message': f'Reload started for {title}',
            'download_id': download_id,
            'reassigned_users': len(affected_users),
            'file_cleanup': file_cleanup_stats
        })

    except Exception as e:
        logger.error(f"[ADMIN RELOAD] Failed to reload {video_id}: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/downloads/<int:global_download_id>/reset-extraction', methods=['POST'])
@api_login_required
def admin_reset_extraction_status(global_download_id):
    """Reset extraction status for a download while keeping the download record."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        from core.downloads_db import reset_extraction_status, get_all_downloads_for_admin
        from core.file_cleanup import delete_extraction_files_only

        # Get download info before resetting
        all_downloads = get_all_downloads_for_admin()
        download_info = next((d for d in all_downloads if d['global_id'] == global_download_id), None)

        if not download_info:
            return jsonify({'error': 'Download not found'}), 404

        # Reset database status
        success, message = reset_extraction_status(global_download_id)

        if not success:
            return jsonify({'error': message}), 400

        # CRITICAL: Clear extraction from all in-memory sessions
        video_id = download_info.get('video_id')
        if video_id:
            user_session_manager.clear_extraction_from_all_sessions(video_id)

        # Delete extraction files
        file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}
        if download_info.get('extracted'):
            file_success, file_message, file_cleanup_stats = delete_extraction_files_only(download_info)
            if not file_success:
                print(f"File cleanup warning: {file_message}")

        return jsonify({
            'success': True,
            'message': message,
            'file_cleanup': file_cleanup_stats
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/downloads/<video_id>/reset-extraction', methods=['POST'])
@api_login_required
def admin_reset_extraction_by_video_id(video_id):
    """Reset extraction status for ALL downloads with this video_id."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        # FIX: Use reset_extraction_status_by_video_id to reset ALL records with this video_id
        # (not just the first one found, which was causing issues when multiple qualities exist)
        from core.downloads_db import reset_extraction_status_by_video_id, get_all_downloads_for_admin
        from core.file_cleanup import delete_extraction_files_only

        # Get download info for file cleanup (get all records with this video_id)
        all_downloads = get_all_downloads_for_admin()
        matching_downloads = [d for d in all_downloads if d['video_id'] == video_id]

        if not matching_downloads:
            return jsonify({'error': f'Download with video_id "{video_id}" not found'}), 404

        # Reset database status for ALL records with this video_id
        success, message = reset_extraction_status_by_video_id(video_id)

        if not success:
            return jsonify({'error': message}), 400

        # CRITICAL: Clear extraction from all in-memory sessions
        # Without this, the session check finds the old extraction and blocks new ones
        user_session_manager.clear_extraction_from_all_sessions(video_id)

        # Delete extraction files for all matching downloads
        file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}
        for download_info in matching_downloads:
            if download_info.get('extracted'):
                file_success, file_message, single_stats = delete_extraction_files_only(download_info)
                if file_success:
                    file_cleanup_stats['files_deleted'].extend(single_stats.get('files_deleted', []))
                    file_cleanup_stats['total_size_freed'] += single_stats.get('total_size_freed', 0)
                else:
                    print(f"File cleanup warning for {download_info['global_id']}: {file_message}")
                    file_cleanup_stats['errors'].append(file_message)

        return jsonify({
            'success': True,
            'message': message,
            'video_id': video_id,
            'file_cleanup': file_cleanup_stats
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/downloads/bulk-delete', methods=['POST'])
@api_login_required
def admin_bulk_delete_downloads():
    """Bulk delete multiple downloads."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        data = request.json
        download_ids = data.get('download_ids', [])

        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400

        from core.downloads_db import delete_download_completely, get_all_downloads_for_admin
        from core.file_cleanup import delete_download_files

        # Get all downloads info first
        all_downloads = get_all_downloads_for_admin()
        downloads_to_delete = {d['global_id']: d for d in all_downloads if d['global_id'] in download_ids}

        results = []
        total_freed = 0

        for download_id in download_ids:
            try:
                download_info_dict = downloads_to_delete.get(download_id)
                video_id = download_info_dict.get('video_id') if download_info_dict else None

                # Delete from database
                success, message, download_info = delete_download_completely(download_id)

                # Clear from all active user sessions
                if success and video_id:
                    user_session_manager.clear_download_from_all_sessions(video_id)

                file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}

                # Delete files using either the retrieved info or the pre-fetched info
                cleanup_info = download_info or download_info_dict
                if cleanup_info:
                    file_success, file_message, file_cleanup_stats = delete_download_files(cleanup_info)
                    total_freed += file_cleanup_stats['total_size_freed']

                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message,
                    'file_cleanup': file_cleanup_stats
                })

            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': str(e),
                    'file_cleanup': {'files_deleted': [], 'total_size_freed': 0, 'errors': [str(e)]}
                })

        successful_deletions = sum(1 for r in results if r['success'])

        return jsonify({
            'success': True,
            'deleted_count': successful_deletions,
            'total_count': len(download_ids),
            'total_size_freed': total_freed,
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cleanup/downloads/bulk-reset', methods=['POST'])
@api_login_required
def admin_bulk_reset_extractions():
    """Bulk reset extraction status for multiple downloads."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        data = request.json
        download_ids = data.get('download_ids', [])

        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400

        from core.downloads_db import reset_extraction_status, get_all_downloads_for_admin
        from core.file_cleanup import delete_extraction_files_only

        # Get all downloads info first
        all_downloads = get_all_downloads_for_admin()
        downloads_to_reset = {d['global_id']: d for d in all_downloads if d['global_id'] in download_ids}

        results = []
        total_freed = 0

        for download_id in download_ids:
            try:
                download_info_dict = downloads_to_reset.get(download_id)

                # Reset extraction status in database
                success, message, download_info = reset_extraction_status(download_id)

                file_cleanup_stats = {'files_deleted': [], 'total_size_freed': 0, 'errors': []}

                # Delete extraction files (stems) but keep download files
                cleanup_info = download_info or download_info_dict
                if cleanup_info and cleanup_info.get('extracted'):
                    file_success, file_message, file_cleanup_stats = delete_extraction_files_only(cleanup_info)
                    total_freed += file_cleanup_stats['total_size_freed']

                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message,
                    'file_cleanup': file_cleanup_stats
                })

            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': f'Error resetting download: {str(e)}',
                    'file_cleanup': {'files_deleted': [], 'total_size_freed': 0, 'errors': [str(e)]}
                })

        successful_resets = len([r for r in results if r['success']])

        return jsonify({
            'success': True,
            'reset_count': successful_resets,
            'total_count': len(download_ids),
            'total_size_freed': total_freed,
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================
# Admin User Management API
# ============================================

@admin_api_bp.route('/api/admin/users', methods=['GET'])
@api_login_required
@api_admin_required
def api_get_users():
    """Get all users (admin only)."""
    users = get_all_users()
    return jsonify({
        'users': [{
            'id': u['id'],
            'username': u['username'],
            'email': u.get('email'),
            'is_admin': u.get('is_admin', False),
            'youtube_enabled': bool(u.get('youtube_enabled', False))
        } for u in users]
    })


@admin_api_bp.route('/api/admin/users', methods=['POST'])
@api_login_required
@api_admin_required
def api_create_user():
    """Create a new user (admin only)."""
    data = request.json or {}

    username = data.get('username', '').strip()
    password = data.get('password', '')
    email = data.get('email', '').strip() or None
    is_admin = bool(data.get('is_admin', False))
    youtube_enabled = bool(data.get('youtube_enabled', False))

    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    success, message = add_user(username, password, email, is_admin, youtube_enabled)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400


@admin_api_bp.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@api_login_required
@api_admin_required
def api_update_user(user_id):
    """Update user details (admin only)."""
    data = request.json or {}

    username = data.get('username', '').strip()
    email = data.get('email', '').strip() or None
    is_admin = bool(data.get('is_admin', False))
    youtube_enabled = bool(data.get('youtube_enabled', False))

    if not username:
        return jsonify({'error': 'Username is required'}), 400

    success, message = update_user(user_id, username, email, is_admin, youtube_enabled)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400


@admin_api_bp.route('/api/admin/users/<int:user_id>/password', methods=['PUT'])
@api_login_required
@api_admin_required
def api_reset_password(user_id):
    """Reset user password (admin only)."""
    data = request.json or {}
    password = data.get('password', '')

    if not password:
        return jsonify({'error': 'Password is required'}), 400

    success, message = reset_user_password(user_id, password)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400


@admin_api_bp.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@api_login_required
@api_admin_required
def api_delete_user(user_id):
    """Delete a user (admin only)."""
    # Prevent self-deletion
    if user_id == current_user.id:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    success, message = delete_user(user_id)

    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'error': message}), 400


@admin_api_bp.route('/api/admin/users/<int:user_id>/youtube', methods=['PUT'])
@api_login_required
@api_admin_required
def api_toggle_user_youtube(user_id):
    """Toggle YouTube access for a user (admin only)."""
    data = request.json or {}
    enabled = bool(data.get('youtube_enabled', False))

    success, message = set_user_youtube_access(user_id, enabled)

    if success:
        return jsonify({'success': True, 'youtube_enabled': enabled})
    else:
        return jsonify({'error': message}), 400


# ============================================
# System Settings Admin API Routes
# ============================================

@admin_api_bp.route('/api/admin/system-settings', methods=['GET'])
@api_login_required
@api_admin_required
def get_system_settings():
    """Get system settings for admin panel."""
    try:
        # Get current settings from config
        downloads_directory = get_setting('downloads_directory', DOWNLOADS_DIR)
        max_concurrent_downloads = get_setting('max_concurrent_downloads', 3)
        max_concurrent_extractions = get_setting('max_concurrent_extractions', 1)
        use_gpu_for_extraction = get_setting('use_gpu_for_extraction', True)
        lyrics_model_size = get_setting('lyrics_model_size', 'medium')
        default_stem_model = get_setting('default_stem_model', 'htdemucs')

        # Check GPU availability
        gpu_available = False
        gpu_name = None
        try:
            import torch
            gpu_available = torch.cuda.is_available()
            if gpu_available:
                gpu_name = torch.cuda.get_device_name(0)
        except Exception:
            pass

        # Check FFmpeg availability
        ffmpeg_available = False
        ffmpeg_path = None
        try:
            import subprocess
            result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
            if result.returncode == 0:
                ffmpeg_available = True
                # Try to get path
                import shutil
                ffmpeg_path = shutil.which('ffmpeg')
        except Exception:
            pass

        return jsonify({
            'success': True,
            'settings': {
                'downloads_directory': downloads_directory,
                'max_concurrent_downloads': max_concurrent_downloads,
                'max_concurrent_extractions': max_concurrent_extractions,
                'use_gpu_for_extraction': use_gpu_for_extraction,
                'lyrics_model_size': lyrics_model_size,
                'default_stem_model': default_stem_model
            },
            'system_info': {
                'gpu_available': gpu_available,
                'gpu_name': gpu_name,
                'ffmpeg_available': ffmpeg_available,
                'ffmpeg_path': ffmpeg_path
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/system-settings', methods=['POST'])
@api_login_required
@api_admin_required
def update_system_settings():
    """Update system settings (admin only)."""
    try:
        data = request.json or {}
        requires_restart = False
        applied_changes = []

        logger.info(f"[SystemSettings] Received settings update: {data}")

        # Track if downloads directory changed
        current_downloads_dir = get_setting('downloads_directory', DOWNLOADS_DIR)
        new_downloads_dir = data.get('downloads_directory')
        if new_downloads_dir and new_downloads_dir != current_downloads_dir:
            # Validate directory exists or can be created
            try:
                os.makedirs(new_downloads_dir, exist_ok=True)
                update_setting('downloads_directory', new_downloads_dir)
                requires_restart = True
                applied_changes.append('downloads_directory')
                logger.info(f"[SystemSettings] Downloads directory changed to: {new_downloads_dir}")
            except Exception as e:
                return jsonify({'error': f'Invalid downloads directory: {str(e)}'}), 400

        # Update other settings (don't require restart)
        if 'max_concurrent_downloads' in data:
            value = int(data['max_concurrent_downloads'])
            if 1 <= value <= 10:
                update_setting('max_concurrent_downloads', value)
                applied_changes.append('max_concurrent_downloads')
                logger.info(f"[SystemSettings] Max concurrent downloads set to: {value}")

        if 'max_concurrent_extractions' in data:
            value = int(data['max_concurrent_extractions'])
            if 1 <= value <= 5:
                update_setting('max_concurrent_extractions', value)
                applied_changes.append('max_concurrent_extractions')
                logger.info(f"[SystemSettings] Max concurrent extractions set to: {value}")

        if 'use_gpu_for_extraction' in data:
            use_gpu = bool(data['use_gpu_for_extraction'])
            update_setting('use_gpu_for_extraction', use_gpu)
            applied_changes.append('use_gpu_for_extraction')
            logger.info(f"[SystemSettings] Use GPU for extraction set to: {use_gpu}")

            # Apply GPU setting to the stems extractor immediately
            try:
                from core.stems_extractor import get_stems_extractor
                extractor = get_stems_extractor()
                extractor.set_use_gpu(use_gpu)
                logger.info(f"[SystemSettings] GPU setting applied to extractor: {extractor.using_gpu}")
            except Exception as e:
                logger.warning(f"[SystemSettings] Could not apply GPU setting to extractor: {e}")

        if 'lyrics_model_size' in data:
            valid_models = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3']
            if data['lyrics_model_size'] in valid_models:
                update_setting('lyrics_model_size', data['lyrics_model_size'])
                applied_changes.append('lyrics_model_size')
                logger.info(f"[SystemSettings] Lyrics model size set to: {data['lyrics_model_size']}")

        if 'default_stem_model' in data:
            valid_stem_models = ['htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'mdx_extra', 'mdx_extra_q']
            if data['default_stem_model'] in valid_stem_models:
                update_setting('default_stem_model', data['default_stem_model'])
                applied_changes.append('default_stem_model')
                logger.info(f"[SystemSettings] Default stem model set to: {data['default_stem_model']}")

        logger.info(f"[SystemSettings] Applied changes: {applied_changes}")

        return jsonify({
            'success': True,
            'message': 'Settings updated successfully',
            'requires_restart': requires_restart,
            'applied_changes': applied_changes
        })
    except Exception as e:
        logger.error(f"[SystemSettings] Error updating settings: {e}")
        return jsonify({'error': str(e)}), 500


# ============================================
# YouTube Cookies Management API Routes
# ============================================

@admin_api_bp.route('/api/admin/cookies/status', methods=['GET'])
@api_login_required
@api_admin_required
def get_cookies_status():
    """Get YouTube cookies file status."""
    try:
        if os.path.exists(COOKIES_FILE_PATH):
            stat = os.stat(COOKIES_FILE_PATH)
            modified_time = datetime.fromtimestamp(stat.st_mtime)
            age_hours = (datetime.now() - modified_time).total_seconds() / 3600

            # Count cookies and check for auth cookies
            cookie_count = 0
            has_auth_cookies = False
            auth_cookie_names = {'__Secure-3PAPISID', 'SID', 'SAPISID', '__Secure-3PSID', 'HSID', 'SSID'}
            found_auth_cookies = []
            with open(COOKIES_FILE_PATH, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        cookie_count += 1
                        parts = line.split('\t')
                        if len(parts) >= 6:
                            cookie_name = parts[5]
                            if cookie_name in auth_cookie_names:
                                has_auth_cookies = True
                                found_auth_cookies.append(cookie_name)

            return jsonify({
                'success': True,
                'exists': True,
                'cookie_count': cookie_count,
                'has_auth_cookies': has_auth_cookies,
                'auth_cookies_found': found_auth_cookies,
                'modified': modified_time.isoformat(),
                'age_hours': round(age_hours, 1),
                'is_fresh': age_hours < 48,
                'file_size': stat.st_size
            })
        else:
            return jsonify({
                'success': True,
                'exists': False
            })
    except Exception as e:
        logger.error(f"[Cookies] Error checking status: {e}")
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cookies/upload', methods=['POST', 'OPTIONS'])
def upload_cookies():
    """
    Receive cookies from bookmarklet and save as Netscape cookies.txt format.
    This endpoint doesn't require auth as it's called from youtube.com via bookmarklet.
    Instead, it uses a one-time token for security.
    """
    # Handle CORS preflight request
    if request.method == 'OPTIONS':
        response = current_app.make_default_options_response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    try:
        data = request.json or {}
        cookies_raw = data.get('cookies', '')
        domain = data.get('domain', '')
        token = data.get('token', '')

        # Helper to add CORS headers to response
        def cors_response(data, status=200):
            response = jsonify(data)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, status

        # Validate token (stored in session or config)
        expected_token = get_setting('cookies_upload_token', None)
        if not expected_token or token != expected_token:
            return cors_response({'success': False, 'message': 'Invalid or expired token'}, 403)

        # Clear the token after use (one-time)
        update_setting('cookies_upload_token', None)

        if not cookies_raw:
            return cors_response({'success': False, 'message': 'No cookies received'}, 400)

        if '.youtube.com' not in domain and 'youtube.com' not in domain:
            return cors_response({'success': False, 'message': 'Cookies must be from youtube.com'}, 400)

        # Parse cookies and convert to Netscape format
        # Format: domain\tinclude_subdomains\tpath\tsecure\texpiry\tname\tvalue
        lines = ['# Netscape HTTP Cookie File', '# Generated by StemTube Admin', '']

        cookie_pairs = cookies_raw.split('; ')
        for pair in cookie_pairs:
            if '=' in pair:
                name, value = pair.split('=', 1)
                # Standard YouTube cookie entry
                # Use .youtube.com for subdomains
                lines.append(f".youtube.com\tTRUE\t/\tTRUE\t0\t{name}\t{value}")

        # Write to file
        with open(COOKIES_FILE_PATH, 'w') as f:
            f.write('\n'.join(lines))

        cookie_count = len(cookie_pairs)
        logger.info(f"[Cookies] Saved {cookie_count} cookies from bookmarklet")

        return cors_response({
            'success': True,
            'message': f'{cookie_count} YouTube cookies saved!',
            'cookie_count': cookie_count
        })
    except Exception as e:
        logger.error(f"[Cookies] Error uploading: {e}")
        # cors_response is defined inside try, so manually add CORS here
        response = jsonify({'success': False, 'message': str(e)})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500


@admin_api_bp.route('/api/admin/cookies/upload-file', methods=['POST'])
@api_login_required
@api_admin_required
def upload_cookies_file():
    """Upload a Netscape-format cookies.txt file exported from a browser extension."""
    try:
        logger.info(f"[Cookies] Upload file request received. Files: {list(request.files.keys())}, Content-Type: {request.content_type}")
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': 'No file provided'}), 400

        file = request.files['file']
        if not file.filename:
            return jsonify({'success': False, 'message': 'No file selected'}), 400

        content = file.read().decode('utf-8', errors='ignore')

        # Validate Netscape cookie file format
        first_line = content.strip().split('\n')[0].strip()
        if not (first_line.startswith('# Netscape HTTP Cookie File') or
                first_line.startswith('# HTTP Cookie File')):
            return jsonify({
                'success': False,
                'message': 'Invalid format. File must be a Netscape HTTP Cookie File (exported with browser extension like "Get cookies.txt LOCALLY")'
            }), 400

        # Check for YouTube domain cookies
        has_youtube = False
        cookie_count = 0
        auth_cookie_names = {'__Secure-3PAPISID', 'SID', 'SAPISID', '__Secure-3PSID', 'HSID', 'SSID'}
        found_auth_cookies = []

        for line in content.split('\n'):
            line = line.strip()
            if line and not line.startswith('#'):
                cookie_count += 1
                if '.youtube.com' in line or 'youtube.com' in line or '.google.com' in line:
                    has_youtube = True
                parts = line.split('\t')
                if len(parts) >= 6:
                    cookie_name = parts[5]
                    if cookie_name in auth_cookie_names:
                        found_auth_cookies.append(cookie_name)

        if not has_youtube:
            return jsonify({
                'success': False,
                'message': 'No YouTube cookies found in file. Export cookies while on youtube.com'
            }), 400

        # Save the file
        with open(COOKIES_FILE_PATH, 'w') as f:
            f.write(content)

        has_auth = len(found_auth_cookies) > 0
        logger.info(f"[Cookies] Uploaded {cookie_count} cookies from file (auth cookies: {found_auth_cookies})")

        message = f'{cookie_count} cookies uploaded successfully!'
        if not has_auth:
            message += ' WARNING: No authentication cookies found (like __Secure-3PAPISID). Make sure you are logged into YouTube when exporting cookies.'

        return jsonify({
            'success': True,
            'message': message,
            'cookie_count': cookie_count,
            'has_auth_cookies': has_auth,
            'auth_cookies_found': found_auth_cookies
        })
    except Exception as e:
        logger.error(f"[Cookies] Error uploading file: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_api_bp.route('/api/admin/cookies/generate-token', methods=['POST'])
@api_login_required
@api_admin_required
def generate_cookies_token():
    """Generate a one-time token for bookmarklet authentication."""
    try:
        import secrets
        token = secrets.token_urlsafe(32)
        update_setting('cookies_upload_token', token)

        # Token expires after 5 minutes (handled by bookmarklet timeout)
        logger.info("[Cookies] Generated new upload token")

        return jsonify({
            'success': True,
            'token': token
        })
    except Exception as e:
        logger.error(f"[Cookies] Error generating token: {e}")
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cookies/bookmarklet', methods=['GET'])
@api_login_required
@api_admin_required
def get_bookmarklet():
    """Generate bookmarklet code with current server URL."""
    try:
        # Detect server URL
        server_url = request.url_root.rstrip('/')

        # If behind ngrok, use the ngrok URL
        ngrok_url = os.environ.get('NGROK_URL', '')
        if ngrok_url:
            server_url = ngrok_url.rstrip('/')

        # Generate token
        import secrets
        token = secrets.token_urlsafe(32)
        update_setting('cookies_upload_token', token)

        # Bookmarklet JavaScript (minified)
        bookmarklet = f"""javascript:(function(){{
if(!location.hostname.includes('youtube.com')){{alert('Please open this page on YouTube.com first!');return;}}
fetch('{server_url}/api/admin/cookies/upload',{{
method:'POST',
headers:{{'Content-Type':'application/json'}},
body:JSON.stringify({{cookies:document.cookie,domain:location.hostname,token:'{token}'}})
}}).then(r=>r.json()).then(d=>alert(d.message||'Error')).catch(e=>alert('Error: '+e));
}})();"""

        return jsonify({
            'success': True,
            'bookmarklet': bookmarklet,
            'server_url': server_url,
            'instructions': [
                '1. Click "Generate Bookmarklet" below',
                '2. Drag the "\U0001f4e5 StemTube Cookies" link to your bookmarks bar',
                '3. Go to youtube.com and log in to your account',
                '4. Click the bookmarklet in your bookmarks bar',
                '5. Cookies will be automatically sent to the server'
            ]
        })
    except Exception as e:
        logger.error(f"[Cookies] Error generating bookmarklet: {e}")
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/cookies', methods=['DELETE'])
@api_login_required
@api_admin_required
def delete_cookies():
    """Delete the cookies file."""
    try:
        if os.path.exists(COOKIES_FILE_PATH):
            os.remove(COOKIES_FILE_PATH)
            logger.info("[Cookies] Cookies file deleted")
            return jsonify({'success': True, 'message': 'Cookies deleted'})
        else:
            return jsonify({'success': True, 'message': 'No cookies file found'})
    except Exception as e:
        logger.error(f"[Cookies] Error deleting: {e}")
        return jsonify({'error': str(e)}), 500


# ============================================
# Admin System Info
# ============================================

@admin_api_bp.route('/api/admin/system-info', methods=['GET'])
@api_login_required
@api_admin_required
def get_system_info():
    """Get detailed system information."""
    try:
        import platform
        import psutil

        system_info = {
            'platform': platform.system(),
            'platform_version': platform.version(),
            'python_version': platform.python_version(),
            'cpu_count': psutil.cpu_count(),
            'cpu_percent': psutil.cpu_percent(interval=0.1),
            'memory_total': psutil.virtual_memory().total,
            'memory_available': psutil.virtual_memory().available,
            'memory_percent': psutil.virtual_memory().percent
        }

        # GPU info
        try:
            import torch
            system_info['pytorch_version'] = torch.__version__
            system_info['cuda_available'] = torch.cuda.is_available()
            if torch.cuda.is_available():
                system_info['cuda_version'] = torch.version.cuda
                system_info['gpu_name'] = torch.cuda.get_device_name(0)
                system_info['gpu_memory_total'] = torch.cuda.get_device_properties(0).total_memory
                system_info['gpu_memory_allocated'] = torch.cuda.memory_allocated(0)
        except Exception:
            system_info['pytorch_version'] = 'Not available'
            system_info['cuda_available'] = False

        return jsonify({
            'success': True,
            'system_info': system_info
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_api_bp.route('/api/admin/restart-server', methods=['POST'])
@api_login_required
@api_admin_required
def restart_server():
    """Restart the server and ngrok (admin only)."""
    import threading
    import time
    import subprocess

    def delayed_restart():
        time.sleep(1)
        logger.info("Restarting server and ngrok...")

        # Get service name from environment (set in systemd service file)
        service_name = os.environ.get('SYSTEMD_SERVICE_NAME', '')

        if service_name:
            # Use systemctl restart - this is the only reliable method
            # since the server can't restart itself after stopping
            logger.info(f"Restarting via systemctl (service: {service_name})...")
            try:
                subprocess.Popen(['sudo', 'systemctl', 'restart', service_name],
                               start_new_session=True,
                               stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
                return
            except Exception as e:
                logger.error(f"systemctl restart failed: {e}")

        # Fallback: basic Python restart (ngrok will not be restarted)
        logger.warning("SYSTEMD_SERVICE_NAME not set - falling back to basic restart (ngrok will not be restarted)")
        os.execv(sys.executable, [sys.executable] + sys.argv)

    # Start restart in background thread
    restart_thread = threading.Thread(target=delayed_restart)
    restart_thread.daemon = True
    restart_thread.start()

    return jsonify({
        'success': True,
        'message': 'Server is restarting...'
    })
