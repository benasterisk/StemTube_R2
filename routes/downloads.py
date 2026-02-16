"""
Blueprint for download API routes.

Covers YouTube search, download CRUD, extraction-status checks,
and batch operations.
"""

import json
import time

from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import (
    api_login_required, youtube_access_required,
    user_session_manager, aiotube_client,
    is_valid_youtube_video_id,
)
from core.logging_config import get_logger, log_with_context
from core.download_manager import DownloadItem, DownloadType, DownloadStatus
from core.downloads_db import (
    find_global_download as db_find_global_download,
    add_user_access as db_add_user_access,
    add_user_extraction_access as db_add_user_extraction_access,
    list_for as db_list_downloads,
    list_extractions_for as db_list_extractions,
    find_any_global_extraction as db_find_any_global_extraction,
    delete_from as db_delete_download,
    find_global_extraction as db_find_global_extraction,
    get_user_download_id_by_video_id as db_get_user_download_id,
)

logger = get_logger(__name__)

downloads_bp = Blueprint('downloads', __name__)

# ── YouTube / Search ───────────────────────────────────────────────


@downloads_bp.route('/api/search', methods=['GET'])
@api_login_required
@youtube_access_required
def search_videos():
    query = request.args.get('query', '')
    max_results = int(request.args.get('max_results', 10))
    logger.info(f"Search request: query='{query}', max_results={max_results}")
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    try:
        response = aiotube_client.search_videos(query, max_results=max_results)
        logger.info(f"Returning {len(response.get('items', []))} search results")
        return jsonify(response)
    except Exception as e:
        logger.error(f"Search error: {e}")
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/video/<video_id>', methods=['GET'])
@api_login_required
@youtube_access_required
def get_video_info(video_id):
    info = aiotube_client.get_video_info(video_id)
    return jsonify(info) if info else (jsonify({'error': 'Video not found'}), 404)


# ── Downloads ──────────────────────────────────────────────────────


