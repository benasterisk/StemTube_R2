"""
Chord refinement: from raw BTC output to the chords a rhythm player actually plays.

BTC labels every ~0.1 s frame, so a vocal melody note, a bass passing note or a guitar
lick flips the label for a fraction of a second: on a typical song a third of the raw
"chords" last less than one beat. This module turns that into a playable chart:

  1. the detector runs on the HARMONIC stems only (no vocals, no drums), mixed to one
     temporary file - so it needs the stems and runs after extraction;
  2. raw boundaries are snapped to the beat grid, then chords are decoded over beats
     (Viterbi): a change must be backed by enough evidence to pay a transition cost,
     lower on downbeats and mid-bar, which removes sub-beat blips and A-B-A flicker
     while keeping real two-beat changes; one-beat passing chords are absorbed;
  3. decoding works on triads (root + major/minor); each resulting segment then takes
     the richest raw label that agrees with it (Bm7, A7...), so colour variants of one
     chord never create extra changes. Both names are stored: `chord` and `simple`;
  4. the key is estimated from the decoded chords and the harmonic chroma, then used to
     settle major/minor doubts (E vs Em in E minor) when the audio's thirds agree.
"""

import logging
import os
import re
import subprocess
import tempfile
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
_FLAT_TO_SHARP = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'Fb': 'E'}
NO_CHORD = 'N'

# Stems that carry no harmony (or a melody that misleads the chord model).
NON_HARMONIC_STEM = re.compile(r'vocal|drum|kick|snare|tom|cymbal|hihat|hi_hat|metronome|click', re.I)

# A raw boundary this far into a beat (or later) belongs to the NEXT beat: chords are
# often pushed an eighth note early, never played late.
SNAP_FORWARD_FROM = 0.4

# Transition costs, in "beats of evidence" a new chord must win to be worth a change.
COST_DOWNBEAT = 0.35
COST_MIDBAR = 0.55
COST_OFFBEAT = 0.85

_CHORD_RE = re.compile(r'^([A-G](?:#|b)?)(.*)$')

# Krumhansl-Kessler key profiles
_KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# (semitones above the tonic, triad quality, weight). Borrowed chords that pop/rock/funk
# use all the time count a little: bVII in major, IV and V major in minor.
_DEGREES = {
    'major': [(0, '', 1.0), (2, 'm', 1.0), (4, 'm', 1.0), (5, '', 1.0), (7, '', 1.0), (9, 'm', 1.0),
              (10, '', 0.5)],
    'minor': [(0, 'm', 1.0), (3, '', 1.0), (5, 'm', 1.0), (7, 'm', 1.0), (8, '', 1.0), (10, '', 1.0),
              (7, '', 0.8), (5, '', 0.5)],
}


# ---------------------------------------------------------------------------
# Chord names
# ---------------------------------------------------------------------------

def split_chord(label: str) -> Tuple[Optional[int], str]:
    """'Bbm7' -> (10, 'm7'); unknown / no chord -> (None, '')."""
    match = _CHORD_RE.match(label or '')
    if not match:
        return None, ''
    root, quality = match.groups()
    root = _FLAT_TO_SHARP.get(root, root)
    if root not in NOTES:
        return None, ''
    return NOTES.index(root), quality.split('/')[0]


def simplify_chord(label: str) -> str:
    """Triad name: root + 'm' for minor-third qualities (min*, dim, m7b5), else major."""
    pc, quality = split_chord(label)
    if pc is None:
        return NO_CHORD
    minor = (quality.startswith('m') and not quality.startswith('maj')) or quality.startswith('dim')
    return NOTES[pc] + ('m' if minor else '')


# ---------------------------------------------------------------------------
# Harmonic mix
# ---------------------------------------------------------------------------

def harmonic_stem_paths(stems_paths: Dict[str, str]) -> List[str]:
    """Existing stem files that carry harmony (everything but vocals and drum parts)."""
    from core.downloads_db import resolve_file_path
    paths = []
    for name, path in (stems_paths or {}).items():
        if NON_HARMONIC_STEM.search(name):
            continue
        path = resolve_file_path(path) or path
        if path and os.path.exists(path):
            paths.append(path)
    return sorted(paths)


