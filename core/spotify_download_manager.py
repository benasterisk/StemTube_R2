"""
Batch download manager for Spotify playlist tracks.

Searches YouTube for each track in a playlist, checks global deduplication,
and queues downloads through the existing download pipeline. Emits real-time
WebSocket progress via Flask-SocketIO.
"""
import re
import time
import threading
from typing import Any, Dict, List, Optional

from core.logging_config import get_logger
from core.aiotube_client import get_aiotube_client
from core.download_manager import DownloadItem, DownloadType
from core.downloads_db import (
    find_global_download as db_find_global_download,
    add_user_access as db_add_user_access,
    add_user_extraction_access as db_add_user_extraction_access,
)
from core.db.playlists import update_track_video_id

logger = get_logger(__name__)

# Delay between YouTube searches to avoid rate limiting
SEARCH_DELAY_SECONDS = 0.5

# Maximum acceptable duration difference (in seconds) when matching tracks
MAX_DURATION_DIFF_SECONDS = 30


def _room_key_for_user(user_id: int) -> str:
    """Build the WebSocket room key for a given user."""
    return f"user_{user_id}"


def _emit_batch_progress(
    user_id: int,
    playlist_id: int,
    current: int,
    total: int,
    track_title: str,
    status: str,
    video_id: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """Emit a spotify_batch_progress event to the user's room."""
    from extensions import socketio

    room = _room_key_for_user(user_id)
    socketio.emit('spotify_batch_progress', {
        'playlist_id': playlist_id,
        'current': current,
        'total': total,
        'track_title': track_title,
        'status': status,
        'video_id': video_id,
        'error': error,
    }, room=room)


def _emit_batch_complete(
    user_id: int,
    playlist_id: int,
    total: int,
    downloaded: int,
    skipped: int,
    failed: int,
) -> None:
    """Emit a spotify_batch_complete event to the user's room."""
    from extensions import socketio

    room = _room_key_for_user(user_id)
    socketio.emit('spotify_batch_complete', {
        'playlist_id': playlist_id,
        'total': total,
        'downloaded': downloaded,
        'skipped': skipped,
        'failed': failed,
    }, room=room)


def _parse_iso_duration_to_seconds(duration: str) -> int:
    """Parse an ISO 8601 duration string (e.g. 'PT3M45S') to seconds."""
    if not duration:
        return 0
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def _ytmusic_search(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """Search YouTube Music via yt-dlp and return results in the same format as AiotubeClient."""
    import yt_dlp
    from core.download_manager import get_youtube_cookies_config

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'skip_download': True,
        'ignoreerrors': True,
    }
    ydl_opts.update(get_youtube_cookies_config())

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            results = ydl.extract_info(f"ytsearch{max_results}:{query} music", download=False)

        entries = results.get('entries', []) if results else []
        items = []
        for entry in entries:
            if not entry:
                continue
            video_id = entry.get('id', '')
            if not video_id or len(video_id) != 11:
                continue
            duration = entry.get('duration', 0) or 0
            items.append({
                'id': video_id,
                'snippet': {
                    'title': entry.get('title', ''),
                    'thumbnails': {
                        'medium': {'url': entry.get('thumbnail', f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg")}
                    },
                },
                'contentDetails': {
                    'duration': f"PT{int(duration // 60)}M{int(duration % 60)}S" if duration else '',
                },
            })
        return items
    except Exception as e:
        logger.warning(f"[Spotify DL] YouTube Music search failed: {e}")
        return []


def _search_youtube_for_track(
    title: str,
    artist: str,
    duration_ms: int,
) -> Optional[Dict[str, Any]]:
    """Search YouTube for a track and return the best matching result.

    Uses the existing AiotubeClient (yt-dlp backed) to search. Picks the
    result whose duration is closest to the Spotify track, provided the
    difference is within MAX_DURATION_DIFF_SECONDS.

    Args:
        title: Track title from Spotify.
        artist: Artist name(s) from Spotify.
        duration_ms: Track duration in milliseconds from Spotify.

    Returns:
        Dict with 'video_id', 'title', 'thumbnail_url', 'duration_seconds'
        or None if no suitable match was found.
    """
    query = f"{artist} - {title}"
    target_seconds = duration_ms / 1000.0

    try:
        # Search YouTube Music first (better music matching than regular YouTube)
        items = _ytmusic_search(query, max_results=5)

        # Fallback to regular YouTube search if YouTube Music returns nothing
        if not items:
            client = get_aiotube_client()
            response = client.search_videos(query, max_results=5)
            items = response.get('items', [])

        if not items:
            logger.warning(f"[Spotify DL] No YouTube results for: {query}")
            return None

        best_match = None
        best_diff = float('inf')

        for item in items:
            video_id = item.get('id', '')
            if not video_id or len(video_id) != 11:
                continue

            # Parse duration from ISO 8601
            iso_duration = item.get('contentDetails', {}).get('duration', '')
            result_seconds = _parse_iso_duration_to_seconds(iso_duration)

            # Skip results with no duration info (likely live streams)
            if result_seconds == 0:
                continue

            diff = abs(result_seconds - target_seconds)
            if diff < best_diff:
                best_diff = diff
                thumbnail_url = (
                    item.get('snippet', {})
                    .get('thumbnails', {})
                    .get('medium', {})
                    .get('url', '')
                )
                if not thumbnail_url:
                    thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

                best_match = {
                    'video_id': video_id,
                    'title': item.get('snippet', {}).get('title', title),
                    'thumbnail_url': thumbnail_url,
                    'duration_seconds': result_seconds,
                }

        # Accept the best match only if duration is close enough
        if best_match and best_diff <= MAX_DURATION_DIFF_SECONDS:
            logger.info(
                f"[Spotify DL] Matched '{query}' -> {best_match['video_id']} "
                f"(diff={best_diff:.0f}s)"
            )
            return best_match

        # Fallback: if no duration-matched result, take the first result
        # (YouTube search relevance is usually good for "artist - title")
        if items and not best_match:
            first = items[0]
            video_id = first.get('id', '')
            if video_id and len(video_id) == 11:
                thumbnail_url = (
                    first.get('snippet', {})
                    .get('thumbnails', {})
                    .get('medium', {})
                    .get('url', '')
                )
                if not thumbnail_url:
                    thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
                logger.info(
                    f"[Spotify DL] Fallback match '{query}' -> {video_id} "
                    f"(no duration filter)"
                )
                return {
                    'video_id': video_id,
                    'title': first.get('snippet', {}).get('title', title),
                    'thumbnail_url': thumbnail_url,
                    'duration_seconds': 0,
                }

        logger.warning(
            f"[Spotify DL] No suitable match for: {query} "
            f"(best_diff={best_diff:.0f}s, threshold={MAX_DURATION_DIFF_SECONDS}s)"
        )
        return None

    except Exception as e:
        logger.error(f"[Spotify DL] YouTube search error for '{query}': {e}")
        return None


def _initiate_download(
    user_id: int,
    video_id: str,
    title: str,
    thumbnail_url: str,
    album: str = '',
    artist: str = '',
) -> Optional[str]:
    """Create a download via the existing download pipeline.

    First checks global deduplication. If the track already exists, grants
    user access and returns immediately. Otherwise, queues a new download.

    Args:
        user_id: The ID of the user requesting the download.
        video_id: YouTube video ID.
        title: Track title for display.
        thumbnail_url: Thumbnail URL for display.
        album: Album name (optional, stored on DownloadItem for DB persistence).
        artist: Artist name (optional).

    Returns:
        The download_id string, or None on failure.
    """
    from extensions import user_session_manager

    try:
        # Check global deduplication — audio/best is the standard for Spotify downloads
        global_download = db_find_global_download(video_id, 'audio', 'best')
        if global_download:
            # Already downloaded globally — grant user access
            db_add_user_access(user_id, global_download)

            # Also grant extraction access if extraction exists
            if global_download.get('extracted') == 1 and global_download.get('extraction_model'):
                try:
                    db_add_user_extraction_access(user_id, global_download)
                except Exception:
                    pass

            logger.info(
                f"[Spotify DL] Dedup hit for {video_id} — user {user_id} "
                f"granted access"
            )
            return global_download.get('id')

        # No existing download — queue a new one through the user's DownloadManager.
        # We need a Flask app context to access user_session_manager properly,
        # but since we are in a background thread we build the manager key directly.
        manager_key = _room_key_for_user(user_id)

        # Get or create the download manager for this user
        if manager_key not in user_session_manager.download_managers:
            dm = DownloadItem.__class__  # placeholder — we need to create a DownloadManager
            # Build a fresh DownloadManager wired to emit to the correct room
            from core.download_manager import DownloadManager
            dm = DownloadManager()
            dm.on_download_progress = (
                lambda item_id, progress, speed=None, eta=None, rk=manager_key:
                    _emit_dm_progress(item_id, progress, speed, eta, rk)
            )
            dm.on_download_complete = (
                lambda item_id, title=None, file_path=None, download_item=None,
                       rk=manager_key, uid=user_id:
                    _emit_dm_complete(item_id, title, file_path, rk, uid, download_item)
            )
            dm.on_download_error = (
                lambda item_id, error, rk=manager_key:
                    _emit_dm_error(item_id, error, rk)
            )
            user_session_manager.download_managers[manager_key] = dm

        dm = user_session_manager.download_managers[manager_key]

        # Check if already queued/active in this session
        all_downloads = dm.get_all_downloads()
        for status_list in all_downloads.values():
            for item in status_list:
                if item.video_id == video_id:
                    logger.info(
                        f"[Spotify DL] {video_id} already in download queue"
                    )
                    return item.download_id

        # Create and queue the download item with album/artist metadata
        item = DownloadItem(
            video_id=video_id,
            title=title,
            thumbnail_url=thumbnail_url,
            download_type=DownloadType.AUDIO,
            quality='best',
        )
        # Attach metadata for DB persistence after download completes
        item.yt_album = album or ''
        item.yt_artist = artist or ''
        dl_id = dm.add_download(item)
        logger.info(f"[Spotify DL] Queued download {dl_id} for {video_id}")
        return dl_id

    except Exception as e:
        logger.error(f"[Spotify DL] Failed to initiate download for {video_id}: {e}")
        return None


def _emit_dm_progress(item_id, progress, speed, eta, room_key):
    """Forward DownloadManager progress events to the user's room."""
    from extensions import socketio
    socketio.emit('download_progress', {
        'download_id': item_id,
        'progress': progress,
        'speed': speed,
        'eta': eta,
    }, room=room_key)


def _emit_dm_complete(item_id, title, file_path, room_key, user_id, download_item):
    """Forward DownloadManager completion events, persisting to DB."""
    from extensions import socketio, user_session_manager
    # Delegate to the existing completion handler which handles DB persistence
    user_session_manager._emit_complete_with_room(
        item_id, title, file_path, room_key, user_id,
        dm_instance=user_session_manager.download_managers.get(room_key),
        dm_key=room_key,
        download_item=download_item,
    )


def _emit_dm_error(item_id, error, room_key):
    """Forward DownloadManager error events to the user's room."""
    from extensions import socketio
    socketio.emit('download_error', {
        'download_id': item_id,
        'error_message': error,
    }, room=room_key)


def batch_download_playlist(
    user_id: int,
    playlist_id: int,
    tracks: List[Dict[str, Any]],
) -> None:
    """Download all tracks from a Spotify playlist via YouTube search.

    This function is designed to run in a background thread. It iterates
    through each track, searches YouTube, checks for global deduplication,
    and queues downloads as needed. Progress is emitted via WebSocket.

    Args:
        user_id: The ID of the requesting user.
        playlist_id: Database ID of the saved playlist.
        tracks: List of track dicts from the playlists table, each containing
                'spotify_track_id', 'title', 'artist', 'duration_ms', 'video_id'.
    """
    # Ensure Flask app context for background thread DB operations
    from core.models import thread_session
    import importlib
    try:
        from flask import current_app
        current_app._get_current_object()
        _has_context = True
    except RuntimeError:
        _has_context = False

    if not _has_context:
        app_module = importlib.import_module('app')
        _app_ctx = app_module.app.app_context()
        _app_ctx.push()
    else:
        _app_ctx = None

    total = len(tracks)
    downloaded = 0
    skipped = 0
    failed = 0

    logger.info(
        f"[Spotify DL] Starting batch download: playlist_id={playlist_id}, "
        f"user_id={user_id}, tracks={total}"
    )

    for i, track in enumerate(tracks):
        track_title = track.get('title', 'Unknown')
        track_artist = track.get('artist', 'Unknown')
        duration_ms = track.get('duration_ms', 0)
        spotify_track_id = track.get('spotify_track_id', '')
        existing_video_id = track.get('video_id')
        display_name = f"{track_artist} - {track_title}"

        # Emit progress: searching
        _emit_batch_progress(
            user_id, playlist_id,
            current=i + 1,
            total=total,
            track_title=display_name,
            status='searching',
        )

        # If track already has a matched video_id, skip search
        if existing_video_id:
            video_id = existing_video_id
            title = track_title
            thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
        else:
            # Search YouTube for this track
            match = _search_youtube_for_track(track_title, track_artist, duration_ms)
            if not match:
                failed += 1
                _emit_batch_progress(
                    user_id, playlist_id,
                    current=i + 1,
                    total=total,
                    track_title=display_name,
                    status='search_failed',
                    error=f"No YouTube match found for: {display_name}",
                )
                # Rate limit delay even on failure
                if i < total - 1:
                    time.sleep(SEARCH_DELAY_SECONDS)
                continue

            video_id = match['video_id']
            title = display_name  # "Artist - Title" from Spotify, not YouTube title
            thumbnail_url = match['thumbnail_url']

            # Update the playlist's tracks_json with the matched video_id
            try:
                update_track_video_id(playlist_id, track_title, track_artist, video_id)
            except Exception as e:
                logger.warning(
                    f"[Spotify DL] Failed to update track video_id in playlist: {e}"
                )

        # Check if already downloaded globally (dedup)
        global_download = db_find_global_download(video_id, 'audio', 'best')
        if global_download:
            # Already exists — just grant access, skip download
            db_add_user_access(user_id, global_download)
            if global_download.get('extracted') == 1:
                try:
                    db_add_user_extraction_access(user_id, global_download)
                except Exception:
                    pass
            skipped += 1
            _emit_batch_progress(
                user_id, playlist_id,
                current=i + 1,
                total=total,
                track_title=display_name,
                status='exists',
                video_id=video_id,
            )
        else:
            # New download needed — queue it with album/artist metadata
            track_album = track.get('album', '')
            dl_id = _initiate_download(user_id, video_id, title, thumbnail_url,
                                       album=track_album, artist=track_artist)
            if dl_id:
                downloaded += 1
                _emit_batch_progress(
                    user_id, playlist_id,
                    current=i + 1,
                    total=total,
                    track_title=display_name,
                    status='queued',
                    video_id=video_id,
                )
            else:
                failed += 1
                _emit_batch_progress(
                    user_id, playlist_id,
                    current=i + 1,
                    total=total,
                    track_title=display_name,
                    status='download_failed',
                    video_id=video_id,
                    error=f"Failed to queue download for: {display_name}",
                )

        # Rate limit: wait between YouTube searches
        if i < total - 1:
            time.sleep(SEARCH_DELAY_SECONDS)

    # Emit completion
    _emit_batch_complete(
        user_id, playlist_id,
        total=total,
        downloaded=downloaded,
        skipped=skipped,
        failed=failed,
    )

    logger.info(
        f"[Spotify DL] Batch complete: playlist_id={playlist_id}, "
        f"downloaded={downloaded}, skipped={skipped}, failed={failed}"
    )

    # Pop app context if we pushed one
    if _app_ctx is not None:
        _app_ctx.pop()
