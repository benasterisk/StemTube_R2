"""
Extraction tracking and status management.

Uses SQLAlchemy ORM and PostgreSQL-compatible constructs.
"""
import json

from sqlalchemy import text

from core.models import db, GlobalDownload, UserDownload, model_to_dict
from core.db.connection import _resolve_paths_in_record


def find_global_extraction(video_id, model_name):
    """Check if an extraction already exists globally for a video with a specific model."""
    print(f"[DB DEBUG] Searching for extraction: video_id='{video_id}', model='{model_name}'")

    gd = GlobalDownload.query.filter_by(
        video_id=video_id, extracted=True, extraction_model=model_name
    ).first()

    if gd:
        print(f"[DB DEBUG] Found global extraction: id={gd.id}, extracted={gd.extracted}")
    else:
        print(f"[DB DEBUG] No global extraction found for video_id='{video_id}', model='{model_name}'")
        # Debug: Check what extractions DO exist for this video_id
        debug_results = GlobalDownload.query.filter_by(video_id=video_id).all()
        print(f"[DB DEBUG] All records for video_id '{video_id}': "
              f"{[(r.id, r.video_id, r.extracted, r.extraction_model) for r in debug_results]}")

    return model_to_dict(gd)


def find_any_global_extraction(video_id):
    """Check if ANY extraction exists for a video_id, regardless of model.

    This is useful for UI detection where users don't care which model was used.
    Returns the first extraction found.
    """
    print(f"[DB DEBUG] Searching for any extraction: video_id='{video_id}'")

    gd = GlobalDownload.query.filter_by(
        video_id=video_id, extracted=True
    ).first()

    if gd:
        print(f"[DB DEBUG] Found extraction: id={gd.id}, model={gd.extraction_model}")
    else:
        print(f"[DB DEBUG] No extraction found for video_id='{video_id}'")

    return model_to_dict(gd)


def find_or_reserve_extraction(video_id, model_name):
    """Atomically check for existing extraction or reserve it for processing.

    Returns:
        tuple: (existing_extraction_dict or None, reserved_successfully: bool)
        - If existing extraction found: (extraction_dict, False)
        - If successfully reserved: (None, True)
        - If already reserved by another process: (None, False)
    """
    print(f"[DB DEBUG] Atomic check/reserve for video_id='{video_id}', model='{model_name}'")

    try:
        # Row-level lock for atomicity (PostgreSQL FOR UPDATE)
        gd = GlobalDownload.query.filter_by(
            video_id=video_id
        ).with_for_update().first()

        if not gd:
            print(f"[DB DEBUG] Could not reserve - no matching download record found")
            db.session.rollback()
            return None, False

        # Check for completed extraction
        if gd.extracted and gd.extraction_model == model_name:
            print(f"[DB DEBUG] Found existing completed extraction")
            result = model_to_dict(gd)
            db.session.rollback()
            return result, False

        # Check for in-progress extraction
        if gd.extracting and gd.extraction_model == model_name:
            print(f"[DB DEBUG] Found extraction already in progress")
            db.session.rollback()
            return None, False

        # No existing or in-progress extraction - try to reserve it
        if not gd.extracting:
            gd.extracting = True
            gd.extraction_model = model_name
            db.session.commit()
            print(f"[DB DEBUG] Successfully reserved extraction")
            return None, True
        else:
            # Already extracting with a different model
            print(f"[DB DEBUG] Could not reserve - extraction in progress with different model")
            db.session.rollback()
            return None, False

    except Exception as e:
        print(f"[DB DEBUG] Error in atomic operation: {e}")
        db.session.rollback()
        raise


def find_global_extraction_in_progress(video_id, model_name):
    """Check if an extraction is currently in progress for a video with a specific model."""
    gd = GlobalDownload.query.filter_by(
        video_id=video_id, extracting=True, extraction_model=model_name
    ).first()
    return model_to_dict(gd)


def set_extraction_in_progress(video_id, model_name):
    """Mark an extraction as in progress."""
    GlobalDownload.query.filter_by(video_id=video_id).update({
        'extracting': True,
        'extraction_model': model_name,
    })
    db.session.commit()


def clear_extraction_in_progress(video_id, user_id=None):
    """Clear the extraction in progress flag from both global and user tables.

    Args:
        video_id: The video ID to clear extraction status for
        user_id: Optional user ID. If provided, clears only that user's flag.
                 If None, clears flags for all users.
    """
    # Clear global flag
    GlobalDownload.query.filter_by(video_id=video_id).update({
        'extracting': False,
    })

    # Also clear user-specific flag(s)
    if user_id:
        UserDownload.query.filter_by(
            video_id=video_id, user_id=user_id
        ).update({'extracting': False})
    else:
        # Clear for all users if no specific user provided
        UserDownload.query.filter_by(
            video_id=video_id
        ).update({'extracting': False})

    db.session.commit()