def mix_stems(paths: List[str], out_path: str, sample_rate: int = 22050):
    """Sum stems into one mono file (ffmpeg amix without level normalisation)."""
    from core.config import get_ffmpeg_path
    ffmpeg = get_ffmpeg_path()
    cmd = [ffmpeg if ffmpeg and os.path.isfile(str(ffmpeg)) else 'ffmpeg', '-y', '-v', 'error']
    for path in paths:
        cmd += ['-i', path]
    if len(paths) > 1:
        cmd += ['-filter_complex', f'amix=inputs={len(paths)}:normalize=0']
    cmd += ['-ac', '1', '-ar', str(sample_rate), out_path]
    subprocess.run(cmd, check=True, timeout=300)


def mean_chroma_frames(audio_path: str) -> Tuple[Optional[np.ndarray], float]:
    """(chroma [12, frames], frames per second) of an audio file, or (None, 0)."""
    try:
        import librosa
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        hop = 4096
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        return chroma, sr / hop
    except Exception as e:
        logger.warning(f"[CHORDS] Chroma analysis failed: {e}")
        return None, 0.0


# ---------------------------------------------------------------------------
# Beat grid
# ---------------------------------------------------------------------------

def build_grid(beat_times: List[float], beat_positions: List[int], duration: float,
               bpm: Optional[float] = None) -> Tuple[List[float], List[int]]:
    """
    Beat starts and bar positions covering [0, duration]: the detected grid, extended
    at both ends with its own period. Without a grid, a steady one from the BPM.
    """
    beats = [float(t) for t in (beat_times or [])]
    positions = [int(p) for p in (beat_positions or [])]
    if len(beats) < 8:
        period = 60.0 / bpm if bpm and bpm > 30 else 0.5
        beats = list(np.arange(0.0, max(duration, period), period))
        return beats, [(i % 4) + 1 for i in range(len(beats))]
    if len(positions) != len(beats):
        positions = [(i % 4) + 1 for i in range(len(beats))]
    per_bar = max(positions) if positions else 4

    beats, positions = _fill_long_intervals(beats, positions)

    period = float(np.median(np.diff(beats[:16])))
    while beats[0] - period > -0.05 * period and beats[0] > 0.25 * period:
        beats.insert(0, max(0.0, beats[0] - period))
        positions.insert(0, positions[0] - 1 if positions[0] > 1 else per_bar if positions[0] == 1 else 0)
    period = float(np.median(np.diff(beats[-16:])))
    while beats[-1] + period < duration:
        beats.append(beats[-1] + period)
        positions.append(0 if positions[-1] == 0 else positions[-1] + 1 if positions[-1] < per_bar else 1)
    return beats, positions


def _fill_long_intervals(beats: List[float], positions: List[int]) -> Tuple[List[float], List[int]]:
    """
    The beat tracker sometimes falls to half tempo for a section (or skips beats): those
    intervals are subdivided so a chord lasting "one beat" there is not thrown away.
    Beats of a halved section count as strong (1 or 3), inserted ones as off-beats (0).
    Internal to the chord decoding: the stored grid is left as detected.
    """
    median = float(np.median(np.diff(beats)))
    filled_beats, filled_positions = [], []
    for i, (t, p) in enumerate(zip(beats, positions)):
        parts = int(round((beats[i + 1] - t) / median)) if i + 1 < len(beats) else 1
        if parts < 2 or parts > 8:
            filled_beats.append(t)
            filled_positions.append(p)
            continue
        filled_beats.append(t)
        filled_positions.append(1 if p % 2 == 1 else 3)
        step = (beats[i + 1] - t) / parts
        for k in range(1, parts):
            filled_beats.append(t + k * step)
            filled_positions.append(0)
    return filled_beats, filled_positions


# ---------------------------------------------------------------------------
# Decoding
# ---------------------------------------------------------------------------

