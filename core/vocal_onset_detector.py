"""
Vocal Onset Detection - Detects when singing starts in isolated vocals track

Uses energy/onset detection on vocals.mp3 to get precise timestamps
for synchronizing with Musixmatch lyrics.
"""

import logging
import numpy as np
from typing import List, Optional

logger = logging.getLogger(__name__)


def detect_vocal_onsets(
    vocals_path: str,
    hop_length: int = 512,
    backtrack: bool = True
) -> Optional[List[float]]:
    """
    Detect energy onsets in the vocal track.

    Args:
        vocals_path: Path to vocals.mp3 (isolated vocal stem)
        hop_length: Hop length for analysis
        backtrack: Whether to backtrack to find true onset start

    Returns:
        List of timestamps (seconds) where vocal energy starts, or None on error
    """
    try:
        import librosa
    except ImportError:
        logger.error("[ONSET] librosa not installed")
        return None

    try:
        logger.info(f"[ONSET] Loading vocals: {vocals_path}")

        # Load audio
        y, sr = librosa.load(vocals_path, sr=22050, mono=True)
        duration = len(y) / sr
        logger.info(f"[ONSET] Audio loaded: {duration:.1f}s, sr={sr}")

        # Detect onsets using multiple methods for robustness
        # 1. Standard onset detection (spectral flux)
        onset_env = librosa.onset.onset_strength(
            y=y, sr=sr, hop_length=hop_length,
            aggregate=np.median  # More robust to noise
        )

        # 2. Detect onset frames
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=hop_length,
            backtrack=backtrack,
            units='frames'
        )

        # Convert to timestamps
        onset_times = librosa.frames_to_time(
            onset_frames, sr=sr, hop_length=hop_length
        )

        # Filter: remove onsets that are too close together (< 100ms)
        filtered_onsets = []
        min_gap = 0.1  # 100ms minimum between onsets

        for t in onset_times:
            if not filtered_onsets or (t - filtered_onsets[-1]) >= min_gap:
                filtered_onsets.append(round(t, 3))

        logger.info(f"[ONSET] Detected {len(filtered_onsets)} vocal onsets "
                    f"(filtered from {len(onset_times)})")

        # Log first few onsets for debugging
        if filtered_onsets:
            sample = filtered_onsets[:10]
            logger.info(f"[ONSET] First onsets: {sample}")

        return filtered_onsets

    except Exception as e:
        logger.error(f"[ONSET] Error detecting onsets: {e}", exc_info=True)
        return None


def calculate_global_offset(
    words: List[dict],
    onsets: List[float],
    search_window: float = 5.0
) -> float:
    """
    Calculate global offset between Musixmatch timestamps and detected onsets.

    Uses cross-correlation approach: find the offset that maximizes matches
    between word starts and onset times.

    Args:
        words: List of word dicts with 'start' timestamps
        onsets: List of onset timestamps
        search_window: Search range in seconds (offset can be -window to +window)

    Returns:
        Optimal offset in seconds (add to Musixmatch timestamps to align with audio)
    """
    if not words or not onsets:
        return 0.0

    # Get first meaningful word timestamp (skip instrumental intro in lyrics)
    first_word_time = None
    for w in words[:20]:  # Check first 20 words
        if w.get('start', 0) > 0.5:  # Skip words at very start
            first_word_time = w['start']
            break

    if first_word_time is None:
        first_word_time = words[0].get('start', 0)

    # Get first significant onset (skip noise at very beginning)
    first_onset_time = None
    for onset in onsets[:30]:  # Check first 30 onsets
        if onset > 1.0:  # Skip first second
            first_onset_time = onset
            break

    if first_onset_time is None and onsets:
        first_onset_time = onsets[0]

    if first_onset_time is None:
        return 0.0

    # Simple offset: difference between first onset and first word
    simple_offset = first_onset_time - first_word_time

    # Refine by testing different offsets and counting matches
    best_offset = simple_offset
    best_matches = 0
    tolerance = 0.15  # 150ms tolerance for match counting

    # Test offsets around the simple estimate
    for delta in np.arange(-1.0, 1.0, 0.05):
        test_offset = simple_offset + delta
        matches = 0

        for word in words:
            adjusted_time = word['start'] + test_offset
            # Check if any onset is close to this adjusted time
            for onset in onsets:
                if abs(onset - adjusted_time) < tolerance:
                    matches += 1
                    break

        if matches > best_matches:
            best_matches = matches
            best_offset = test_offset

    # Musixmatch timestamps are typically early or on-time, never late.
    # A negative offset would shift lyrics even earlier — always wrong.
    best_offset = max(0.0, best_offset)

    logger.info(f"[ONSET] Global offset calculated: {best_offset:.3f}s "
                f"(first word: {first_word_time:.2f}s, first onset: {first_onset_time:.2f}s, "
                f"matches with offset: {best_matches})")

    return best_offset


