"""
Custom playlists blueprint — user-created playlists with track management.
"""
import json
from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required
from core.logging_config import get_logger

logger = get_logger(__name__)

playlists_bp = Blueprint('playlists', __name__)


@playlists_bp.route('/api/playlists', methods=['GET'])
@api_login_required
def list_all():
    """List all playlists (custom + Spotify imports) for the current user."""
    from core.db.playlists import list_playlists
    playlists = list_playlists(current_user.id)
    return jsonify({'success': True, 'playlists': playlists})


@playlists_bp.route('/api/playlists', methods=['POST'])
@api_login_required
def create():
    """Create a custom playlist."""
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    from core.db.playlists import save_playlist
    playlist_id = save_playlist(
        user_id=current_user.id,
        spotify_id=None,
        name=name,
        description=data.get('description', ''),
        thumbnail_url='',
        tracks=[],
        track_count=0,
    )
    return jsonify({'success': True, 'playlist_id': playlist_id, 'name': name})


@playlists_bp.route('/api/playlists/<int:playlist_id>', methods=['GET'])
@api_login_required
def get_one(playlist_id):
    """Get a playlist with tracks."""
    from core.db.playlists import get_playlist
    playlist = get_playlist(current_user.id, playlist_id)
    if not playlist:
        return jsonify({'error': 'Playlist not found'}), 404
    return jsonify({'success': True, 'playlist': playlist})


@playlists_bp.route('/api/playlists/<int:playlist_id>', methods=['PUT'])
@api_login_required
def update(playlist_id):
    """Rename a playlist."""
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    from core.db.connection import _conn
    with _conn() as conn:
        conn.execute("UPDATE playlists SET name=? WHERE id=? AND user_id=?",
                     (name, playlist_id, current_user.id))
        conn.commit()
    return jsonify({'success': True})


@playlists_bp.route('/api/playlists/<int:playlist_id>', methods=['DELETE'])
@api_login_required
def delete(playlist_id):
    """Delete a playlist."""
    from core.db.playlists import delete_playlist
    delete_playlist(current_user.id, playlist_id)
    return jsonify({'success': True})


@playlists_bp.route('/api/playlists/<int:playlist_id>/tracks', methods=['POST'])
@api_login_required
def add_tracks(playlist_id):
    """Add tracks to a playlist by video_ids."""
    data = request.get_json(silent=True) or {}
    video_ids = data.get('video_ids', [])
    if not video_ids:
        return jsonify({'error': 'video_ids required'}), 400

    from core.db.playlists import get_playlist
    from core.db.downloads import list_for

    playlist = get_playlist(current_user.id, playlist_id)
    if not playlist:
        return jsonify({'error': 'Playlist not found'}), 404

    # Get metadata for the video_ids from user's downloads
    downloads = list_for(current_user.id)
    dl_map = {d['video_id']: d for d in downloads}

    tracks = playlist.get('tracks', [])
    existing_vids = {t.get('video_id') for t in tracks}
    added = 0

    for vid in video_ids:
        if vid in existing_vids:
            continue
        d = dl_map.get(vid)
        if d:
            tracks.append({
                'title': d.get('title', ''),
                'artist': d.get('artist', ''),
                'album': d.get('album', ''),
                'duration_ms': int((d.get('duration') or 0) * 1000),
                'video_id': vid,
            })
            added += 1

    # Save back
    from core.db.connection import _conn
    with _conn() as conn:
        conn.execute("UPDATE playlists SET tracks_json=?, track_count=? WHERE id=? AND user_id=?",
                     (json.dumps(tracks), len(tracks), playlist_id, current_user.id))
        conn.commit()

    return jsonify({'success': True, 'added': added, 'total': len(tracks)})


@playlists_bp.route('/api/playlists/<int:playlist_id>/tracks', methods=['DELETE'])
@api_login_required
def remove_tracks(playlist_id):
    """Remove tracks from a playlist by video_ids."""
    data = request.get_json(silent=True) or {}
    video_ids = set(data.get('video_ids', []))
    if not video_ids:
        return jsonify({'error': 'video_ids required'}), 400

    from core.db.playlists import get_playlist
    playlist = get_playlist(current_user.id, playlist_id)
    if not playlist:
        return jsonify({'error': 'Playlist not found'}), 404

    tracks = [t for t in playlist.get('tracks', []) if t.get('video_id') not in video_ids]

    from core.db.connection import _conn
    with _conn() as conn:
        conn.execute("UPDATE playlists SET tracks_json=?, track_count=? WHERE id=? AND user_id=?",
                     (json.dumps(tracks), len(tracks), playlist_id, current_user.id))
        conn.commit()

    return jsonify({'success': True, 'total': len(tracks)})
