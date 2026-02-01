"""
Metadata Extractor for StemTube
Extracts artist and track name from ID3 tags and title parsing
"""

import subprocess
import json
import re
import logging
from typing import Tuple, Optional

logger = logging.getLogger(__name__)


def extract_metadata(file_path: str = None, db_title: str = None) -> Tuple[str, str]:
    """
    Extract artist and track name from multiple sources

    Priority:
    1. Parse title "Artist - Track" format (most reliable for YouTube music videos)
    2. ID3 tags from file (often contains YouTube channel name, less reliable)
    3. Fallback: use full title as track name

    Args:
        file_path: Path to audio file (MP3, etc.)
        db_title: Title from database (YouTube video title)

    Returns:
        Tuple of (artist, track_name)
    """
    artist, track = None, None

    # 1. FIRST try parsing the title (YouTube music videos are usually "Artist - Track")
    # This is more reliable than ID3 tags which often contain the uploader name
    if db_title and ' - ' in db_title:
        parsed_artist, parsed_track = parse_artist_title(db_title)
        if parsed_artist:
            artist = parsed_artist
            track = parsed_track
            logger.info(f"[METADATA] Parsed from title: artist='{artist}', track='{track}'")

    # 2. Try ID3 tags as fallback (yt-dlp often puts channel name as artist)
    if file_path and not artist:
        tags = get_id3_tags(file_path)
        if tags:
            # ID3 artist tag - use only if we couldn't parse from title
            if tags.get('artist'):
                artist = tags['artist']
                logger.info(f"[METADATA] Found artist from ID3 tags: {artist}")

            # ID3 title - try to extract track name if not already set
            if not track and tags.get('title'):
                _, parsed_track = parse_artist_title(tags['title'])
                if parsed_track:
                    track = parsed_track

    # 3. Fallback
    if not artist:
        artist = ""  # Will need user input
        logger.info("[METADATA] Artist not found, will need user input")
    if not track:
        track = db_title or "Unknown"
        logger.info(f"[METADATA] Using full title as track: {track}")

    return artist.strip(), track.strip()


def get_id3_tags(file_path: str) -> Optional[dict]:
    """
    Extract ID3 tags from audio file using ffprobe

    Args:
        file_path: Path to audio file

    Returns:
        Dictionary of tags or None
    """
    try:
        result = subprocess.run([
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_format', file_path
        ], capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            data = json.loads(result.stdout)
            tags = data.get('format', {}).get('tags', {})

            # Normalize tag keys to lowercase
            normalized = {k.lower(): v for k, v in tags.items()}

            logger.debug(f"[METADATA] ID3 tags found: {list(normalized.keys())}")
            return normalized

    except subprocess.TimeoutExpired:
        logger.warning(f"[METADATA] ffprobe timeout for: {file_path}")
    except json.JSONDecodeError:
        logger.warning(f"[METADATA] ffprobe invalid JSON for: {file_path}")
    except FileNotFoundError:
        logger.warning("[METADATA] ffprobe not found in PATH")
    except Exception as e:
        logger.error(f"[METADATA] ffprobe error: {e}")

    return None


def parse_artist_title(title: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse "Artist - Track (Extra Info)" format

    Examples:
        "Amy Winehouse - Back To Black" -> ("Amy Winehouse", "Back To Black")
        "Sting - It's Probably Me (feat. Eric Clapton)" -> ("Sting", "It's Probably Me")
        "Teddy Swims - Lose Control (Official Video)" -> ("Teddy Swims", "Lose Control")
        "Some Track Title" -> (None, "Some Track Title")

    Args:
        title: Full title string

    Returns:
        Tuple of (artist, track_name) - artist may be None if not parseable
    """
    if not title:
        return None, None

    # Clean up common YouTube suffixes
    clean_title = title

    # Remove common video type suffixes
    patterns_to_remove = [
        r'\s*[\(\[]\s*(Official\s*)?(Music\s*)?(Video|Audio|Lyrics?|Visualizer|Clip)\s*[\)\]]',
        r'\s*[\(\[]\s*(HD|HQ|4K|1080p|720p)\s*[\)\]]',
        r'\s*[\(\[]\s*(Live|Acoustic|Remix|Cover|Version)\s*[\)\]]',
        r'\s*[\(\[]\s*(Audio(\s*Only)?|Video(\s*Only)?)\s*[\)\]]',
        r'\s*[\(\[]\s*\d{4}\s*[\)\]]',  # Year like (2023)
    ]

    for pattern in patterns_to_remove:
        clean_title = re.sub(pattern, '', clean_title, flags=re.IGNORECASE)

    # Remove trailing parentheses content that's likely not part of song title
    # But keep things like "(feat. Someone)" or "(Pt. 2)"
    clean_title = re.sub(r'\s*[\(\[](?!feat|ft|pt|part)[^)\]]*[\)\]]\s*$', '', clean_title, flags=re.IGNORECASE)

    # Trim whitespace
    clean_title = clean_title.strip()

    # Split on " - " (standard YouTube music video format)
    if ' - ' in clean_title:
        parts = clean_title.split(' - ', 1)
        artist = parts[0].strip()
        track = parts[1].strip()

        # Clean up track name - remove remaining parentheses if they look like metadata
        track = re.sub(r'\s*[\(\[](?!feat|ft|pt|part)[^)\]]*[\)\]]\s*$', '', track, flags=re.IGNORECASE).strip()

        return artist, track

    # No separator found - return None for artist, full title as track
    return None, clean_title


def format_for_display(artist: str, track: str) -> str:
    """Format artist and track for display"""
    if artist:
        return f"{artist} - {track}"
    return track


# Test if run directly
if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    # Test title parsing
    test_titles = [
        "Amy Winehouse - Back To Black",
        "Selah Sue - Alone (Official Video)",
        "Teddy Swims - Lose Control (The Village Sessions)",
        "Sting - It's Probably Me (feat. Eric Clapton) (Original Promo)",
        "Some Random Track Without Artist",
        "Artist Name - Song Title (Official Music Video) (HD)",
        "Band - Track Name (Live at Venue 2023)",
    ]

    print("=== Title Parsing Tests ===\n")
    for title in test_titles:
        artist, track = parse_artist_title(title)
        print(f"Input:  {title}")
        print(f"Artist: {artist or '(none)'}")
        print(f"Track:  {track}")
        print()

    # Test with file if provided
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
        print(f"\n=== File Metadata Test ===\n")
        print(f"File: {file_path}\n")

        tags = get_id3_tags(file_path)
        if tags:
            print("ID3 Tags:")
            for key, value in tags.items():
                print(f"  {key}: {value}")

        artist, track = extract_metadata(file_path)
        print(f"\nExtracted:")
        print(f"  Artist: {artist or '(none)'}")
        print(f"  Track:  {track}")
