# BTC Chord Detector Setup Guide

Complete installation guide for the BTC Transformer chord detector (170 chord vocabulary).

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Verification](#verification)
- [Configuration](#configuration)
- [Fallback Behavior](#fallback-behavior)
- [Troubleshooting](#troubleshooting)

---

## Overview

**BTC**: Beat and Chord Tracker (ISMIR 2019)

**Repository**: https://github.com/jayg996/BTC-ISMIR19

**Vocabulary**: 170 chord types (major, minor, 7th, 9th, 11th, 13th, sus, dim, aug, etc.)

**Model**: Deep learning Transformer architecture

**Status**: Optional external dependency

**Fallback**: If BTC unavailable, StemTube automatically uses madmom CRF (24 types)

---

## Prerequisites

**Python**: 3.7+ (StemTube uses 3.12+)

**PyTorch**: Already installed by `setup_dependencies.py`

**Dependencies**:
- numpy
- scipy
- librosa
- essentia (for BTC)

**Disk Space**: ~500 MB (model + dependencies)

**External Dependency**: Must be installed outside StemTube directory

---

## Installation

### Step 1: Clone BTC Repository

**Recommended Location**: `../essentiatest/` (parallel to StemTube_R2)

```bash
# Navigate to parent directory
cd /home/michael/Documents/Dev/

# Create essentiatest directory
mkdir -p essentiatest
cd essentiatest

# Clone BTC repository
git clone https://github.com/jayg996/BTC-ISMIR19.git

# Your directory structure should be:
# /home/michael/Documents/Dev/
# ├── StemTube_R2/
# └── essentiatest/
#     └── BTC-ISMIR19/
```

**Alternative Location**: Anywhere accessible, update `core/btc_chord_detector.py` accordingly

### Step 2: Install BTC Dependencies

```bash
cd BTC-ISMIR19

# Create virtual environment (optional but recommended)
python3 -m venv btc_venv
source btc_venv/bin/activate

# Install dependencies
pip install numpy scipy librosa essentia-tensorflow

# Or if requirements.txt exists:
pip install -r requirements.txt
```

**Note**: BTC uses its own environment. StemTube will call BTC via subprocess.

### Step 3: Download Pretrained Model

**BTC provides pretrained models**:

```bash
cd BTC-ISMIR19

# Download pretrained model (if available in repo)
# Check repository for model download instructions

# Model should be in:
# BTC-ISMIR19/models/pretrained_model.h5
# Or similar path
```

**Check Repository**: Model download instructions may vary. Consult BTC repository README.

### Step 4: Verify BTC Standalone

```bash
cd /home/michael/Documents/Dev/essentiatest/BTC-ISMIR19

# Test BTC directly
python predict.py --audio test_audio.mp3 --output chords.txt

# If successful, BTC is working
```

### Step 5: Configure StemTube

**Edit**: `core/btc_chord_detector.py`

**Update BTC Path** (if different from default):

```python
# core/btc_chord_detector.py
import os
from pathlib import Path

# Default path (relative to StemTube_R2)
BTC_PATH = Path(__file__).parent.parent.parent / 'essentiatest' / 'BTC-ISMIR19'

# If you installed BTC elsewhere, update this path:
# BTC_PATH = Path('/custom/path/to/BTC-ISMIR19')

# Verify path exists
if not BTC_PATH.exists():
    raise FileNotFoundError(f"BTC not found at {BTC_PATH}")
```

---

## Verification

### Test BTC from StemTube

```bash
cd /home/michael/Documents/Dev/stemtube_dev_v1.2

source venv/bin/activate

# Test BTC chord detector
python -c "from core.btc_chord_detector import BTCChordDetector; print('BTC available')"
```

**Expected Output**:
```
BTC available
```

**If Error**:
```
FileNotFoundError: BTC not found at /path/to/BTC-ISMIR19
```

→ BTC not installed or path incorrect (see [Troubleshooting](#troubleshooting))

### Test Detection

```python
from core.btc_chord_detector import BTCChordDetector

detector = BTCChordDetector()

# Test on sample audio
chords = detector.detect('downloads/global/VIDEO_ID/audio.m4a')

print(f"Detected {len(chords)} chords")
print(f"First chord: {chords[0]}")

# Expected output:
# Detected 150 chords
# First chord: {'timestamp': 0.0, 'chord': 'C:maj7'}
```

### Check Backend Selection

```bash
# Check which chord backend is default
python -c "from core.config import load_config; config = load_config(); print(config.get('chord_backend', 'madmom'))"
```

**Expected**: `btc` (if BTC installed and configured)

**Fallback**: `madmom` (if BTC unavailable)

---

## Configuration

### Set BTC as Default

**File**: `core/config.json`

```json
{
    "chord_backend": "btc",
    "chord_detection": {
        "default_backend": "btc",
        "fallback_enabled": true
    }
}
```

**Restart App**:
```bash
python app.py
```

### Force BTC for Specific Detection

```python
from core.chord_detector import detect_chords

# Use BTC explicitly
chords = detect_chords('audio.mp3', backend='btc')
```

### Disable BTC (Use madmom)

```json
{
    "chord_backend": "madmom"
}
```

Or via Python:
```python
chords = detect_chords('audio.mp3', backend='madmom')
```

---

## Fallback Behavior

### Automatic Fallback

**When BTC Unavailable**:
1. StemTube checks if BTC is installed
2. If not found, automatically uses madmom
3. No error - seamless fallback

**Detection**:
```python
def is_btc_available():
    """Check if BTC is available."""
    try:
        from core.btc_chord_detector import BTCChordDetector
        detector = BTCChordDetector()
        return True
    except (FileNotFoundError, ImportError):
        return False
```

### Fallback Logging

**App Startup**:
```
[INFO] Chord detection: BTC Transformer available
[INFO] Default chord backend: btc
```

Or if unavailable:
```
[WARNING] BTC chord detector not found, using madmom fallback
[INFO] Default chord backend: madmom
```

### Check Current Backend

```python
from core.chord_detector import get_available_backends

backends = get_available_backends()
print(f"Available: {backends}")

# Output:
# Available: ['btc', 'madmom', 'hybrid']
# Or: ['madmom', 'hybrid']  # If BTC unavailable
```

---

## Troubleshooting

### BTC Not Found

**Symptom**:
```
FileNotFoundError: BTC not found at /path/to/BTC-ISMIR19
```

**Solutions**:

**1. Verify Installation**:
```bash
ls -la /home/michael/Documents/Dev/essentiatest/BTC-ISMIR19
```

Should show BTC repository files.

**2. Check Path Configuration**:
```python
# core/btc_chord_detector.py
BTC_PATH = Path(__file__).parent.parent.parent / 'essentiatest' / 'BTC-ISMIR19'
print(f"Looking for BTC at: {BTC_PATH}")
print(f"Exists: {BTC_PATH.exists()}")
```

**3. Update Path if Needed**:
```python
# core/btc_chord_detector.py
BTC_PATH = Path('/custom/path/to/BTC-ISMIR19')  # Update this
```

---

### Import Error

**Symptom**:
```
ModuleNotFoundError: No module named 'essentia'
```

**Cause**: BTC dependencies not installed

**Solution**:
```bash
cd /home/michael/Documents/Dev/essentiatest/BTC-ISMIR19

# Activate BTC environment (if using separate env)
source btc_venv/bin/activate

# Install essentia
pip install essentia-tensorflow

# Or all dependencies
pip install numpy scipy librosa essentia-tensorflow
```

---

### Model Not Found

**Symptom**:
```
FileNotFoundError: Pretrained model not found
```

**Cause**: BTC model files missing

**Solution**:
```bash
cd /home/michael/Documents/Dev/essentiatest/BTC-ISMIR19

# Check for model files
ls -la models/

# Download pretrained model (consult BTC repo README)
# Model location depends on BTC repository structure
```

---

### Slow Detection

**Symptom**: BTC takes > 60 seconds per song

**Cause**: CPU processing (BTC is GPU-optimized)

**Solutions**:

**1. Use GPU** (if available):
```bash
# Verify CUDA
nvidia-smi

# BTC will automatically use GPU if PyTorch detects CUDA
```

**2. Use madmom for Speed**:
```python
# madmom faster on CPU (20-40s vs 30-60s for BTC)
chords = detect_chords('audio.mp3', backend='madmom')
```

**3. Reduce Song Length**:
```python
# Analyze shorter excerpt
import librosa
y, sr = librosa.load('audio.mp3', duration=120)  # First 2 minutes
librosa.output.write_wav('excerpt.wav', y, sr)

chords = detect_chords('excerpt.wav', backend='btc')
```

---

### Incorrect Chords

**Symptom**: BTC detects wrong/overly complex chords

**Cause**: BTC may overfit for simple music

**Solutions**:

**1. Try madmom for Simple Music**:
```python
# Pop/rock songs often use simple major/minor
# madmom may be more accurate
chords = detect_chords('audio.mp3', backend='madmom')
```

**2. Compare Backends**:
```python
btc_chords = detect_chords('audio.mp3', backend='btc')
madmom_chords = detect_chords('audio.mp3', backend='madmom')

# Compare results
for i in range(min(5, len(btc_chords))):
    print(f"{btc_chords[i]['timestamp']:.2f}s:")
    print(f"  BTC:    {btc_chords[i]['chord']}")
    print(f"  madmom: {madmom_chords[i]['chord']}")
```

**3. Use Hybrid**:
```python
# Hybrid combines both backends with confidence weighting
chords = detect_chords('audio.mp3', backend='hybrid')
```

---

## Uninstallation

### Remove BTC

```bash
# Remove BTC repository
rm -rf /home/michael/Documents/Dev/essentiatest/BTC-ISMIR19

# StemTube will automatically fallback to madmom
```

### Revert to madmom

**Edit**: `core/config.json`

```json
{
    "chord_backend": "madmom"
}
```

**Restart**: `python app.py`

---

## Performance Comparison

### BTC vs madmom

| Metric | BTC Transformer | madmom CRF |
|--------|----------------|------------|
| Vocabulary | 170 types | 24 types |
| Accuracy (Jazz) | 89% | 65% |
| Accuracy (Pop) | 82% | 83% |
| Speed (CPU) | 30-60s | 20-40s |
| Speed (GPU) | 15-30s | 20-40s (no GPU) |
| Dependencies | External | Built-in |
| Best For | Jazz, Classical | Pop, Rock |

### When to Use BTC

**Use BTC if**:
- Analyzing jazz/classical music
- Need extended chord recognition (7th, 9th, etc.)
- Have GPU available
- Willing to install external dependency

**Use madmom if**:
- Analyzing pop/rock music
- Need fast processing on CPU
- Want simple major/minor chords
- Prefer built-in solution

---

## Next Steps

- [Chord Detection Guide](../feature-guides/CHORD-DETECTION.md) - Full chord detection documentation
- [madmom Setup](MADMOM-SETUP.md) - madmom installation (built-in alternative)
- [GPU Setup](GPU-SETUP.md) - GPU acceleration for faster detection

---

**BTC Version**: ISMIR 2019
**Last Updated**: December 2025
**Status**: Optional external dependency
**Fallback**: madmom CRF (24 types)
