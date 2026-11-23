"""Time map and time-warp used to straighten a song.

A band that is not tight drifts around its own tempo. The detected beats give
that drift: ``beat_map`` pairs every beat of the recording with its place on a
regular grid at the average tempo of the song. ``splice_plan`` + ``warp`` then
move the audio along that map with WSOLA (waveform-similarity overlap-add), a
time-domain stretch that keeps the pitch and suits small ratios well.

Every stem is warped with the SAME splice points, decided once on the mix: the
stems stay sample-aligned with each other, so their bleed does not turn into
comb filtering when they play together. The lead vocal weighs more in that
decision because it is the stem most often heard on its own next to MIDI tracks.
"""
import numpy as np
import scipy.signal as sg

try:
    from numba import njit
except Exception:                      # pragma: no cover
    def njit(*args, **kwargs):
        return (lambda f: f) if not (args and callable(args[0])) else args[0]

SR = 44100
FRAME = 2048            # 46 ms
HOP = FRAME // 2
SEARCH = 512            # the splice point may move this far to find a similar waveform
DECIM = 4               # the similarity search runs on a decimated signal
MIN_BEATS = 8
DIVISIONS = {"1/4": 1, "1/8": 2, "1/16": 4, "1/8T": 3, "1/16T": 6}
UNSNAPPED = ("vocals", "backing_vocals")    # sung notes follow the voice, not the grid


def identity_map(beats):
    """A map that moves nothing, for a song already on its grid (to snap notes with map_notes)."""
    beats = [float(t) for t in beats]
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    end = (beats[-1] if beats else 0.0) + 64 * period
    return {"src": np.array([0.0, end]), "dst": np.array([0.0, end]), "beats": beats,
            "period": period, "duration": end}


def beat_map(beats, positions, duration, strength=1.0, follow="beat"):
    """Pair the recording with a regular grid.

    Returns a dict: ``src``/``dst`` anchors (seconds, from 0 to the end) of the
    piecewise-linear map recording time -> straightened time, ``beats`` and
    ``positions`` of the new grid, ``bpm``, ``period``, ``duration`` of the
    result, and ``drift_ms`` / ``jitter_ms`` / ``ratio`` describing how far the
    recording was from the grid. ``strength`` below 1 corrects only that share
    of the drift. ``follow``: "beat" puts every beat on the grid (the drummer is
    quantized), "bar" only straightens the tempo and keeps the feel inside a bar.
    """
    pairs = sorted((float(t), int(p)) for t, p in zip(beats, positions) if 0 <= float(t) <= duration)
    if len(pairs) < MIN_BEATS:
        raise ValueError("Not enough beats detected to straighten this song")
    b = np.array([t for t, _ in pairs])
    pos = [p for _, p in pairs]
    period = float(np.median(np.diff(b)))
    keep = [0]
    for i in range(1, len(b)):             # a beat right after another is a detection glitch
        if b[i] - b[keep[-1]] >= 0.5 * period:
            keep.append(i)
    b, pos = b[keep], [pos[i] for i in keep]
    if len(b) < MIN_BEATS:
        raise ValueError("Not enough beats detected to straighten this song")
    # index of each beat on the grid: a gap of two periods is one missed beat
    steps = np.maximum(1, np.rint(np.diff(b) / period)).astype(int)
    k = np.concatenate([[0], np.cumsum(steps)])
    period, origin = (float(v) for v in np.polyfit(k, b, 1))
    drift = b - (origin + period * k)
    # The slow part of the drift (the tempo of the band wandering) is read over two
    # bars. What is left is beat-level: a laid-back backbeat, a rushed fill, and
    # the error of the beat detection itself.
    half = max(2, max(pos))
    slow = sg.medfilt(np.pad(drift, 2, mode="edge"), 5)[2:-2]
    window = np.bartlett(2 * half + 3)[1:-1]
    slow = np.convolve(np.pad(slow, half, mode="edge"), window / window.sum(), mode="valid")
    if follow == "beat":
        # every beat goes on the grid; a beat far off the others is a detection error
        smooth = slow + np.clip(drift - slow, -0.12 * period, 0.12 * period)
    else:
        smooth = slow
    strength = float(min(1.0, max(0.0, strength)))
    src = origin + period * k + smooth
    src[0] = max(0.0, src[0])
    for i in range(1, len(src)):           # keep the map strictly increasing
        src[i] = max(src[i], src[i - 1] + 0.25 * period * steps[i - 1])
    dst = origin + period * k + (1.0 - strength) * smooth
    dst = dst + (src[0] - dst[0])          # the start of the song stays where it is
    ratio = np.diff(dst) / np.diff(src)
    if ratio.min() < 0.5 or ratio.max() > 2.0:
        raise ValueError("The beat grid of this song is too irregular to straighten")
    s_full, d_full = list(src), list(dst)
    if src[0] > 1e-6:
        s_full.insert(0, 0.0)
        d_full.insert(0, 0.0)
    if duration - src[-1] > 1e-6:
        s_full.append(float(duration))
        d_full.append(float(dst[-1] + duration - src[-1]))
    index = np.arange(k[-1] + 1)
    new_beats = np.interp(index, k, dst)
    bar = max(1, max(pos))
    known = dict(zip(k.tolist(), pos))
    new_pos, last = [], pos[0]
    for j in index.tolist():               # a missed beat continues the count of the bar
        last = known[j] if j in known else last % bar + 1
        new_pos.append(int(last))
    return {"src": np.array(s_full), "dst": np.array(d_full),
            "beats": [round(float(t), 4) for t in new_beats], "positions": new_pos,
            "bpm": round(60.0 / period, 2), "period": period, "duration": float(d_full[-1]),
            "drift_ms": round(float(np.abs(slow - slow.mean()).max() * 1000), 1),
            "jitter_ms": round(float(np.std(drift - slow) * 1000), 1),
            "ratio": (round(float(ratio.min()), 3), round(float(ratio.max()), 3))}


