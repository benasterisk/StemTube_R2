"""
Blueprint for user library management and user cleanup routes.

Covers user view management (remove from list, bulk remove, force remove),
disclaimer status, comprehensive cleanup, and the shared library API.
"""

import os
import json

from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required, user_session_manager
from core.logging_config import get_logger
from core.downloads_db import (
    list_for as db_list_downloads,
    list_extractions_for as db_list_extractions,
    add_user_access as db_add_user_access,
    add_user_extraction_access as db_add_user_extraction_access,
)

logger = get_logger(__name__)

library_bp = Blueprint('library', __name__)


# ------------------------------------------------------------------
# User View Management
# ------------------------------------------------------------------

@library_bp.route('/api/user/downloads/<video_id>/remove-from-list', methods=['DELETE'])
@api_login_required
def remove_download_from_user_list(video_id):
    """Remove a download from user's personal list (keeps file and global record)."""
    try:
        from core.downloads_db import remove_user_download_access
        success, message = remove_user_download_access(current_user.id, video_id)

        if success:
            # Clear any session data for this video
            try:
                dm = user_session_manager.get_download_manager()
                # Remove from all session collections that might contain this video_id
                for collection_name in ['queued_downloads', 'active_downloads', 'failed_downloads', 'completed_downloads']:
                    collection = getattr(dm, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[SESSION CLEANUP] Removed {key} from {collection_name}")
            except Exception as session_error:
                print(f"[SESSION CLEANUP] Warning: {session_error}")

            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'error': message}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/user/extractions/<video_id>/remove-from-list', methods=['DELETE'])
@api_login_required
def remove_extraction_from_user_list(video_id):
    """Remove an extraction from user's personal list (keeps extraction and global record)."""
    try:
        from core.downloads_db import remove_user_extraction_access
        success, message = remove_user_extraction_access(current_user.id, video_id)

        if success:
            # Clear any session data for this video
            try:
                se = user_session_manager.get_stems_extractor()
                # Remove from all session collections that might contain this video_id
                for collection_name in ['queued_extractions', 'active_extractions', 'failed_extractions', 'completed_extractions']:
                    collection = getattr(se, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[SESSION CLEANUP] Removed {key} from {collection_name}")
            except Exception as session_error:
                print(f"[SESSION CLEANUP] Warning: {session_error}")

            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'error': message}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/user/downloads/bulk-remove-from-list', methods=['POST'])
