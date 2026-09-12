"""
Downsampled waveform for the UI.

Like StemTube, we keep MIN and MAX per bucket (not just |peak|), so transients
read crisply and the waveform looks nervous/detailed rather than a flat blob.
High resolution (many buckets) lets the front zoom in without re-fetching.
"""
from __future__ import annotations
import numpy as np
import librosa

# Many buckets so the waveform stays detailed even when zoomed in.
N_BUCKETS = 6000


def peaks(wav_path: str, n_buckets: int = N_BUCKETS):
    """
    Return {"min":[...], "max":[...]} normalized to [-1, 1].
    Each entry is the min / max sample value within its bucket.

    Decoded at the file's own rate (sr=None): peaks only feed the drawing, and asking
    librosa for another rate adds a resample that costs more than the whole job
    (measured: 2.3 s resampled vs 0.34 s native for a 3-minute stem).
    """
    y, _ = librosa.load(wav_path, sr=None, mono=True)
    if len(y) == 0:
        return {"min": [], "max": []}

    n = min(n_buckets, len(y))
    # split into n contiguous buckets (vectorized: reduceat over the bucket starts)
    bounds = np.linspace(0, len(y), n + 1, dtype=int)
    starts = bounds[:-1]
    empty = bounds[1:] <= starts
    mins = np.minimum.reduceat(y, starts).astype(np.float32)
    maxs = np.maximum.reduceat(y, starts).astype(np.float32)
    mins[empty] = 0.0
    maxs[empty] = 0.0

    peak = float(max(abs(mins.min()), abs(maxs.max()))) or 1.0
    mins = (mins / peak)
    maxs = (maxs / peak)
    return {"min": [round(float(v), 4) for v in mins],
            "max": [round(float(v), 4) for v in maxs]}