def sync_words_with_onsets(
    words: List[dict],
    onsets: List[float],
    tolerance_ms: float = 200,
    global_offset: float = 0.0
) -> List[dict]:
    """
    Synchronize word timestamps with detected vocal onsets.

    Args:
        words: List of word dicts with 'word', 'start', 'end' from Musixmatch
        onsets: List of onset timestamps from vocal detection
        tolerance_ms: Maximum allowed difference to consider a match (ms)
        global_offset: Pre-calculated offset to apply to all words

    Returns:
        Words with corrected timestamps
    """
    if not words or not onsets:
        return words

    tolerance = tolerance_ms / 1000.0  # Convert to seconds
    synced_words = []
    matched_count = 0
    interpolated_count = 0

    # Track used onsets to avoid double-matching
    used_onsets = set()

    for i, word in enumerate(words):
        word_copy = word.copy()

        # Apply global offset to Musixmatch timestamp
        mm_start = word['start'] + global_offset
        original_duration = word.get('end', mm_start + 0.2) - word['start']

        # Find closest unused onset within tolerance
        best_onset = None
        best_delta = float('inf')

        for onset in onsets:
            if onset in used_onsets:
                continue
            delta = abs(onset - mm_start)
            if delta < best_delta:
                best_delta = delta
                best_onset = onset

        if best_onset is not None and best_delta <= tolerance:
            # Direct match - use onset timestamp
            word_copy['start'] = round(best_onset, 3)
            word_copy['_matched'] = True
            used_onsets.add(best_onset)
            matched_count += 1
        else:
            # No direct match - use offset-adjusted timestamp
            # Find surrounding onsets for potential micro-adjustment
            prev_onset = None
            next_onset = None

            for onset in onsets:
                if onset <= mm_start:
                    prev_onset = onset
                elif onset > mm_start and next_onset is None:
                    next_onset = onset
                    break

            if prev_onset is not None and next_onset is not None:
                # We're between two onsets - keep the offset-adjusted time
                # but ensure we don't go before prev_onset
                adjusted_start = max(mm_start, prev_onset + 0.05)
                word_copy['start'] = round(adjusted_start, 3)
            else:
                # Use offset-adjusted timestamp directly
                word_copy['start'] = round(max(0, mm_start), 3)

            word_copy['_interpolated'] = True
            interpolated_count += 1

        synced_words.append(word_copy)

    # Recalculate end times: each word ends when next word starts
    # But preserve minimum duration based on word length
    for i in range(len(synced_words) - 1):
        current_start = synced_words[i]['start']
        next_start = synced_words[i + 1]['start']

        # Minimum duration: ~80ms per character, min 150ms
        word_text = synced_words[i].get('word', '')
        min_duration = max(0.15, len(word_text) * 0.08)

        # End time is either next word's start or current + min_duration
        if next_start > current_start:
            synced_words[i]['end'] = round(next_start, 3)
        else:
            synced_words[i]['end'] = round(current_start + min_duration, 3)

    # Last word: estimate duration
    if synced_words:
        last = synced_words[-1]
        word_text = last.get('word', '')
        min_duration = max(0.3, len(word_text) * 0.1)
        last['end'] = round(last['start'] + min_duration, 3)

    logger.info(f"[ONSET] Sync complete: {matched_count} matched, "
                f"{interpolated_count} interpolated (tolerance={tolerance_ms}ms, "
                f"offset={global_offset:.3f}s)")

    return synced_words


def sync_lyrics_with_vocal_onsets(
    lyrics_segments: List[dict],
    vocals_path: str,
    tolerance_ms: float = 200
) -> tuple:
    """
    Main function: synchronize Musixmatch lyrics with vocal onset detection.

    Args:
        lyrics_segments: Musixmatch lyrics [{start, end, text, words}, ...]
        vocals_path: Path to vocals.mp3
        tolerance_ms: Matching tolerance in milliseconds

    Returns:
        Tuple of (synced_lyrics, stats_dict)
    """
    # Step 1: Detect onsets
    onsets = detect_vocal_onsets(vocals_path)
    if not onsets:
        logger.warning("[ONSET] No onsets detected, returning original lyrics")
        return lyrics_segments, {"source": "musixmatch", "synced": False}

    # Step 2: Collect all words with their segment info
    all_words = []
    for seg in lyrics_segments:
        if seg.get('words'):
            all_words.extend(seg['words'])

    if not all_words:
        logger.warning("[ONSET] No words in lyrics, returning original")
        return lyrics_segments, {"source": "musixmatch", "synced": False}

    # Step 3: Calculate global offset between Musixmatch and actual audio
    global_offset = calculate_global_offset(all_words, onsets)
    logger.info(f"[ONSET] Using global offset: {global_offset:.3f}s")

    # Step 4: Sync words with onsets using the global offset
    synced_words = sync_words_with_onsets(
        all_words, onsets, tolerance_ms, global_offset
    )

    # Step 5: Rebuild segments with synced words
    synced_segments = []
    word_idx = 0

    for seg in lyrics_segments:
        seg_copy = seg.copy()
        seg_word_count = len(seg.get('words', []))

        if seg_word_count > 0:
            seg_words = synced_words[word_idx:word_idx + seg_word_count]
            word_idx += seg_word_count

            seg_copy['words'] = seg_words

            # Update segment start/end to match words
            if seg_words:
                seg_copy['start'] = seg_words[0]['start']
                seg_copy['end'] = seg_words[-1]['end']

        synced_segments.append(seg_copy)

    # Calculate stats
    matched = sum(1 for w in synced_words if w.get('_matched'))
    interpolated = sum(1 for w in synced_words if w.get('_interpolated'))
    total = len(synced_words)

    stats = {
        "source": "musixmatch+onset",
        "synced": True,
        "total_words": total,
        "matched_words": matched,
        "interpolated_words": interpolated,
        "match_rate": round(matched / total * 100, 1) if total > 0 else 0,
        "onsets_detected": len(onsets),
        "tolerance_ms": tolerance_ms,
        "global_offset_sec": round(global_offset, 3)
    }

    logger.info(f"[ONSET] Lyrics synchronized: {stats}")

    return synced_segments, stats