def snap_to_beats(segments: List[Tuple[float, float, str]], beats: List[float],
                  end_time: float) -> List[Tuple[float, float, str]]:
    """Move every raw boundary onto the beat grid; segments squeezed to nothing vanish."""
    bounds = np.array(beats + [end_time])

    def snap(t: float) -> float:
        i = int(np.searchsorted(bounds, t, side='right')) - 1
        if i < 0:
            return float(bounds[0])
        if i >= len(bounds) - 1:
            return float(bounds[-1])
        fraction = (t - bounds[i]) / max(bounds[i + 1] - bounds[i], 1e-6)
        return float(bounds[i + 1] if fraction >= SNAP_FORWARD_FROM else bounds[i])

    snapped = []
    for start, end, label in segments:
        s0, s1 = snap(start), snap(end)
        if s1 <= s0:
            continue
        if snapped and snapped[-1][2] == label and abs(snapped[-1][1] - s0) < 1e-6:
            snapped[-1] = (snapped[-1][0], s1, label)
        else:
            snapped.append((s0, s1, label))
    return snapped


def _overlaps(segments, labels_of, beats, end_time):
    """emission[b][state] = share of beat b covered by each state's raw segments."""
    states = sorted({labels_of(label) for _, _, label in segments} | {NO_CHORD})
    index = {s: i for i, s in enumerate(states)}
    bounds = beats + [end_time]
    emission = np.zeros((len(beats), len(states)))
    j = 0
    for b in range(len(beats)):
        b0, b1 = bounds[b], bounds[b + 1]
        if b1 <= b0:
            continue
        while j < len(segments) and segments[j][1] <= b0:
            j += 1
        k = j
        while k < len(segments) and segments[k][0] < b1:
            s0, s1, label = segments[k]
            emission[b, index[labels_of(label)]] += (min(s1, b1) - max(s0, b0)) / (b1 - b0)
            k += 1
        covered = emission[b].sum()
        if covered < 1.0:
            emission[b, index[NO_CHORD]] += 1.0 - covered
    return states, emission


def _viterbi(emission: np.ndarray, change_cost: np.ndarray) -> List[int]:
    """Best state per beat: maximise summed emission minus a cost for each change."""
    n_beats, n_states = emission.shape
    score = emission[0].copy()
    back = np.zeros((n_beats, n_states), dtype=int)
    for b in range(1, n_beats):
        best_prev = int(np.argmax(score))
        switch = score[best_prev] - change_cost[b]
        stay = score
        take_switch = switch > stay
        back[b] = np.where(take_switch, best_prev, np.arange(n_states))
        score = np.where(take_switch, switch, stay) + emission[b]
    path = [int(np.argmax(score))]
    for b in range(n_beats - 1, 0, -1):
        path.append(int(back[b][path[-1]]))
    return path[::-1]


def _change_costs(positions: List[int]) -> np.ndarray:
    per_bar = max(positions) if positions else 4
    mid = per_bar // 2 + 1 if per_bar % 2 == 0 else None
    return np.array([COST_DOWNBEAT if p == 1 else COST_MIDBAR if p == mid else COST_OFFBEAT
                     for p in positions])


def decode_on_beats(segments: List[Tuple[float, float, str]], beats: List[float],
                    positions: List[int], end_time: float) -> List[Dict]:
    """Raw (start, end, label) segments -> beat-aligned [{start, end, simple, chord}]."""
    if not segments or not beats:
        return []
    segments = snap_to_beats(segments, beats, end_time)
    if not segments:
        return []
    states, emission = _overlaps(segments, simplify_chord, beats, end_time)
    path = _viterbi(emission, _change_costs(_harmonic_positions(emission, positions)))
    bounds = beats + [end_time]

    runs = []
    for b, s in enumerate(path):
        if runs and runs[-1]['simple'] == states[s]:
            runs[-1]['end'] = bounds[b + 1]
        else:
            runs.append({'start': bounds[b], 'end': bounds[b + 1], 'simple': states[s]})

    for run in runs:
        run['beats'] = sum(1 for t in beats if run['start'] - 1e-6 <= t < run['end'] - 1e-6)
    return runs