@downloads_bp.route('/api/downloads', methods=['GET'])
@api_login_required
def get_all_downloads():
    """
    Returns:
        - live downloads from the current user manager
        - historical downloads from DB (completed only)
    """
    try:
        dm = user_session_manager.get_download_manager()

        # Get live downloads from current session
        live = []
        live_video_ids = set()  # Track video IDs in live session

        for status in ['active', 'queued', 'completed', 'failed']:
            for item in dm.get_all_downloads().get(status, []):
                live_item = {
                    'download_id': item.download_id,
                    'video_id': item.video_id,
                    'title': item.title,
                    'thumbnail_url': item.thumbnail_url,
                    'type': item.download_type.value,
                    'quality': item.quality,
                    'status': item.status.value,
                    'progress': item.progress,
                    'speed': item.speed,
                    'eta': item.eta,
                    'file_path': item.file_path,
                    'error_message': item.error_message,
                    'created_at': item.download_id.split('_')[1] if '_' in item.download_id else str(int(time.time())),
                    'detected_bpm': getattr(item, 'detected_bpm', None),
                    'detected_key': getattr(item, 'detected_key', None),
                    'analysis_confidence': getattr(item, 'analysis_confidence', None),
                    # Initialize extraction fields (will be populated from DB for completed downloads)
                    'extracted': False,
                    'stems_paths': None,
                    'extraction_model': None
                }

                # For completed downloads, check database for extraction status
                # This ensures extraction data is included even if download is still in live session
                if status == 'completed' and item.video_id:
                    try:
                        db_data = db_list_downloads(current_user.id)
                        for db_item in db_data:
                            if db_item.get('video_id') == item.video_id:
                                live_item['extracted'] = db_item.get('extracted', False)
                                live_item['stems_paths'] = db_item.get('stems_paths')
                                live_item['extraction_model'] = db_item.get('extraction_model')
                                live_item['global_download_id'] = db_item.get('global_download_id')
                                # Use database ID for completed items to match extraction API
                                live_item['download_id'] = db_item['id']
                                break
                    except Exception as e:
                        logger.warning(f"Could not fetch extraction data for {item.video_id}: {e}")

                live.append(live_item)
                live_video_ids.add(item.video_id)

        # Get historical downloads from database (excluding those in live session)
        history_raw = db_list_downloads(current_user.id)
        history = []

        # Get stems extractor to check for ongoing extractions
        se = user_session_manager.get_stems_extractor()

        for db_item in history_raw:
            # Skip if this video is already in the live session
            if db_item['video_id'] in live_video_ids:
                continue

            # Skip if download was removed (file_path is NULL but extraction might remain)
            if not db_item['file_path']:
                continue

            # Check if extraction is in progress for this download
            status = 'completed'
            progress = 100.0
            extraction_id = None

            # Check all extraction statuses for a match with this video_id
            all_active = se.get_all_extractions().get('active', [])
            all_queued = se.get_all_extractions().get('queued', [])

            # Debug: Log extraction check
            if all_active or all_queued:
                logger.debug(f"Checking extractions for video_id={db_item['video_id']}: {len(all_active)} active, {len(all_queued)} queued")

            for extraction in all_active + all_queued:
                logger.debug(f"  Comparing extraction.video_id='{extraction.video_id}' with db_item video_id='{db_item['video_id']}'")
                if extraction.video_id == db_item['video_id']:
                    # Found ongoing extraction for this download
                    status = extraction.status.value if hasattr(extraction.status, 'value') else str(extraction.status)
                    progress = extraction.progress
                    extraction_id = extraction.extraction_id  # Capture extraction_id for DOM element lookup
                    logger.info(f"Found ongoing extraction for {db_item['video_id']}: extraction_id={extraction_id}, status={status}, progress={progress}")
                    break

            # Map database fields to frontend format
            history.append({
                'download_id': db_item['id'],  # Use database ID as download_id for historical items
                'global_download_id': db_item['global_download_id'],  # Add global_download_id for remove functionality
                'video_id': db_item['video_id'],
                'title': db_item['title'],
                'thumbnail_url': db_item['thumbnail'],  # Map thumbnail -> thumbnail_url
                'type': db_item['media_type'],  # Map media_type -> type
                'quality': db_item['quality'],
                'status': status,  # Update with extraction status if in progress
                'progress': progress,  # Update with extraction progress if in progress
                'extraction_id': extraction_id,  # Include extraction_id for progress bar lookup
                'speed': '',  # No speed for completed items
                'eta': '',  # No ETA for completed items
                'file_path': db_item['file_path'],
                'error_message': '',  # No error for completed items
                'created_at': db_item['created_at'],  # Include creation time
                'detected_bpm': db_item.get('detected_bpm'),
                'detected_key': db_item.get('detected_key'),
                'analysis_confidence': db_item.get('analysis_confidence'),
                # Extraction information
                'extracted': db_item.get('extracted', False),
                'stems_paths': db_item.get('stems_paths'),
                'extraction_model': db_item.get('extraction_model')
            })

        return jsonify(live + history)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/downloads/<download_id>', methods=['GET'])
@api_login_required
def get_download_status(download_id):
    item = user_session_manager.get_download_manager().get_download_status(download_id)
    if not item:
        return jsonify({'error': 'Download not found'}), 404
    return jsonify({
        'download_id': item.download_id,
        'video_id': item.video_id,
        'title': item.title,
        'thumbnail_url': item.thumbnail_url,
        'type': item.download_type.value,
        'quality': item.quality,
        'status': item.status.value,
        'progress': item.progress,
        'speed': item.speed,
        'eta': item.eta,
        'file_path': item.file_path,
        'error_message': item.error_message
    })


