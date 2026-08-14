"""Stem separation (demucs) → WAV stems at the working sample rate."""
from __future__ import annotations
import os
import sys
import subprocess
import numpy as np
import librosa
import soundfile as sf

from .config import SR, DEMUCS_MODEL

STEM_NAMES = ("drums", "bass", "vocals", "other")


def separate(mp3_path: str, out_dir: str, model: str = DEMUCS_MODEL) -> dict:
    """
    Split the MP3 into stems with demucs, normalized to <out_dir>/stems/<name>.wav
    at SR. Skips if already present. Returns {stem_name: wav_path}.
    """
    stem_dir = os.path.join(out_dir, "stems")
    os.makedirs(stem_dir, exist_ok=True)
    expected = {s: os.path.join(stem_dir, f"{s}.wav") for s in STEM_NAMES}
    if all(os.path.exists(p) for p in expected.values()):
        print("[STEMS] already separated, skipping")
        return expected

    demucs_out = os.path.join(out_dir, "_demucs")
    cmd = [sys.executable, "-m", "demucs.separate", "-n", model, "--out", demucs_out, mp3_path]
    print(f"[STEMS] demucs ({model})…")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("[STEMS] demucs stderr:\n", r.stderr[-2000:])
        raise RuntimeError("demucs failed")

    track = os.path.splitext(os.path.basename(mp3_path))[0]
    src_dir = os.path.join(demucs_out, model, track)
    out = {}
    for s in STEM_NAMES:
        src = os.path.join(src_dir, f"{s}.wav")
        if os.path.exists(src):
            y, _ = librosa.load(src, sr=SR, mono=False)
            if y.ndim == 1:
                y = np.stack([y, y])
            sf.write(expected[s], y.T, SR)
            out[s] = expected[s]
    print(f"[STEMS] wrote {len(out)} stems @ {SR}Hz")
    return out