def _harmonic_positions(emission: np.ndarray, positions: List[int]) -> List[int]:
    """
    Bar positions as the harmony sees them. The downbeat tracker is sometimes a beat or
    two out of phase; chords mostly change on the real downbeat, so when the snapped
    changes pile up on another position, the costs follow that one. Internal only: the
    stored beat grid is not touched.
    """
    per_bar = max(positions) if positions else 4
    labels = emission.argmax(axis=1)
    counts = np.zeros(per_bar + 1)
    for b in range(1, len(labels)):
        if labels[b] != labels[b - 1]:
            counts[positions[b]] += 1
    total = counts.sum()
    if total < 8:
        return positions
    best = int(counts.argmax())
    if best <= 1 or counts[best] < 1.5 * counts[1] or counts[best] < 0.35 * total:
        return positions
    shift = best - 1
    return [((p - 1 - shift) % per_bar) + 1 if p else 0 for p in positions]


def absorb_single_beats(runs: List[Dict]) -> List[Dict]:
    """
    A one-beat chord between two others is a passing colour, not a chord to play: it
    joins the neighbour sharing its root, else the longer neighbour.
    """
    changed = True
    while changed:
        changed = False
        for i, run in enumerate(runs):
            if run['beats'] > 1 or run['simple'] == NO_CHORD or len(runs) < 2:
                continue
            prev_run = runs[i - 1] if i > 0 else None
            next_run = runs[i + 1] if i + 1 < len(runs) else None
            root = split_chord(run['simple'])[0]
            target = None
            for neighbour in (next_run, prev_run):
                if neighbour and neighbour['simple'] != NO_CHORD and split_chord(neighbour['simple'])[0] == root:
                    target = neighbour
                    break
            if target is None:
                candidates = [n for n in (prev_run, next_run) if n and n['simple'] != NO_CHORD]
                if not candidates:
                    continue
                target = max(candidates, key=lambda n: n['beats'])
            if target is prev_run:
                prev_run['end'] = run['end']
            else:
                next_run['start'] = run['start']
            target['beats'] += run['beats']
            del runs[i]
            changed = True
            break
    return _merge_equal(runs)


def _merge_equal(runs: List[Dict]) -> List[Dict]:
    merged: List[Dict] = []
    for run in runs:
        if merged and merged[-1]['simple'] == run['simple']:
            merged[-1]['end'] = run['end']
            merged[-1]['beats'] += run['beats']
        else:
            merged.append(run)
    return merged


def _richest_label(segments, run) -> str:
    """The raw label agreeing with the run's triad that covers most of it."""
    if run['simple'] == NO_CHORD:
        return NO_CHORD
    weight: Dict[str, float] = {}
    for s0, s1, label in segments:
        overlap = min(s1, run['end']) - max(s0, run['start'])
        if overlap > 0 and simplify_chord(label) == run['simple']:
            weight[label] = weight.get(label, 0.0) + overlap
    if not weight:
        return run['simple']
    best = max(weight, key=weight.get)
    # A colour only names the chord if it is there most of the time; otherwise the triad.
    if weight[best] < 0.5 * (run['end'] - run['start']):
        return run['simple']
    return best


# ---------------------------------------------------------------------------
# Key
# ---------------------------------------------------------------------------

def _diatonic(tonic: int, mode: str) -> Dict[str, float]:
    chords: Dict[str, float] = {}
    for offset, quality, weight in _DEGREES[mode]:
        name = NOTES[(tonic + offset) % 12] + quality
        chords[name] = max(chords.get(name, 0.0), weight)
    return chords


