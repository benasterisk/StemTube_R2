"""
Chord detection (BTC Transformer, 170-chord vocabulary) + key estimation derived
from the detected chords.

Chords use StemTube's own BTC detector (external/BTC-ISMIR19), so this is the same
proven method as R2/Friend and stays re-integrable. Output: [{timestamp, chord}].

Key is NOT taken from StemTube's chroma-dominant heuristic (which often locks onto
the dominant). Instead we infer it from the chord profile: for each of the 24 keys
we sum the duration of chords that are diatonic to it, plus a tonic-chord bonus
that breaks the relative major/minor tie (so e.g. F-major-ish chords that are
really D minor resolve to D minor). Validated: Back To Black→D minor, Lazy Song→
B major, Get Lucky→F# minor.
"""
from __future__ import annotations
import os
import re
import sys
import json

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
_ENH = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}

# diatonic triads (root offset, quality) for major and natural-minor keys
_MAJ_DEG = [(0, 'maj'), (2, 'min'), (4, 'min'), (5, 'maj'), (7, 'maj'), (9, 'min'), (11, 'dim')]
_MIN_DEG = [(0, 'min'), (2, 'dim'), (3, 'maj'), (5, 'min'), (7, 'min'), (8, 'maj'), (10, 'maj')]


def detect_chords(audio_path: str, bpm: float | None = None):
    """
    Run BTC chord detection. Returns a list [{"timestamp": s, "chord": "C"}], or
    [] if BTC is unavailable / fails. Labels are StemTube-style ("C", "Am", "G7",
    "Fmaj7", "Dm7b5", ...).
    """
    try:
        from core.btc_chord_detector import analyze_audio_file, is_available
    except Exception as e:
        print(f"[CHORDS] BTC import failed: {e}")
        return []
    if not is_available():
        print("[CHORDS] BTC not available")
        return []
    try:
        result = analyze_audio_file(audio_path, bpm)
        chords_json = result[0] if result else None
        if not chords_json:
            return []
        return json.loads(chords_json)
    except Exception as e:
        print(f"[CHORDS] BTC detection failed: {e}")
        return []


def _parse_chord(label: str):
    """'C', 'Am', 'F#m7', 'Bbmaj7' → (root_index 0..11, quality in maj/min/dim)."""
    m = re.match(r'^([A-G][#b]?)(.*)$', label or '')
    if not m:
        return None
    root = _ENH.get(m.group(1), m.group(1))
    if root not in NOTE_NAMES:
        return None
    q = m.group(2)
    if q.startswith('dim'):
        quality = 'dim'
    elif q.startswith('m') and not q.startswith('maj'):
        quality = 'min'
    else:
        quality = 'maj'
    return NOTE_NAMES.index(root), quality


def estimate_key_from_chords(chords: list):
    """
    Infer (key, tonic, mode, confidence) from a chord list with timestamps.
    Returns dict {tonic, mode, key, confidence}. Falls back to C major if empty.
    """
    if not chords:
        return {"tonic": "C", "mode": "major", "key": "C major", "confidence": 0.0}

    # duration weight per chord label (gap to next change)
    dur = {}
    for i, c in enumerate(chords):
        t0 = float(c.get("timestamp", 0))
        t1 = float(chords[i + 1]["timestamp"]) if i + 1 < len(chords) else t0 + 2.0
        dur[c["chord"]] = dur.get(c["chord"], 0.0) + max(0.1, t1 - t0)
    total = sum(dur.values()) or 1.0

    best = None  # (combined, key, diatonic_frac, tonic_frac)
    for tonic in range(12):
        for degs, mode in ((_MAJ_DEG, "major"), (_MIN_DEG, "minor")):
            diatonic = set(((tonic + off) % 12, q) for off, q in degs)
            score = 0.0
            tonic_w = 0.0
            for label, d in dur.items():
                p = _parse_chord(label)
                if not p:
                    continue
                if p in diatonic:
                    score += d
                # tonic-chord bonus: the I (major) or i (minor)
                if p[0] == tonic and ((mode == "major" and p[1] == "maj")
                                      or (mode == "minor" and p[1] == "min")):
                    tonic_w += d
            combined = score / total + 0.5 * (tonic_w / total)
            if best is None or combined > best[0]:
                best = (combined, f"{NOTE_NAMES[tonic]} {mode}", score / total, tonic_w / total,
                        NOTE_NAMES[tonic], mode)

    return {
        "tonic": best[4],
        "mode": best[5],
        "key": best[1],
        "confidence": round(float(min(1.0, best[2])), 3),   # diatonic coverage as confidence
    }


def detect_chords_and_key(audio_path: str, bpm: float | None = None):
    """Convenience: returns (chords_list, key_dict)."""
    chords = detect_chords(audio_path, bpm)
    key = estimate_key_from_chords(chords)
    return chords, key
