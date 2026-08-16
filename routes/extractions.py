import os
import json
import time
import random

from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import (
    api_login_required, user_session_manager,
    get_model_display_name,
)
from core.logging_config import get_logger, log_with_context
from core.stems_extractor import ExtractionItem, ExtractionStatus
from core.downloads_db import (
    list_extractions_for as db_list_extractions,
    find_global_extraction as db_find_global_extraction,
    find_any_global_extraction as db_find_any_global_extraction,
    find_or_reserve_extraction as db_find_or_reserve_extraction,
    add_user_extraction_access as db_add_user_extraction_access,
    set_user_extraction_in_progress as db_set_user_extraction_in_progress,
)

logger = get_logger(__name__)

extractions_bp = Blueprint('extractions', __name__)


@extractions_bp.route('/api/extractions', methods=['GET'])
@api_login_required
def get_all_extractions():
    """
    Returns:
        - live extractions from the current user manager
        - historical extractions from DB (completed only)
    """
    try:
        se = user_session_manager.get_stems_extractor()

        # Get live extractions from current session
        live = []
        live_video_model_pairs = set()  # Track (video_id, model_name) pairs in live session

        for status in ['active', 'queued', 'completed', 'failed']:
            for item in se.get_all_extractions().get(status, []):
                live.append({
                    'extraction_id': item.extraction_id,
                    'video_id': item.video_id,
                    'title': item.title,
                    'audio_path': item.audio_path,
                    'model_name': get_model_display_name(item.model_name),
                    'selected_stems': item.selected_stems,
                    'two_stem_mode': item.two_stem_mode,
                    'primary_stem': item.primary_stem,
                    'status': item.status.value,
                    'progress': item.progress,
                    'error_message': item.error_message,
                    'output_paths': item.output_paths,
                    'zip_path': item.zip_path,
                    'created_at': item.extraction_id.split('_')[1] if '_' in item.extraction_id else str(int(time.time())),
                    'detected_bpm': getattr(item, 'detected_bpm', None),
                    'detected_key': getattr(item, 'detected_key', None),
                    'analysis_confidence': getattr(item, 'analysis_confidence', None)
                })
                live_video_model_pairs.add((item.video_id, item.model_name))

        # Get historical extractions from database (excluding those in live session)
        history_raw = db_list_extractions(current_user.id)
        with log_with_context(logger, user_id=current_user.id):
            logger.debug(f"Found {len(history_raw)} historical extractions")
        for item in history_raw:
            with log_with_context(logger, video_id=item['video_id']):
                logger.debug(f"Historical extraction: model={item['extraction_model']}, extracted_at={item['extracted_at']}")
        history = []

        for db_item in history_raw:
            # Skip if this extraction is already in the live session
            if (db_item['video_id'], db_item['extraction_model']) in live_video_model_pairs:
                continue

            # Parse JSON fields
            import json
            try:
                stems_paths = json.loads(db_item['stems_paths']) if db_item['stems_paths'] else {}
                # Try to infer selected stems from the paths
                selected_stems = list(stems_paths.keys()) if stems_paths else ['vocals', 'drums', 'bass', 'other']
            except:
                selected_stems = ['vocals', 'drums', 'bass', 'other']
                stems_paths = {}

            # Map database fields to frontend format
            history.append({
                'extraction_id': f"download_{db_item['id']}",  # Use download ID as extraction_id
                'global_download_id': db_item['global_download_id'],  # Add global_download_id for remove functionality
                'video_id': db_item['video_id'],
                'title': db_item['title'],
                'audio_path': db_item['file_path'],  # Use the download file path as audio path
                'model_name': get_model_display_name(db_item['extraction_model']),
                'selected_stems': selected_stems,
                'two_stem_mode': False,  # Not stored in DB, assume false
                'primary_stem': 'vocals',  # Not stored in DB, assume vocals
                'status': 'completed',  # Database items are always completed
                'progress': 100.0,  # Completed items have 100% progress
                'error_message': '',  # No error for completed items
                'output_paths': stems_paths,
                'zip_path': db_item['stems_zip_path'],
                'created_at': db_item['extracted_at'] or db_item['created_at'],
                'detected_bpm': db_item.get('detected_bpm'),
                'detected_key': db_item.get('detected_key'),
                'analysis_confidence': db_item.get('analysis_confidence')
            })

        # Combine live and historical extractions
        all_extractions = live + history

        # Sort by creation time (newest first)
        all_extractions.sort(key=lambda x: x['created_at'], reverse=True)

        return jsonify(all_extractions)

    except Exception as e:
        print(f"Error getting extractions: {e}")
        return jsonify({'error': str(e)}), 500


