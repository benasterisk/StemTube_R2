"""
Spotify integration blueprint — simplified embed scraping approach.

No API keys needed. User pastes a Spotify playlist URL,
we scrape track data from the embed page, save locally, and batch download.
"""
import threading
from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required
from core.logging_config import get_logger

logger = get_logger(__name__)

spotify_bp = Blueprint('spotify', __name__)


@spotify_bp.route('/api/spotify/playlist', methods=['POST'])
@api_login_required
def fetch_playlist():
    """Fetch a Spotify playlist by URL, save it locally, return tracks."""
    from core.spotify_client import extract_playlist_id, get_playlist_from_embed
    from core.db.playlists import save_playlist

    data = request.get_json(silent=True) or {}
    url = data.get('url', '').strip()

    playlist_id = extract_playlist_id(url)
    if not playlist_id:
        return jsonify({'error': 'Invalid Spotify playlist URL'}), 400

    result = get_playlist_from_embed(playlist_id)
    if not result:
        return jsonify({'error': 'Could not load playlist. Make sure it exists and is public.'}), 404

    # Save locally
    db_id = save_playlist(
        current_user.id,
        playlist_id,
        result['name'],
        result.get('description', ''),
        result.get('thumbnail_url', ''),
        result['tracks'],
        result['track_count'],
    )

    logger.info(f"[Spotify] Playlist '{result['name']}' ({len(result['tracks'])} tracks) saved for user {current_user.id}")
    return jsonify({
        'success': True,
        'playlist_id': db_id,
        'name': result['name'],
        'thumbnail_url': result.get('thumbnail_url', ''),
        'track_count': len(result['tracks']),
        'tracks': result['tracks'],
    })


@spotify_bp.route('/api/spotify/playlists/saved', methods=['GET'])
@api_login_required
def list_saved():
    """List locally saved playlists."""
    from core.db.playlists import list_playlists
    playlists = list_playlists(current_user.id)
    return jsonify({'success': True, 'playlists': playlists})


@spotify_bp.route('/api/spotify/playlists/saved/<int:playlist_id>', methods=['GET'])
@api_login_required
def get_saved(playlist_id):
    """Get a saved playlist with tracks."""
    from core.db.playlists import get_playlist
    playlist = get_playlist(current_user.id, playlist_id)
    if not playlist:
        return jsonify({'error': 'Playlist not found'}), 404
    return jsonify({'success': True, 'playlist': playlist})


@spotify_bp.route('/api/spotify/playlists/saved/<int:playlist_id>', methods=['DELETE'])
@api_login_required
def delete_saved(playlist_id):
    """Delete a saved playlist."""
    from core.db.playlists import delete_playlist
    delete_playlist(current_user.id, playlist_id)
    return jsonify({'success': True})


@spotify_bp.route('/api/spotify/playlists/<int:playlist_id>/download', methods=['POST'])
@api_login_required
def download_playlist(playlist_id):
    """Start batch downloading all tracks in a saved playlist."""
    from core.db.playlists import get_playlist
    playlist = get_playlist(current_user.id, playlist_id)
    if not playlist:
        return jsonify({'error': 'Playlist not found'}), 404

    tracks = playlist.get('tracks', [])
    if not tracks:
        return jsonify({'error': 'Playlist has no tracks'}), 400

    from core.spotify_download_manager import batch_download_playlist
    thread = threading.Thread(
        target=batch_download_playlist,
        args=(current_user.id, playlist_id, tracks),
        daemon=True
    )
    thread.start()

    logger.info(f"[Spotify] Batch download started for playlist {playlist_id} ({len(tracks)} tracks)")
    return jsonify({'success': True, 'track_count': len(tracks)})
