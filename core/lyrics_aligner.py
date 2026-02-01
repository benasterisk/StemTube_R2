"""
Lyrics Word Aligner - Enriches LrcLib lyrics with word-level timestamps from Whisper

This module combines the accuracy of LrcLib text (crowdsourced, edited) with the
precision of Whisper's word-level timing, enabling word-by-word karaoke highlighting
and accurate chord placement.
"""

import os
import logging
from difflib import SequenceMatcher
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


def similarity(a: str, b: str) -> float:
    """
    Calculate similarity ratio between two strings (0.0 to 1.0)

    Examples:
        similarity("were", "where") -> 0.89
        similarity("love", "above") -> 0.50
        similarity("hello", "hello") -> 1.0
    """
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def find_best_match(
    target_word: str,
    whisper_words: List[Dict],
    start_idx: int,
    window_size: int = 15
) -> Optional[Tuple[Dict, int]]:
    """
    Find the best matching Whisper word for a target LrcLib word

    Args:
        target_word: The word from LrcLib to match
        whisper_words: List of Whisper words with timestamps
        start_idx: Starting index in whisper_words to search from
        window_size: How many words ahead to search

    Returns:
        Tuple of (matched_word_dict, index) or None if no good match
    """
    if not whisper_words or start_idx >= len(whisper_words):
        return None

    best_match = None
    best_score = 0.0
    best_idx = start_idx

    # Search within window
    end_idx = min(start_idx + window_size, len(whisper_words))

    for i in range(start_idx, end_idx):
        whisper_word = whisper_words[i].get('word', '')
        score = similarity(target_word, whisper_word)

        if score > best_score:
            best_score = score
            best_match = whisper_words[i]
            best_idx = i

    # Return match only if similarity is above threshold
    if best_score >= 0.6:
        return (best_match, best_idx)

    return None


def interpolate_timestamps(
    words: List[Dict],
    line_start: float,
    line_end: float
) -> List[Dict]:
    """
    Fill in missing timestamps by interpolating between known values

    Args:
        words: List of word dicts, some may have start/end = None
        line_start: Start time of the line
        line_end: End time of the line

    Returns:
        Words list with all timestamps filled in
    """
    if not words:
        return words

    # Find segments of words that need interpolation
    result = []

    for i, word in enumerate(words):
        result.append(word.copy())

    # First pass: identify anchor points (words with timestamps)
    anchors = []  # (index, start, end)
    for i, word in enumerate(result):
        if word.get('start') is not None and word.get('end') is not None:
            anchors.append((i, word['start'], word['end']))

    # If no anchors, distribute evenly across the line
    if not anchors:
        total_chars = sum(len(w.get('word', '')) for w in result)
        if total_chars == 0:
            total_chars = len(result)  # Fallback: equal distribution

        current_time = line_start
        duration = line_end - line_start

        for word in result:
            word_len = len(word.get('word', '')) or 1
            word_duration = (word_len / total_chars) * duration
            word['start'] = round(current_time, 2)
            word['end'] = round(current_time + word_duration, 2)
            current_time += word_duration

        return result

    # Add virtual anchors at start and end
    if anchors[0][0] > 0:
        anchors.insert(0, (-1, line_start, line_start))
    if anchors[-1][0] < len(result) - 1:
        anchors.append((len(result), line_end, line_end))

    # Interpolate between anchors
    for a_idx in range(len(anchors) - 1):
        start_anchor = anchors[a_idx]
        end_anchor = anchors[a_idx + 1]

        start_idx = start_anchor[0] + 1
        end_idx = end_anchor[0]

        if start_idx >= end_idx:
            continue

        # Calculate available time and characters
        time_start = start_anchor[2]  # End of previous word
        time_end = end_anchor[1]      # Start of next word

        words_to_fill = result[start_idx:end_idx]
        total_chars = sum(len(w.get('word', '')) or 1 for w in words_to_fill)

        if total_chars == 0:
            continue

        duration = time_end - time_start
        current_time = time_start

        for word in words_to_fill:
            word_len = len(word.get('word', '')) or 1
            word_duration = (word_len / total_chars) * duration
            word['start'] = round(current_time, 2)
            word['end'] = round(current_time + word_duration, 2)
            current_time += word_duration

    return result