@extractions_bp.route('/api/extractions/<extraction_id>', methods=['GET'])
@api_login_required
def get_extraction_status(extraction_id):
    # For mixer usage: Always get from database since mixer only loads completed extractions
    from core.downloads_db import get_download_by_id, list_extractions_for

    try:
        # Try direct ID lookup first (download_123 format)
        download_id = extraction_id
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download_data = get_download_by_id(current_user.id, download_id)
        else:
            # Search by multiple criteria for filename-based extraction_id
            download_data = None
            db_extractions = list_extractions_for(current_user.id)

            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''

                # Match by video_id or filename
                if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                    download_data = db_extraction
                    print(f"[API] Found extraction by {'video_id' if video_id == extraction_id else 'filename'}: {extraction_id}")
                    break

        if download_data and download_data.get('extracted'):
            response_data = {
                'extraction_id': extraction_id,
                'video_id': download_data.get('video_id'),
                'audio_path': download_data.get('file_path', ''),
                'file_path': download_data.get('file_path', ''),  # Add for mobile compatibility
                'title': download_data.get('title', 'Unknown Track'),  # Add title
                'stems_paths': download_data.get('stems_paths'),  # Add stems paths JSON
                'model_name': download_data.get('extraction_model', ''),
                'status': 'completed',
                'progress': 100,
                'detected_bpm': download_data.get('detected_bpm'),
                'detected_key': download_data.get('detected_key'),
                'analysis_confidence': download_data.get('analysis_confidence'),
                'chords_data': download_data.get('chords_data'),
                'beat_offset': download_data.get('beat_offset', 0.0),
                'beat_times': download_data.get('beat_times'),
                'beat_positions': download_data.get('beat_positions'),
                'structure_data': download_data.get('structure_data'),
                'lyrics_data': download_data.get('lyrics_data'),
                'music_start_time': download_data.get('music_start_time', 0.0)
            }
            print(f"[API] Returning analysis data for {extraction_id}: BPM={response_data['detected_bpm']}, Key={response_data['detected_key']}, Chords={bool(response_data['chords_data'])}, Structure={bool(response_data['structure_data'])}, Lyrics={bool(response_data['lyrics_data'])}, MusicStart={response_data['music_start_time']}")
            return jsonify(response_data)


    except Exception as e:
        print(f"Error fetching database extraction: {e}")

    # Fallback: try session for active extractions (non-mixer usage)
    item = user_session_manager.get_stems_extractor().get_extraction_status(extraction_id)
    if item:
        response_data = {
            'extraction_id': item.extraction_id,
            'video_id': getattr(item, 'video_id', None),
            'audio_path': item.audio_path,
            'model_name': item.model_name,
            'selected_stems': item.selected_stems,
            'two_stem_mode': item.two_stem_mode,
            'primary_stem': item.primary_stem,
            'status': item.status.value,
            'progress': item.progress,
            'error_message': item.error_message,
            'output_paths': item.output_paths,
            'zip_path': item.zip_path
        }
        return jsonify(response_data)

    return jsonify({'error': 'Extraction not found'}), 404


