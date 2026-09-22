# Madmom Beat & Downbeat Detection - Setup Guide

## Overview

StemTube uses **madmom** - a music information retrieval library with deep learning models - for **beat and downbeat detection only**. Its output drives the metronome grid, count-in, bar numbers (`b17` loop fields) and the measure layout of the chord views.

> **madmom is NOT used for chord detection.** Chords come exclusively from the BTC-ISMIR19
> Transformer (see [BTC Setup](BTC-SETUP.md) and the
> [Chord Detection Guide](../feature-guides/CHORD-DETECTION.md)). The old madmom CRF chord path
> and the hybrid detector are no longer wired in, and the `chords_use_madmom` /
> `chords_use_hybrid` settings in `core/config.json` have no effect.

## What It Does

### Beat Tracking Engine
- **RNN downbeat activations** - `RNNDownBeatProcessor` computes beat/downbeat likelihoods
- **DBN decoding** - `DBNDownBeatTrackingProcessor` (Viterbi) turns them into beat times and bar positions
- **Tempo-constrained search** - the detected BPM narrows the tempo window, avoiding octave errors
- **Fallback** - plain `RNNBeatProcessor` + `DBNBeatTrackingProcessor` if downbeat tracking fails (beats without bar positions)

### Timeline Sync
- **Beat offset** - first downbeat precisely identified
- **Beat grid** - every beat time plus its position in the bar (1, 2, 3, 4...)
- **Metronome** - the mixer's click track and count-in are built from this grid

## Installation

### Automatic (Recommended)
```bash
# Installs madmom, pins numpy 1.26.4 / scipy 1.17.1 / librosa 0.11.0,
# and runs patch_madmom.py for you
python3.12 setup_dependencies.py
```

### Manual
```bash
source venv/bin/activate
pip install 'numpy==1.26.4'  # Required: madmom needs numpy 1.x
pip install cython
pip install madmom

# Patch for numpy 1.20+ / Python 3.10+
python patch_madmom.py
```

## Important Notes

### NumPy Version Requirement
⚠️ **Madmom requires numpy 1.x** (not 2.x)
- Madmom 0.16.1's compiled Cython extensions were built with numpy 1.x
- `setup_dependencies.py` pins `numpy==1.26.4`
- `scipy` is pinned to `1.17.1` (1.18+ references the removed `np.long` and breaks madmom's wav loading)
- `librosa` is pinned to `0.11.0` (1.0 requires numpy 2)

### Python 3.10+ Compatibility
The `patch_madmom.py` script fixes:
- `collections.MutableSequence` → `collections.abc.MutableSequence`
- Deprecated `np.float` / `np.int` / `np.complex` / `np.bool` aliases

Run after every madmom installation.

## How It Works

### Automatic Integration
Beat detection runs automatically **after stem extraction** (not at download time):

```python
# In extensions.py - post-extraction chain
from core.madmom_chord_detector import MadmomChordDetector

detector = MadmomChordDetector()
beat_offset, beats, beat_positions = detector._detect_beats(audio_path, known_bpm=known_bpm)
```

Despite the module name, only `_detect_beats()` is used.

### Regenerate Beats
From the mixer, or via API:

```bash
curl -X POST http://localhost:5011/api/extractions/<extraction_id>/beats/regenerate
```

To fill in songs that have no beat grid yet:

```bash
python utils/analysis/regenerate_beat_times.py
```

Regenerating beats stores the freshly detected grid (beat times, bar positions, offset) and keeps **Skip Intro** (`music_start_time`). Regenerating chords does not touch the beat grid. Regenerating beats re-decodes the chords on the new grid (the chords are aligned on beats by `core/chord_refiner.py`), and the response carries them as `chords`.

## Detection Pipeline

1. **Activations (RNN)**
   - `RNNDownBeatProcessor` on the audio (~10-30 s, the expensive step)

2. **Decoding (DBN)**
   - Tempo-constrained around the known BPM when available
   - Outputs (time, bar position) pairs

3. **Sanity Checks**
   - Post-hoc octave check on the resulting tempo
   - Fallback to beat-only tracking if downbeats fail

4. **Storage**
   - Beat times rounded and saved with bar positions

## Output Format

**Database Fields** (`global_downloads`):
- `beat_times` - JSON array of beat times in seconds
- `beat_positions` - JSON array of beat-in-bar positions (1 = downbeat)
- `beat_offset` - Time of first downbeat (seconds)

```json
{
  "beat_offset": 0.33,
  "beat_times": [0.33, 0.83, 1.33, 1.83, 2.33],
  "beat_positions": [1, 2, 3, 4, 1]
}
```

## Mixer Integration

The mixer uses the beat grid for:
- **Metronome track** (starts muted - unmute it to hear the click)
- **Count-in** and the Start / Stop markers
- **Snap to beat** for loop bounds and markers
- **Bar-based loop fields** (`b17`, `b17.3`)
- **Chord views** laid out beat by beat and measure by measure

## Troubleshooting

### Import Error: "numpy has no attribute 'float'"
Run the patcher:
```bash
python patch_madmom.py
```

### Wrong NumPy Version
```bash
pip install 'numpy==1.26.4'
pip install --force-reinstall --no-cache-dir madmom
python patch_madmom.py
```

### "module 'numpy' has no attribute 'long'"
SciPy is too new for numpy 1.x:
```bash
pip install 'scipy==1.17.1'
```

### Madmom Not Available
Check installation:
```bash
python -c "import madmom; print(madmom.__version__)"
```

Should output: `0.16.1`

### Detection Fails
Beat detection failures are non-fatal - the extraction still completes:
```
[BEATS] Beat detection error (non-fatal): ...
```
The song then has no beat grid (no metronome). Fix madmom, then regenerate beats.

## Performance

| Metric | Value |
|--------|-------|
| Processing Speed | ~10-30 s per song (CPU) |
| GPU | Not used |
| Dependencies | NumPy 1.x, SciPy ≤ 1.17.1, Cython |

## Files

**Core Implementation:**
- `core/madmom_chord_detector.py` - `MadmomChordDetector._detect_beats()` (beat/downbeat tracking; the chord code in this module is unused)
- `extensions.py` - Post-extraction beat detection call
- `routes/media.py` - `/beats/regenerate` endpoint
- `patch_madmom.py` - numpy / Python 3.10+ compatibility patcher (also in `utils/setup/`)

**Utilities:**
- `utils/analysis/regenerate_beat_times.py` - Detect beats for songs missing a beat grid
- `utils/testing/test_madmom_tempo_key.py` - Test madmom tempo/key/beat detection

**Not related to madmom anymore:**
- `utils/analysis/reanalyze_all_chords.py` - BTC chord + key re-analysis on the harmonic stems,
  decoded on the stored beat grid (`core/chord_refiner.py`)
- `utils/analysis/reanalyze_with_madmom.py` was removed (despite its name it stored raw full-mix
  BTC chords)

## Credits

- **madmom**: [https://github.com/CPJKU/madmom](https://github.com/CPJKU/madmom)
- Deep learning models for music information retrieval
- Developed by CP-JKU (Johannes Kepler University)