def align_line(
    lrclib_text: str,
    whisper_words: List[Dict],
    line_start: float,
    line_end: float,
    whisper_start_idx: int = 0
) -> Tuple[List[Dict], int]:
    """
    Align a single LrcLib line with Whisper word timestamps

    Args:
        lrclib_text: Text of the LrcLib line
        whisper_words: All Whisper words for the song
        line_start: Start time of the LrcLib line
        line_end: End time of the LrcLib line
        whisper_start_idx: Index to start searching in whisper_words

    Returns:
        Tuple of (aligned_words, next_whisper_idx)
    """
    # Split LrcLib text into words
    lrclib_words = lrclib_text.split()

    if not lrclib_words:
        return [], whisper_start_idx

    aligned = []
    current_whisper_idx = whisper_start_idx

    for lrc_word in lrclib_words:
        # Try to find a matching Whisper word
        match = find_best_match(lrc_word, whisper_words, current_whisper_idx)

        if match:
            matched_word, matched_idx = match
            aligned.append({
                'word': lrc_word,  # Keep LrcLib text
                'start': matched_word.get('start'),
                'end': matched_word.get('end'),
                '_matched': True  # Track for stats
            })
            current_whisper_idx = matched_idx + 1
        else:
            # No match - mark for interpolation
            aligned.append({
                'word': lrc_word,
                'start': None,
                'end': None,
                '_matched': False  # Track for stats
            })

    # Interpolate missing timestamps
    aligned = interpolate_timestamps(aligned, line_start, line_end)

    return aligned, current_whisper_idx