@downloads_bp.route('/api/downloads/<video_id>/extraction-status', methods=['GET'])
@api_login_required
def check_video_extraction_status(video_id):
    """Check extraction status for a video_id."""
    try:
        # Check if ANY extraction exists for this video_id (regardless of model)
        # This is better than checking for a specific model since users don't care which model was used
        global_extraction = db_find_any_global_extraction(video_id)

        if not global_extraction:
            return jsonify({
                'exists': False,
                'user_has_access': False,
                'status': 'not_extracted'
            })

        # Check if current user has access to this extraction
        user_extractions = db_list_extractions(current_user.id)
        user_has_access = any(
            ext['video_id'] == video_id and ext.get('extracted') == 1
            for ext in user_extractions
        )

        # DEBUG: Log the check results
        print(f"[API DEBUG] video_id={video_id}, user_id={current_user.id}")
        print(f"[API DEBUG] global_extraction found: model={global_extraction.get('extraction_model')}")
        print(f"[API DEBUG] user_has_access={user_has_access}")
        print(f"[API DEBUG] user_extractions count: {len(user_extractions)}")
        matching = [ext for ext in user_extractions if ext['video_id'] == video_id]
        print(f"[API DEBUG] matching extractions: {len(matching)}")
        if matching:
            print(f"[API DEBUG] first match: extracted={matching[0].get('extracted')}, model={matching[0].get('extraction_model')}")

        # Prepare response
        response_data = {
            'exists': True,
            'user_has_access': user_has_access,
            'status': 'extracted' if user_has_access else 'extracted_no_access',
            'extraction_model': global_extraction.get('extraction_model'),
            'extracted_at': global_extraction.get('extracted_at')
        }

        print(f"[API DEBUG] Returning status: {response_data['status']}")

        # If user has access, include stems information
        if user_has_access:
            # Parse stems_paths JSON if available
            stems_paths_json = global_extraction.get('stems_paths')
            if stems_paths_json:
                try:
                    response_data['stems_paths'] = json.loads(stems_paths_json) if isinstance(stems_paths_json, str) else stems_paths_json
                    response_data['stems_available'] = True
                except:
                    response_data['stems_available'] = False
            else:
                response_data['stems_available'] = False

            # Add ZIP path if available
            zip_path = global_extraction.get('stems_zip_path')
            if zip_path:
                response_data['zip_path'] = zip_path

            # Add extraction ID for creating ZIP on-the-fly if needed
            response_data['extraction_id'] = global_extraction.get('id')

        return jsonify(response_data)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/downloads/batch-extraction-status', methods=['POST'])
