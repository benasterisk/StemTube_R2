"""
Downsampled waveform for the UI.

Like StemTube, we keep MIN and MAX per bucket (not just |peak|), so transients
read crisply and the waveform looks nervous/detailed rather than a flat blob.
High resolution (many buckets) lets the front zoom in without re-fetching.
"""
from __future__ import annotations
import numpy as np
import librosa

from .config import SR

# Many buckets so the waveform stays detailed even when zoomed in.
N_BUCKETS = 6000


def peaks(wav_path: str, n_buckets: int = N_BUCKETS):
    """
    Return {"min":[...], "max":[...]} normalized to [-1, 1].
    Each entry is the min / max sample value within its bucket.
    """
    y, _ = librosa.load(wav_path, sr=SR, mono=True)
    if len(y) == 0:
        return {"min": [], "max": []}

    n = min(n_buckets, len(y))
    # split into n contiguous buckets
    bounds = np.linspace(0, len(y), n + 1, dtype=int)
    mins = np.empty(n, dtype=np.float32)
    maxs = np.empty(n, dtype=np.float32)
    for i in range(n):
        a, b = bounds[i], bounds[i + 1]
        if b <= a:
            mins[i] = 0.0
            maxs[i] = 0.0
        else:
            seg = y[a:b]
            mins[i] = float(seg.min())
            maxs[i] = float(seg.max())

    peak = float(max(abs(mins.min()), abs(maxs.max()))) or 1.0
    mins = (mins / peak)
    maxs = (maxs / peak)
    return {"min": [round(float(v), 4) for v in mins],
            "max": [round(float(v), 4) for v in maxs]}
