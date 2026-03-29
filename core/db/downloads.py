"""
Global and per-user download CRUD operations.

Rewritten from raw sqlite3 to SQLAlchemy ORM. Public function signatures
and return types are unchanged — callers import via core/downloads_db.py shim.
"""
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.models import db, GlobalDownload, UserDownload, model_to_dict
from core.db.connection import _resolve_paths_in_record


def add_or_update(user_id, meta):
    """Insert or update a download record for a user.

    Returns the global_download_id (int).
    """
    video_id = meta["video_id"]
    media_type = meta.get("download_type", "audio")
    quality = meta["quality"]
    file_path = meta["file_path"]

    # Create or link album if album name provided
    album_id = None
    if meta.get("album"):
        from core.db.albums import find_or_create_album, update_album_track_count
        album_artist = meta.get("album_artist") or meta.get("artist") or None
        if album_artist and ',' in album_artist:
            album_artist = album_artist.split(',')[0].strip()
        album_id = find_or_create_album(
            name=meta["album"],
            artist=album_artist,
            thumbnail_url=meta.get("thumbnail_url"),
        )

    print(f"[DB DEBUG] add_or_update called with video_id: '{video_id}' (length: {len(video_id)})")
    print(f"[DB DEBUG] Full meta: {meta}")

    session = db.session

    # Check if this file already exists globally
    gd = GlobalDownload.query.filter_by(
        video_id=video_id, media_type=media_type, quality=quality
    ).first()

    if gd:
        global_download_id = gd.id
    else:
        gd = GlobalDownload(
            video_id=video_id,
            title=meta["title"],
            thumbnail=meta.get("thumbnail_url") or None,
            file_path=file_path,
            media_type=media_type,
            quality=quality,
            file_size=meta.get("file_size", 0),
            artist=meta.get("artist") or None,
            album=meta.get("album") or None,
            duration=meta.get("duration") or None,
            album_id=album_id,
        )
        session.add(gd)
        session.flush()  # populate gd.id
        global_download_id = gd.id

    # Add/update user access record with PostgreSQL ON CONFLICT
    stmt = pg_insert(UserDownload).values(
        user_id=user_id,
        global_download_id=global_download_id,
        video_id=video_id,
        title=meta["title"],
        thumbnail=meta.get("thumbnail_url") or None,
        file_path=file_path,
        media_type=media_type,
        quality=quality,
        artist=meta.get("artist") or None,
        album=meta.get("album") or None,
        duration=meta.get("duration") or None,
        album_id=album_id,
    )
    stmt = stmt.on_conflict_do_update(
        constraint='uq_user_video',
        set_={
            'global_download_id': stmt.excluded.global_download_id,
            'title': stmt.excluded.title,
            'thumbnail': stmt.excluded.thumbnail,
            'file_path': stmt.excluded.file_path,
            'quality': stmt.excluded.quality,
            'artist': db.func.coalesce(stmt.excluded.artist, UserDownload.artist),
            'album': db.func.coalesce(stmt.excluded.album, UserDownload.album),
            'duration': db.func.coalesce(stmt.excluded.duration, UserDownload.duration),
            'album_id': db.func.coalesce(stmt.excluded.album_id, UserDownload.album_id),
        }
    )
    session.execute(stmt)
    session.commit()

    # Update album track count if we linked one
    if album_id:
        try:
            from core.db.albums import update_album_track_count
            update_album_track_count(album_id)
        except Exception:
            pass

    return global_download_id


def update_download_analysis(video_id, detected_bpm, detected_key, analysis_confidence,
                             chords_data=None, beat_offset=0.0, structure_data=None,
                             lyrics_data=None, beat_times=None, beat_positions=None,
                             music_start_time=0.0):
    """Update audio analysis results for a download."""
    print(f"[DB DEBUG] Updating analysis for video_id='{video_id}': BPM={detected_bpm}, "
          f"Key={detected_key}, Chords={bool(chords_data)}, BeatOffset={beat_offset:.3f}s, "
          f"Structure={bool(structure_data)}, Lyrics={bool(lyrics_data)}, "
          f"BeatTimes={len(beat_times) if beat_times else 0}, "
          f"BeatPositions={len(beat_positions) if beat_positions else 0}, "
          f"MusicStart={music_start_time:.1f}s")

    session = db.session

    # JSONB columns accept dicts/lists directly — no json.dumps needed
    analysis_fields = dict(
        detected_bpm=detected_bpm,
        detected_key=detected_key,
        analysis_confidence=analysis_confidence,
        chords_data=chords_data,
        beat_offset=beat_offset,
        structure_data=structure_data,
        lyrics_data=lyrics_data,
        beat_times=beat_times,
        beat_positions=beat_positions,
        music_start_time=music_start_time or 0.0,
    )

    # Update global_downloads
    rows_updated = GlobalDownload.query.filter_by(video_id=video_id).update(analysis_fields)
    print(f"[DB DEBUG] Updated {rows_updated} rows in global_downloads")

    # Update all user_downloads entries for this video_id
    rows_updated2 = UserDownload.query.filter_by(video_id=video_id).update(analysis_fields)
    print(f"[DB DEBUG] Updated {rows_updated2} rows in user_downloads")

    session.commit()

    if rows_updated == 0:
        print(f"[DB DEBUG] WARNING: No rows updated! Video_id '{video_id}' not found in global_downloads")
    else:
        print(f"[DB DEBUG] Analysis updated successfully for video_id='{video_id}'")