@extractions_bp.route('/api/extractions', methods=['POST'])
@api_login_required
def add_extraction():
    data = request.json or {}

    # Add retry logic for race conditions
    import time
    import random

    max_retries = 3
    base_delay = 0.1  # 100ms

    for attempt in range(max_retries + 1):
        try:
            video_id = data.get('video_id')
            model_name = data.get('model_name', 'htdemucs')  # Default model
            grant_access_only = data.get('grant_access_only', False)

            print(f"=== EXTRACTION DEBUG START (Attempt {attempt + 1}/{max_retries + 1}) ===")
            print(f"User: {current_user.username} (ID: {current_user.id})")
            print(f"Received data: {data}")
            print(f"Video ID: {video_id}")
            print(f"Model: {model_name}")
            print(f"Grant access only: {grant_access_only}")
            print(f"Audio path: {data.get('audio_path')}")

            # Special case: only grant access to existing extraction
            if grant_access_only:
                if not video_id:
                    return jsonify({'error': 'video_id required for grant_access_only'}), 400

                existing_extraction = db_find_global_extraction(video_id, model_name)
                if existing_extraction:
                    print(f"Granting access to existing extraction for user {current_user.id}")
                    db_add_user_extraction_access(current_user.id, existing_extraction)
                    return jsonify({
                        'extraction_id': f"download_{existing_extraction['id']}",
                        'message': f'Access granted to existing extraction',
                        'existing': True
                    })
                else:
                    return jsonify({'error': 'No extraction found for this video'}), 404

            # Use atomic check/reserve operation to prevent race conditions
            if video_id:
                print(f"Checking/reserving extraction for video_id='{video_id}', model='{model_name}'")
                existing_extraction, reserved = db_find_or_reserve_extraction(video_id, model_name)

                if existing_extraction:
                    print(f"Found existing global extraction! Granting access to user {current_user.id}")
                    # Extraction already exists globally - give user access to it
                    db_add_user_extraction_access(current_user.id, existing_extraction)
                    print(f"=== EXTRACTION DEBUG END (EXISTING GLOBAL) ===")
                    return jsonify({
                        'extraction_id': str(existing_extraction['id']),
                        'message': f'Stems already extracted with {model_name} model',
                        'existing': True
                    })
                elif not reserved:
                    if attempt < max_retries:
                        # Wait with exponential backoff before retrying
                        delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)
                        print(f"Extraction in progress by another user, retrying in {delay:.2f}s...")
                        time.sleep(delay)
                        continue
                    else:
                        print(f"Extraction already in progress by another user")
                        print(f"=== EXTRACTION DEBUG END (IN PROGRESS) ===")
                        return jsonify({
                            'extraction_id': 'in_progress',
                            'message': f'Extraction with {model_name} model already in progress. Please wait.',
                            'existing': True,
                            'in_progress': True
                        })
                # If reserved=True, we can proceed with new extraction
                print(f"Successfully reserved extraction slot")
            else:
                print("WARNING: No video_id provided - cannot check global deduplication!")

            # Since we successfully reserved the extraction slot, we can skip user-specific checks
            # The atomic reservation already handled global deduplication
            break  # Exit retry loop if we get here

        except Exception as e:
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)
                print(f"Database error on attempt {attempt + 1}: {e}, retrying in {delay:.2f}s...")
                time.sleep(delay)
                continue
            else:
                print(f"Failed after {max_retries + 1} attempts: {e}")
                return jsonify({'error': str(e)}), 500

    try:

        # Also check current session extractions (only active/queued ones matter)
        # Failed and completed extractions should be retryable
        print(f"Checking current session extractions...")
        se = user_session_manager.get_stems_extractor()
        all_extractions = se.get_all_extractions()
        print(f"Session extractions: {list(all_extractions.keys())}")

        # Only check actively running extractions (queued or active), not failed/completed
        for status_name in ['active', 'queued']:
            status_list = all_extractions.get(status_name, [])
            print(f"  {status_name}: {len(status_list)} items")
            for item in status_list:
                print(f"    - {item.audio_path} with {item.model_name}")
                # Compare based on audio path and model (since we might not have video_id for all)
                if (item.audio_path == data['audio_path'] and
                    item.model_name == model_name):
                    print(f"Found existing {status_name} session extraction!")
                    print(f"=== EXTRACTION DEBUG END (EXISTING SESSION) ===")
                    return jsonify({
                        'extraction_id': item.extraction_id,
                        'message': 'Extraction already in progress',
                        'existing': True
                    })

        # Log failed/completed counts for debugging
        print(f"  failed: {len(all_extractions.get('failed', []))} items (retryable)")
        print(f"  completed: {len(all_extractions.get('completed', []))} items")

        # No existing extraction found - proceed with new extraction
        print(f"No existing extraction found. Starting new extraction...")
        print(f"Creating ExtractionItem with video_id='{video_id}'")
        item = ExtractionItem(
            audio_path=data['audio_path'],
            model_name=model_name,
            output_dir=data.get('output_dir', os.path.join(
                os.path.dirname(data['audio_path']), 'stems')),
            selected_stems=data['selected_stems'],
            two_stem_mode=data.get('two_stem_mode', False),
            primary_stem=data.get('primary_stem', 'vocals'),
            video_id=video_id or "",  # Store video_id for persistence
            title=data.get('title', "")  # Store title for persistence
        )
        ex_id = se.add_extraction(item)
        print(f"New extraction started with ID: {ex_id}")

        # Set user extraction in progress (global extraction was already reserved)
        if video_id:
            print(f"Marking user extraction as in progress for user_id={current_user.id}, video_id='{video_id}', model='{model_name}'")
            try:
                db_set_user_extraction_in_progress(current_user.id, video_id, model_name)
                print(f"Successfully marked user extraction as in progress")
            except Exception as db_error:
                print(f"Error marking user extraction as in progress: {db_error}")

        print(f"=== EXTRACTION DEBUG END (NEW EXTRACTION) ===")
        return jsonify({'extraction_id': ex_id, 'existing': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@extractions_bp.route('/api/extractions/<extraction_id>', methods=['DELETE'])
@api_login_required
def cancel_extraction(extraction_id):
    ok = user_session_manager.get_stems_extractor().cancel_extraction(extraction_id)
    return jsonify({'success': ok})


@extractions_bp.route('/api/extractions/<extraction_id>/retry', methods=['POST'])
@api_login_required
def retry_extraction(extraction_id):
    try:
        print(f"[DEBUG] Retry extraction requested for: {extraction_id}")
        se = user_session_manager.get_stems_extractor()

        # Debug: print current state
        print(f"[DEBUG] Active extractions: {list(se.active_extractions.keys())}")
        print(f"[DEBUG] Failed extractions: {list(se.failed_extractions.keys())}")
        print(f"[DEBUG] Completed extractions: {list(se.completed_extractions.keys())}")

        extraction = se.get_extraction_status(extraction_id)

        if not extraction:
            print(f"[DEBUG] Extraction not found: {extraction_id}")
            return jsonify({'error': 'Extraction not found'}), 404

        if extraction.status.value not in ['failed', 'cancelled']:
            return jsonify({'error': 'Can only retry failed or cancelled extractions'}), 400

        # Handle the case where a cancelled extraction might still be in active_extractions
        if extraction_id in se.active_extractions and extraction.status.value == 'cancelled':
            # Move it to failed_extractions first
            del se.active_extractions[extraction_id]
            se.failed_extractions[extraction_id] = extraction

        # Reset extraction status and re-add to queue
        extraction.status = ExtractionStatus.QUEUED
        extraction.progress = 0.0
        extraction.error_message = ""
        extraction.output_paths = {}
        extraction.zip_path = None

        # Move from failed to queued
        se.failed_extractions.pop(extraction_id, None)
        se.queued_extractions[extraction_id] = extraction
        se.extraction_queue.put(extraction)

        return jsonify({'success': True, 'extraction_id': extraction_id})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@extractions_bp.route('/api/extractions/<extraction_id>/delete', methods=['DELETE'])
@api_login_required
def delete_extraction(extraction_id):
    try:
        print(f"[DEBUG] Delete extraction requested for: {extraction_id}")
        se = user_session_manager.get_stems_extractor()

        # Debug: print current state
        print(f"[DEBUG] Active extractions: {list(se.active_extractions.keys())}")
        print(f"[DEBUG] Failed extractions: {list(se.failed_extractions.keys())}")
        print(f"[DEBUG] Completed extractions: {list(se.completed_extractions.keys())}")
        print(f"[DEBUG] Queued extractions: {list(se.queued_extractions.keys())}")

        # Remove from all possible locations
        removed = False
        if extraction_id in se.failed_extractions:
            del se.failed_extractions[extraction_id]
            removed = True
        if extraction_id in se.completed_extractions:
            del se.completed_extractions[extraction_id]
            removed = True
        if extraction_id in se.active_extractions:
            del se.active_extractions[extraction_id]
            removed = True
        if extraction_id in se.queued_extractions:
            del se.queued_extractions[extraction_id]
            removed = True

        if not removed:
            return jsonify({'error': 'Extraction not found or cannot be deleted'}), 404

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@extractions_bp.route('/api/extractions/<extraction_id>/create-zip', methods=['POST'])
@api_login_required
def create_zip_for_extraction(extraction_id):
    """Bundle a completed extraction's stems into a ZIP archive.

    Resolution order matters: the in-memory extractor only knows about jobs
    run by THIS process since its last restart, so resolving through it alone
    returned 404 for every song extracted in an earlier session - even though
    the stems were sitting on disk. The database row is the durable source of
    truth (and its WHERE user_id=? IS the ownership check), so try it first
    and keep the in-memory lookup as a fallback for jobs that are still
    finishing.
    """
    import zipfile
    from core.downloads_db import get_download_by_id, update_stems_zip_path

    try:
        stem_paths = {}
        row_id = None
        db_row = None

        # 1) Durable path: the caller's own library row.
        try:
            row_id = int(extraction_id)
        except (TypeError, ValueError):
            row_id = None

        if row_id is not None:
            db_row = get_download_by_id(current_user.id, row_id)
            if db_row and db_row.get('extracted') and db_row.get('stems_paths'):
                try:
                    stem_paths = json.loads(db_row['stems_paths']) or {}
                except (ValueError, TypeError):
                    stem_paths = {}

        # 2) Fallback: an extraction still tracked in this process.
        if not stem_paths:
            se = user_session_manager.get_stems_extractor()
            extraction = se.get_extraction_status(extraction_id)
            if not extraction:
                return jsonify({'error': 'Extraction not found in your records',
                                'success': False}), 404
            if extraction.status.value != 'completed':
                return jsonify({'error': 'Extraction not completed', 'success': False}), 400
            stem_paths = extraction.output_paths or {}

        # Only bundle files that are actually there: a row can outlive its
        # audio (manual cleanup, moved downloads dir).
        present = {name: p for name, p in stem_paths.items() if p and os.path.exists(p)}
        if not present:
            return jsonify({'error': 'No stem files found on disk', 'success': False}), 404

        first = next(iter(present.values()))
        output_dir = os.path.dirname(first)
        # Name the archive after the song, not after the containing folder
        # (which is literally "stems" and yielded "stems_stems.zip").
        base_name = 'stems'
        title = (db_row or {}).get('title') or ''
        safe = ''.join(ch for ch in title if ch.isalnum() or ch in ' ._-').strip()
        if safe:
            base_name = safe[:80]
        zip_path = os.path.join(output_dir, f"{base_name}_stems.zip")

        # Write to a temp name then replace, so a concurrent download never
        # sees a half-written archive.
        tmp_path = zip_path + '.tmp'
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for _stem_name, file_path in present.items():
                zipf.write(file_path, os.path.basename(file_path))
        os.replace(tmp_path, zip_path)

        # Persist it: stems_zip_path was previously only ever set in memory,
        # so the archive was re-zipped on every request and lost on restart.
        if row_id is not None:
            try:
                update_stems_zip_path(current_user.id, row_id, zip_path)
            except Exception as db_error:
                logger.warning(f"Could not persist zip path for row {row_id}: {db_error}")

        logger.info(f"Created stems ZIP for extraction {extraction_id}: "
                    f"{len(present)} stem(s)")
        return jsonify({'success': True, 'zip_path': zip_path,
                        'stem_count': len(present)})

    except Exception as e:
        logger.error(f"Error creating ZIP for {extraction_id}: {e}", exc_info=True)
        return jsonify({'error': str(e), 'success': False}), 500
