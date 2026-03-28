"""
Spotify playlist scraper — extracts track data from the embed page.

No API keys, no OAuth, no credentials needed.
Works by parsing the __NEXT_DATA__ JSON from Spotify's embed endpoint.
"""
import re
import json
import requests
from core.logging_config import get_logger

logger = get_logger(__name__)

EMBED_URL = 'https://open.spotify.com/embed/playlist/{playlist_id}'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def extract_playlist_id(url_or_id):
    """Extract Spotify playlist ID from a URL or return as-is if already an ID.

    Accepts:
        https://open.spotify.com/playlist/55FaVpoogyMIZur0EEWpv0
        https://open.spotify.com/playlist/55FaVpoogyMIZur0EEWpv0?si=...
        spotify:playlist:55FaVpoogyMIZur0EEWpv0
        55FaVpoogyMIZur0EEWpv0
    """
    if not url_or_id:
        return None
    url_or_id = url_or_id.strip()

    # spotify:playlist:ID
    if url_or_id.startswith('spotify:playlist:'):
        return url_or_id.split(':')[-1]

    # URL format
    match = re.search(r'playlist[/:]([a-zA-Z0-9]+)', url_or_id)
    if match:
        return match.group(1)

    # Bare ID (alphanumeric, 22 chars typically)
    if re.match(r'^[a-zA-Z0-9]{15,}$', url_or_id):
        return url_or_id

    return None


def get_playlist_from_embed(playlist_id):
    """Fetch playlist metadata and tracks from Spotify's embed page.

    Returns dict with: name, description, thumbnail_url, tracks[]
    Each track: {title, artist, duration_ms, spotify_uri}
    Returns None on failure.
    """
    url = EMBED_URL.format(playlist_id=playlist_id)

    try:
        resp = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=15)
        if resp.status_code != 200:
            logger.error(f"[Spotify] Embed page returned {resp.status_code} for {playlist_id}")
            return None

        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if not match:
            logger.error(f"[Spotify] No __NEXT_DATA__ found for {playlist_id}")
            return None

        data = json.loads(match.group(1))
        entity = data['props']['pageProps']['state']['data']['entity']

        # Extract cover art
        cover_sources = entity.get('coverArt', {}).get('sources', [])
        thumbnail = cover_sources[0]['url'] if cover_sources else ''

        # Extract tracks
        track_list = entity.get('trackList', [])
        tracks = []
        for t in track_list:
            tracks.append({
                'title': t.get('title', ''),
                'artist': t.get('subtitle', ''),
                'duration_ms': t.get('duration', 0),
                'spotify_uri': t.get('uri', ''),
                'video_id': None,
            })

        result = {
            'name': entity.get('name', entity.get('title', 'Untitled')),
            'description': entity.get('subtitle', ''),
            'thumbnail_url': thumbnail,
            'track_count': len(tracks),
            'tracks': tracks,
        }
        logger.info(f"[Spotify] Scraped playlist '{result['name']}': {len(tracks)} tracks")
        return result

    except Exception as e:
        logger.error(f"[Spotify] Failed to scrape playlist {playlist_id}: {e}")
        return None
