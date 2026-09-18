"""
Lyrics alignment - lyrics text from a lyrics database + word timings from Whisper.

The database (LRCLIB) has the right words but at best line-level timing, often for the
album version rather than the downloaded video. Whisper has accurate word timings on the
vocals stem but mishears words. Aligning the two word sequences gives the database text
with Whisper's timings; words Whisper missed are placed between their matched neighbours.
"""

import logging
import re
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

WORD_SLOT = 0.35       # seconds given to a word placed without a timing on one side
MAX_EVEN_SPREAD = 1.0  # above this per-word gap an unmatched run is packed, not spread


def normalize_word(word: str) -> str:
    """Lowercase, strip punctuation (keeps letters of every script and apostrophes)."""
    return re.sub(r"[^\w']", "", (word or "").lower().replace("’", "'"))


def _whisper_words(segments: List[Dict]) -> List[Dict]:
    words = []
    for seg in segments or []:
        for w in seg.get("words") or []:
            if w.get("start") is None or w.get("end") is None:
                continue
            words.append({"word": w.get("word", ""), "start": float(w["start"]), "end": float(w["end"])})
    return words


def _estimate(line: Dict, index: int, count: int) -> Tuple[Optional[float], Optional[float]]:
    """Even split of a line's own timing, when the line has one."""
    if line.get("start") is None or line.get("end") is None or count == 0:
        return None, None
    span = (line["end"] - line["start"]) / count
    return line["start"] + index * span, line["start"] + (index + 1) * span


def align_lines_with_whisper(lines: List[Dict], whisper_segments: List[Dict]) -> Tuple[List[Dict], Dict]:
    """
    Align lyrics lines ([{start, end, text}], start/end may be None) with Whisper output.

    Returns (segments [{start, end, text, words}], stats). Every returned word has a timing;
    stats["match_rate"] (percent of lyrics words matched to a Whisper word) tells the caller
    whether the lyrics and the audio actually agree.
    """
    words = []
    for line_idx, line in enumerate(lines):
        tokens = line["text"].split()
        for k, token in enumerate(tokens):
            est_start, est_end = _estimate(line, k, len(tokens))
            words.append({"word": token, "line": line_idx, "start": None, "end": None,
                          "est_start": est_start, "est_end": est_end, "source": None})

    wh = _whisper_words(whisper_segments)
    stats = {"total_words": len(words), "matched_words": 0, "interpolated_words": 0,
             "match_rate": 0.0, "whisper_words": len(wh)}
    if not words:
        return [], stats

    if wh:
        ref_norm = [normalize_word(w["word"]) for w in words]
        wh_norm = [normalize_word(w["word"]) for w in wh]
        matcher = SequenceMatcher(None, ref_norm, wh_norm, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    words[i1 + k].update(start=wh[j1 + k]["start"], end=wh[j1 + k]["end"], source="matched")
            elif tag == "replace" and (j2 - j1) <= 3 * (i2 - i1) + 4:
                # Misheard words: share the Whisper time span. A much longer Whisper run
                # (hallucinated text over an instrumental) is not trusted for timing.
                t0, t1 = wh[j1]["start"], wh[j2 - 1]["end"]
                step = (t1 - t0) / (i2 - i1)
                for k in range(i2 - i1):
                    words[i1 + k].update(start=t0 + k * step, end=t0 + (k + 1) * step, source="spread")

    _shift_estimates(words)
    _fill_unmatched(words)

    # Keep time moving forward and give every word a visible duration.
    last = 0.0
    for w in words:
        w["start"] = max(w["start"], last)
        w["end"] = max(w["end"], w["start"] + 0.05)
        last = w["start"]

    segments = []
    for line_idx, line in enumerate(lines):
        line_words = [w for w in words if w["line"] == line_idx]
        if not line_words:
            continue
        segments.append({
            "start": round(line_words[0]["start"], 3),
            "end": round(line_words[-1]["end"], 3),
            "text": line["text"],
            "words": [{"word": w["word"], "start": round(w["start"], 3), "end": round(w["end"], 3)}
                      for w in line_words],
        })

    matched = sum(1 for w in words if w["source"] == "matched")
    stats.update(matched_words=matched, interpolated_words=len(words) - matched,
                 match_rate=round(100.0 * matched / len(words), 1))
    logger.info(f"[ALIGN] {matched}/{len(words)} lyrics words matched ({stats['match_rate']}%), "
                f"{len(wh)} Whisper words")
    return segments, stats


def _shift_estimates(words: List[Dict]):
    """
    Move line-synced estimates by the median gap to the matched Whisper timings: the
    lyrics database often times the album version, offset from the downloaded video.
    """
    gaps = sorted(w["start"] - w["est_start"] for w in words
                  if w["source"] == "matched" and w["est_start"] is not None)
    if not gaps:
        return
    offset = gaps[len(gaps) // 2]
    for w in words:
        if w["est_start"] is not None:
            w["est_start"] += offset
            w["est_end"] += offset


def _fill_unmatched(words: List[Dict]):
    """Time the words Whisper did not hear, run by run, from their timed neighbours."""
    i = 0
    while i < len(words):
        if words[i]["start"] is not None:
            i += 1
            continue
        j = i
        while j < len(words) and words[j]["start"] is None:
            j += 1
        run = words[i:j]
        left = words[i - 1]["end"] if i > 0 else None
        right = words[j]["start"] if j < len(words) else None
        n = len(run)

        estimates = [(w["est_start"], w["est_end"]) for w in run]
        estimates_fit = all(s is not None for s, _ in estimates) and \
            (left is None or estimates[0][0] >= left) and (right is None or estimates[-1][1] <= right)

        if estimates_fit:
            times = estimates
        elif left is not None and right is not None and (right - left) / n <= MAX_EVEN_SPREAD:
            step = (right - left) / n
            times = [(left + k * step, left + (k + 1) * step) for k in range(n)]
        elif left is not None and (right is None or words[j]["line"] != run[-1]["line"]):
            # Run ends its line: sing it right after the previous timed word.
            times = [(left + k * WORD_SLOT, left + (k + 1) * WORD_SLOT) for k in range(n)]
        elif right is not None:
            # Run leads into the next timed word of the same line: sing it just before.
            base = max(right - n * WORD_SLOT, left if left is not None else 0.0)
            step = (right - base) / n
            times = [(base + k * step, base + (k + 1) * step) for k in range(n)]
        else:
            times = [(k * WORD_SLOT, (k + 1) * WORD_SLOT) for k in range(n)]

        for w, (start, end) in zip(run, times):
            w.update(start=start, end=end, source="interpolated")
        i = j
