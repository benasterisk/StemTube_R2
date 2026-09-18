"""
Media metadata for lyrics lookup: artist, track and sung language.

YouTube (through yt-dlp) gives music metadata (`artist`, `track`) only for some videos,
but usually the declared audio `language`, the uploader and the tags. The metadata is
captured once at download time and stored as JSON in `global_downloads.media_metadata`;
songs downloaded before that are fetched lazily (one yt-dlp metadata request) and cached.
"""

import logging
import re
from typing import Dict, Optional, Tuple

from core.metadata_extractor import get_id3_tags, parse_artist_title

logger = logging.getLogger(__name__)

YOUTUBE_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')

# "(Musical Artist)" tags come from YouTube's knowledge graph and name the performer.
MUSICAL_ARTIST_TAG = re.compile(r'^(.+?)\s*\(Musical Artist\)$', re.IGNORECASE)


def from_ytdlp_info(info: Dict) -> Dict:
    """The subset of a yt-dlp info dict the lyrics pipeline uses."""
    if not info:
        return {}
    artists = info.get('artists') or []
    creators = info.get('creators') or []
    return {
        'source': 'youtube',
        'artist': info.get('artist') or (artists[0] if artists else None) or info.get('creator')
                  or (creators[0] if creators else None),
        'track': info.get('track') or info.get('alt_title'),
        'language': (info.get('language') or '').split('-')[0].lower() or None,
        'uploader': info.get('uploader') or info.get('channel'),
        'tags': (info.get('tags') or [])[:40],
        'duration': info.get('duration'),
    }


def fetch_youtube_metadata(video_id: str) -> Dict:
    """One metadata-only yt-dlp request (no download). {} on failure."""
    if not video_id or not YOUTUBE_ID.match(video_id):
        return {}
    try:
        from core.cookie_broker import youtube_dl
        opts = {'quiet': True, 'no_warnings': True, 'skip_download': True,
                'js_runtimes': {'deno': {}, 'node': {}}}
        with youtube_dl(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        meta = from_ytdlp_info(info)
        logger.info(f"[METADATA] YouTube {video_id}: artist={meta.get('artist')!r} "
                    f"track={meta.get('track')!r} language={meta.get('language')!r}")
        return meta
    except Exception as e:
        logger.warning(f"[METADATA] yt-dlp metadata fetch failed for {video_id}: {e}")
        return {}


def load_media_metadata(video_id: str, fetch_if_missing: bool = True) -> Dict:
    """Stored metadata for a song; fetched from YouTube and stored when missing."""
    from core.downloads_db import get_media_metadata, update_media_metadata
    meta = get_media_metadata(video_id) or {}
    if meta or not fetch_if_missing:
        return meta
    meta = fetch_youtube_metadata(video_id)
    if meta:
        update_media_metadata(video_id, meta)
    return meta


def _clean_uploader(name: str) -> str:
    name = re.sub(r'\s*-\s*Topic$', '', name or '', flags=re.IGNORECASE)
    name = re.sub(r'(VEVO|Official|TV)$', '', name).strip()
    return name


def resolve_artist_track(title: str = None, file_path: str = None, meta: Optional[Dict] = None,
                         override_artist: str = None, override_track: str = None) -> Tuple[str, str]:
    """
    (artist, track) for a lyrics search, best source first:
    user override > YouTube music metadata > "Artist - Track" title > ID3 tags
    > "(Musical Artist)" tag > uploader name.
    """
    meta = meta or {}
    if override_artist or override_track:
        return (override_artist or '').strip(), (override_track or title or '').strip()

    if meta.get('artist') and meta.get('track'):
        return meta['artist'].strip(), meta['track'].strip()

    artist, track = parse_artist_title(title) if title else (None, None)
    if artist and track:
        return artist, track

    if file_path:
        tags = get_id3_tags(file_path) or {}
        # yt-dlp writes the uploader as ID3 artist for plain videos: only trust it for uploads.
        if tags.get('artist') and meta.get('source') != 'youtube':
            id3_track = parse_artist_title(tags.get('title') or '')[1] or track
            if id3_track:
                return tags['artist'].strip(), id3_track.strip()

    for tag in meta.get('tags') or []:
        match = MUSICAL_ARTIST_TAG.match(tag)
        if match and track:
            return match.group(1).strip(), track

    if meta.get('artist') and track:
        return meta['artist'].strip(), track
    if meta.get('uploader') and track:
        return _clean_uploader(meta['uploader']), track
    return '', (track or title or '').strip()
