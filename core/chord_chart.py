"""
Chord chart for paper: the chords of every bar, laid out under the lyric line sung there.

Not a songbook (chords over syllables): the unit is the BAR. Each lyric line is followed
by the bars sung during it, one cell per beat, with the chord written in the cell where
it is played. The lyrics are there to find one's place; the grid says what to play.

build_chart() turns the stored analysis (beat grid, chords, lyrics) into a plain data
structure; chord_chart_pdf.render_pdf() draws it.

    {
      "title", "key", "bpm", "beats_per_bar",
      "blocks": [
        {"kind": "line" | "instrumental", "start": 17.8, "text": "If the night turned cold...",
         "bars": [
            {"number": 9, "start": 17.4,
             "cells": [{"chord": "Em", "change": True}, {"chord": "Em", "change": False}, ...]}
         ]}
      ]
    }
"""

import json
from typing import Dict, List, Optional, Tuple

# A bar belongs to a lyric line once the line has started before this share of the bar
# has elapsed (a pickup starting late in a bar leaves that bar to the previous line).
LINE_OWNS_BAR_AT = 0.75
# Bars starting this many bars after a line's last word, with the next line still far,
# are shown as an instrumental passage instead of being stapled to the previous line.
INSTRUMENTAL_AFTER_BARS = 1.0

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
_FLATS = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}


def _load(value, default):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def transpose_chord(name: str, semitones: int) -> str:
    """'Bm7' + 2 -> 'C#m7' (sharp spelling, like the mixer)."""
    if not name or not semitones:
        return name
    root = name[:2] if len(name) > 1 and name[1] in '#b' else name[:1]
    rest = name[len(root):]
    root = _FLATS.get(root, root)
    if root not in NOTES:
        return name
    return NOTES[(NOTES.index(root) + semitones) % 12] + rest


def bars_from_grid(beat_times: List[float], beat_positions: List[int], duration: float,
                   bpm: Optional[float], chords: Optional[List[Dict]] = None) -> Tuple[List[Dict], int]:
    """
    Bars as {start, end, beats: [t...]} from the stored grid (or a steady one).

    The downbeat tracker is sometimes a beat or two out of phase; chords change on the
    real downbeat far more often than not, so when the changes pile up on another beat
    position the bars are re-phased to start there (the chart only; the stored grid is
    left as is).
    """
    beats = [float(t) for t in beat_times or []]
    positions = [int(p) for p in beat_positions or []]
    if len(beats) < 8 or len(positions) != len(beats):
        period = 60.0 / bpm if bpm and bpm > 30 else 0.5
        beats, positions = [], []
        t = 0.0
        while t < duration:
            beats.append(t)
            positions.append(len(beats) % 4 or 4)
            t += period
        positions = [((i % 4) + 1) for i in range(len(beats))]
    beats_per_bar = max(positions) if positions else 4

    # Extend the grid to the end of the song with its own period.
    if len(beats) >= 2:
        period = (beats[-1] - beats[-8 if len(beats) >= 8 else 0]) / (7 if len(beats) >= 8 else len(beats) - 1)
        while beats[-1] + period < duration:
            beats.append(beats[-1] + period)
            positions.append(positions[-1] + 1 if positions[-1] < beats_per_bar else 1)

    if chords:
        positions = _rephase_to_chords(beats, positions, beats_per_bar, chords)

    bars: List[Dict] = []
    for t, p in zip(beats, positions):
        if p == 1 or not bars:
            bars.append({'start': t, 'beats': [t]})
        else:
            bars[-1]['beats'].append(t)
    for i, bar in enumerate(bars):
        bar['end'] = bars[i + 1]['start'] if i + 1 < len(bars) else bar['beats'][-1] + (
            (bar['beats'][-1] - bar['beats'][0]) / max(1, len(bar['beats']) - 1) if len(bar['beats']) > 1 else 0.5)
        bar['number'] = i + 1
    return bars, beats_per_bar


def _rephase_to_chords(beats: List[float], positions: List[int], per_bar: int, chords: List[Dict]) -> List[int]:
    counts = [0] * (per_bar + 1)
    for c in chords:
        t = float(c.get('timestamp') or 0)
        i = min(range(len(beats)), key=lambda k: abs(beats[k] - t))
        if abs(beats[i] - t) < 0.25:
            counts[positions[i]] += 1
    total = sum(counts)
    if total < 8:
        return positions
    best = max(range(1, per_bar + 1), key=lambda k: counts[k])
    if best == 1 or counts[best] < 1.5 * counts[1] or counts[best] < 0.35 * total:
        return positions
    shift = best - 1
    return [((p - 1 - shift) % per_bar) + 1 for p in positions]