def to_dst(t, bm):
    """Recording time(s) -> straightened time(s)."""
    return np.interp(t, bm["src"], bm["dst"])


def grid(bm, division):
    """Every grid line of the straightened song for a division (see DIVISIONS)."""
    div = DIVISIONS.get(division, 4)
    beats = np.asarray(bm["beats"])
    step = bm["period"] / div
    inner = np.interp(np.arange((len(beats) - 1) * div + 1) / div, np.arange(len(beats)), beats)
    before = inner[0] - step * np.arange(int(inner[0] / step), 0, -1)
    after = inner[-1] + step * np.arange(1, int(max(0.0, bm["duration"] - inner[-1]) / step) + 1)
    return np.concatenate([before, inner, after])


def map_notes(notes, bm, division="1/16", strength=1.0, snap=True):
    """Move notes onto the straightened timing; ``snap`` also pulls each onset to the grid.

    A note keeps its length. Two notes of the same pitch never overlap afterwards.
    """
    if not notes:
        return []
    lines = grid(bm, division) if snap else None
    out = []
    for s, e, p, v in notes:
        s2, e2 = float(to_dst(s, bm)), float(to_dst(e, bm))
        if lines is not None and len(lines) > 1:
            i = int(np.clip(np.searchsorted(lines, s2), 1, len(lines) - 1))
            near = lines[i - 1] if s2 - lines[i - 1] <= lines[i] - s2 else lines[i]
            move = (near - s2) * strength
            s2, e2 = s2 + move, e2 + move
        s2 = max(0.0, s2)
        out.append([s2, max(s2 + 0.03, e2), int(p), int(v)])
    out.sort(key=lambda n: (n[2], n[0]))
    kept = []
    for n in out:
        if kept and kept[-1][2] == n[2]:
            if n[0] - kept[-1][0] < 0.01:          # two notes landed on the same line
                kept[-1][1] = max(kept[-1][1], n[1])
                kept[-1][3] = max(kept[-1][3], n[3])
                continue
            kept[-1][1] = min(kept[-1][1], n[0])
        kept.append(n)
    return sorted(((s, e, p, v) for s, e, p, v in kept), key=lambda n: n[0])