def mark_extraction_complete(video_id, extraction_data):
    """Mark a global download as extracted with stems information."""
    print(f"[DB DEBUG] Marking extraction complete for video_id='{video_id}', "
          f"model='{extraction_data['model_name']}'")

    try:
        # Debug: check existing record
        gd = GlobalDownload.query.filter_by(video_id=video_id).first()
        if gd:
            print(f"[DB DEBUG] Found existing global download: id={gd.id}, video_id='{gd.video_id}'")
        else:
            print(f"[DB DEBUG] WARNING: No global download found for video_id='{video_id}'")

        stems_paths_json = json.dumps(extraction_data["stems_paths"])
        zip_path = extraction_data.get("zip_path", "")

        # Update global_downloads
        result = db.session.execute(text("""
            UPDATE global_downloads
            SET extracted = true,
                extracting = false,
                extraction_model = :model_name,
                stems_paths = :stems_paths,
                stems_zip_path = :zip_path,
                extracted_at = CURRENT_TIMESTAMP
            WHERE video_id = :video_id
        """), {
            'model_name': extraction_data["model_name"],
            'stems_paths': stems_paths_json,
            'zip_path': zip_path,
            'video_id': video_id,
        })
        rows_affected = result.rowcount
        print(f"[DB DEBUG] Updated {rows_affected} rows in global_downloads")

        # Also update all user_downloads records for this video
        db.session.execute(text("""
            UPDATE user_downloads
            SET extracted = true,
                extracting = false,
                extraction_model = :model_name,
                stems_paths = :stems_paths,
                stems_zip_path = :zip_path,
                extracted_at = CURRENT_TIMESTAMP
            WHERE video_id = :video_id
        """), {
            'model_name': extraction_data["model_name"],
            'stems_paths': stems_paths_json,
            'zip_path': zip_path,
            'video_id': video_id,
        })

        db.session.commit()
        print(f"[DB DEBUG] Successfully marked extraction complete and committed transaction")

    except Exception as e:
        print(f"[DB DEBUG] Error marking extraction complete: {e}")
        db.session.rollback()
        raise


def add_user_extraction_access(user_id, global_download):
    """Give a user access to an existing extraction by updating their user_downloads record."""
    print(f"[DB DEBUG] Adding user extraction access: user_id={user_id}, "
          f"video_id='{global_download['video_id']}'")

    # Check if user already has any records for this video_id
    existing_records = UserDownload.query.filter_by(
        user_id=user_id, video_id=global_download["video_id"]
    ).order_by(UserDownload.created_at.desc()).all()

    print(f"[DB DEBUG] Found {len(existing_records)} existing records for this video")

    if existing_records:
        # Update the most recent record with extraction data
        best_record = existing_records[0]
        print(f"[DB DEBUG] Updating existing record ID {best_record.id} with extraction data")

        best_record.extracted = True
        best_record.extracting = False
        best_record.extraction_model = global_download["extraction_model"]
        best_record.stems_paths = global_download["stems_paths"]
        best_record.stems_zip_path = global_download["stems_zip_path"]
        best_record.extracted_at = global_download["extracted_at"]

        # Delete any duplicate records for the same user/video
        if len(existing_records) > 1:
            duplicate_ids = [record.id for record in existing_records[1:]]
            print(f"[DB DEBUG] Cleaning up {len(duplicate_ids)} duplicate records: {duplicate_ids}")
            for dup_id in duplicate_ids:
                UserDownload.query.filter_by(id=dup_id).delete()

    else:
        # Create new user access record (extraction-only, no download data)
        print(f"[DB DEBUG] Creating new extraction-only record")
        new_record = UserDownload(
            user_id=user_id,
            global_download_id=global_download["id"],
            video_id=global_download["video_id"],
            title=global_download["title"],
            thumbnail=global_download["thumbnail"],
            file_path=None,
            media_type=None,
            quality=None,
            extracted=True,
            extraction_model=global_download["extraction_model"],
            stems_paths=global_download["stems_paths"],
            stems_zip_path=global_download["stems_zip_path"],
            extracted_at=global_download["extracted_at"],
        )
        db.session.add(new_record)

    db.session.commit()


def set_user_extraction_in_progress(user_id, video_id, model_name):
    """Mark an extraction as in progress for a specific user."""
    UserDownload.query.filter_by(
        user_id=user_id, video_id=video_id
    ).update({
        'extracting': True,
        'extraction_model': model_name,
    })
    db.session.commit()


def list_extractions_for(user_id):
    """Return all downloads with extractions for a given user, newest first."""
    result = db.session.execute(text("""
        SELECT
            ud.id,
            ud.user_id,
            ud.video_id,
            COALESCE(gd.title, ud.title) as title,
            ud.file_path,
            ud.media_type,
            ud.quality,
            COALESCE(gd.thumbnail, ud.thumbnail) as thumbnail,
            ud.created_at,
            ud.extracted,
            ud.extracting,
            ud.extracted_at,
            ud.extraction_model,
            ud.stems_paths,
            ud.stems_zip_path,
            ud.global_download_id,
            COALESCE(gd.detected_bpm, ud.detected_bpm) as detected_bpm,
            COALESCE(gd.detected_key, ud.detected_key) as detected_key,
            COALESCE(gd.analysis_confidence, ud.analysis_confidence) as analysis_confidence,
            COALESCE(gd.chords_data, ud.chords_data) as chords_data,
            COALESCE(gd.beat_offset, ud.beat_offset) as beat_offset,
            COALESCE(gd.structure_data, ud.structure_data) as structure_data,
            COALESCE(gd.lyrics_data, ud.lyrics_data) as lyrics_data,
            COALESCE(gd.beat_times, ud.beat_times) as beat_times,
            COALESCE(gd.beat_positions, ud.beat_positions) as beat_positions,
            COALESCE(gd.music_start_time, ud.music_start_time) as music_start_time,
            COALESCE(gd.artist, ud.artist) as artist,
            COALESCE(gd.album, ud.album) as album,
            COALESCE(gd.duration, ud.duration) as duration,
            COALESCE(gd.album_id, ud.album_id) as album_id
        FROM user_downloads ud
        LEFT JOIN global_downloads gd ON ud.global_download_id = gd.id
        WHERE ud.user_id = :user_id AND ud.extracted = true
        ORDER BY ud.extracted_at DESC
    """), {'user_id': user_id})

    return [_resolve_paths_in_record(dict(row._mapping)) for row in result.fetchall()]