def chord_at(chords: List[Dict], t: float, key: str) -> Optional[str]:
    """Chord active at time t (last change at or before t, 30 ms tolerance)."""
    name = None
    for c in chords:
        if c['timestamp'] <= t + 0.03:
            name = c.get(key) or c.get('chord')
        else:
            break
    return name


def _bar_signature(bar: Dict) -> Tuple[str, ...]:
    return tuple(c['chord'] for c in bar['cells'])


def _repeating_unit(bars: List[Dict]) -> Tuple[List[Dict], int, List[Dict]]:
    """
    Shortest chord pattern the bars repeat: (unit, count, remainder). [Em Em Am Am] x2
    for eight bars; a partial last repeat is returned as the remainder. Count 1 and the
    whole section when nothing repeats.
    """
    sig = [_bar_signature(b) for b in bars]
    n = len(sig)
    for p in range(1, n // 2 + 1):
        count = n // p
        if count >= 2 and all(sig[i] == sig[i % p] for i in range(count * p)):
            return bars[:p], count, bars[count * p:]
    return bars, 1, []


def _bars_match(a: Dict, b: Dict) -> bool:
    """Same chords on at least 3 beats out of 4 (a pickup on the last beat does not count)."""
    sa, sb = _bar_signature(a), _bar_signature(b)
    n = max(len(sa), len(sb))
    same = sum(1 for x, y in zip(sa, sb) if x == y)
    return n > 0 and same / n >= 0.75


def _similarity(seq: List[Dict], ref: List[Dict]) -> float:
    """Share of matching bars between two bar sequences, best of a few bar shifts."""
    best = 0.0
    for shift in range(-3, 4):
        hits = sum(1 for i, bar in enumerate(seq) if 0 <= i + shift < len(ref) and _bars_match(bar, ref[i + shift]))
        best = max(best, hits / max(len(seq), len(ref)))
    return best


SAME_PART_MIN = 0.6     # a free run this close to an earlier part (shifted) is that part again
MAX_UNIT_BARS = 16      # longest loop looked for
MIN_LOOP_BARS = 8       # a 1- or 2-bar loop must cover this many bars to count as a part
SHORT_RUN_BARS = 2      # runs this short are a tail of the previous part, not a part


def _repeats_from(bars: List[Dict], i: int, p: int) -> Tuple[int, int]:
    """(repeats, exact bar matches) of the p-bar unit at i; a repeat may differ by one
    bar in four (a fill, a turnaround), short units must match fully."""
    n = len(bars)
    unit = bars[i:i + p]
    reps, exact = 1, 0
    while i + (reps + 1) * p <= n:
        hits = sum(1 for k in range(p) if _bars_match(bars[i + reps * p + k], unit[k]))
        if hits < p if p < 4 else hits / p < 0.75:
            break
        reps += 1
        exact += hits
    return reps, exact


def _loop_at(bars: List[Dict], i: int):
    """(start, period, repeats) of the loop found at bar i, or None. Most bars covered
    wins; on a tie, 4/8/16-bar periods, then the longer one. The start may move up to
    p-1 bars later when the loop repeats more exactly from there (a pickup bar before
    the real top of the progression)."""
    n = len(bars)
    best = None
    for p in range(1, min(MAX_UNIT_BARS, (n - i) // 2) + 1):
        reps, _ = _repeats_from(bars, i, p)
        if reps < 2 or (p <= 2 and p * reps < MIN_LOOP_BARS):
            continue
        key = (p * reps, p % 4 == 0, p)
        if best is None or key > best[0]:
            best = (key, p, reps)
    if best is None:
        return None
    _, p, reps = best
    start, best_exact = i, _repeats_from(bars, i, p)[1]
    for d in range(1, p):
        r2, exact = _repeats_from(bars, i + d, p)
        if r2 >= 2 and r2 * p >= (reps - 1) * p and exact > best_exact:
            start, reps, best_exact = i + d, r2, exact
    return start, p, reps


def _same_loop(unit: List[Dict], ref: List[Dict]) -> bool:
    """Same loop up to a rotation (entering the cycle at another bar)."""
    if len(unit) != len(ref):
        return False
    n = len(unit)
    for r in range(n):
        hits = sum(1 for k in range(n) if _bars_match(unit[k], ref[(k + r) % n]))
        if hits / n >= 0.75:
            return True
    return False


def summarize_parts(bars: List[Dict], lines: List[Dict]) -> Dict:
    """
    Musician's summary from the chords themselves. Scanning the bars, a stretch where a
    unit of bars repeats ([Dm Gm A Dm] x2) becomes a part played N times, the stretches
    in between become parts played once; a stretch that repeats an earlier part (same
    loop entered at another bar, or mostly the same bars shifted by up to 3) reuses its
    letter. Parts are lettered in order of appearance; one with no sung words is marked
    instrumental. A run of 1-2 bars is a tail of the previous part, not a part.

    Returns {'form': [{'label', 'count', 'bars', 'extra'}...],
             'parts': [{'label', 'unit', 'repeat', 'remainder', 'bars_total', 'instrumental', 'occurrences', 'start'}]}.
    """
    if not bars:
        return {'form': [], 'parts': []}
    sung = set()
    for li in lines:
        st, en = float(li.get('start') or 0), float(li.get('end') or 0)
        for i, b in enumerate(bars):
            if b['start'] < en and b['end'] > st:
                sung.add(i)

    # 1. Segments: loops and the free runs between them.
    segments = []
    run_first = None
    i, n = 0, len(bars)
    while i < n:
        loop = _loop_at(bars, i)
        if loop:
            start, p, reps = loop
            if start > i and run_first is None:
                run_first = i
            if run_first is not None:
                segments.append({'first': run_first, 'bars': bars[run_first:start], 'unit': bars[run_first:start], 'repeat': 1})
                run_first = None
            segments.append({'first': start, 'bars': bars[start:start + p * reps], 'unit': bars[start:start + p], 'repeat': reps})
            i = start + p * reps
        else:
            if run_first is None:
                run_first = i
            i += 1
    if run_first is not None:
        segments.append({'first': run_first, 'bars': bars[run_first:], 'unit': bars[run_first:], 'repeat': 1})

    # 2. Parts and form.
    parts: List[Dict] = []
    form: List[Dict] = []
    for seg in segments:
        first, last = seg['first'], seg['first'] + len(seg['bars'])
        has_words = any(k in sung for k in range(first, last))
        if len(seg['bars']) <= SHORT_RUN_BARS and seg['repeat'] == 1 and form:
            form[-1]['extra'] += len(seg['bars'])
            form[-1]['bars'] += len(seg['bars'])
            continue
        best, best_sim = None, 0.0
        for pt in parts:
            # Same loop (up to rotation), or a unit made of several turns of the part's loop.
            u, ref = seg['unit'], pt['_unit']
            if seg['repeat'] > 1 and pt['_repeat'] > 1 and len(u) % len(ref) == 0 and \
                    all(_same_loop(u[k:k + len(ref)], ref) for k in range(0, len(u), len(ref))):
                seg['repeat'] *= len(u) // len(ref)
                seg['unit'] = u[:len(ref)]
                best, best_sim = pt, 2.0
                break
            sim = _similarity(seg['unit'], pt['_unit'])
            if sim >= SAME_PART_MIN and sim > best_sim:
                best, best_sim = pt, sim
        if best is None:
            label = chr(ord('A') + len(parts)) if len(parts) < 26 else f"P{len(parts) + 1}"
            best = {'label': label, '_unit': seg['unit'], '_repeat': seg['repeat'], 'instrumental': not has_words,
                    'occurrences': 0, 'start': seg['bars'][0]['start']}
            parts.append(best)
        elif len(seg['unit']) > len(best['_unit']):
            best['_unit'], best['_repeat'] = seg['unit'], seg['repeat']
        best['instrumental'] = best['instrumental'] and not has_words
        best['occurrences'] += 1
        if form and form[-1]['label'] == best['label'] and not form[-1]['extra']:
            form[-1]['count'] += seg['repeat']
            form[-1]['bars'] += len(seg['bars'])
        else:
            form.append({'label': best['label'], 'count': seg['repeat'], 'bars': len(seg['bars']), 'extra': 0})

    for pt in parts:
        unit, repeat = pt.pop('_unit'), pt.pop('_repeat')
        pt.update(unit=unit, repeat=repeat, remainder=[], bars_total=len(unit) * repeat)
    return {'form': form, 'parts': parts}


def build_chart(row: Dict, detail: str = 'simple', transpose: int = 0) -> Dict:
    """Chart data from a global_downloads row (dict with the analysis columns)."""
    chords = sorted(_load(row.get('chords_data'), []), key=lambda c: c.get('timestamp', 0))
    lyrics = [s for s in _load(row.get('lyrics_data'), []) if (s.get('text') or '').strip()]
    beat_times = _load(row.get('beat_times'), [])
    beat_positions = _load(row.get('beat_positions'), [])
    duration = float(row.get('duration') or 0) or max(
        [c['timestamp'] for c in chords] + [float(s.get('end') or 0) for s in lyrics] + [beat_times[-1] if beat_times else 0]) + 4.0
    bars, beats_per_bar = bars_from_grid(beat_times, beat_positions, duration, row.get('detected_bpm'), chords)
    name_key = 'chord' if detail == 'detailed' else 'simple'

    # Cells: the chord played on each beat, flagged where it changes.
    previous = None
    for bar in bars:
        cells = []
        for t in bar['beats']:
            name = chord_at(chords, t, name_key)
            if name:
                name = transpose_chord(name, transpose)
            cells.append({'chord': name or '', 'change': bool(name) and name != previous})
            previous = name or previous
        bar['cells'] = cells

    # Owner line of every bar.
    lines = sorted(lyrics, key=lambda s: float(s.get('start') or 0))
    line_start = [float(s.get('start') or 0) for s in lines]
    line_end = [max(float(s.get('end') or 0), float(s.get('start') or 0)) for s in lines]
    owner: List[Optional[int]] = []
    for bar in bars:
        threshold = bar['start'] + LINE_OWNS_BAR_AT * (bar['end'] - bar['start'])
        li = -1
        for i, st in enumerate(line_start):
            if st <= threshold:
                li = i
            else:
                break
        if li == -1:
            owner.append(None)
            continue
        bar_len = bar['end'] - bar['start']
        # (the next line, if any, starts after `threshold`, i.e. late in this bar or
        # later: it does not claim the bar)
        if bar['start'] > line_end[li] + INSTRUMENTAL_AFTER_BARS * bar_len:
            owner.append(None)
        else:
            owner.append(li)

    # Group consecutive bars by owner into blocks.
    blocks: List[Dict] = []
    for bar, li in zip(bars, owner):
        if blocks and blocks[-1]['_owner'] == li and (li is not None or blocks[-1]['kind'] == 'instrumental'):
            blocks[-1]['bars'].append(bar)
            continue
        if li is None:
            blocks.append({'kind': 'instrumental', 'text': '', 'start': bar['start'], 'bars': [bar], '_owner': None})
        else:
            blocks.append({'kind': 'line', 'text': lines[li]['text'].strip(), 'start': line_start[li],
                           'bars': [bar], '_owner': li})
    # Lines with no bar of their own (two lines inside one bar): keep their text, no grid.
    seen = {b['_owner'] for b in blocks if b['_owner'] is not None}
    for i, seg in enumerate(lines):
        if i in seen:
            continue
        pos = next((k for k, b in enumerate(blocks) if b['start'] > line_start[i]), len(blocks))
        blocks.insert(pos, {'kind': 'line', 'text': seg['text'].strip(), 'start': line_start[i], 'bars': [], '_owner': i})
    summary = summarize_parts(bars, lines)
    # Section starts, shown in the margin of the detailed pages.
    section_at_bar = {}
    for sc in sorted(_load(row.get('structure_data'), []) or [], key=lambda x: float(x.get('start') or 0)):
        if not sc.get('label'):
            continue
        i = min(range(len(bars)), key=lambda k: abs(bars[k]['start'] - float(sc.get('start') or 0)))
        section_at_bar.setdefault(bars[i]['number'], str(sc['label']))
    for b in blocks:
        b.pop('_owner', None)
        for bar in b['bars']:
            bar.pop('beats', None)
            if bar['number'] in section_at_bar:
                bar['section'] = section_at_bar[bar['number']]

    key = row.get('detected_key') or ''
    if key and transpose:
        tonic, _, mode = key.partition(' ')
        key = f"{transpose_chord(tonic, transpose)} {mode}".strip()
    return {
        'title': row.get('title') or row.get('video_id') or '',
        'key': key,
        'bpm': row.get('detected_bpm'),
        'beats_per_bar': beats_per_bar,
        'detail': detail,
        'transpose': transpose,
        'blocks': blocks,
        'summary': summary,
    }