def update_download_lyrics(video_id, lyrics_data):
    """Update lyrics data for a download."""
    print(f"[LYRICS] Saving lyrics data for video_id='{video_id}': {len(lyrics_data)} segments")

    session = db.session

    # JSONB columns accept dicts/lists directly
    rows_updated = GlobalDownload.query.filter_by(video_id=video_id).update(
        {'lyrics_data': lyrics_data}
    )
    print(f"[LYRICS] Updated {rows_updated} rows in global_downloads")

    rows_updated2 = UserDownload.query.filter_by(video_id=video_id).update(
        {'lyrics_data': lyrics_data}
    )
    print(f"[LYRICS] Updated {rows_updated2} rows in user_downloads")

    session.commit()

    if rows_updated == 0:
        print(f"[LYRICS] WARNING: No rows updated! Video_id '{video_id}' not found")
    else:
        print(f"[LYRICS] Lyrics saved successfully for video_id='{video_id}'")


def update_download_structure(video_id, structure_data):
    """Update LLM-analyzed structure data for a download."""
    print(f"[STRUCTURE] Saving structure data for video_id='{video_id}'")

    session = db.session

    # JSONB columns accept dicts/lists directly
    rows_updated = GlobalDownload.query.filter_by(video_id=video_id).update(
        {'structure_data': structure_data}
    )
    print(f"[STRUCTURE] Updated {rows_updated} rows in global_downloads")

    rows_updated2 = UserDownload.query.filter_by(video_id=video_id).update(
        {'structure_data': structure_data}
    )
    print(f"[STRUCTURE] Updated {rows_updated2} rows in user_downloads")

    session.commit()

    if rows_updated == 0:
        print(f"[STRUCTURE] WARNING: No rows updated! Video_id '{video_id}' not found")
    else:
        print(f"[STRUCTURE] Structure saved successfully for video_id='{video_id}'")


def find_global_download(video_id, media_type, quality):
    """Check if a download already exists globally.

    Returns a dict (matching old dict(row) shape) or None.
    """
    gd = GlobalDownload.query.filter_by(
        video_id=video_id, media_type=media_type, quality=quality
    ).first()
    return model_to_dict(gd)


def add_user_access(user_id, global_download):
    """Give a user access to an existing global download.

    Args:
        user_id: The user's ID.
        global_download: A dict with keys from global_downloads (as returned by find_global_download).
    """
    stmt = pg_insert(UserDownload).values(
        user_id=user_id,
        global_download_id=global_download["id"],
        video_id=global_download["video_id"],
        title=global_download["title"],
        thumbnail=global_download["thumbnail"],
        file_path=global_download["file_path"],
        media_type=global_download["media_type"],
        quality=global_download["quality"],
    )
    stmt = stmt.on_conflict_do_nothing(constraint='uq_user_video')
    db.session.execute(stmt)
    db.session.commit()


def list_for(user_id):
    """Return all downloads for a given user, newest first.

    Uses raw SQL with COALESCE to prefer global_downloads data over
    user_downloads (preserves the original query logic).

    Returns a list of dicts with resolved file paths.
    """
    sql = text("""
        SELECT
            ud.id,
            ud.user_id,
            ud.global_download_id,
            ud.video_id,
            COALESCE(gd.title, ud.title) as title,
            COALESCE(gd.thumbnail, ud.thumbnail) as thumbnail,
            ud.file_path,
            ud.media_type,
            ud.quality,
            ud.created_at,
            ud.extracted,
            ud.extracting,
            ud.extracted_at,
            ud.extraction_model,
            ud.stems_paths,
            ud.stems_zip_path,
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
        WHERE ud.user_id = :user_id
        ORDER BY ud.created_at DESC
    """)
    result = db.session.execute(sql, {"user_id": user_id})
    rows = [dict(row._mapping) for row in result]
    return [_resolve_paths_in_record(row) for row in rows]


def get_download_by_id(user_id, download_id):
    """Get a specific download by ID for a user.

    Returns a dict with resolved file paths, or None.
    """
    sql = text("""
        SELECT
            ud.id,
            ud.user_id,
            ud.global_download_id,
            ud.video_id,
            COALESCE(gd.title, ud.title) as title,
            COALESCE(gd.thumbnail, ud.thumbnail) as thumbnail,
            ud.file_path,
            ud.media_type,
            ud.quality,
            ud.created_at,
            ud.extracted,
            ud.extracting,
            ud.extracted_at,
            ud.extraction_model,
            ud.stems_paths,
            ud.stems_zip_path,
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
        WHERE ud.user_id = :user_id AND ud.id = :download_id
    """)
    result = db.session.execute(sql, {"user_id": user_id, "download_id": download_id})
    row = result.fetchone()
    if row is None:
        return None
    return _resolve_paths_in_record(dict(row._mapping))


def get_user_download_id_by_video_id(user_id, video_id):
    """Get user's download_id (user_downloads.id) for a specific video_id.

    This is needed for WebSocket events to update the correct UI element.
    Returns None if user doesn't have access to this video.
    """
    ud = UserDownload.query.filter_by(
        user_id=user_id, video_id=video_id
    ).order_by(UserDownload.created_at.desc()).first()
    return ud.id if ud else None


def delete_from(user_id, video_id):
    """Delete a specific download record for a user."""
    UserDownload.query.filter_by(user_id=user_id, video_id=video_id).delete()
    db.session.commit()