@api_login_required
def batch_check_extraction_status():
    """Check extraction status for multiple video_ids at once."""
    try:
        data = request.json or {}
        video_ids = data.get('video_ids', [])

        if not video_ids or not isinstance(video_ids, list):
            return jsonify({'error': 'video_ids array required'}), 400

        # Limit to prevent abuse
        if len(video_ids) > 100:
            video_ids = video_ids[:100]

        # Get all user extractions once (instead of per video)
        user_extractions = db_list_extractions(current_user.id)
        user_extracted_videos = {
            ext['video_id']: ext
            for ext in user_extractions
            if ext.get('extracted') == 1
        }

        results = {}
        for video_id in video_ids:
            # Check if global extraction exists
            global_extraction = db_find_any_global_extraction(video_id)

            if not global_extraction:
                results[video_id] = {
                    'exists': False,
                    'user_has_access': False,
                    'status': 'not_extracted'
                }
                continue

            # Check if user has access
            user_has_access = video_id in user_extracted_videos

            response_data = {
                'exists': True,
                'user_has_access': user_has_access,
                'status': 'extracted' if user_has_access else 'extracted_no_access',
                'extraction_model': global_extraction.get('extraction_model'),
            }

            # If user has access, include stems information
            if user_has_access:
                stems_paths_json = global_extraction.get('stems_paths')
                if stems_paths_json:
                    try:
                        response_data['stems_paths'] = json.loads(stems_paths_json) if isinstance(stems_paths_json, str) else stems_paths_json
                        response_data['stems_available'] = True
                    except:
                        response_data['stems_available'] = False
                else:
                    response_data['stems_available'] = False

                if global_extraction.get('stems_zip_path'):
                    response_data['zip_path'] = global_extraction.get('stems_zip_path')
                response_data['extraction_id'] = global_extraction.get('id')

            results[video_id] = response_data

        return jsonify({'statuses': results})

    except Exception as e:
        logger.error(f"Batch extraction status error: {e}")
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/downloads', methods=['POST'])
@api_login_required
def add_download():
    data = request.json or {}
    required = ['video_id', 'title', 'thumbnail_url', 'download_type', 'quality']
    if any(f not in data for f in required):
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        video_id = data['video_id']

        # DEBUG: Log the received video_id
        with log_with_context(logger, video_id=video_id):
            logger.debug(f"Received video_id (length: {len(video_id)})")
        logger.debug(f"Download request data: {data}")

        # VALIDATE VIDEO ID
        if not is_valid_youtube_video_id(video_id):
            error_msg = f'Invalid YouTube video ID: "{video_id}" (length: {len(video_id)}). YouTube video IDs must be exactly 11 characters long.'
            logger.warning(f"Video ID validation failed: {error_msg}")
            return jsonify({'error': error_msg}), 400

        download_type = DownloadType.AUDIO if str(data['download_type']).lower() == 'audio' else DownloadType.VIDEO
        quality = data['quality']

        # First check if this video exists globally (any user has downloaded it)
        global_download = db_find_global_download(video_id, download_type.value, quality)
        if global_download:
            # File already exists globally - give this user access to it
            db_add_user_access(current_user.id, global_download)

            # Also check if there are any extractions for this video and give user access
            try:
                # Check if the global download has an extraction (using new unified system)
                if global_download.get('extracted') == 1 and global_download.get('extraction_model'):
                    # Grant user access to the existing extraction
                    db_add_user_extraction_access(current_user.id, global_download)
                    print(f"Granted user {current_user.id} access to extraction with model {global_download['extraction_model']}")

            except Exception as e:
                print(f"Warning: Could not grant extraction access: {e}")

            return jsonify({
                'download_id': global_download['id'],
                'message': 'File already downloaded by another user - instant access granted',
                'existing': True,
                'global': True
            })

        # Check if this video is already downloaded by this user (fallback check)
        existing_downloads = db_list_downloads(current_user.id)
        for existing in existing_downloads:
            if existing['video_id'] == video_id and existing['media_type'] == download_type.value:
                # Video already exists for this user - return the database ID as download_id
                return jsonify({
                    'download_id': existing['id'],
                    'message': 'Video already downloaded by you',
                    'existing': True,
                    'global': False
                })

        # Also check current session downloads
        dm = user_session_manager.get_download_manager()
        all_downloads = dm.get_all_downloads()
        for status_list in all_downloads.values():
            for item in status_list:
                if item.video_id == video_id and item.download_type == download_type:
                    # Already in current session
                    return jsonify({
                        'download_id': item.download_id,
                        'message': 'Download already in progress or completed',
                        'existing': True
                    })

        # No existing download found - proceed with new download
        item = DownloadItem(
            video_id=video_id,
            title=data['title'],
            thumbnail_url=data['thumbnail_url'],
            download_type=download_type,
            quality=data['quality']
        )
        dl_id = dm.add_download(item)
        return jsonify({'download_id': dl_id, 'existing': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/downloads/<download_id>', methods=['DELETE'])
@api_login_required
def cancel_download(download_id):
    ok = user_session_manager.get_download_manager().cancel_download(download_id)
    return jsonify({'success': ok})


@downloads_bp.route('/api/downloads/<download_id>/retry', methods=['POST'])
@api_login_required
def retry_download(download_id):
    try:
        dm = user_session_manager.get_download_manager()
        download = dm.get_download_status(download_id)

        if not download:
            return jsonify({'error': 'Download not found'}), 404

        if download.status.value not in ['failed', 'cancelled', 'error']:
            return jsonify({'error': 'Can only retry failed or cancelled downloads'}), 400

        # Reset download status and re-add to queue
        download.status = DownloadStatus.QUEUED
        download.progress = 0.0
        download.speed = ""
        download.eta = ""
        download.error_message = ""
        download.file_path = ""

        # Reset cancel event
        if download.cancel_event:
            download.cancel_event.clear()

        # Move from failed to queued
        dm.failed_downloads.pop(download_id, None)
        dm.queued_downloads[download_id] = download

        # Re-add to the download queue so the worker picks it up
        dm.download_queue.put(download)

        return jsonify({'success': True, 'download_id': download_id})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/downloads/<download_id>/delete', methods=['DELETE'])
@api_login_required
def delete_download(download_id):
    try:
        dm = user_session_manager.get_download_manager()

        # Remove from all possible locations
        removed = False
        if download_id in dm.queued_downloads:
            del dm.queued_downloads[download_id]
            removed = True
        if download_id in dm.active_downloads:
            del dm.active_downloads[download_id]
            removed = True
        if download_id in dm.failed_downloads:
            del dm.failed_downloads[download_id]
            removed = True
        if download_id in dm.completed_downloads:
            del dm.completed_downloads[download_id]
            removed = True

        # Also remove from database if user is authenticated
        db_removed = False
        if current_user and current_user.is_authenticated:
            try:
                # Handle both live downloads (download_id format) and database downloads (id format)
                if download_id.isdigit():
                    # This is a database ID, find the video_id from database first
                    import sqlite3
                    from pathlib import Path
                    DB_PATH = Path("stemtubes.db")
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute('SELECT video_id FROM user_downloads WHERE user_id = ? AND id = ?',
                                  (current_user.id, download_id))
                    result = cursor.fetchone()
                    if result:
                        video_id = result[0]
                        db_delete_download(current_user.id, video_id)
                        db_removed = True
                    conn.close()
                else:
                    # This is a download_id format, extract video_id
                    video_id = download_id.split('_')[0]
                    db_delete_download(current_user.id, video_id)
                    db_removed = True
            except Exception as e:
                print(f"Database delete error: {e}")
                pass  # Ignore database errors

        if not removed and not db_removed:
            return jsonify({'error': 'Download not found or cannot be deleted'}), 404

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@downloads_bp.route('/api/downloads/clear-all', methods=['DELETE'])
@api_login_required
def clear_all_downloads():
    try:
        dm = user_session_manager.get_download_manager()
        se = user_session_manager.get_stems_extractor()

        # Clear all downloads from in-memory manager
        queued_count = len(dm.queued_downloads)
        active_count = len(dm.active_downloads)
        completed_count = len(dm.completed_downloads)
        failed_count = len(dm.failed_downloads)

        dm.queued_downloads.clear()
        dm.active_downloads.clear()
        dm.completed_downloads.clear()
        dm.failed_downloads.clear()

        # Clear all extractions from in-memory manager
        extraction_active_count = len(se.active_extractions)
        extraction_completed_count = len(se.completed_extractions)
        extraction_failed_count = len(se.failed_extractions)

        se.active_extractions.clear()
        se.completed_extractions.clear()
        se.failed_extractions.clear()

        # Clear database for current user
        if current_user and current_user.is_authenticated:
            # Clear downloads from database
            import sqlite3
            from pathlib import Path
            DB_PATH = Path("stemtubes.db")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('DELETE FROM user_downloads WHERE user_id = ?', (current_user.id,))
            db_deleted_count = cursor.rowcount
            conn.commit()
            conn.close()
        else:
            db_deleted_count = 0

        total_cleared = queued_count + active_count + completed_count + failed_count + extraction_active_count + extraction_completed_count + extraction_failed_count

        return jsonify({
            'success': True,
            'cleared': {
                'downloads': {
                    'queued': queued_count,
                    'active': active_count,
                    'completed': completed_count,
                    'failed': failed_count
                },
                'extractions': {
                    'active': extraction_active_count,
                    'completed': extraction_completed_count,
                    'failed': extraction_failed_count
                },
                'database': db_deleted_count,
                'total': total_cleared
            }
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500
