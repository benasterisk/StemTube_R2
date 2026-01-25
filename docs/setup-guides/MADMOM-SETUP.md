# Professional Madmom Chord Detection - Setup Guide

## Overview

StemTube now uses **madmom** - a professional music information retrieval library with deep learning models for chord detection. This provides Chordify/Moises-level accuracy with improved timeline synchronization.

## What's New

### Professional Detection Engine
- **CNN-based feature extraction** - More accurate than STFT/chroma analysis
- **CRF chord recognition** - Conditional Random Fields for better accuracy
- **RNN beat tracking** - Neural network beat detection for perfect timeline sync
- **24-chord vocabulary** - 12 major + 12 minor chords
- **Automatic fallback** - Uses basic detector if madmom unavailable

### Improved Timeline Sync
- **Beat offset detection** - First downbeat precisely identified
- **Beat-aligned chords** - Chords synced to musical beats, not arbitrary time
- **Better mixer display** - Past/current/next chords perfectly timed

## Installation

### Automatic (Recommended)
```bash
# Install all dependencies including madmom
pip install -r requirements.txt

# Patch madmom for Python 3.10+ compatibility
python patch_madmom.py
```

### Manual
```bash
# Install dependencies
pip install numpy<2.0  # Required: madmom needs numpy 1.x
pip install cython
pip install madmom

# Patch for Python 3.10+
python patch_madmom.py
```

## Important Notes

### NumPy Version Requirement
⚠️ **Madmom requires numpy 1.x** (not 2.x)
- Madmom's compiled Cython extensions were built with numpy 1.x
- `requirements.txt` pins to `numpy<2.0`
- Other dependencies (scipy, librosa) work fine with numpy 1.x

### Python 3.10+ Compatibility
The `patch_madmom.py` script fixes:
- `collections.MutableSequence` → `collections.abc.MutableSequence`

Run after every madmom installation.

## How It Works

### Automatic Integration
All new downloads automatically use madmom chord detection:

```python
# In download_manager.py - already integrated!
from .chord_detector import analyze_audio_file

# Automatically tries madmom first, falls back to basic detector
chords_data, beat_offset = analyze_audio_file(file_path, bpm=detected_bpm)
```

### Re-Analyze Existing Downloads
Upgrade old downloads to use madmom:

```bash
python reanalyze_with_madmom.py
```

This script:
1. Finds all downloads with audio files
2. Re-analyzes each with madmom
3. Updates database with improved chord data
4. Preserves BPM/key from original analysis

### Manual Usage
```python
from core.chord_detector import analyze_audio_file

# Use madmom (with fallback)
chords_json, beat_offset = analyze_audio_file(audio_path, bpm=120, use_madmom=True)

# Force basic detector
chords_json, beat_offset = analyze_audio_file(audio_path, bpm=120, use_madmom=False)
```

## Detection Pipeline

1. **Beat Tracking (RNN)**
   - Detects all beats in audio
   - Identifies first downbeat (beat offset)
   - Used for timeline synchronization

2. **Feature Extraction (CNN)**
   - Processes audio into 128-dimensional features
   - Deep learning model trained on music

3. **Chord Recognition (CRF)**
   - Decodes features into chord labels
   - Outputs 24-chord vocabulary (major/minor)

4. **Post-Processing**
   - Merges consecutive duplicates
   - Filters short chord changes (< 0.2s)
   - Formats for database storage

## Chord Vocabulary

Madmom CRF model supports:

**Major Chords (0-11):**
C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B

**Minor Chords (12-23):**
Cm, C#m, Dm, Ebm, Em, Fm, F#m, Gm, Abm, Am, Bbm, Bm

**No Chord:**
N (filtered out in results)

## Output Format

```json
[
  {
    "timestamp": 0.330,
    "chord": "D",
    "confidence": 1.0
  },
  {
    "timestamp": 2.150,
    "chord": "G",
    "confidence": 1.0
  }
]
```

**Database Fields:**
- `chords_data` - JSON array of chord timeline
- `beat_offset` - Time of first downbeat (seconds)

## Mixer Integration

The mixer automatically loads chord data:

```javascript
// In mixer/core.js
const chordsData = EXTRACTION_INFO.chords_data;
const beatOffset = EXTRACTION_INFO.beat_offset;

// Chord display syncs with playback
chordDisplay.sync(currentTime);
```

Displays:
- **Past chord** (gray)
- **Current chord** (highlighted)
- **Next chord** (preview)

## Troubleshooting

### Import Error: "numpy has no attribute 'float'"
Run the patcher:
```bash
python patch_madmom.py
```

### Wrong NumPy Version
```bash
pip install 'numpy<2.0'
pip install --force-reinstall --no-cache-dir madmom
python patch_madmom.py
```

### Madmom Not Available
Check installation:
```bash
python -c "import madmom; print(madmom.__version__)"
```

Should output: `0.16.1`

### Detection Fails
The system automatically falls back to basic detector:
```
[CHORD DETECTION] Madmom error, falling back...
[CHORD DETECTION] Using basic STFT-based detector...
```

## Performance

**Madmom vs Basic Detector:**

| Metric | Madmom | Basic |
|--------|--------|-------|
| Accuracy | High (CNN+CRF) | Medium (Template) |
| Timeline Sync | Excellent (RNN beats) | Good (Autocorrelation) |
| Chord Vocabulary | 24 chords | 24 chords |
| Processing Speed | ~30s per song | ~5s per song |
| Dependencies | NumPy 1.x, Cython | NumPy any, Scipy |

## Files

**Core Implementation:**
- `core/madmom_chord_detector.py` - Professional detection engine
- `core/chord_detector.py` - Integration with fallback
- `patch_madmom.py` - Python 3.10+ compatibility patcher

**Utilities:**
- `reanalyze_with_madmom.py` - Re-analyze existing downloads
- `reanalyze_all_chords.py` - Legacy re-analyzer (uses madmom now)

**Configuration:**
- `requirements.txt` - Dependencies (numpy<2.0, madmom, cython)

## Future Improvements

1. **Extended Chord Vocabulary**
   - Add 7th, sus, dim, aug chords
   - Requires custom model training

2. **Hybrid Approach**
   - Madmom beat tracking + custom template matching
   - Better for folk/acoustic guitar

3. **Key-Aware Detection**
   - Detect key first
   - Constrain chord search to key

4. **Model Fine-Tuning**
   - Train on folk/acoustic dataset
   - Improve accuracy for fingerpicking styles

## Credits

- **madmom**: [https://github.com/CPJKU/madmom](https://github.com/CPJKU/madmom)
- Deep learning models for music information retrieval
- Developed by CP-JKU (Johannes Kepler University)
