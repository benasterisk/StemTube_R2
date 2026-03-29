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

        # Get all global downloads via SQLAlchemy
        from core.models import db, GlobalDownload, UserDownload
        from sqlalchemy import func, text, and_

        # Subquery: user_count per global_download
        user_count_sq = (
            db.session.query(
                UserDownload.global_download_id,
                func.count(func.distinct(UserDownload.user_id)).label('user_count'),
            )
            .group_by(UserDownload.global_download_id)
            .subquery()
        )

        # Subquery: current user's access row
        user_access_sq = (
            db.session.query(
                UserDownload.global_download_id,
                UserDownload.user_id,
                UserDownload.file_path.label('user_file_path'),
                UserDownload.extracted.label('user_extracted'),
            )
            .filter(UserDownload.user_id == current_user.id)
            .subquery()
        )

        query = (
            db.session.query(
                GlobalDownload,
                func.coalesce(user_count_sq.c.user_count, 0).label('user_count'),
                user_access_sq.c.user_id.label('ua_user_id'),
                user_access_sq.c.user_file_path,
                user_access_sq.c.user_extracted,
            )
            .outerjoin(user_count_sq, GlobalDownload.id == user_count_sq.c.global_download_id)
            .outerjoin(user_access_sq, GlobalDownload.id == user_access_sq.c.global_download_id)
        )

        if search_query:
            search_param = f"%{search_query}%"
            query = query.filter(
                (GlobalDownload.title.ilike(search_param)) |
                (GlobalDownload.video_id.ilike(search_param))
            )

        if filter_type == 'downloads':
            query = query.filter(GlobalDownload.file_path.isnot(None))
        elif filter_type == 'extractions':
            query = query.filter(GlobalDownload.extracted == True)

        query = query.order_by(GlobalDownload.created_at.desc())
        rows = query.all()

        formatted_items = []
        for gd, user_count, ua_user_id, user_file_path, user_extracted in rows:
            has_download = bool(gd.file_path)
            has_extraction = bool(gd.extracted)
            user_has_download_access = bool(ua_user_id and user_file_path)
            user_has_extraction_access = bool(ua_user_id and user_extracted)

            file_size = None
            if gd.file_path and os.path.exists(gd.file_path):
                try:
                    file_size = os.path.getsize(gd.file_path)
                except Exception:
                    pass

            formatted_items.append({
                'id': gd.id,
                'video_id': gd.video_id,
                'title': gd.title,
                'thumbnail_url': gd.thumbnail,
                'media_type': gd.media_type,
                'quality': gd.quality,
                'created_at': gd.created_at,
                'user_count': user_count,
                'file_size': file_size,
                'file_path': gd.file_path if has_download else None,
                'has_download': has_download,
                'has_extraction': has_extraction,
                'user_has_download_access': user_has_download_access,
                'user_has_extraction_access': user_has_extraction_access,
                'can_add_download': has_download and not user_has_download_access,
                'can_add_extraction': has_extraction and not user_has_extraction_access,
                'badge_type': 'both' if (has_download and has_extraction) else ('download' if has_download else 'extraction'),
            })

        return jsonify({
            'success': True,
            'items': formatted_items,
            'total_count': len(formatted_items),
            'filter': filter_type,
            'search': search_query,
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/library/<int:global_download_id>/add-download', methods=['POST'])
@api_login_required
def add_library_download_to_user(global_download_id):
    """Add a download from library to user's personal downloads list."""
    try:
        # Get the global download record via ORM
        from core.models import GlobalDownload, UserDownload, model_to_dict
        gd = GlobalDownload.query.get(global_download_id)
        if not gd:
            return jsonify({'error': 'Download not found in library'}), 404

        global_download = model_to_dict(gd)

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
        # Get the global download record via ORM
        from core.models import GlobalDownload, model_to_dict
        gd = GlobalDownload.query.get(global_download_id)
        if not gd:
            return jsonify({'error': 'Extraction not found in library'}), 404

        global_download = model_to_dict(gd)

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


# ------------------------------------------------------------------
# Global Library Category APIs
# ------------------------------------------------------------------

@library_bp.route('/api/library/global/artists', methods=['GET'])
@api_login_required
def list_global_artists():
    """Return distinct artists from global_downloads with song counts."""
    try:
        from core.models import db, GlobalDownload
        from sqlalchemy import func

        rows = (
            db.session.query(
                func.coalesce(GlobalDownload.artist, '').label('artist'),
                func.count(func.distinct(GlobalDownload.video_id)).label('song_count'),
                func.min(GlobalDownload.thumbnail).label('thumbnail'),
            )
            .filter(
                GlobalDownload.file_path.isnot(None),
                func.coalesce(GlobalDownload.artist, '') != '',
            )
            .group_by(func.coalesce(GlobalDownload.artist, ''))
            .order_by(func.lower(func.coalesce(GlobalDownload.artist, '')))
            .all()
        )

        artists = [
            {'artist': r.artist, 'song_count': r.song_count, 'thumbnail': r.thumbnail}
            for r in rows
        ]
        return jsonify({'success': True, 'artists': artists})
    except Exception as e:
        logger.error(f"list_global_artists error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/global/artists/<path:artist_name>/tracks', methods=['GET'])
@api_login_required
def list_global_artist_tracks(artist_name):
    """Return tracks for a specific artist in the global library."""
    try:
        from core.models import db, GlobalDownload, UserDownload
        from sqlalchemy import func

        user_count_sq = (
            db.session.query(
                UserDownload.global_download_id,
                func.count(func.distinct(UserDownload.user_id)).label('user_count'),
            )
            .group_by(UserDownload.global_download_id)
            .subquery()
        )
        user_access_sq = (
            db.session.query(
                UserDownload.global_download_id,
                UserDownload.user_id,
                UserDownload.file_path.label('user_file_path'),
                UserDownload.extracted.label('user_extracted'),
            )
            .filter(UserDownload.user_id == current_user.id)
            .subquery()
        )

        rows = (
            db.session.query(
                GlobalDownload,
                func.coalesce(user_count_sq.c.user_count, 0).label('user_count'),
                user_access_sq.c.user_id.label('ua_user_id'),
                user_access_sq.c.user_file_path,
                user_access_sq.c.user_extracted,
            )
            .outerjoin(user_count_sq, GlobalDownload.id == user_count_sq.c.global_download_id)
            .outerjoin(user_access_sq, GlobalDownload.id == user_access_sq.c.global_download_id)
            .filter(
                GlobalDownload.file_path.isnot(None),
                func.coalesce(GlobalDownload.artist, '') == artist_name,
            )
            .order_by(func.lower(GlobalDownload.title))
            .all()
        )

        items = []
        for gd, user_count, ua_user_id, user_file_path, user_extracted in rows:
            has_download = bool(gd.file_path)
            has_extraction = bool(gd.extracted)
            user_has_download_access = bool(ua_user_id and user_file_path)
            user_has_extraction_access = bool(ua_user_id and user_extracted)

            items.append({
                'id': gd.id,
                'video_id': gd.video_id,
                'title': gd.title,
                'artist': gd.artist,
                'album': gd.album,
                'duration': gd.duration,
                'thumbnail_url': gd.thumbnail,
                'thumbnail': gd.thumbnail,
                'media_type': gd.media_type,
                'quality': gd.quality,
                'created_at': gd.created_at,
                'user_count': user_count,
                'file_path': gd.file_path if has_download else None,
                'has_download': has_download,
                'has_extraction': has_extraction,
                'extracted': has_extraction,
                'user_has_download_access': user_has_download_access,
                'user_has_extraction_access': user_has_extraction_access,
                'can_add_download': has_download and not user_has_download_access,
                'can_add_extraction': has_extraction and not user_has_extraction_access,
                'badge_type': 'both' if (has_download and has_extraction) else ('download' if has_download else 'extraction'),
            })

        return jsonify({'success': True, 'items': items})
    except Exception as e:
        logger.error(f"list_global_artist_tracks error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/global/stems', methods=['GET'])
@api_login_required
def list_global_stems():
    """Return only extracted tracks from global_downloads."""
    try:
        from core.models import db, GlobalDownload, UserDownload
        from sqlalchemy import func

        search_query = request.args.get('search', '').strip()

        user_count_sq = (
            db.session.query(
                UserDownload.global_download_id,
                func.count(func.distinct(UserDownload.user_id)).label('user_count'),
            )
            .group_by(UserDownload.global_download_id)
            .subquery()
        )
        user_access_sq = (
            db.session.query(
                UserDownload.global_download_id,
                UserDownload.user_id,
                UserDownload.file_path.label('user_file_path'),
                UserDownload.extracted.label('user_extracted'),
            )
            .filter(UserDownload.user_id == current_user.id)
            .subquery()
        )

        query = (
            db.session.query(
                GlobalDownload,
                func.coalesce(user_count_sq.c.user_count, 0).label('user_count'),
                user_access_sq.c.user_id.label('ua_user_id'),
                user_access_sq.c.user_file_path,
                user_access_sq.c.user_extracted,
            )
            .outerjoin(user_count_sq, GlobalDownload.id == user_count_sq.c.global_download_id)
            .outerjoin(user_access_sq, GlobalDownload.id == user_access_sq.c.global_download_id)
            .filter(GlobalDownload.extracted == True)
        )

        if search_query:
            search_param = f"%{search_query}%"
            query = query.filter(
                (GlobalDownload.title.ilike(search_param)) |
                (GlobalDownload.artist.ilike(search_param))
            )

        rows = query.order_by(GlobalDownload.created_at.desc()).all()

        items = []
        for gd, user_count, ua_user_id, user_file_path, user_extracted in rows:
            has_download = bool(gd.file_path)
            has_extraction = bool(gd.extracted)
            user_has_download_access = bool(ua_user_id and user_file_path)
            user_has_extraction_access = bool(ua_user_id and user_extracted)

            file_size = None
            if gd.file_path and os.path.exists(gd.file_path):
                try:
                    file_size = os.path.getsize(gd.file_path)
                except Exception:
                    pass

            items.append({
                'id': gd.id,
                'video_id': gd.video_id,
                'title': gd.title,
                'artist': gd.artist,
                'thumbnail_url': gd.thumbnail,
                'thumbnail': gd.thumbnail,
                'media_type': gd.media_type,
                'quality': gd.quality,
                'created_at': gd.created_at,
                'user_count': user_count,
                'file_size': file_size,
                'file_path': gd.file_path if has_download else None,
                'has_download': has_download,
                'has_extraction': has_extraction,
                'extracted': has_extraction,
                'extraction_model': gd.extraction_model,
                'user_has_download_access': user_has_download_access,
                'user_has_extraction_access': user_has_extraction_access,
                'can_add_download': has_download and not user_has_download_access,
                'can_add_extraction': has_extraction and not user_has_extraction_access,
                'badge_type': 'both' if (has_download and has_extraction) else ('download' if has_download else 'extraction'),
            })

        return jsonify({
            'success': True,
            'items': items,
            'total_count': len(items),
        })
    except Exception as e:
        logger.error(f"list_global_stems error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/global/albums/singles', methods=['GET'])
@api_login_required
def list_global_singles():
    """Return tracks with no album in the global library."""
    try:
        from core.models import db, GlobalDownload, UserDownload
        from sqlalchemy import func

        user_count_sq = (
            db.session.query(
                UserDownload.global_download_id,
                func.count(func.distinct(UserDownload.user_id)).label('user_count'),
            )
            .group_by(UserDownload.global_download_id)
            .subquery()
        )
        user_access_sq = (
            db.session.query(
                UserDownload.global_download_id,
                UserDownload.user_id,
                UserDownload.file_path.label('user_file_path'),
                UserDownload.extracted.label('user_extracted'),
            )
            .filter(UserDownload.user_id == current_user.id)
            .subquery()
        )

        rows = (
            db.session.query(
                GlobalDownload,
                func.coalesce(user_count_sq.c.user_count, 0).label('user_count'),
                user_access_sq.c.user_id.label('ua_user_id'),
                user_access_sq.c.user_file_path,
                user_access_sq.c.user_extracted,
            )
            .outerjoin(user_count_sq, GlobalDownload.id == user_count_sq.c.global_download_id)
            .outerjoin(user_access_sq, GlobalDownload.id == user_access_sq.c.global_download_id)
            .filter(
                GlobalDownload.file_path.isnot(None),
                GlobalDownload.album_id.is_(None),
            )
            .order_by(func.lower(GlobalDownload.title))
            .all()
        )

        items = []
        for gd, user_count, ua_user_id, user_file_path, user_extracted in rows:
            has_download = bool(gd.file_path)
            has_extraction = bool(gd.extracted)
            user_has_download_access = bool(ua_user_id and user_file_path)
            user_has_extraction_access = bool(ua_user_id and user_extracted)

            items.append({
                'id': gd.id,
                'video_id': gd.video_id,
                'title': gd.title,
                'artist': gd.artist,
                'thumbnail_url': gd.thumbnail,
                'thumbnail': gd.thumbnail,
                'media_type': gd.media_type,
                'created_at': gd.created_at,
                'user_count': user_count,
                'file_path': gd.file_path if has_download else None,
                'has_download': has_download,
                'has_extraction': has_extraction,
                'extracted': has_extraction,
                'user_has_download_access': user_has_download_access,
                'user_has_extraction_access': user_has_extraction_access,
                'can_add_download': has_download and not user_has_download_access,
                'can_add_extraction': has_extraction and not user_has_extraction_access,
                'badge_type': 'both' if (has_download and has_extraction) else ('download' if has_download else 'extraction'),
            })

        return jsonify({'success': True, 'items': items})
    except Exception as e:
        logger.error(f"list_global_singles error: {e}")
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Library Views API (Playlists, Albums, Tracks, Stems, Queue)
# ------------------------------------------------------------------

@library_bp.route('/api/library/albums', methods=['GET'])
@api_login_required
def list_user_albums():
    """Return albums for the current user's library, plus a singles count."""
    try:
        from core.db.albums import list_albums_for_user
        from core.models import db, UserDownload, GlobalDownload
        from sqlalchemy import func

        albums = list_albums_for_user(current_user.id)

        # Count tracks with no album_id (singles)
        singles_count = (
            db.session.query(func.count(func.distinct(UserDownload.video_id)))
            .join(GlobalDownload, UserDownload.global_download_id == GlobalDownload.id)
            .filter(
                UserDownload.user_id == current_user.id,
                GlobalDownload.album_id.is_(None),
                GlobalDownload.file_path.isnot(None),
            )
            .scalar()
        ) or 0

        return jsonify({
            'success': True,
            'albums': albums,
            'singles_count': singles_count,
        })
    except Exception as e:
        logger.error(f"list_user_albums error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/albums/<int:album_id>/tracks', methods=['GET'])
@api_login_required
def get_user_album_tracks(album_id):
    """Return tracks for a specific album in the user's library."""
    try:
        from core.db.albums import get_album_tracks
        tracks = get_album_tracks(album_id, user_id=current_user.id)
        return jsonify({'success': True, 'tracks': tracks})
    except Exception as e:
        logger.error(f"get_user_album_tracks error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/albums/singles', methods=['GET'])
@api_login_required
def get_user_singles():
    """Return tracks with no album for the current user."""
    try:
        from core.models import db, GlobalDownload, UserDownload
        from sqlalchemy import func

        rows = (
            db.session.query(
                GlobalDownload.video_id,
                GlobalDownload.title,
                GlobalDownload.artist,
                GlobalDownload.album,
                GlobalDownload.duration,
                GlobalDownload.thumbnail,
                GlobalDownload.extracted,
                GlobalDownload.extraction_model,
                GlobalDownload.detected_bpm,
                GlobalDownload.detected_key,
                GlobalDownload.file_path,
                UserDownload.id.label('download_id'),
            )
            .join(UserDownload, (UserDownload.global_download_id == GlobalDownload.id) & (UserDownload.user_id == current_user.id))
            .filter(
                GlobalDownload.album_id.is_(None),
                GlobalDownload.file_path.isnot(None),
            )
            .order_by(func.lower(GlobalDownload.title))
            .all()
        )

        tracks = [
            {
                'video_id': r.video_id, 'title': r.title, 'artist': r.artist,
                'album': r.album, 'duration': r.duration, 'thumbnail': r.thumbnail,
                'extracted': r.extracted, 'extraction_model': r.extraction_model,
                'detected_bpm': r.detected_bpm, 'detected_key': r.detected_key,
                'file_path': r.file_path, 'download_id': r.download_id,
            }
            for r in rows
        ]
        return jsonify({'success': True, 'tracks': tracks})
    except Exception as e:
        logger.error(f"get_user_singles error: {e}")
        return jsonify({'error': str(e)}), 500

@library_bp.route('/api/library/artists', methods=['GET'])
@api_login_required
def list_artists():
    """Return unique artists with song counts for the current user."""
    try:
        from core.models import db, GlobalDownload, UserDownload
        from sqlalchemy import func

        artist_col = func.coalesce(GlobalDownload.artist, UserDownload.artist)

        rows = (
            db.session.query(
                artist_col.label('artist'),
                func.count(func.distinct(UserDownload.video_id)).label('song_count'),
                func.min(func.coalesce(GlobalDownload.thumbnail, UserDownload.thumbnail)).label('thumbnail'),
            )
            .outerjoin(GlobalDownload, UserDownload.global_download_id == GlobalDownload.id)
            .filter(
                UserDownload.user_id == current_user.id,
                artist_col.isnot(None),
                artist_col != '',
            )
            .group_by(artist_col)
            .order_by(func.lower(artist_col))
            .all()
        )

        artists = [{'artist': r.artist, 'song_count': r.song_count, 'thumbnail': r.thumbnail} for r in rows]
        return jsonify({'success': True, 'artists': artists})
    except Exception as e:
        logger.error(f"list_artists error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/songs', methods=['GET'])
@api_login_required
def list_songs():
    """Return all songs for the current user with metadata."""
    try:
        downloads = db_list_downloads(current_user.id)
        songs = [{
            'id': d['id'], 'video_id': d['video_id'], 'title': d.get('title', ''),
            'artist': d.get('artist', ''), 'album': d.get('album', ''),
            'duration': d.get('duration'), 'thumbnail': d.get('thumbnail', ''),
            'detected_bpm': d.get('detected_bpm'), 'detected_key': d.get('detected_key'),
            'extracted': d.get('extracted', False), 'extraction_model': d.get('extraction_model'),
            'file_path': d.get('file_path'), 'created_at': d.get('created_at'),
        } for d in downloads if d.get('file_path')]
        return jsonify({'success': True, 'songs': songs})
    except Exception as e:
        logger.error(f"list_songs error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/extracted', methods=['GET'])
@api_login_required
def list_extracted():
    """Return only extracted tracks for the current user."""
    try:
        extractions = db_list_extractions(current_user.id)
        songs = [{
            'id': d['id'], 'video_id': d['video_id'], 'title': d.get('title', ''),
            'artist': d.get('artist', ''), 'album': d.get('album', ''),
            'duration': d.get('duration'), 'thumbnail': d.get('thumbnail', ''),
            'detected_bpm': d.get('detected_bpm'), 'detected_key': d.get('detected_key'),
            'extracted': True, 'extraction_model': d.get('extraction_model'),
            'file_path': d.get('file_path'), 'stems_paths': d.get('stems_paths'),
        } for d in extractions]
        return jsonify({'success': True, 'songs': songs})
    except Exception as e:
        logger.error(f"list_extracted error: {e}")
        return jsonify({'error': str(e)}), 500


@library_bp.route('/api/library/queue', methods=['POST'])
@api_login_required
def get_queue_metadata():
    """Return file paths and metadata for a list of video_ids (playlist player)."""
    try:
        data = request.get_json(silent=True) or {}
        video_ids = data.get('video_ids', [])
        if not video_ids:
            return jsonify({'error': 'video_ids required'}), 400

        downloads = db_list_downloads(current_user.id)
        dl_map = {d['video_id']: d for d in downloads}

        queue = []
        for vid in video_ids:
            d = dl_map.get(vid)
            if d and d.get('file_path'):
                queue.append({
                    'video_id': vid, 'title': d.get('title', ''),
                    'artist': d.get('artist', ''), 'album': d.get('album', ''),
                    'duration': d.get('duration'), 'thumbnail': d.get('thumbnail', ''),
                    'file_path': d.get('file_path'),
                })
        return jsonify({'success': True, 'queue': queue})
    except Exception as e:
        logger.error(f"get_queue_metadata error: {e}")
        return jsonify({'error': str(e)}), 500
