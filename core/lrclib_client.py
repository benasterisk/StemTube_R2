"""
LrcLib API client for fetching synchronized lyrics
https://lrclib.net/docs
"""

import requests
import re
import logging
from typing import Optional, List, Dict

logger = logging.getLogger(__name__)

LRCLIB_API = "https://lrclib.net/api"
USER_AGENT = "StemTube/1.3 (https://github.com/stemtube)"


def parse_lrc_timestamp(timestamp: str) -> float:
    """
    Parse LRC timestamp [MM:SS.MS] to seconds

    Examples:
        "[00:19.16]" -> 19.16
        "[01:23.45]" -> 83.45
    """
    match = re.match(r'\[(\d+):(\d+)\.(\d+)\]', timestamp)
    if match:
        minutes, seconds, centiseconds = match.groups()
        return int(minutes) * 60 + int(seconds) + int(centiseconds) / 100
    return 0.0


def parse_synced_lyrics(synced_lyrics: str) -> List[Dict]:
    """
    Parse LRC format to StemTube lyrics data structure

    Input format:
        "[00:19.16] When you were here before"
        "[00:24.09] Couldn't look you in the eye"

    Output format (compatible with faster-whisper):
        [
            {"start": 19.16, "end": 24.09, "text": "When you were here before"},
            {"start": 24.09, "end": 29.00, "text": "Couldn't look you in the eye"}
        ]
    """
    if not synced_lyrics:
        return []

    lines = synced_lyrics.strip().split('\n')
    lyrics_data = []

    for i, line in enumerate(lines):
        # Match timestamp and text
        match = re.match(r'(\[\d+:\d+\.\d+\])\s*(.*)', line)
        if match:
            timestamp, text = match.groups()
            start = parse_lrc_timestamp(timestamp)

            # Calculate end time = start of next line or +5 seconds
            end = start + 5.0  # Default duration
            if i + 1 < len(lines):
                next_match = re.match(r'(\[\d+:\d+\.\d+\])', lines[i + 1])
                if next_match:
                    end = parse_lrc_timestamp(next_match.group(1))

            # Only add non-empty lines
            if text.strip():
                lyrics_data.append({
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": text.strip()
                })

    return lyrics_data


def fetch_lyrics(
    track_name: str,
    artist_name: str,
    album_name: Optional[str] = None,
    duration: Optional[float] = None
) -> Optional[List[Dict]]:
    """
    Fetch lyrics from LrcLib API

    Args:
        track_name: Song title
        artist_name: Artist name
        album_name: Album name (optional, improves accuracy)
        duration: Track duration in seconds (optional, improves accuracy)

    Returns:
        List of lyrics segments in StemTube format, or None if not found
    """
    if not track_name or not artist_name:
        logger.warning("[LRCLIB] track_name and artist_name are required")
        return None

    params = {
        "track_name": track_name,
        "artist_name": artist_name
    }
    if album_name:
        params["album_name"] = album_name
    if duration:
        params["duration"] = int(duration)

    logger.info(f"[LRCLIB] Fetching lyrics for: {artist_name} - {track_name}")

    try:
        response = requests.get(
            f"{LRCLIB_API}/get",
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()

            # Log what we found
            has_synced = bool(data.get("syncedLyrics"))
            has_plain = bool(data.get("plainLyrics"))
            logger.info(f"[LRCLIB] Found lyrics - synced: {has_synced}, plain: {has_plain}")

            # Prefer synced lyrics (with timestamps)
            if data.get("syncedLyrics"):
                lyrics = parse_synced_lyrics(data["syncedLyrics"])
                if lyrics:
                    logger.info(f"[LRCLIB] Parsed {len(lyrics)} synced lyrics lines")
                    return lyrics

            # Fallback to plain lyrics (no timestamps - single block)
            if data.get("plainLyrics"):
                logger.info("[LRCLIB] Using plain lyrics (no timestamps)")
                return [{
                    "start": 0.0,
                    "end": duration or 300.0,
                    "text": data["plainLyrics"]
                }]

        elif response.status_code == 404:
            logger.info(f"[LRCLIB] Lyrics not found for: {artist_name} - {track_name}")
        else:
            logger.warning(f"[LRCLIB] API error: {response.status_code}")

        return None

    except requests.Timeout:
        logger.error("[LRCLIB] Request timeout")
        return None
    except requests.RequestException as e:
        logger.error(f"[LRCLIB] Request error: {e}")
        return None
    except Exception as e:
        logger.error(f"[LRCLIB] Unexpected error: {e}")
        return None


def search_lyrics(query: str, limit: int = 10) -> List[Dict]:
    """
    Search for tracks on LrcLib

    Args:
        query: Search query (artist name, track name, or both)
        limit: Maximum number of results

    Returns:
        List of matching tracks with metadata
    """
    if not query:
        return []

    try:
        response = requests.get(
            f"{LRCLIB_API}/search",
            params={"q": query},
            headers={"User-Agent": USER_AGENT},
            timeout=10
        )

        if response.status_code == 200:
            results = response.json()
            return results[:limit] if isinstance(results, list) else []

        return []

    except Exception as e:
        logger.error(f"[LRCLIB] Search error: {e}")
        return []


# Test if run directly
if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 3:
        print("Usage: python lrclib_client.py <artist> <track>")
        print("Example: python lrclib_client.py 'Amy Winehouse' 'Back To Black'")
        sys.exit(1)

    artist = sys.argv[1]
    track = sys.argv[2]

    print(f"\nSearching for: {artist} - {track}\n")

    lyrics = fetch_lyrics(track, artist)

    if lyrics:
        print(f"Found {len(lyrics)} lyrics lines:\n")
        for i, line in enumerate(lyrics[:15], 1):
            mins = int(line['start'] // 60)
            secs = int(line['start'] % 60)
            print(f"[{mins:02d}:{secs:02d}] {line['text']}")

        if len(lyrics) > 15:
            print(f"\n... and {len(lyrics) - 15} more lines")
    else:
        print("Lyrics not found")