def align_lyrics_with_whisper(
    lrclib_lyrics: List[Dict],
    whisper_lyrics: List[Dict],
    return_stats: bool = False
) -> Dict:
    """
    Main alignment function: combine LrcLib text with Whisper timestamps

    Args:
        lrclib_lyrics: Lyrics from LrcLib (line-level timestamps, no words array)
        whisper_lyrics: Lyrics from Whisper (word-level timestamps)
        return_stats: If True, return dict with lyrics and alignment stats

    Returns:
        If return_stats=False: List of enriched lyrics segments
        If return_stats=True: Dict with 'lyrics', 'stats' keys
    """
    def make_result(lyrics, stats):
        """Helper to return results in the correct format"""
        if return_stats:
            return {'lyrics': lyrics, 'stats': stats}
        return lyrics

    empty_stats = {
        'total_words': 0,
        'matched_words': 0,
        'interpolated_words': 0,
        'match_rate': 0.0,
        'whisper_words_available': 0
    }

    if not lrclib_lyrics:
        return make_result(lrclib_lyrics, empty_stats)

    if not whisper_lyrics:
        # No Whisper data - return LrcLib as-is with estimated word timestamps
        logger.warning("[ALIGNER] No Whisper data available, estimating word timestamps")
        result = []
        total_words = 0
        for segment in lrclib_lyrics:
            words = segment.get('text', '').split()
            if not words:
                result.append(segment)
                continue

            total_words += len(words)

            # Create word timestamps by estimation
            aligned_words = interpolate_timestamps(
                [{'word': w, 'start': None, 'end': None} for w in words],
                segment.get('start', 0),
                segment.get('end', 0)
            )

            result.append({
                'start': segment.get('start'),
                'end': segment.get('end'),
                'text': segment.get('text'),
                'words': aligned_words
            })

        stats = {
            'total_words': total_words,
            'matched_words': 0,
            'interpolated_words': total_words,
            'match_rate': 0.0,
            'whisper_words_available': 0
        }
        return make_result(result, stats)

    # Flatten all Whisper words into a single list with absolute timestamps
    all_whisper_words = []
    for segment in whisper_lyrics:
        if 'words' in segment and segment['words']:
            all_whisper_words.extend(segment['words'])

    if not all_whisper_words:
        logger.warning("[ALIGNER] Whisper data has no word-level timestamps")
        # Fallback to estimation
        return align_lyrics_with_whisper(lrclib_lyrics, None, return_stats=return_stats)

    logger.info(f"[ALIGNER] Aligning {len(lrclib_lyrics)} LrcLib lines with {len(all_whisper_words)} Whisper words")

    # PHASE 1: Match all LrcLib words with Whisper words (no interpolation yet)
    all_lrclib_words = []  # Flat list of all words with line references
    whisper_idx = 0

    for line_idx, segment in enumerate(lrclib_lyrics):
        text = segment.get('text', '')
        lrclib_words = text.split()

        for word in lrclib_words:
            # Try to find matching Whisper word
            match = find_best_match(word, all_whisper_words, whisper_idx, window_size=15)

            if match:
                matched_word, matched_idx = match
                all_lrclib_words.append({
                    'word': word,
                    'line_idx': line_idx,
                    'start': matched_word.get('start'),
                    'end': matched_word.get('end'),
                    '_matched': True
                })
                whisper_idx = matched_idx + 1
            else:
                all_lrclib_words.append({
                    'word': word,
                    'line_idx': line_idx,
                    'start': None,
                    'end': None,
                    '_matched': False
                })

    # PHASE 2: Interpolate unmatched words between matched anchors
    # Find all matched words as anchors
    anchors = []  # (global_word_idx, start, end)
    for i, w in enumerate(all_lrclib_words):
        if w['_matched'] and w['start'] is not None:
            anchors.append((i, w['start'], w['end']))

    # Add virtual anchors at start and end if needed
    if anchors:
        first_anchor_idx = anchors[0][0]
        last_anchor_idx = anchors[-1][0]

        # If first words are unmatched, use first anchor's start
        if first_anchor_idx > 0:
            first_start = max(0, anchors[0][1] - 2.0)  # 2 seconds before first match
            anchors.insert(0, (-1, first_start, first_start))

        # If last words are unmatched, use last anchor's end
        if last_anchor_idx < len(all_lrclib_words) - 1:
            last_end = anchors[-1][2] + 5.0  # 5 seconds after last match
            anchors.append((len(all_lrclib_words), last_end, last_end))

    # Interpolate between consecutive anchors
    for a_idx in range(len(anchors) - 1):
        start_anchor = anchors[a_idx]
        end_anchor = anchors[a_idx + 1]

        start_word_idx = start_anchor[0] + 1
        end_word_idx = end_anchor[0]

        if start_word_idx >= end_word_idx:
            continue

        # Get words that need interpolation
        words_to_interpolate = all_lrclib_words[start_word_idx:end_word_idx]
        unmatched_words = [w for w in words_to_interpolate if not w['_matched']]

        if not unmatched_words:
            continue

        # Calculate time range for interpolation
        time_start = start_anchor[2]  # End time of previous matched word
        time_end = end_anchor[1]      # Start time of next matched word

        # Distribute timestamps proportionally by character count
        total_chars = sum(len(w['word']) for w in unmatched_words) or 1
        duration = time_end - time_start
        current_time = time_start

        for w in words_to_interpolate:
            if not w['_matched']:
                word_len = len(w['word']) or 1
                word_duration = (word_len / total_chars) * duration
                w['start'] = round(current_time, 2)
                w['end'] = round(current_time + word_duration, 2)
                current_time += word_duration

    # PHASE 3: Rebuild line structure with aligned words
    result = []
    matched_count = 0
    interpolated_count = 0

    for line_idx, segment in enumerate(lrclib_lyrics):
        text = segment.get('text', '')

        # Get words for this line
        line_words = [w for w in all_lrclib_words if w['line_idx'] == line_idx]

        # Count matches
        for w in line_words:
            if w.get('_matched', False):
                matched_count += 1
            else:
                interpolated_count += 1

        # Determine segment timestamps from words
        if line_words:
            segment_start = line_words[0].get('start') or segment.get('start', 0)
            segment_end = line_words[-1].get('end') or segment.get('end', segment_start + 5)
        else:
            segment_start = segment.get('start', 0)
            segment_end = segment.get('end', segment_start + 5)

        result.append({
            'start': segment_start,
            'end': segment_end,
            'text': text,
            'words': line_words
        })

    total_words = matched_count + interpolated_count
    match_rate = (matched_count / total_words * 100) if total_words > 0 else 0.0

    logger.info(f"[ALIGNER] Alignment complete: {len(result)} segments, {matched_count}/{total_words} words matched ({match_rate:.1f}%)")

    stats = {
        'total_words': total_words,
        'matched_words': matched_count,
        'interpolated_words': interpolated_count,
        'match_rate': round(match_rate, 1),
        'whisper_words_available': len(all_whisper_words)
    }

    return make_result(result, stats)


