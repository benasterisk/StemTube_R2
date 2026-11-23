"""Simplified version of a chord/arpeggio track.

"Normal" is the note-for-note transcription. "Simplified" keeps what a player
needs to follow the song: one block chord per chord change, struck again on each
bar line, voiced in the register the instrument really plays in, and only where
the instrument is actually playing. The chords are the ones already detected for
the song; without them the transcription itself is reduced beat by beat.
"""
import re

import numpy as np

PITCH_CLASS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# quality -> semitones above the root
QUALITIES = [
    (r"^(maj7|M7|Δ)", (0, 4, 7, 11)), (r"^(m7b5|ø)", (0, 3, 6, 10)), (r"^(dim7|°7)", (0, 3, 6, 9)),
    (r"^(min7|m7|-7)", (0, 3, 7, 10)), (r"^(mM7|minmaj7)", (0, 3, 7, 11)),
    (r"^(dim|°)", (0, 3, 6)), (r"^(aug|\+)", (0, 4, 8)), (r"^sus2", (0, 2, 7)), (r"^sus4?", (0, 5, 7)),
    (r"^(min|m|-)(?!aj)", (0, 3, 7)), (r"^(maj)?6", (0, 4, 7, 9)), (r"^(9|11|13|7)", (0, 4, 7, 10)),
    (r"^5", (0, 7)), (r"^(maj)?", (0, 4, 7)),
]


def chord_pitch_classes(label):
    """'A#m7' -> [10, 1, 5, 8] (root first). None for 'N' or anything unreadable."""
    if not label:
        return None
    m = re.match(r"^([A-G])([#b]?)[:]?(.*)$", label.strip())
    if not m:
        return None
    root = (PITCH_CLASS[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
    rest = m.group(3).split("/")[0]
    for pattern, steps in QUALITIES:
        if re.match(pattern, rest):
            return [(root + s) % 12 for s in steps]
    return [root, (root + 4) % 12, (root + 7) % 12]


def _voicing(pcs, centre, lo, hi, previous=None):
    """Close voicing of the pitch classes around ``centre``, moving little from ``previous``."""
    notes = []
    for pc in pcs:
        cands = [p for p in range(lo, hi + 1) if p % 12 == pc]
        if not cands:
            continue
        ref = centre if previous is None else float(np.mean(previous))
        notes.append(min(cands, key=lambda p: abs(p - ref)))
    return sorted(set(notes))


def simplify(notes, chords, beat_times=None, beat_positions=None, lo=40, hi=84):
    """notes: full transcription; chords: [{'timestamp', 'chord', 'simple'}]. Returns notes."""
    if not notes:
        return []
    starts = np.array([n[0] for n in notes])
    ends = np.array([n[1] for n in notes])
    pitches = np.array([n[2] for n in notes])
    vels = np.array([n[3] for n in notes])
    centre = float(np.median(pitches))
    lo_v, hi_v = max(lo, int(centre) - 12), min(hi, int(centre) + 12)
    song_end = float(ends.max())

    def playing(a, b):
        """Share of [a, b) covered by notes, and their mean velocity."""
        sel = (starts < b) & (ends > a)
        if not sel.any():
            return 0.0, 0
        cover = np.clip(np.minimum(ends[sel], b) - np.maximum(starts[sel], a), 0, None).max()
        return float(cover / max(b - a, 1e-6)), int(vels[sel].mean())

    out = []
    if chords:
        chords = sorted(chords, key=lambda c: c["timestamp"])
        downbeats = []
        if beat_times and beat_positions and len(beat_times) == len(beat_positions):
            downbeats = [t for t, p in zip(beat_times, beat_positions) if int(p) == 1]
        previous = None
        for i, c in enumerate(chords):
            a = float(c["timestamp"])
            b = float(chords[i + 1]["timestamp"]) if i + 1 < len(chords) else song_end
            pcs = chord_pitch_classes(c.get("simple") or c.get("chord"))
            if pcs is None or b <= a:
                continue
            voicing = _voicing(pcs, centre, lo_v, hi_v, previous)
            if not voicing:
                continue
            previous = voicing
            cuts = [a] + [t for t in downbeats if a + 0.2 < t < b - 0.2] + [b]
            for s, e in zip(cuts[:-1], cuts[1:]):
                cover, vel = playing(s, e)
                if cover < 0.15:
                    continue          # the instrument rests here
                for p in voicing:
                    out.append((s, e - 0.02, p, max(40, min(110, vel))))
        return sorted(out, key=lambda n: (n[0], n[2]))

    # no chords: keep the three strongest pitch classes of each beat as a block
    grid = list(beat_times or [])
    if len(grid) < 2:
        grid = list(np.arange(0.0, song_end + 0.5, 0.5))
    for s, e in zip(grid[:-1], grid[1:]):
        sel = (starts < e) & (ends > s)
        if not sel.any():
            continue
        weight = {}
        for p, v, a, b in zip(pitches[sel], vels[sel], starts[sel], ends[sel]):
            weight[p % 12] = weight.get(p % 12, 0.0) + v * (min(b, e) - max(a, s))
        pcs = [pc for pc, _ in sorted(weight.items(), key=lambda kv: -kv[1])[:3]]
        for p in _voicing(pcs, centre, lo_v, hi_v):
            out.append((float(s), float(e) - 0.02, p, int(vels[sel].mean())))
    # merge a pitch that repeats on consecutive beats into one held note
    out.sort(key=lambda n: (n[2], n[0]))
    merged = []
    for n in out:
        if merged and merged[-1][2] == n[2] and n[0] - merged[-1][1] < 0.05:
            merged[-1] = (merged[-1][0], n[1], n[2], merged[-1][3])
        else:
            merged.append(n)
    return sorted(merged, key=lambda n: (n[0], n[2]))
