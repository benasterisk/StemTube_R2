# BTC Chord Detection Setup Guide

StemTube uses **BTC (Bi-directional Transformer for Chord Recognition)** for professional-grade chord detection with a 170-chord vocabulary.

## Overview

BTC is a deep learning model from ISMIR 2019 that provides professional-grade chord recognition comparable to Chordify or Moises.ai.

**Features:**
- 170 chord vocabulary (major, minor, 7th, maj7, min7, sus, dim, aug, and more)
- Bi-directional transformer architecture
- Pre-trained model included
- CPU-based (no GPU required for chord detection)

## Directory Structure

```
stemtube/
└── external/
    └── BTC-ISMIR19/           # BTC chord detection model
        ├── btc_model.py       # Model architecture
        ├── btc_wrapper.py     # StemTube integration wrapper
        ├── test.py            # Standalone testing script
        ├── run_config.yaml    # Model configuration
        ├── test/
        │   ├── btc_model.pt           # Basic model (24 chords)
        │   └── btc_model_large_voca.pt # Large vocabulary (170 chords)
        └── utils/             # Helper modules
```

## Dependencies

BTC requires additional Python packages:

```bash
# Core BTC dependencies (installed by setup_dependencies.py)
pip install torch librosa mir_eval pretty_midi pyyaml pandas pyrubberband scipy
```

**Note:** PyTorch is a large package (~2.8GB). For CPU-only (recommended):
```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

## Verification

Test BTC installation:

```bash
cd external/BTC-ISMIR19
python3 test.py --audio_dir ./test --save_dir ./test_output --voca True
```

Expected output:
```
I BTC-ISMIR19 [...] label type: large voca
I BTC-ISMIR19 [...] restore model
I BTC-ISMIR19 [...] ======== 1 of 1 in progress ========
I BTC-ISMIR19 [...] label file saved : ./test_output/example.lab
```

## Usage in StemTube

BTC is automatically used as the primary chord detection backend. The fallback chain is:

1. **BTC Transformer** (170 chords) - Primary
2. **madmom CRF** (24 chords) - Fallback
3. **Hybrid detector** - Last resort

### Configuration

Edit `core/config.json` to change chord detection settings:

```json
{
  "chord_detection": {
    "backend": "btc",
    "btc_large_vocab": true
  }
}
```

### Manual Testing

```bash
cd core
python3 btc_chord_detector.py /path/to/audio.mp3
```

## Chord Output Format

BTC outputs chords in the following format:

```
0.000  1.944  N         (No chord)
1.944  6.296  D:min     (D minor)
6.296  7.130  A         (A major)
7.130  12.130 D:min7    (D minor 7th)
12.130 13.333 G         (G major)
```

StemTube converts these to display format:
- `D:min` → `Dm`
- `D:min7` → `Dm7`
- `C:maj7` → `Cmaj7`

## Supported Chord Types

| Category | Examples |
|----------|----------|
| Major | C, D, E, F, G, A, B |
| Minor | Cm, Dm, Em, Fm, Gm, Am, Bm |
| Dominant 7th | C7, D7, E7, F7, G7, A7, B7 |
| Major 7th | Cmaj7, Dmaj7, Emaj7... |
| Minor 7th | Cm7, Dm7, Em7... |
| Sus2/Sus4 | Csus2, Csus4, Dsus2... |
| Diminished | Cdim, Ddim, Cdim7... |
| Augmented | Caug, Daug... |
| Extended | C9, Cmaj9, Cm9... |

## Performance

- **Processing Speed:** ~5x real-time (4-minute song → ~50 seconds)
- **Memory Usage:** ~500MB peak per file
- **Model Size:** ~25MB

## Troubleshooting

### "BTC path not found"
Ensure `external/BTC-ISMIR19` exists and contains the model files.

### "Could not import BTC wrapper"
Check that all BTC dependencies are installed:
```bash
pip install torch librosa mir_eval pretty_midi pyyaml
```

### "Model file not found"
Ensure model files exist:
```bash
ls -lh external/BTC-ISMIR19/test/*.pt
```

### NumPy compatibility error
The BTC wrapper includes fixes for NumPy compatibility. If you see `np.float` errors, the fix may not have been applied.

## Credits

BTC (Bi-directional Transformer for Chord Recognition) is based on:

**Paper:** "A Bi-directional Transformer for Musical Chord Recognition" (ISMIR 2019)
**Authors:** Jonggwon Park, Kyoyun Choi, Sungwook Jeon, Dooyong Kim, Taegyun Kwon
**Repository:** https://github.com/jayg996/BTC-ISMIR19
**License:** MIT

## See Also

- [Chord Detection Feature Guide](../feature-guides/CHORD-DETECTION.md)
- [madmom Setup](MADMOM-SETUP.md)
- [GPU Setup](GPU-SETUP.md)
