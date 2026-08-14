"""
Orchestrates the full pipeline by calling each single-purpose module:
  stems → beats → groove → metronome → waveform, then writes meta.json.

This is the only module the server imports for processing. Each step reports
progress via the optional `progress(stage, pct)` callback.
"""
from __future__ import annotations
import os
import json
import soundfile as sf

from . import stems as M_stems
from . import beats as M_beats
from . import groove as M_groove
from . import metronome as M_metro
from . import waveform as M_wave
from . import startpoint as M_start
from . import chords as M_chords
from .config import SR


def process(mp3_path: str, out_dir: str, progress=None) -> dict:
    def step(stage, pct):
        if progress:
            try:
                progress(stage, pct)
            except Exception:
                pass
        print(f"[PROGRESS] {pct:3d}% {stage}")

    os.makedirs(out_dir, exist_ok=True)

    step("Separating stems (demucs)…", 5)
    stem_paths = M_stems.separate(mp3_path, out_dir)
    drums = stem_paths["drums"]

    step("Detecting beats (madmom)…", 55)
    beats, positions = M_beats.detect(mp3_path)

    step("Snapping to groove…", 80)
    snapped, snap_stats = M_groove.snap(beats, drums)

    step("Rendering metronome (3 resolutions)…", 88)
    stems_dir = os.path.join(out_dir, "stems")
    # Render one click-track per resolution (0.5 / 1 / 2). "1" → metronome.wav.
    metro_res = M_metro.render_all(snapped, positions, drums, stems_dir)
    metro_wav = os.path.join(stems_dir, "metronome.wav")  # default (res 1)
    stem_paths["metronome"] = metro_wav

    step("Building waveforms…", 90)
    waveforms = {name: M_wave.peaks(path) for name, path in stem_paths.items()}

    # Chord detection (BTC) + key inferred from the chords. Runs on the source
    # mp3 (full mix). Best-effort: failure leaves chords/key empty.
    step("Detecting chords + key (BTC)…", 94)
    chords, key = [], {"key": "", "tonic": "", "mode": "", "confidence": 0.0}
    try:
        chords, key = M_chords.detect_chords_and_key(mp3_path, None)
        print(f"[PIPELINE] {len(chords)} chords, key={key.get('key')} (conf {key.get('confidence')})")
    except Exception as e:
        print(f"[PIPELINE] chord/key detection failed: {e}")

    # Auto-detect a musical start point (first downbeat where tempo settles),
    # and the song's median tempo (for a steady precount). Both are proposals
    # the UI can override (Start marker is draggable).
    start_index, start_time = M_start.detect_start(snapped, positions)
    ibis = [snapped[i + 1] - snapped[i] for i in range(len(snapped) - 1)]
    import statistics as _st
    median_ibi = _st.median(ibis) if ibis else 0.5
    median_bpm = round(60.0 / median_ibi) if median_ibi > 0 else 120

    dur = sf.info(drums).duration
    meta = {
        "mp3": os.path.basename(mp3_path),
        "duration": round(dur, 3),
        "sr": SR,
        "beats": snapped,
        "positions": positions,
        "snap_stats": snap_stats,
        "stems": {name: f"stems/{name}.wav" for name in stem_paths},
        # metronome click-track per resolution; UI selector switches between them
        "metronome_resolutions": metro_res,   # {"0.5":..., "1":..., "2":...}
        # precount support: proposed start (downbeat after intro) + steady tempo
        "start_index": start_index,
        "start_time": round(start_time, 3),
        "median_bpm": median_bpm,
        # chords (BTC) + key inferred from them. Key drives the pitch-shift base.
        "chords": chords,                      # [{timestamp, chord}]
        "key": key.get("key", ""),             # e.g. "B major"
        "key_tonic": key.get("tonic", ""),     # e.g. "B"
        "key_mode": key.get("mode", ""),       # "major" | "minor"
        "key_confidence": key.get("confidence", 0.0),
        "waveforms": waveforms,
    }
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f)
    step("Done", 100)
    return meta