@api_login_required
def bulk_remove_downloads_from_user_list():
    """Remove multiple downloads from user's personal list."""
    try:
        data = request.json
        download_ids = data.get('download_ids', [])

        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400

        from core.downloads_db import remove_user_download_access

        results = []
        successful_removals = 0

        for download_id in download_ids:
            try:
                success, message = remove_user_download_access(current_user.id, download_id)
                if success:
                    successful_removals += 1
                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message
                })
            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': f'Error: {str(e)}'
                })

        return jsonify({
            'success': True,
            'removed_count': successful_removals,
            'total_count': len(download_ids),
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/user/extractions/bulk-remove-from-list', methods=['POST'])
@api_login_required
def bulk_remove_extractions_from_user_list():
    """Remove multiple extractions from user's personal list."""
    try:
        data = request.json
        download_ids = data.get('download_ids', [])  # Note: using download_id for extractions too

        if not download_ids:
            return jsonify({'error': 'No download IDs provided'}), 400

        from core.downloads_db import remove_user_extraction_access

        results = []
        successful_removals = 0

        for download_id in download_ids:
            try:
                success, message = remove_user_extraction_access(current_user.id, download_id)
                if success:
                    successful_removals += 1
                results.append({
                    'download_id': download_id,
                    'success': success,
                    'message': message
                })
            except Exception as e:
                results.append({
                    'download_id': download_id,
                    'success': False,
                    'message': f'Error: {str(e)}'
                })

        return jsonify({
            'success': True,
            'removed_count': successful_removals,
            'total_count': len(download_ids),
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Force removal endpoints for when regular removal doesn't work
@library_bp.route('/api/user/downloads/<video_id>/force-remove', methods=['DELETE'])
@api_login_required
def force_remove_download_from_user_list(video_id):
    """Forcefully remove all access to a video_id (both download and extraction)."""
    try:
        from core.downloads_db import force_remove_all_user_access
        success, message = force_remove_all_user_access(current_user.id, video_id)

        if success:
            # Clear all session data for this video
            try:
                # Clear download manager session data
                dm = user_session_manager.get_download_manager()
                for collection_name in ['queued_downloads', 'active_downloads', 'failed_downloads', 'completed_downloads']:
                    collection = getattr(dm, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[FORCE CLEANUP] Removed {key} from {collection_name}")

                # Clear extraction manager session data
                se = user_session_manager.get_stems_extractor()
                for collection_name in ['queued_extractions', 'active_extractions', 'failed_extractions', 'completed_extractions']:
                    collection = getattr(se, collection_name, {})
                    keys_to_remove = [k for k, v in collection.items() if hasattr(v, 'video_id') and v.video_id == video_id]
                    for key in keys_to_remove:
                        del collection[key]
                        print(f"[FORCE CLEANUP] Removed {key} from {collection_name}")
            except Exception as session_error:
                print(f"[FORCE CLEANUP] Warning: {session_error}")

            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'error': message}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/user/cleanup/comprehensive', methods=['POST'])
@api_login_required
def user_comprehensive_cleanup():
    """Run comprehensive cleanup for the current user's data."""
    try:
        from core.downloads_db import comprehensive_cleanup

        # Run comprehensive cleanup
        comprehensive_cleanup()

        # Clear current user's session data
        try:
            user_session_manager.clear_user_session(current_user.id)
        except Exception as session_error:
            print(f"[USER CLEANUP] Session clear warning: {session_error}")

        return jsonify({
            'success': True,
            'message': 'Comprehensive cleanup completed for your account'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Disclaimer Routes
# ------------------------------------------------------------------

@library_bp.route('/api/user/disclaimer-status', methods=['GET'])
@api_login_required
def get_disclaimer_status():
    """Check if current user has accepted the disclaimer."""
    from core.auth_db import get_user_disclaimer_status

    user_id = current_user.id
    accepted = get_user_disclaimer_status(user_id)

    return jsonify({'accepted': accepted})

@library_bp.route('/api/user/accept-disclaimer', methods=['POST'])
@api_login_required
def accept_disclaimer_route():
    """Record that current user has accepted the disclaimer."""
    from core.auth_db import accept_disclaimer

    user_id = current_user.id
    success = accept_disclaimer(user_id)

    if success:
        return jsonify({'success': True, 'message': 'Disclaimer accepted'})
    else:
        return jsonify({'success': False, 'message': 'Failed to record disclaimer acceptance'}), 500


# ------------------------------------------------------------------
# Library API
# ------------------------------------------------------------------

@library_bp.route('/api/library', methods=['GET'])
@api_login_required
def get_library():
    """Get all global downloads/extractions available to users."""
    try:
        filter_type = request.args.get('filter', 'all')  # 'all', 'downloads', 'extractions'
        search_query = request.args.get('search', '').strip()

        # Get all global downloads
        import sqlite3
        from pathlib import Path
        DB_PATH = Path("stemtubes.db")

        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Base query for global downloads with user access information
            base_query = """
                SELECT
                    gd.*,
                    COUNT(DISTINCT ud.user_id) as user_count,
                    CASE WHEN user_access.user_id IS NOT NULL THEN 1 ELSE 0 END as user_has_access,
                    user_access.file_path as user_file_path,
                    user_access.extracted as user_extracted
                FROM global_downloads gd
                LEFT JOIN user_downloads ud ON gd.id = ud.global_download_id
                LEFT JOIN user_downloads user_access ON gd.id = user_access.global_download_id
                    AND user_access.user_id = ?
            """

            # Add search filter
            where_conditions = []
            params = [current_user.id]

            if search_query:
                where_conditions.append("(gd.title LIKE ? OR gd.video_id LIKE ?)")
                search_param = f"%{search_query}%"
                params.extend([search_param, search_param])

            # Add filter conditions
            if filter_type == 'downloads':
                where_conditions.append("gd.file_path IS NOT NULL")
            elif filter_type == 'extractions':
                where_conditions.append("gd.extracted = 1")

            if where_conditions:
                base_query += " WHERE " + " AND ".join(where_conditions)

            base_query += """
                GROUP BY gd.id
                ORDER BY gd.created_at DESC
            """

            cursor.execute(base_query, params)
            library_items = cursor.fetchall()

            # Format results
            formatted_items = []
            for item in library_items:
                # Determine what's available
                has_download = bool(item['file_path'])
                has_extraction = bool(item['extracted'])

                # Determine user's current access
                user_has_download_access = bool(item['user_has_access'] and item['user_file_path'])
                user_has_extraction_access = bool(item['user_has_access'] and item['user_extracted'])

                # Calculate file size if available
                file_size = None
                if item['file_path'] and os.path.exists(item['file_path']):
                    try:
                        file_size = os.path.getsize(item['file_path'])
                    except:
                        pass

                formatted_item = {
                    'id': item['id'],
                    'video_id': item['video_id'],
                    'title': item['title'],
                    'thumbnail_url': item['thumbnail'],
                    'media_type': item['media_type'],
                    'quality': item['quality'],
                    'created_at': item['created_at'],
                    'user_count': item['user_count'],
                    'file_size': file_size,

                    # Availability flags
                    'has_download': has_download,
                    'has_extraction': has_extraction,

                    # User access flags
                    'user_has_download_access': user_has_download_access,
                    'user_has_extraction_access': user_has_extraction_access,

                    # Action availability
                    'can_add_download': has_download and not user_has_download_access,
                    'can_add_extraction': has_extraction and not user_has_extraction_access,

                    # Badge type for display
                    'badge_type': 'both' if (has_download and has_extraction) else ('download' if has_download else 'extraction')
                }

                formatted_items.append(formatted_item)

            return jsonify({
                'success': True,
                'items': formatted_items,
                'total_count': len(formatted_items),
                'filter': filter_type,
                'search': search_query
            })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/library/<int:global_download_id>/add-download', methods=['POST'])
@api_login_required
def add_library_download_to_user(global_download_id):
    """Add a download from library to user's personal downloads list."""
    try:
        # Get the global download record
        import sqlite3
        from pathlib import Path
        DB_PATH = Path("stemtubes.db")

        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_downloads WHERE id = ?", (global_download_id,))
            global_download = cursor.fetchone()

            if not global_download:
                return jsonify({'error': 'Download not found in library'}), 404

            # Convert to dict for use with existing functions
            global_download = dict(global_download)

        # Check if user already has access to this download
        existing_downloads = db_list_downloads(current_user.id)
        for existing in existing_downloads:
            if existing['global_download_id'] == global_download_id and existing['file_path']:
                return jsonify({'error': 'You already have access to this download'}), 400

        # Add user access to the download
        db_add_user_access(current_user.id, global_download)

        return jsonify({
            'success': True,
            'message': f'Added "{global_download["title"]}" to your downloads'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/library/<int:global_download_id>/add-extraction', methods=['POST'])
@api_login_required
def add_library_extraction_to_user(global_download_id):
    """Add an extraction from library to user's personal extractions list."""
    try:
        # Get the global download record
        import sqlite3
        from pathlib import Path
        DB_PATH = Path("stemtubes.db")

        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_downloads WHERE id = ?", (global_download_id,))
            global_download = cursor.fetchone()

            if not global_download:
                return jsonify({'error': 'Extraction not found in library'}), 404

            # Convert to dict for use with existing functions
            global_download = dict(global_download)

        if not global_download['extracted']:
            return jsonify({'error': 'This item has not been extracted yet'}), 400

        # Check if user already has access to this extraction
        user_extractions = db_list_extractions(current_user.id)
        for existing in user_extractions:
            if existing['global_download_id'] == global_download_id:
                return jsonify({'error': 'You already have access to this extraction'}), 400

        # Add user access to the extraction
        db_add_user_extraction_access(current_user.id, global_download)

        return jsonify({
            'success': True,
            'message': f'Added extraction of "{global_download["title"]}" to your list'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500
