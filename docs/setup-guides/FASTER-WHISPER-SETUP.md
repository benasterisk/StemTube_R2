# faster-whisper Setup Guide

## Overview

**faster-whisper** is used in StemTube for automatic lyrics transcription (karaoke/lyrics). It is an optimized implementation of OpenAI Whisper using CTranslate2 for ~4x faster performance.

## Installation

### Automatic (Recommended)

The `setup_dependencies.py` script installs faster-whisper and its dependencies automatically:

```bash
python setup_dependencies.py
```

The script:
1. ✓ Detects an NVIDIA GPU
2. ✓ Installs faster-whisper from requirements.txt
3. ✓ Installs cuDNN for GPU support (if GPU available)
4. ✓ Verifies that faster-whisper runs

### Manual

If you need to install manually:

```bash
# Activate the venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate     # Windows

# Install faster-whisper and dependencies
pip install faster-whisper>=1.0.0
pip install ctranslate2>=4.0.0
pip install av>=10.0.0
pip install huggingface-hub>=0.13.0
pip install tokenizers>=0.13.0
pip install onnxruntime>=1.14.0

# For GPU: install cuDNN
pip install nvidia-cudnn-cu11
```

## Dependencies

### Core Dependencies (requirements.txt)

```
faster-whisper>=1.0.0     # Primary package
ctranslate2>=4.0.0        # Optimized inference backend
av>=10.0.0                # Audio/video decoding (PyAV)
huggingface-hub>=0.13.0   # Model downloads
tokenizers>=0.13.0        # Text tokenization
onnxruntime>=1.14.0       # Runtime for some models
```

### GPU Dependencies (optional)

```
nvidia-cudnn-cu11         # NVIDIA cuDNN for GPU acceleration
```

**Note**: cuDNN is installed automatically by `setup_dependencies.py` if an NVIDIA GPU is detected.

## GPU Configuration

### Verify GPU Support

```bash
./venv/bin/python -c "
from faster_whisper import WhisperModel
try:
    model = WhisperModel('tiny', device='cuda', compute_type='float16')
    print('✓ GPU mode available')
except Exception as e:
    print(f'✗ GPU mode not available: {e}')
"
```

### Environment Variables

The `start_service.sh` script automatically configures the cuDNN path:

```bash
export LD_LIBRARY_PATH="$VENV_SITE_PACKAGES/nvidia/cudnn/lib:$LD_LIBRARY_PATH"
```

This is required so faster-whisper can find the cuDNN libraries.

## Usage in StemTube

### Code Example

```python
from core.lyrics_detector import LyricsDetector

# Initialize detector (GPU auto-detected)
detector = LyricsDetector()

# Transcribe an audio file
audio_path = "path/to/audio.mp3"
lyrics_data = detector.transcribe_audio(
    audio_path,
    model_size="medium",  # tiny, base, small, medium, large, large-v3
    language="en"         # or None for auto-detect
)

# Result format
# [
#   {
#     "start": 0.0,
#     "end": 2.5,
#     "text": "Lyric line text",
#     "words": [
#       {"start": 0.0, "end": 0.5, "word": "Lyric"},
#       {"start": 0.6, "end": 1.2, "word": "line"}
#     ]
#   },
#   ...
# ]
```

### Available Models

| Model    | Size  | GPU Memory | Speed | Accuracy |
|----------|-------|------------|-------|----------|
| tiny     | 39M   | ~1GB       | ~32x  | ★★☆☆☆    |
| base     | 74M   | ~1GB       | ~16x  | ★★★☆☆    |
| small    | 244M  | ~2GB       | ~6x   | ★★★★☆    |
| medium   | 769M  | ~5GB       | ~2x   | ★★★★★    |
| large-v2 | 1550M | ~10GB      | ~1x   | ★★★★★★   |
| large-v3 | 1550M | ~10GB      | ~1x   | ★★★★★★   |

**Recommended for production**: `medium` (best accuracy/performance balance)

## Performance

### GPU vs CPU

| Configuration          | Time (3 min audio) |
|------------------------|--------------------|
| CPU (8 cores)          | ~60-120 seconds    |
| GPU (NVIDIA RTX)       | ~10-30 seconds     |

**GPU speedup**: 4-8x faster than CPU

### Optimizations

1. **GPU Compute Type**:
   - `float16`: Faster, slightly reduced accuracy (recommended)
   - `int8_float16`: Even faster, more accuracy loss
   - `float32`: Max accuracy, slower

2. **CPU Compute Type**:
   - `int8`: Recommended for CPU (good balance)
   - `float32`: Max accuracy, slower

3. **VAD (Voice Activity Detection)**:
   - Enabled by default in StemTube
   - Filters non-voice segments (improves accuracy)

## Troubleshooting

### Error: "Could not load library libcudnn"

**Fix**: Verify cuDNN is installed and LD_LIBRARY_PATH is set.

```bash
# Check installation
pip list | grep cudnn

# Should show:
# nvidia-cudnn-cu11  9.x.x.xx

# Check library path
ls venv/lib/python3.12/site-packages/nvidia/cudnn/lib/

# Should contain: libcudnn*.so*
```

If missing, reinstall:
```bash
pip install --force-reinstall nvidia-cudnn-cu11
```

### Error: "CUDA out of memory"

**Fixes**:
1. Use a smaller model (`tiny`, `base`, `small`)
2. Reduce compute_type (try `int8_float16`)
3. Fallback to CPU:
   ```python
   model = WhisperModel('medium', device='cpu', compute_type='int8')
   ```

### GPU not being used

**Checks**:
```bash
# 1. Check CUDA
nvidia-smi

# 2. Check PyTorch CUDA
python -c "import torch; print(torch.cuda.is_available())"

# 3. Check faster-whisper
python -c "from faster_whisper import WhisperModel; m = WhisperModel('tiny', device='cuda'); print('OK')"
```

### Slow performance even with GPU

**Possible causes**:
1. First run: the model must download (~769MB for medium)
2. Model cache not used: verify `~/.cache/huggingface/hub/`
3. GPU underutilized: monitor with `nvidia-smi -l 1` during transcription

## Model Storage

Models are downloaded and cached in:
```
~/.cache/huggingface/hub/models--guillaumekln--faster-whisper-{model_size}/
```

### Pre-download Models

```python
from faster_whisper import WhisperModel

# Download without instantiating
for model_size in ["tiny", "base", "small", "medium"]:
    print(f"Downloading {model_size}...")
    WhisperModel(model_size, device="cpu")
    print(f"✓ {model_size} cached")
```

## Integration with StemTube

### Automatic Workflow

1. **Audio download** → `DownloadManager.download_audio()`
2. **Automatic lyrics detection** → `LyricsDetector.transcribe_audio()`
3. **DB storage** → `global_downloads.lyrics_data` (JSON)
4. **Mixer display** → `karaoke-display.js` (playback sync)

### Configuration in app.py

```python
# core/config.json
{
    "use_gpu_for_extraction": true  # Also controls faster-whisper GPU
}
```

## Resources

- [faster-whisper GitHub](https://github.com/guillaumekln/faster-whisper)
- [CTranslate2](https://github.com/OpenNMT/CTranslate2)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [Hugging Face Models](https://huggingface.co/guillaumekln)

## Installed Version

```bash
./venv/bin/pip show faster-whisper
```

**Current version**: 1.2.0
**Last checked**: 2025-10-26

---

**Note**: faster-whisper is optional but recommended for StemTube karaoke features. The app runs without it, but automatic lyrics transcription will be unavailable.