def enrich_lrclib_with_whisper(
    lrclib_lyrics: List[Dict],
    audio_path: str,
    use_gpu: bool = False,
    model_size: str = "medium",
    return_stats: bool = False
) -> Dict:
    """
    High-level function: fetch Whisper timestamps and align with LrcLib

    Args:
        lrclib_lyrics: Lyrics from LrcLib
        audio_path: Path to audio file (preferably vocals stem)
        use_gpu: Use GPU for Whisper
        model_size: Whisper model size
        return_stats: If True, return dict with 'lyrics' and 'stats'

    Returns:
        If return_stats=False: List of enriched lyrics segments
        If return_stats=True: Dict with 'lyrics', 'stats' keys
    """
    def make_result(lyrics, stats=None):
        if return_stats:
            return {'lyrics': lyrics, 'stats': stats}
        return lyrics

    empty_stats = {
        'total_words': 0, 'matched_words': 0, 'interpolated_words': 0,
        'match_rate': 0.0, 'whisper_words_available': 0
    }

    if not lrclib_lyrics:
        return make_result(lrclib_lyrics, empty_stats)

    if not audio_path or not os.path.exists(audio_path):
        logger.warning(f"[ALIGNER] Audio file not found: {audio_path}")
        result = align_lyrics_with_whisper(lrclib_lyrics, None, return_stats=True)
        return make_result(result['lyrics'], result['stats'])

    logger.info(f"[ALIGNER] Running Whisper alignment on: {audio_path}")

    try:
        from core.lyrics_detector import detect_song_lyrics

        # Run Whisper to get word timestamps
        whisper_lyrics = detect_song_lyrics(
            audio_path=audio_path,
            model_size=model_size,
            use_gpu=use_gpu
        )

        if whisper_lyrics:
            logger.info(f"[ALIGNER] Whisper transcribed {len(whisper_lyrics)} segments")
            result = align_lyrics_with_whisper(lrclib_lyrics, whisper_lyrics, return_stats=True)
            return make_result(result['lyrics'], result['stats'])
        else:
            logger.warning("[ALIGNER] Whisper returned no results, using estimation")
            result = align_lyrics_with_whisper(lrclib_lyrics, None, return_stats=True)
            return make_result(result['lyrics'], result['stats'])

    except Exception as e:
        logger.error(f"[ALIGNER] Error running Whisper: {e}", exc_info=True)
        result = align_lyrics_with_whisper(lrclib_lyrics, None, return_stats=True)
        return make_result(result['lyrics'], result['stats'])


# Test if run directly
if __name__ == "__main__":
    import json

    logging.basicConfig(level=logging.INFO)

    # Test data
    lrclib_sample = [
        {"start": 0.0, "end": 3.0, "text": "When you were here before"},
        {"start": 3.0, "end": 6.0, "text": "Couldn't look you in the eye"},
    ]

    whisper_sample = [
        {
            "start": 0.0, "end": 3.0, "text": "When you where here before",
            "words": [
                {"start": 0.0, "end": 0.4, "word": "When"},
                {"start": 0.5, "end": 0.8, "word": "you"},
                {"start": 0.9, "end": 1.3, "word": "where"},  # Whisper error
                {"start": 1.4, "end": 1.8, "word": "here"},
                {"start": 1.9, "end": 2.8, "word": "before"},
            ]
        },
        {
            "start": 3.0, "end": 6.0, "text": "Couldn't look you in the eye",
            "words": [
                {"start": 3.0, "end": 3.4, "word": "Couldn't"},
                {"start": 3.5, "end": 3.8, "word": "look"},
                {"start": 3.9, "end": 4.1, "word": "you"},
                {"start": 4.2, "end": 4.4, "word": "in"},
                {"start": 4.5, "end": 4.7, "word": "the"},
                {"start": 4.8, "end": 5.8, "word": "eye"},
            ]
        }
    ]

    print("=== LrcLib Input ===")
    print(json.dumps(lrclib_sample, indent=2))

    print("\n=== Whisper Input ===")
    print(json.dumps(whisper_sample, indent=2))

    result = align_lyrics_with_whisper(lrclib_sample, whisper_sample)

    print("\n=== Aligned Output ===")
    print(json.dumps(result, indent=2))

    print("\n=== Verification ===")
    for seg in result:
        print(f"\nLine: {seg['text']}")
        if 'words' in seg:
            for w in seg['words']:
                print(f"  [{w['start']:.2f}-{w['end']:.2f}] {w['word']}")
