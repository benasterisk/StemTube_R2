"""Render the metronome click-track WAV, sample-aligned with the stems."""
from __future__ import annotations
import os
import numpy as np
import soundfile as sf

from .config import CLICK_FREQ, CLICK_DUR, CLICK_RAMP
from . import click_kit


def _click(sr: int) -> np.ndarray:
    """Legacy single-sample click (the default "click" timbre's normal sample).
    Kept for back-compat callers; new code uses click_kit.sample(instrument, sr)."""
    return click_kit.sample("click", sr)[1]


def _resolution_grid(beats: list[float], positions: list[int], resolution: float):
    """
    Build (times, is_downbeat) for a given click resolution. Ported verbatim from
    stemtube-metronome-rework (core/beat_groove_snap.py):
      0.5 = half time  : every other beat (downbeats preferentially kept)
      1   = on time    : every beat
      2   = double time: each beat plus the midpoint to the next
    """
    bt = [float(x) for x in beats]
    pos = list(positions or [])
    times, down = [], []
    if resolution == 0.5:
        for i in range(0, len(bt), 2):
            times.append(bt[i])
            down.append(i < len(pos) and pos[i] == 1)
    elif resolution == 2:
        for i in range(len(bt)):
            times.append(bt[i])
            down.append(i < len(pos) and pos[i] == 1)
            if i + 1 < len(bt):
                times.append((bt[i] + bt[i + 1]) / 2.0)
                down.append(False)   # midpoints are never downbeats
    else:  # 1 = on time
        for i in range(len(bt)):
            times.append(bt[i])
            down.append(i < len(pos) and pos[i] == 1)
    return times, down


def _render_grid(times, downs, sr: int, total: int, out_wav: str, instrument="click") -> str:
    """Synthesize one click-track WAV from a (times, downbeats) grid, using the
    chosen instrument's (accent, normal) samples (accent on downbeats)."""
    accent, normal = click_kit.sample(instrument, sr)
    maxn = max(len(accent), len(normal))
    track = np.zeros(total + maxn, dtype=np.float32)
    for bt, is_db in zip(times, downs):
        idx = int(round(bt * sr))
        if 0 <= idx < total:
            smp = accent if is_db else normal
            end = min(idx + len(smp), len(track))
            track[idx:end] += smp[:end - idx]
    track = track[:total]
    sf.write(out_wav, track, sr)
    return out_wav


# Resolutions rendered at process time, and the file-name suffix for each.
# "1" is also written as plain metronome.wav (the default / back-compat name).
METRONOME_RESOLUTIONS = {0.5: "0.5", 1: "1", 2: "2"}


def render(beats: list[float], positions: list[int], ref_wav: str, out_wav: str,
           instrument="click") -> str:
    """
    Write the default (on-time, resolution 1) metronome WAV, matching ref_wav's
    sample rate and length exactly so it plays sample-for-sample with the stems.
    Downbeats (bar position 1) are accented. Kept for back-compat.
    """
    info = sf.info(ref_wav)
    sr = int(info.samplerate)
    total = int(info.frames)
    times, downs = _resolution_grid(beats, positions, 1)
    _render_grid(times, downs, sr, total, out_wav, instrument=instrument)
    print(f"[METRO] wrote {os.path.basename(out_wav)} ({len(times)} clicks @ {sr}Hz, {total} frames)")
    return out_wav


def render_all(beats: list[float], positions: list[int], ref_wav: str, stems_dir: str,
               instrument="click") -> dict:
    """
    Render one metronome WAV per resolution into stems_dir:
      metronome.wav (=res 1, default), metronome_0.5.wav, metronome_2.wav
    `instrument` selects the timbre (see core.poc.click_kit). Returns
    {resolution_str: relative_path} for meta.json (paths relative to out_dir).
    """
    info = sf.info(ref_wav)
    sr = int(info.samplerate)
    total = int(info.frames)
    out = {}
    for res, suffix in METRONOME_RESOLUTIONS.items():
        times, downs = _resolution_grid(beats, positions, res)
        fname = "metronome.wav" if suffix == "1" else f"metronome_{suffix}.wav"
        _render_grid(times, downs, sr, total, os.path.join(stems_dir, fname), instrument=instrument)
        out[suffix] = f"stems/{fname}"
    print(f"[METRO] wrote {len(out)} resolution WAVs @ {sr}Hz, {total} frames "
          f"({len(beats)} base beats, instrument={instrument})")
    return out
