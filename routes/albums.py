"""
Albums blueprint — album listing and batch download.
"""
import threading
from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required
from core.logging_config import get_logger

logger = get_logger(__name__)

albums_bp = Blueprint('albums', __name__)


@albums_bp.route('/api/albums', methods=['GET'])
@api_login_required
def list_albums():
    """List all albums for the current user."""
    from core.db.albums import list_albums_for_user
    albums = list_albums_for_user(current_user.id)
    return jsonify({'success': True, 'albums': albums})


@albums_bp.route('/api/albums/global', methods=['GET'])
@api_login_required
def list_global():
    """List all albums in the global library."""
    from core.db.albums import list_global_albums
    albums = list_global_albums()
    return jsonify({'success': True, 'albums': albums})


@albums_bp.route('/api/albums/<int:album_id>/tracks', methods=['GET'])
@api_login_required
def get_tracks(album_id):
    """Get tracks in an album."""
    scope = request.args.get('scope', 'user')  # 'user' or 'global'
    from core.db.albums import get_album_tracks
    user_id = current_user.id if scope == 'user' else None
    tracks = get_album_tracks(album_id, user_id=user_id)
    return jsonify({'success': True, 'tracks': tracks})


@albums_bp.route('/api/albums/<int:album_id>/download', methods=['POST'])
@api_login_required
def download_album(album_id):
    """Batch download all tracks in an album."""
    from core.db.albums import get_album_tracks
    tracks = get_album_tracks(album_id)
    if not tracks:
        return jsonify({'error': 'Album not found or empty'}), 404

    # Build track list for batch download
    track_list = []
    for t in tracks:
        if t.get('video_id'):
            track_list.append({
                'title': t.get('title', ''),
                'artist': t.get('artist', ''),
                'video_id': t['video_id'],
                'duration_ms': int((t.get('duration') or 0) * 1000),
            })

    if not track_list:
        return jsonify({'error': 'No downloadable tracks in album'}), 400

    # Reuse the batch download mechanism from spotify_download_manager
    from core.spotify_download_manager import batch_download_playlist
    # Use album_id as "playlist_id" for progress tracking
    thread = threading.Thread(
        target=batch_download_playlist,
        args=(current_user.id, album_id, track_list),
        daemon=True
    )
    thread.start()

    logger.info(f"[Albums] Batch download started for album {album_id} ({len(track_list)} tracks)")
    return jsonify({'success': True, 'track_count': len(track_list)})


@albums_bp.route('/api/albums/ytmusic/<browse_id>', methods=['GET'])
@api_login_required
def get_ytmusic_album(browse_id):
    """Fetch album tracks from YouTube Music by browse_id."""
    from extensions import aiotube_client
    if not aiotube_client:
        from core.aiotube_client import get_aiotube_client
        aiotube_client = get_aiotube_client()
    result = aiotube_client.get_album_tracks(browse_id)
    if not result.get('success'):
        return jsonify({'error': result.get('error', 'Failed to fetch album')}), 500
    return jsonify(result)


@albums_bp.route('/api/albums/ytmusic/<browse_id>/download', methods=['POST'])
@api_login_required
def download_ytmusic_album(browse_id):
    """Batch download all tracks from a YouTube Music album."""
    from extensions import aiotube_client
    if not aiotube_client:
        from core.aiotube_client import get_aiotube_client
        aiotube_client = get_aiotube_client()

    album_data = aiotube_client.get_album_tracks(browse_id)
    if not album_data.get('success') or not album_data.get('tracks'):
        return jsonify({'error': 'Failed to fetch album tracks'}), 500

    tracks = album_data['tracks']

    # Build track list for batch download
    track_list = []
    for t in tracks:
        if t.get('video_id'):
            track_list.append({
                'title': t['title'],
                'artist': t.get('artist', ''),
                'album': album_data.get('title', ''),
                'video_id': t['video_id'],
                'duration_ms': 0,
            })

    if not track_list:
        return jsonify({'error': 'No downloadable tracks'}), 400

    # Also create the album in our DB
    from core.db.albums import find_or_create_album
    album_id = find_or_create_album(
        name=album_data.get('title', ''),
        artist=album_data.get('artist', ''),
        thumbnail_url=album_data.get('thumbnail', ''),
        year=int(album_data['year']) if album_data.get('year', '').isdigit() else None,
        source='ytmusic',
        source_id=browse_id,
    )

    from core.spotify_download_manager import batch_download_playlist
    thread = threading.Thread(
        target=batch_download_playlist,
        args=(current_user.id, album_id or 0, track_list),
        daemon=True
    )
    thread.start()

    logger.info(f"[Albums] YT Music album download: {album_data.get('title')} ({len(track_list)} tracks)")
    return jsonify({'success': True, 'track_count': len(track_list), 'album_title': album_data.get('title', '')})
