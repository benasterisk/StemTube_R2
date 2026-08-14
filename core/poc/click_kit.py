"""Metronome timbres ("instruments") loaded from baked WAV one-shots.

The one-shots live in core/poc/samples/ (<id>.wav = normal, <id>_accent.wav =
downbeat) and are produced offline by core/poc/gen_samples.py. They are
synthesized there (no third-party samples → no licensing concerns) but with
heavier DSP than a live synth could afford, so they read as real percussion.

This module is the SINGLE source of the click sound: metronome.py / precount.py
pull (accent, normal) from `sample(instrument, sr)`. Picking an instrument
re-renders every click track (3 resolutions + count-in + stop + export)
identically and stays sample-locked to the stems.

100% samples: if an instrument's WAV is missing it simply doesn't appear in the
catalogue. The default is whatever DEFAULT_INSTRUMENT resolves to among the files
present (prefers "click").
"""
from __future__ import annotations
import os
import numpy as np
import soundfile as sf

SAMPLES_DIR = os.path.join(os.path.dirname(__file__), "samples")

# id → human label (display order = dropdown order). Only those whose <id>.wav
# exists are actually exposed (see INSTRUMENTS below).
_LABELS = {
    "click":     "Click (default)",
    "beep":      "Beep (soft)",
    "woodblock": "Woodblock",
    "clave":     "Clave",
    "rimshot":   "Cross-stick",
    "cowbell":   "Cowbell",
    "conga":     "Congas",
    "shaker":    "Shaker",
}


def _available():
    """Ids that have at least a normal WAV on disk, in _LABELS order."""
    out = {}
    for k, v in _LABELS.items():
        if os.path.exists(os.path.join(SAMPLES_DIR, f"{k}.wav")):
            out[k] = v
    return out


INSTRUMENTS = _available()
DEFAULT_INSTRUMENT = "click" if "click" in INSTRUMENTS else (next(iter(INSTRUMENTS), "click"))


def normalize(instrument):
    """Coerce an arbitrary value to an available instrument id (default if unknown)."""
    return instrument if instrument in INSTRUMENTS else DEFAULT_INSTRUMENT


def _resample(x, src_sr, dst_sr):
    """Linear resample (samples are short one-shots → linear is inaudible-grade)."""
    if src_sr == dst_sr or x.size == 0:
        return x.astype(np.float32)
    n_dst = int(round(len(x) * dst_sr / src_sr))
    if n_dst <= 1:
        return x.astype(np.float32)
    xp = np.linspace(0.0, 1.0, num=len(x), endpoint=False)
    fp = np.linspace(0.0, 1.0, num=n_dst, endpoint=False)
    return np.interp(fp, xp, x).astype(np.float32)


def _load_one(path, dst_sr):
    data, src_sr = sf.read(path, dtype="float32", always_2d=False)
    if getattr(data, "ndim", 1) > 1:        # mix to mono if a stereo file slipped in
        data = data.mean(axis=1)
    return _resample(np.asarray(data, dtype=np.float32), int(src_sr), int(dst_sr))


# (instrument, sr) → (accent, normal). Decoding/resampling is cached per process
# (all 3 resolutions + precount + stop reuse the same samples).
_CACHE = {}


def sample(instrument, sr):
    """Return (accent, normal) float32 mono samples for `instrument` at `sr`.

    Falls back to the normal sample for the accent if no _accent.wav exists, and to
    a tiny synthesized click if an instrument's files are entirely missing (so the
    renderer never crashes on a stale id)."""
    inst = normalize(instrument)
    key = (inst, int(sr))
    if key in _CACHE:
        return _CACHE[key]
    normal_p = os.path.join(SAMPLES_DIR, f"{inst}.wav")
    accent_p = os.path.join(SAMPLES_DIR, f"{inst}_accent.wav")
    try:
        normal = _load_one(normal_p, sr)
        accent = _load_one(accent_p, sr) if os.path.exists(accent_p) else normal
    except Exception:
        normal = accent = _fallback_click(int(sr))
    _CACHE[key] = (accent, normal)
    return _CACHE[key]


def _fallback_click(sr):
    """Last-resort synthesized click if a sample file can't be read."""
    n = int(0.05 * sr); t = np.arange(n) / sr
    return (np.sin(2 * np.pi * 1200.0 * t) * np.exp(-32.0 * t / 0.05) * 0.9).astype(np.float32)