def estimate_key(runs: List[Dict], chroma: Optional[np.ndarray] = None) -> Tuple[Optional[str], float]:
    """
    Key from the decoded chords (time spent on the key's chords, tonic counted one and a half times,
    bonuses for dominant resolutions onto the tonic and for ending on it) blended with the Krumhansl correlation of the
    harmonic chroma. Returns ('E minor', confidence 0-1) or (None, 0).
    """
    durations: Dict[str, float] = {}
    for run in runs:
        if run['simple'] != NO_CHORD:
            durations[run['simple']] = durations.get(run['simple'], 0.0) + run['end'] - run['start']
    total = sum(durations.values())
    if total <= 0:
        return None, 0.0
    sung = [r for r in runs if r['simple'] != NO_CHORD]
    last, first = sung[-1]['simple'], sung[0]['simple']

    # Dominant resolutions: a major chord falling a fifth onto the candidate tonic is the
    # strongest cue a chart gives, and the one that tells a minor key from the key of
    # its (major) dominant, which the chroma profile alone tends to pick.
    resolutions: Dict[str, float] = {}
    for a, b in zip(sung, sung[1:]):
        root_a, root_b = split_chord(a['simple'])[0], split_chord(b['simple'])[0]
        if not a['simple'].endswith('m') and (root_a - root_b) % 12 == 7:
            # I -> IV looks the same as V -> I on triads; a dominant seventh does not.
            quality = split_chord(a.get('chord', ''))[1]
            dominant = quality.startswith(('7', '9', '13'))
            resolutions[b['simple']] = resolutions.get(b['simple'], 0.0) + (1.0 if dominant else 0.3)
    changes = max(len(sung) - 1, 1)

    profile = chroma.mean(axis=1) if chroma is not None and chroma.size else None
    scores = []
    for tonic in range(12):
        for mode in ('major', 'minor'):
            chords = _diatonic(tonic, mode)
            tonic_name = NOTES[tonic] + ('m' if mode == 'minor' else '')
            fit = sum(durations.get(name, 0.0) * w for name, w in chords.items()) / total
            fit += 0.5 * durations.get(tonic_name, 0.0) / total
            fit += 0.10 * (last == tonic_name) + 0.05 * (first == tonic_name)
            fit += 1.5 * resolutions.get(tonic_name, 0.0) / changes
            if profile is not None:
                ks = np.corrcoef(np.roll(_KS_MAJOR if mode == 'major' else _KS_MINOR, tonic), profile)[0, 1]
                fit += 0.35 * max(ks, 0.0)
            scores.append((fit, f"{NOTES[tonic]} {mode}"))
    scores.sort(reverse=True)
    best, runner_up = scores[0], scores[1]
    confidence = float(min(1.0, max(0.0, (best[0] - runner_up[0]) / max(best[0], 1e-6) * 4)))
    return best[1], round(confidence, 2)


def settle_thirds(runs: List[Dict], key: Optional[str], chroma: Optional[np.ndarray],
                  frames_per_second: float) -> List[Dict]:
    """
    Major/minor doubts. A chord outside the key whose parallel (same root, other third)
    belongs to the key becomes that parallel when
      - it touches that very parallel (E between two Em: one chord, heard two ways),
        unless the audio's third clearly says otherwise, or
      - the audio's thirds lean towards the parallel.
    """
    if not key:
        return runs
    tonic_name, mode = key.split()
    in_key = _diatonic(NOTES.index(tonic_name), mode)
    for i, run in enumerate(runs):
        pc, _ = split_chord(run['simple'])
        if pc is None or run['simple'] in in_key:
            continue
        is_minor = run['simple'].endswith('m')
        parallel = NOTES[pc] + ('' if is_minor else 'm')
        if parallel not in in_key:
            continue
        heard_third = parallel_third = 1.0
        if chroma is not None and frames_per_second:
            f0 = int(run['start'] * frames_per_second)
            f1 = max(f0 + 1, int(run['end'] * frames_per_second))
            frame = chroma[:, f0:f1].mean(axis=1)
            heard_third = frame[(pc + (3 if is_minor else 4)) % 12]
            parallel_third = frame[(pc + (4 if is_minor else 3)) % 12]
        touches_parallel = any(0 <= j < len(runs) and runs[j]['simple'] == parallel for j in (i - 1, i + 1))
        if (touches_parallel and heard_third < 2.0 * parallel_third) or parallel_third >= 0.95 * heard_third:
            run['simple'] = parallel
    return _merge_equal(runs)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def refine(segments: List[Tuple[float, float, str]], beat_times: List[float],
           beat_positions: List[int], duration: float, bpm: Optional[float] = None,
           chroma: Optional[np.ndarray] = None, frames_per_second: float = 0.0) -> Dict:
    """Raw BTC segments -> {'chords': [{timestamp, chord, simple}], 'key', 'key_confidence'}."""
    beats, positions = build_grid(beat_times, beat_positions, duration, bpm)
    runs = decode_on_beats(segments, beats, positions, duration)
    for run in runs:
        run['chord'] = _richest_label(segments, run)
    key, confidence = estimate_key(runs, chroma)
    runs = settle_thirds(runs, key, chroma, frames_per_second)
    runs = absorb_single_beats(runs)
    for run in runs:
        run['chord'] = _richest_label(segments, run)
    key, confidence = estimate_key(runs, chroma)
    chords = []
    for run in runs:
        if run['simple'] == NO_CHORD or (chords and chords[-1]['simple'] == run['simple']):
            continue    # a silence keeps the previous chord on screen, as the raw chart did
        chords.append({'timestamp': round(run['start'], 3), 'chord': run['chord'], 'simple': run['simple']})
    return {'chords': chords, 'key': key, 'key_confidence': confidence}


