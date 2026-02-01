"""
SyncedLyrics Client - Fetches word-level synchronized lyrics

This module uses the syncedlyrics library to fetch lyrics with word-level
timestamps (Enhanced LRC format), eliminating the need for Whisper alignment.
"""

import re
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


def parse_enhanced_lrc(lrc_content: str) -> List[Dict]:
    """
    Parse Enhanced LRC format with word-level timestamps.

    Format: [MM:SS.ms] <MM:SS.ms> word1 <MM:SS.ms> word2 ...

    Args:
        lrc_content: Raw Enhanced LRC string

    Returns:
        List of segments with word-level timestamps:
        [
            {
                'start': 1.19,
                'end': 6.5,
                'text': 'Well, someone told me yesterday',
                'words': [
                    {'word': 'Well,', 'start': 1.19, 'end': 1.47},
                    {'word': 'someone', 'start': 1.47, 'end': 1.90},
                    ...
                ]
            },
            ...
        ]
    """
    if not lrc_content:
        return []

    segments = []
    lines = lrc_content.strip().split('\n')

    # Regex patterns
    line_time_pattern = re.compile(r'^\[(\d{2}):(\d{2})\.(\d{2,3})\]')
    word_pattern = re.compile(r'<(\d{2}):(\d{2})\.(\d{2,3})>\s*([^<\[\]]+)')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Extract line start time
        line_match = line_time_pattern.match(line)
        if not line_match:
            continue

        line_start = _parse_timestamp(line_match.group(1), line_match.group(2), line_match.group(3))

        # Extract all words with timestamps
        words = []
        for word_match in word_pattern.finditer(line):
            word_start = _parse_timestamp(word_match.group(1), word_match.group(2), word_match.group(3))
            word_text = word_match.group(4).strip()

            # Skip empty or whitespace-only
            if not word_text:
                continue

            words.append({
                'word': word_text,
                'start': word_start,
                'end': None  # Will be filled in next pass
            })

        if not words:
            continue

        # Calculate end times (each word ends when next word starts)
        for i in range(len(words) - 1):
            words[i]['end'] = words[i + 1]['start']

        # Last word ends at next line start or +0.5s
        # We'll fix this in post-processing
        if words:
            words[-1]['end'] = words[-1]['start'] + 0.5

        # Build full text
        text = ' '.join(w['word'] for w in words)

        # Use first word's timestamp for segment start (not line_start)
        # This ensures segment activation syncs with word highlighting
        segment_start = words[0]['start'] if words else line_start

        segments.append({
            'start': segment_start,
            'end': words[-1]['end'] if words else line_start,
            'text': text,
            'words': words
        })

    # Post-process: fix last word end times using next segment start
    for i in range(len(segments) - 1):
        if segments[i]['words']:
            # Last word of this segment ends when next segment starts
            next_start = segments[i + 1]['start']
            last_word = segments[i]['words'][-1]

            # Only extend if reasonable (< 3 seconds gap)
            if next_start - last_word['start'] < 3.0:
                last_word['end'] = next_start

            # Update segment end time
            segments[i]['end'] = last_word['end']

    return segments


def _parse_timestamp(minutes: str, seconds: str, milliseconds: str) -> float:
    """Convert MM:SS.ms to seconds as float"""
    ms = milliseconds
    # Handle both 2-digit (centiseconds) and 3-digit (milliseconds)
    if len(ms) == 2:
        ms = int(ms) * 10
    else:
        ms = int(ms)

    return int(minutes) * 60 + int(seconds) + ms / 1000.0


def fetch_lyrics_enhanced(
    track_name: str,
    artist_name: str = None,
    allow_plain: bool = False
) -> Optional[List[Dict]]:
    """
    Fetch word-level synchronized lyrics using syncedlyrics.

    Args:
        track_name: Song title
        artist_name: Artist name (optional but recommended)
        allow_plain: If True, fall back to line-level if word-level unavailable

    Returns:
        List of segments with word-level timestamps, or None if not found
    """
    try:
        import syncedlyrics
    except ImportError:
        logger.error("[SYNCEDLYRICS] syncedlyrics package not installed. Run: pip install syncedlyrics")
        return None

    # Build search query
    if artist_name:
        query = f"{artist_name} {track_name}"
    else:
        query = track_name

    logger.info(f"[SYNCEDLYRICS] Searching for: {query}")

    try:
        # Try enhanced (word-level) first
        result = syncedlyrics.search(query, enhanced=True)

        if result and '<' in result:  # Enhanced format has <timestamps>
            logger.info(f"[SYNCEDLYRICS] Found word-level lyrics ({len(result)} chars)")
            segments = parse_enhanced_lrc(result)

            if segments:
                total_words = sum(len(s.get('words', [])) for s in segments)
                logger.info(f"[SYNCEDLYRICS] Parsed {len(segments)} lines, {total_words} words with timestamps")
                return segments

        # Fall back to line-level if allowed
        if allow_plain:
            logger.info("[SYNCEDLYRICS] No word-level found, trying line-level...")
            result = syncedlyrics.search(query, enhanced=False)

            if result:
                logger.info(f"[SYNCEDLYRICS] Found line-level lyrics ({len(result)} chars)")
                # Parse standard LRC (line-level only)
                return _parse_standard_lrc(result)

        logger.warning(f"[SYNCEDLYRICS] No lyrics found for: {query}")
        return None

    except Exception as e:
        logger.error(f"[SYNCEDLYRICS] Error fetching lyrics: {e}")
        return None


def _parse_standard_lrc(lrc_content: str) -> List[Dict]:
    """
    Parse standard LRC format (line-level timestamps only).
    Falls back to this if enhanced not available.
    """
    if not lrc_content:
        return []

    segments = []
    line_pattern = re.compile(r'^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.+)$')

    for line in lrc_content.strip().split('\n'):
        line = line.strip()
        match = line_pattern.match(line)

        if match:
            timestamp = _parse_timestamp(match.group(1), match.group(2), match.group(3))
            text = match.group(4).strip()

            if text:
                segments.append({
                    'start': timestamp,
                    'end': timestamp + 5.0,  # Placeholder
                    'text': text,
                    'words': []  # No word-level timestamps
                })

    # Fix end times
    for i in range(len(segments) - 1):
        segments[i]['end'] = segments[i + 1]['start']

    return segments


# Test if run directly
if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.INFO)

    # Test with So Lonely
    result = fetch_lyrics_enhanced("So Lonely", "The Police")

    if result:
        print(f"\nFound {len(result)} segments")
        print("\nFirst 5 segments:")
        for seg in result[:5]:
            print(f"\n[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")
            if seg.get('words'):
                for w in seg['words'][:5]:
                    print(f"  [{w['start']:.2f}s - {w['end']:.2f}s] {w['word']}")
                if len(seg['words']) > 5:
                    print(f"  ... +{len(seg['words'])-5} more words")
    else:
        print("No lyrics found")
