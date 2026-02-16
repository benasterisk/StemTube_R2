"""
Lyrics Merger — Combines Musixmatch text with Whisper timestamps.

Musixmatch provides correct lyrics text but timestamps are often early.
Whisper provides accurate timestamps aligned to audio but may get words wrong.
This module merges both: Musixmatch text + Whisper timing = best of both worlds.
"""

import re
import logging
from difflib import SequenceMatcher
from typing import List, Dict, Tuple, Optional

logger = logging.getLogger(__name__)


def normalize_word(word: str) -> str:
    """Normalize word for comparison: lowercase, strip punctuation."""
    return re.sub(r"[^\w']", "", word.lower().strip())


def flatten_words(segments: List[Dict], tag_seg_idx: bool = False) -> List[Dict]:
    """Flatten segment list into a single word list."""
    words = []
    for seg_idx, seg in enumerate(segments):
        for word in seg.get('words', []):
            w = word.copy()
            if tag_seg_idx:
                w['_seg_idx'] = seg_idx
            words.append(w)
    return words


def interpolate_timestamps(words: List[Dict], start_idx: int, end_idx: int,
                           time_start: float, time_end: float):
    """Distribute a time range evenly across words[start_idx:end_idx]."""
    count = end_idx - start_idx
    if count <= 0:
        return
    duration = (time_end - time_start) / count
    for k, idx in enumerate(range(start_idx, end_idx)):
        words[idx]['start'] = round(time_start + k * duration, 3)
        words[idx]['end'] = round(time_start + (k + 1) * duration, 3)
        words[idx]['_source'] = 'interpolated'


def find_nearest_timestamps(words: List[Dict], idx: int) -> Tuple[Optional[float], Optional[float]]:
    """Find nearest matched timestamps before and after a given index."""
    before_end = None
    after_start = None

    # Search backward for a matched/interpolated word
    for i in range(idx - 1, -1, -1):
        if words[i].get('_source') in ('matched', 'interpolated'):
            before_end = words[i]['end']
            break

    # Search forward for a matched/interpolated word
    for i in range(idx + 1, len(words)):
        if words[i].get('_source') in ('matched', 'interpolated'):
            after_start = words[i]['start']
            break

    return before_end, after_start


def merge_lyrics(musixmatch_segments: List[Dict],
                 whisper_segments: List[Dict]) -> Tuple[List[Dict], Dict]:
    """
    Merge Musixmatch text with Whisper timestamps.

    Args:
        musixmatch_segments: Segments from Musixmatch with word-level data
        whisper_segments: Segments from Whisper with word-level timestamps

    Returns:
        Tuple of (merged_segments, stats_dict)
    """
    # Flatten both into word lists
    mm_words = flatten_words(musixmatch_segments, tag_seg_idx=True)
    wh_words = flatten_words(whisper_segments)

    if not mm_words:
        logger.warning("[MERGE] No Musixmatch words found")
        return musixmatch_segments, {"source": "musixmatch", "match_rate": 0}

    if not wh_words:
        logger.warning("[MERGE] No Whisper words found")
        return musixmatch_segments, {"source": "musixmatch", "match_rate": 0}

    logger.info(f"[MERGE] Aligning {len(mm_words)} Musixmatch words with {len(wh_words)} Whisper words")

    # Normalize for comparison
    mm_normalized = [normalize_word(w.get('word', '')) for w in mm_words]
    wh_normalized = [normalize_word(w.get('word', '')) for w in wh_words]

    # Sequence matching
    matcher = SequenceMatcher(None, mm_normalized, wh_normalized, autojunk=False)
    opcodes = matcher.get_opcodes()

    matched_count = 0
    interpolated_count = 0
    deleted_count = 0

    for tag, i1, i2, j1, j2 in opcodes:
        if tag == 'equal':
            # Words match — apply Whisper timestamps to Musixmatch text
            for k, mm_idx in enumerate(range(i1, i2)):
                wh_idx = j1 + k
                mm_words[mm_idx]['start'] = wh_words[wh_idx]['start']
                mm_words[mm_idx]['end'] = wh_words[wh_idx]['end']
                mm_words[mm_idx]['_source'] = 'matched'
                matched_count += 1

        elif tag == 'replace':
            # Words differ — distribute Whisper time range across Musixmatch words
            wh_start = wh_words[j1]['start']
            wh_end = wh_words[j2 - 1]['end']
            interpolate_timestamps(mm_words, i1, i2, wh_start, wh_end)
            interpolated_count += (i2 - i1)

        elif tag == 'insert':
            # Extra Whisper words not in Musixmatch — skip
            pass

        elif tag == 'delete':
            # Musixmatch words not found in Whisper — mark for interpolation
            for mm_idx in range(i1, i2):
                mm_words[mm_idx]['_source'] = 'deleted'
                deleted_count += 1

    # Fix deleted words: interpolate from surrounding matched timestamps
    for i, w in enumerate(mm_words):
        if w.get('_source') == 'deleted':
            before_end, after_start = find_nearest_timestamps(mm_words, i)
            if before_end is not None and after_start is not None:
                # Interpolate between neighbors
                mm_words[i]['start'] = round(before_end, 3)
                mm_words[i]['end'] = round(after_start, 3)
                mm_words[i]['_source'] = 'interpolated'
                interpolated_count += 1
                deleted_count -= 1
            elif before_end is not None:
                mm_words[i]['start'] = round(before_end, 3)
                mm_words[i]['end'] = round(before_end + 0.3, 3)
                mm_words[i]['_source'] = 'interpolated'
                interpolated_count += 1
                deleted_count -= 1
            elif after_start is not None:
                mm_words[i]['start'] = round(max(0, after_start - 0.3), 3)
                mm_words[i]['end'] = round(after_start, 3)
                mm_words[i]['_source'] = 'interpolated'
                interpolated_count += 1
                deleted_count -= 1
            # else: keep original Musixmatch timestamps

    # Clean up internal fields and rebuild segments
    merged_segments = []
    for seg_idx, seg in enumerate(musixmatch_segments):
        seg_words = [w for w in mm_words if w.get('_seg_idx') == seg_idx]

        # Clean internal fields from words
        cleaned_words = []
        for w in seg_words:
            cleaned = {
                'word': w['word'],
                'start': w['start'],
                'end': w['end']
            }
            cleaned_words.append(cleaned)

        new_seg = {
            'start': cleaned_words[0]['start'] if cleaned_words else seg['start'],
            'end': cleaned_words[-1]['end'] if cleaned_words else seg['end'],
            'text': seg['text'],
            'words': cleaned_words
        }
        merged_segments.append(new_seg)

    total = len(mm_words)
    match_rate = round(matched_count / total * 100, 1) if total > 0 else 0

    stats = {
        "source": "musixmatch+whisper",
        "total_words": total,
        "matched_words": matched_count,
        "interpolated_words": interpolated_count,
        "unmatched_words": deleted_count,
        "match_rate": match_rate,
        "whisper_words": len(wh_words)
    }

    logger.info(f"[MERGE] Complete: {matched_count}/{total} matched ({match_rate}%), "
                f"{interpolated_count} interpolated, {deleted_count} unmatched")

    return merged_segments, stats
