"""
Self-measurement: does the metronome land on the real drum hits?
Compares the metronome WAV's clicks to the drum stem's onsets. Pure measurement.
"""
from __future__ import annotations
import os
import numpy as np
import librosa
import scipy.signal as sps
from scipy.signal import find_peaks, hilbert

from .config import SR


def alignment(out_dir: str) -> dict:
    stems_dir = os.path.join(out_dir, "stems")
    drums = os.path.join(stems_dir, "drums.wav")
    metro = os.path.join(stems_dir, "metronome.wav")

    ym, _ = librosa.load(metro, sr=SR, mono=True)
    ec = np.abs(hilbert(sps.sosfiltfilt(
        sps.butter(4, [1100, 1300], btype='band', fs=SR, output='sos'), ym)))
    cpk, _ = find_peaks(ec, height=0.05, distance=int(0.15 * SR))
    clicks = cpk / SR

    yd, _ = librosa.load(drums, sr=SR, mono=True)
    oenv = librosa.onset.onset_strength(y=yd, sr=SR, hop_length=128)
    ot = librosa.times_like(oenv, sr=SR, hop_length=128)
    opk, _ = find_peaks(oenv / (oenv.max() + 1e-9), height=0.15, distance=int(0.10 * SR / 128))
    onsets = ot[opk]

    devs = []
    for ct in clicks:
        if len(onsets) == 0:
            break
        nearest = onsets[np.argmin(np.abs(onsets - ct))]
        d = (nearest - ct) * 1000.0
        if abs(d) < 60:
            devs.append(d)
    devs = np.array(devs) if devs else np.array([999.0])
    res = {
        "n_clicks": int(len(clicks)),
        "n_matched": int(len(devs)),
        "median_ms": float(np.median(devs)),
        "mean_ms": float(np.mean(devs)),
        "std_ms": float(np.std(devs)),
        "aligned": bool(abs(float(np.median(devs))) < 12),
    }
    print(f"[MEASURE] click vs drum onset: median={res['median_ms']:+.1f}ms "
          f"std={res['std_ms']:.1f}ms (N={res['n_matched']}) -> "
          f"{'ALIGNED' if res['aligned'] else 'MISALIGNED'}")
    return res
