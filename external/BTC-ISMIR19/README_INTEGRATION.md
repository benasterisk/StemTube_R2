# BTC Chord Recognition - Quick Start

**Professional-grade chord detection using deep learning (170 chord types)**

This is the BTC (Bi-directional Transformer for Chord Recognition) model from ISMIR 2019, configured for integration with Stemtube.

---

## Quick Usage

### Method 1: Command Line (Simple)
```bash
source ../.venv/bin/activate
python3 test.py --audio_dir ./songs --save_dir ./output --voca True
```

Output: Creates `.lab` and `.midi` files in `./output`

---

### Method 2: Python Wrapper (Recommended for Stemtube)
```bash
source ../.venv/bin/activate
python3 btc_wrapper.py song.mp3
```

**Or from Python code:**
```python
from btc_wrapper import BTCChordDetector

# Initialize once (loads model into memory)
detector = BTCChordDetector()

# Detect chords
chords = detector.detect("song.mp3")

# Result: [(start_time, end_time, chord_name), ...]
for start, end, chord in chords:
    print(f"{start:.2f}s - {end:.2f}s: {chord}")
```

**Save to file:**
```python
detector.detect_and_save("song.mp3", "output.lab")
```

---

## What BTC Detects

- **170 chord types** (large vocabulary mode)
- Major, minor, 7th, maj7, min7, sus2, sus4, dim, aug, and more
- Works on any genre: rock, pop, jazz, classical
- Professional accuracy comparable to Chordify/Moises.ai

---

## Output Format (.lab files)

```
0.000  2.685  N         ← No chord / silence
2.685  4.074  F#:7      ← F# dominant 7th
4.074  5.370  B:maj7    ← B major 7th
5.370  6.944  F#:7
6.944  8.148  B:maj7
```

Format: `start_time  end_time  chord_label` (space-separated, times in seconds)

---

## Installation Status

✓ Repository cloned from GitHub
✓ Dependencies installed (PyTorch, librosa, etc.)
✓ Compatibility fixes applied (Python 3.8+, NumPy 2.0+, PyTorch 2.6+)
✓ Models downloaded (btc_model_large_voca.pt)
✓ Tested and working

---

## Files Overview

### Scripts You'll Use

| File | Purpose | Use Case |
|------|---------|----------|
| `btc_wrapper.py` | **Simple Python API** | **← Use this for Stemtube** |
| `test.py` | Original batch processing | Batch analyze folders of songs |

### Models (Pre-trained)

| File | Vocabulary | When to Use |
|------|------------|-------------|
| `test/btc_model_large_voca.pt` | 170 chords | **Default - use this** |
| `test/btc_model.pt` | 24 chords | Only for basic major/minor |

### Configuration

| File | Purpose |
|------|---------|
| `run_config.yaml` | Hyperparameters (don't modify) |

### Internal Modules (Don't call directly)

| Directory/File | Purpose |
|----------------|---------|
| `btc_model.py` | Neural network architecture |
| `utils/` | Helper modules (features, logging, etc.) |
| `audio_dataset.py` | Training data loader (not needed) |
| `train.py` | Model training (not needed) |

---

## Integration Examples

### Example 1: Stemtube Chord Detection Module
```python
# stemtube/modules/chord_detector.py

import sys
sys.path.insert(0, '/path/to/BTC-ISMIR19')
from btc_wrapper import BTCChordDetector

class StemtubeChordDetector:
    def __init__(self):
        self.btc = BTCChordDetector()

    def detect_chords(self, audio_path):
        """Detect chords for Stemtube"""
        chords = self.btc.detect(audio_path, return_format='dict')
        # Returns: [{'start': 0.0, 'end': 2.5, 'chord': 'C'}, ...]
        return chords
```

### Example 2: Subprocess Call (Simpler, but slower)
```python
import subprocess
import os

def detect_chords_subprocess(audio_file, output_dir):
    btc_path = "/path/to/BTC-ISMIR19"

    subprocess.run([
        "python3", f"{btc_path}/btc_wrapper.py",
        audio_file,
        "--output", f"{output_dir}/chords.lab"
    ], check=True, cwd=btc_path)

    # Parse .lab file
    chords = []
    with open(f"{output_dir}/chords.lab") as f:
        for line in f:
            start, end, chord = line.strip().split()
            chords.append({
                'start': float(start),
                'end': float(end),
                'chord': chord
            })
    return chords
```

---

## Performance

- **Speed**: ~5x real-time (10 min song → ~2 min processing)
- **Memory**: ~500MB peak per file
- **CPU**: Uses PyTorch CPU backend (no GPU needed)

**For Stemtube**: Load model once, reuse for multiple songs

---

## Troubleshooting

### "ModuleNotFoundError"
→ Activate venv: `source ../.venv/bin/activate`

### "Model file not found"
→ Check: `ls -lh test/*.pt` (should show ~12MB files)

### Wrong chord times
→ Ensure you're using `btc_wrapper.py` (times in seconds)

### Out of memory
→ Process one file at a time, or increase RAM

---

## Documentation

- **Full integration guide**: `../BTC_INTEGRATION_GUIDE.md`
- **Test results & accuracy**: `../BTC_ANALYSIS_REPORT.md`
- **General usage**: `../CLAUDE.md`

---

## Original Paper

**"A Bi-directional Transformer for Musical Chord Recognition"**
Eunjin Choi, Taegyun Kwon, Jongpil Lee
ISMIR 2019

GitHub: https://github.com/jayg996/BTC-ISMIR19

---

## For Stemtube Integration

**Recommendation**: Use `btc_wrapper.py` with the Python API

**Why**:
- Simple API: `detector.detect("song.mp3")`
- Model stays in memory (faster for multiple songs)
- Returns Python data structures (tuples/dicts)
- Error handling included

**Migration from madmom/librosa**:
1. Keep old backend as fallback
2. Add BTC as new option: `chord_backend = 'btc'`
3. Test on sample songs
4. Gradual rollout

See `../BTC_INTEGRATION_GUIDE.md` for detailed migration steps.
