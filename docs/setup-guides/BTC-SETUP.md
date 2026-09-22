# BTC Chord Detector Setup Guide

Complete installation guide for the BTC Transformer chord detector (170 chord vocabulary).

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Verification](#verification)
- [Configuration](#configuration)
- [No Fallback](#no-fallback)
- [Troubleshooting](#troubleshooting)

---

## Overview

**BTC**: Bi-directional Transformer for Chord recognition (ISMIR 2019)

**Upstream Repository**: https://github.com/jayg996/BTC-ISMIR19

**Vocabulary**: 170 chord types (major, minor, 7th, 9th, 11th, 13th, sus, dim, aug, etc.)

**Model**: Deep learning Transformer architecture

**Status**: **Required** for chords - it is StemTube's only chord detector

**Fallback**: **None.** If BTC is unavailable, songs get no chords. madmom is used only for
beat/downbeat detection, and the old madmom CRF / hybrid chord chain has been removed.

---

## Prerequisites

**Python**: 3.12+ (StemTube venv)

**PyTorch**: Already installed by `setup_dependencies.py`

**Dependencies** (installed by `setup_dependencies.py`):
- torch
- librosa
- mir_eval, pretty_midi
- pyyaml, pandas, scipy

**Disk Space**: ~25 MB of model weights

**Location**: Bundled inside the project at `external/BTC-ISMIR19/` (tracked in git) - no separate install

---

## Installation

### Step 1: Check the Bundled Model

BTC ships with StemTube. Nothing needs to be cloned:

```bash
cd stemtube_dev_1.4

ls external/BTC-ISMIR19/
# btc_model.py  btc_wrapper.py  run_config.yaml  test/  utils/ ...

ls -lh external/BTC-ISMIR19/test/*.pt
# btc_model.pt              (24-chord model, unused)
# btc_model_large_voca.pt   (170-chord model, used by StemTube)
```

The path is resolved automatically in `core/btc_chord_detector.py`:

```python
# BTC is located at external/BTC-ISMIR19 relative to project root
BTC_PATH = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)),
                                        'external', 'BTC-ISMIR19'))
```

### Step 2: Install Dependencies

```bash
python3.12 setup_dependencies.py
```

BTC runs **in-process** in the StemTube venv (no separate environment, no subprocess).

### Step 3: Verify BTC Standalone (Optional)

```bash
cd external/BTC-ISMIR19
python3 test.py --audio_dir ./test --save_dir ./test_output --voca True
```

See [BTC-CHORD-SETUP.md](BTC-CHORD-SETUP.md) for the expected output.

---

## Verification

### Test BTC from StemTube

```bash
source venv/bin/activate

python -c "from core.btc_chord_detector import is_available; print('BTC available:', is_available())"
```

**Expected Output**:
```
[BTC] BTC wrapper imported successfully
BTC available: True
```

**If Unavailable**:
```
[BTC] Warning: BTC path not found at /path/to/external/BTC-ISMIR19
```
or
```
[BTC] Warning: Could not import BTC wrapper: ...
```

→ See [Troubleshooting](#troubleshooting)

### Test Detection

```python
from core.btc_chord_detector import detect_segments

# Raw BTC output: (start, end, label) segments, "N" = no chord
segments = detect_segments('path/to/song.mp3')

print(f"Detected {len(segments)} raw segments")
print(f"First segment: {segments[0] if segments else None}")

# Expected output:
# [BTC] Running transformer inference...
# [BTC] Detected 150 chord segments
# Detected 150 raw segments
```

Full pipeline on an extracted song (harmonic stems → BTC → beat-grid decoding → key; stores the
result):
```python
from core.chord_refiner import update_song_chords

result = update_song_chords('<video_id>')
print(result['key'], len(result['chords']), result['chords'][0])
# E minor 86 {'timestamp': 19.705, 'chord': 'Em7', 'simple': 'Em'}
```

Or directly:
```bash
python core/btc_chord_detector.py /path/to/audio.mp3
```

---

## Configuration

There is nothing to configure:
- BTC is always used when available
- The 170-chord vocabulary is hard-wired (`use_large_vocab=True`)
- `chords_use_madmom` and `chords_use_hybrid` in `core/config.json` are **inert** leftovers
- There is no `chord_backend` setting and no way to select another backend

---

## No Fallback

### When BTC Is Unavailable

1. `core/chord_refiner.py` (run after stem extraction) checks `is_available()`
2. If BTC is missing, it logs `[CHORDS] BTC is not available`
3. `chords_data` stays empty - **no other detector is tried**

If BTC raises during the post-extraction pass, the log shows
`[CHORDS] Chord detection error (non-fatal): ...`, the extraction still completes and the result is
also empty.

### Logging

**Success**:
```
[CHORDS] 166 raw segments -> 86 chords, key E minor (0.21), from stems
```

**Failure**:
```
[CHORDS] BTC is not available
```

After fixing BTC, regenerate chords for affected songs from the mixer (**Reanalyze** in the Chords
tab) or with `python utils/analysis/reanalyze_all_chords.py [--limit N] [--video-id ID]`
(extracted songs only; songs whose stems are not on disk are skipped).

---

## Troubleshooting

### BTC Not Found

**Symptom**:
```
[BTC] Warning: BTC path not found at /path/to/external/BTC-ISMIR19
```

**Solutions**:

**1. Verify the Directory**:
```bash
ls -la external/BTC-ISMIR19
```

**2. Restore It from Git** (if deleted):
```bash
git checkout -- external/BTC-ISMIR19
```

---

### Import Error

**Symptom**:
```
[BTC] Warning: Could not import BTC wrapper: No module named 'mir_eval'
```

**Cause**: BTC dependencies not installed in the StemTube venv

**Solution**:
```bash
source venv/bin/activate
pip install torch librosa mir_eval pretty_midi pyyaml pandas
```

---

### Model Not Found

**Symptom**: BTC fails to load its weights

**Cause**: `.pt` files missing

**Solution**:
```bash
ls -la external/BTC-ISMIR19/test/btc_model_large_voca.pt
git checkout -- external/BTC-ISMIR19/test/
```

---

### Slow Detection

**Symptom**: BTC takes > 60 seconds per song

**Cause**: BTC runs on CPU (`btc_wrapper.py` defaults to `torch.device("cpu")`), sharing it with
extraction and Whisper

**Solutions**:
- Let concurrent extractions finish
- Expect roughly 5x real-time on a typical CPU

---

### Incorrect Chords

**Symptom**: BTC detects wrong/overly complex chords

**Cause**: BTC may overfit for simple music

**Solutions**:
- Regenerate chords from the mixer
- Use higher-quality source audio
- There is no alternative backend to compare against

---

## Uninstallation

Removing `external/BTC-ISMIR19` disables chord detection entirely - StemTube does **not** fall
back to madmom. There is no supported way to swap in another chord backend.

---

## Performance

| Metric | BTC Transformer |
|--------|----------------|
| Vocabulary | 170 types |
| Device | CPU |
| Speed | ~5x real-time (4-min song → ~50 s) |
| Memory | ~500 MB peak |
| Dependencies | Bundled in `external/` |

---

## Next Steps

- [Chord Detection Guide](../feature-guides/CHORD-DETECTION.md) - Full chord detection documentation
- [BTC Chord Setup](BTC-CHORD-SETUP.md) - Directory layout, standalone test, output format
- [madmom Setup](MADMOM-SETUP.md) - Beat/downbeat detection (not chords)

---

**BTC Version**: ISMIR 2019
**Last Updated**: September 2026
**Status**: Required for chord detection (bundled)
**Fallback**: None