def analyze_stems(stems_paths: Dict[str, str], beat_times: List[float], beat_positions: List[int],
                  bpm: Optional[float] = None, fallback_audio: Optional[str] = None) -> Optional[Dict]:
    """
    Chords and key of an extracted song. Uses the harmonic stems; falls back to
    `fallback_audio` (the full mix) when the extraction has none (e.g. vocals only).
    Returns refine()'s dict plus 'source' ('stems' | 'mix'), or None on failure.
    """
    from core.btc_chord_detector import detect_segments, is_available
    if not is_available():
        logger.warning("[CHORDS] BTC is not available")
        return None

    paths = harmonic_stem_paths(stems_paths)
    with tempfile.TemporaryDirectory(prefix='stemtube_chords_') as tmp:
        if paths:
            audio, source = os.path.join(tmp, 'harmonic.wav'), 'stems'
            try:
                mix_stems(paths, audio)
            except Exception as e:
                logger.warning(f"[CHORDS] Could not mix the harmonic stems ({e}), using the full mix")
                audio, source = fallback_audio, 'mix'
        else:
            audio, source = fallback_audio, 'mix'
        if not audio or not os.path.exists(audio):
            logger.warning("[CHORDS] No audio to analyze")
            return None

        segments = detect_segments(audio)
        if not segments:
            return None
        chroma, fps = mean_chroma_frames(audio)

    duration = max(segments[-1][1], (beat_times or [0])[-1])
    result = refine(segments, beat_times, beat_positions, duration, bpm, chroma, fps)
    result['source'] = source
    logger.info(f"[CHORDS] {len(segments)} raw segments -> {len(result['chords'])} chords, "
                f"key {result['key']} ({result['key_confidence']}), from {source}")
    return result


def update_song_chords(video_id: str, stems_paths: Optional[Dict[str, str]] = None,
                       fallback_audio: Optional[str] = None) -> Optional[Dict]:
    """
    Analyze an extracted song and store its chords and key. The one entry point for the
    post-extraction pass, the Regenerate button and the backfill script.

    Reads the stems, beat grid and BPM from the database unless `stems_paths` is given;
    only `chords_data`, `detected_key` and `analysis_confidence` are written.
    Returns analyze_stems()'s result, or None when nothing could be detected.
    """
    import json
    from core.db.connection import _conn
    from core.downloads_db import resolve_file_path, update_download_analysis

    with _conn() as conn:
        row = conn.execute(
            "SELECT stems_paths, beat_times, beat_positions, detected_bpm, file_path "
            "FROM global_downloads WHERE video_id=?", (video_id,)).fetchone()
    if not row:
        logger.warning(f"[CHORDS] Unknown video_id {video_id}")
        return None

    def _load(value, default):
        try:
            return json.loads(value) if value else default
        except (TypeError, ValueError):
            return default

    stems = stems_paths or _load(row['stems_paths'], {})
    fallback = fallback_audio or resolve_file_path(row['file_path']) or row['file_path']
    result = analyze_stems(stems, _load(row['beat_times'], []), _load(row['beat_positions'], []),
                           bpm=row['detected_bpm'], fallback_audio=fallback)
    if not result or not result['chords']:
        return None
    update_download_analysis(video_id, None, result['key'], result['key_confidence'],
                             chords_data=json.dumps(result['chords']))
    return result
