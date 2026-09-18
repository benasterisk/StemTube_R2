"""
LRCLIB client - free, open lyrics database (https://lrclib.net/docs).

LRCLIB records carry line-synced lyrics (LRC), plain text, or both - never word-level
timings. StemTube uses them as the lyrics *text* (and line timing when present); Whisper
supplies the word timings (core/lyrics_merger.align_lines_with_whisper).

Replaces the Musixmatch desktop API, which stopped serving anonymous clients in 2026.
"""

import logging
import re
import time
import unicodedata
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

import requests

from core.config import APP_VERSION

logger = logging.getLogger(__name__)

LRCLIB_API = "https://lrclib.net/api"
USER_AGENT = f"StemTube/{APP_VERSION} (https://github.com/benasterisk/StemTube_R2)"
TIMEOUT = 15

# Below this artist/track similarity a search hit is considered another song.
MIN_NAME_SIMILARITY = 0.6

_LRC_LINE = re.compile(r'^\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$')


def _get(path: str, params: Optional[Dict] = None):
    # LRCLIB answers the odd 502/503 under load: retry a couple of times before failing.
    for attempt in range(3):
        response = requests.get(f"{LRCLIB_API}{path}", params=params,
                                headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
        if response.status_code not in (429, 502, 503, 504) or attempt == 2:
            break
        time.sleep(1.5 * (attempt + 1))
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def _summary(record: Dict) -> Dict:
    """Search-result shape shared by the API route and the regenerate dialogs."""
    return {
        "track_id": record.get("id"),
        "track_name": record.get("trackName") or "",
        "artist_name": record.get("artistName") or "",
        "album_name": record.get("albumName") or "",
        "duration": record.get("duration"),
        "has_synced": bool(record.get("syncedLyrics")),
        "has_plain": bool(record.get("plainLyrics")),
        "instrumental": bool(record.get("instrumental")),
    }


def search_tracks(artist: str = "", track: str = "", limit: int = 10) -> List[Dict]:
    """Search LRCLIB. Returns summaries, records with lyrics first."""
    artist, track = (artist or "").strip(), (track or "").strip()
    if not artist and not track:
        return []
    if artist and track:
        params = {"artist_name": artist, "track_name": track}
    else:
        params = {"q": artist or track}
    records = _get("/search", params) or []
    if not records and artist and track:
        # Field search is strict about spelling; the free-text query is more forgiving.
        records = _get("/search", {"q": f"{artist} {track}"}) or []
    summaries = [_summary(r) for r in records]
    summaries.sort(key=lambda s: (not s["has_synced"], not s["has_plain"]))
    logger.info(f"[LRCLIB] Search '{artist} - {track}': {len(summaries)} results")
    return summaries[:limit]


def get_record(record_id: int) -> Optional[Dict]:
    """Full LRCLIB record by id."""
    return _get(f"/get/{int(record_id)}")


def _normalize_name(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[\(\[].*?[\)\]]", " ", text)          # (feat. X), [Remastered]
    text = re.sub(r"\b(feat|ft|featuring)\b.*$", " ", text)
    text = text.replace("&", " and ")
    return " ".join(re.findall(r"[a-z0-9']+", text))


def _similarity(a: str, b: str) -> float:
    a, b = _normalize_name(a), _normalize_name(b)
    if not a or not b:
        return 0.0
    if a == b or a in b or b in a:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def find_best_record(artist: str, track: str, duration: Optional[float] = None) -> Optional[Dict]:
    """
    Best LRCLIB record for an artist/track, or None.

    Hits must match both names; synced lyrics beat plain text, then the closest duration
    wins (a music video often runs longer than the album version, so duration only ranks).
    """
    if not artist or not track:
        return None
    try:
        params = {"artist_name": artist, "track_name": track}
        records = _get("/search", params) or []
        if not records:
            records = _get("/search", {"q": f"{artist} {track}"}) or []
    except Exception as e:
        logger.warning(f"[LRCLIB] Search failed for '{artist} - {track}': {e}")
        return None

    candidates = []
    for record in records:
        if record.get("instrumental") or not (record.get("syncedLyrics") or record.get("plainLyrics")):
            continue
        name_score = min(_similarity(artist, record.get("artistName", "")),
                         _similarity(track, record.get("trackName", "")))
        if name_score < MIN_NAME_SIMILARITY:
            continue
        gap = abs((record.get("duration") or 0) - duration) if duration else 0
        candidates.append((not record.get("syncedLyrics"), -round(name_score, 2), gap, record))

    if not candidates:
        logger.info(f"[LRCLIB] No matching lyrics for '{artist} - {track}' ({len(records)} hits)")
        return None
    candidates.sort(key=lambda c: c[:3])
    best = candidates[0][3]
    logger.info(f"[LRCLIB] Match: #{best.get('id')} {best.get('artistName')} - {best.get('trackName')} "
                f"({'synced' if best.get('syncedLyrics') else 'plain'}, {best.get('duration')}s)")
    return best


def parse_synced(lrc: str) -> List[Dict]:
    """LRC text -> [{start, end, text, words: []}]; blank timing lines end the previous line."""
    stamps = []
    for raw in (lrc or "").splitlines():
        match = _LRC_LINE.match(raw.strip())
        if not match:
            continue
        minutes, seconds, fraction, text = match.groups()
        fraction = (fraction or "0").ljust(3, "0")[:3]
        stamps.append((int(minutes) * 60 + int(seconds) + int(fraction) / 1000.0, text.strip()))
    stamps.sort(key=lambda s: s[0])

    segments = []
    for i, (start, text) in enumerate(stamps):
        if not text:
            continue
        end = stamps[i + 1][0] if i + 1 < len(stamps) else start + 5.0
        segments.append({"start": round(start, 3), "end": round(max(end, start + 0.2), 3),
                         "text": text, "words": []})
    return segments


def parse_plain(text: str) -> List[Dict]:
    """Plain lyrics -> [{start: None, end: None, text, words: []}] (one per non-empty line)."""
    return [{"start": None, "end": None, "text": line.strip(), "words": []}
            for line in (text or "").splitlines() if line.strip()]


def record_to_lines(record: Dict) -> Tuple[List[Dict], Optional[str]]:
    """(lines, level) where level is 'line' (synced) or 'text' (plain), or ([], None)."""
    if not record:
        return [], None
    lines = parse_synced(record.get("syncedLyrics"))
    if lines:
        return lines, "line"
    lines = parse_plain(record.get("plainLyrics"))
    return (lines, "text") if lines else ([], None)


def spread_words(lines: List[Dict]) -> List[Dict]:
    """
    Give line-synced lyrics approximate word timings (each line's time split by word
    length), so they display word by word until Whisper alignment replaces them.
    """
    result = []
    for line in lines:
        tokens = line["text"].split()
        if not tokens or line.get("start") is None:
            continue
        start, end = line["start"], line["end"]
        # Leave a short breath before the next line instead of stretching the last word.
        end = min(end, start + max(0.6, 0.45 * len(tokens)))
        weights = [max(len(t), 2) for t in tokens]
        total, cursor, words = sum(weights), start, []
        for token, weight in zip(tokens, weights):
            span = (end - start) * weight / total
            words.append({"word": token, "start": round(cursor, 3), "end": round(cursor + span, 3)})
            cursor += span
        result.append({"start": words[0]["start"], "end": words[-1]["end"],
                       "text": line["text"], "words": words})
    return result


if __name__ == "__main__":
    import json
    import sys
    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 3:
        print("Usage: python -m core.lrclib_client <artist> <track> [duration]")
        sys.exit(1)
    best = find_best_record(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else None)
    lines, level = record_to_lines(best)
    print(json.dumps({"level": level, "lines": lines[:5]}, ensure_ascii=False, indent=2))