TIME_KEYS = ("start", "end", "timestamp", "time", "start_time", "end_time")


def map_times(obj, bm, keys=TIME_KEYS):
    """Copy of a JSON-like value with every time field moved onto the straightened timing."""
    if isinstance(obj, list):
        return [map_times(v, bm, keys) for v in obj]
    if isinstance(obj, dict):
        return {k: (round(float(to_dst(v, bm)), 3)
                    if k in keys and isinstance(v, (int, float)) and not isinstance(v, bool)
                    else map_times(v, bm, keys)) for k, v in obj.items()}
    return obj


@njit(cache=True)
def _search(g, cs, ideal, n, h, r):
    """WSOLA read positions on the decimated guide ``g`` (``cs``: running sum of its squares)."""
    m = len(ideal)
    pos = np.empty(m, np.int64)
    last = len(g) - n - 1
    p = min(max(int(round(ideal[0])), 0), last)
    pos[0] = p
    for j in range(1, m):
        nat = min(p + h, last)                 # where the previous frame continues by itself
        c = min(max(int(round(ideal[j])), 0), last)
        lo, hi = max(0, c - r), min(last, c + r)
        if lo <= nat <= hi:
            best, best_score = nat, 0.999      # no splice unless it is forced
        else:
            best, best_score = c, -2.0
        e_nat = cs[nat + n] - cs[nat]
        if e_nat > 1e-9 and best != nat:
            for q in range(lo, hi + 1):
                e_q = cs[q + n] - cs[q]
                if e_q <= 1e-9:
                    continue
                acc = 0.0
                for i in range(n):
                    acc += g[q + i] * g[nat + i]
                score = acc / np.sqrt(e_q * e_nat)
                if score > best_score:
                    best_score = score
                    best = q
        p = best
        pos[j] = p
    return pos


@njit(cache=True)
def _ola(x, pos, win, n_total, frame, hop):
    out = np.zeros(n_total, np.float32)
    for j in range(len(pos)):
        p = pos[j]
        o = j * hop
        for i in range(frame):
            out[o + i] += x[p + i] * win[i]
    return out


def splice_plan(guide, bm):
    """Where every output frame is read in the recording. ``guide``: mono mix at SR.

    Output frame j is centred on output sample j * HOP. Signals are read with HOP
    samples of silence in front, so a frame centred on sample c starts at index c.
    """
    n_out = int(round(bm["duration"] * SR))
    frames = int(np.ceil(n_out / HOP)) + 1
    centre = np.interp(np.arange(frames) * HOP / SR, bm["dst"], bm["src"]) * SR
    g = sg.resample_poly(guide.astype(np.float64), 1, DECIM)
    g = np.concatenate([np.zeros(HOP // DECIM), g, np.zeros(2 * FRAME // DECIM + 2)])
    cs = np.concatenate([[0.0], np.cumsum(g * g)])
    pos = _search(g, cs, centre / DECIM, FRAME // DECIM, HOP // DECIM, SEARCH // DECIM)
    return {"pos": pos * DECIM, "n_out": n_out}


def warp(x, plan):
    """Warp a stem ((2, n) float32) along a splice plan. Returns (2, n_out) float32."""
    win = np.hanning(FRAME + 1)[:FRAME].astype(np.float32)
    pos, n_out = plan["pos"], plan["n_out"]
    need = int(pos.max()) + FRAME + 1
    total = (len(pos) - 1) * HOP + FRAME
    out = []
    for c in x:
        padded = np.concatenate([np.zeros(HOP, np.float32), c.astype(np.float32),
                                 np.zeros(max(0, need - HOP - len(c)), np.float32)])
        y = _ola(padded, pos, win, total, FRAME, HOP)
        out.append(y[HOP:HOP + n_out])
    return np.stack(out)
