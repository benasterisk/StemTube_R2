"""
Groove snap — align each madmom beat to the real drum hit.

For each beat, snap to the STRONGEST drum onset within an adaptive window, so we
lock to the actual groove without grabbing off-beats or ghost notes. Beats with
no clear onset keep their madmom position. The result stays strictly increasing.
"""
from __future__ import annotations
import numpy as np
import librosa

from .config import SR, SNAP_WINDOW_SEC, SNAP_WINDOW_BEAT_FRAC, SNAP_ACCENT_THRESHOLD


def snap(beats: list[float], drums_wav: str,
         window_sec: float = SNAP_WINDOW_SEC,
         window_beat_frac: float = SNAP_WINDOW_BEAT_FRAC,
         accent_threshold: float = SNAP_ACCENT_THRESHOLD) -> tuple[list[float], dict]:
    y, _ = librosa.load(drums_wav, sr=SR, mono=True)
    oenv = librosa.onset.onset_strength(y=y, sr=SR, hop_length=128)
    otimes = librosa.times_like(oenv, sr=SR, hop_length=128)
    peak = float(oenv.max()) or 1.0
    oenv = oenv / peak

    bt = [float(x) for x in beats]
    n = len(bt)
    if n >= 2:
        ibi = np.diff(bt)
        half_beat = np.empty(n)
        half_beat[:-1] = ibi / 2.0
        half_beat[-1] = ibi[-1] / 2.0 if len(ibi) else 0.25
    else:
        half_beat = np.array([0.25] * n)

    out = list(bt)
    shifts = []
    snapped = 0
    for i, g in enumerate(bt):
        win = min(window_sec, window_beat_frac * half_beat[i])
        if win <= 0:
            continue
        lo = np.searchsorted(otimes, g - win)
        hi = np.searchsorted(otimes, g + win)
        if hi <= lo:
            continue
        seg = oenv[lo:hi]
        k = int(np.argmax(seg))
        if seg[k] >= accent_threshold:
            out[i] = float(otimes[lo + k])
            shifts.append((out[i] - g) * 1000.0)
            snapped += 1

    # keep strictly increasing (never cross a neighbor)
    eps = 1e-4
    for i in range(n):
        lo_b = (out[i - 1] + eps) if i > 0 else -1e9
        hi_b = (bt[i + 1] - eps) if i < n - 1 else 1e9
        out[i] = min(max(out[i], lo_b), hi_b)
    out = [max(0.0, round(x, 4)) for x in out]

    sh = np.array(shifts) if shifts else np.array([0.0])
    stats = {"snapped": snapped, "total": n,
             "median_shift_ms": float(np.median(sh)),
             "max_shift_ms": float(np.max(np.abs(sh)))}
    print(f"[SNAP] {snapped}/{n} beats snapped, median shift {stats['median_shift_ms']:+.1f}ms")
    return out, stats
