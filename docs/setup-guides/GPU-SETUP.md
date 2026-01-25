# GPU Setup Guide

Complete guide to GPU acceleration for StemTube (4-10x faster processing).

---

## Table of Contents

- [Overview](#overview)
- [Benefits](#benefits)
- [Prerequisites](#prerequisites)
- [CUDA Installation](#cuda-installation)
- [cuDNN Installation](#cudnn-installation)
- [Verification](#verification)
- [Automatic Configuration](#automatic-configuration)
- [Troubleshooting](#troubleshooting)
- [CPU Fallback](#cpu-fallback)

---

## Overview

**GPU Acceleration**: NVIDIA CUDA for PyTorch-based models

**Supported**:
- ✅ Stem extraction (Demucs) - 4-8x faster
- ✅ Lyrics transcription (faster-whisper) - 3-5x faster
- ❌ Chord detection (madmom - CPU optimized)
- ⚠️ Chord detection (BTC - GPU optional)

**Requirements**:
- NVIDIA GPU with CUDA Compute Capability 3.5+
- CUDA 11.x - 13.x
- cuDNN 8.x
- 4+ GB VRAM recommended

---

## Benefits

### Performance Gains

| Operation | CPU | GPU (CUDA) | Speedup |
|-----------|-----|------------|---------|
| **Stem extraction** (4 stems, 4-min song) | 3-8 min | 20-60s | **4-8x** |
| **Stem extraction** (6 stems, 4-min song) | 5-12 min | 30-90s | **4-8x** |
| **Lyrics transcription** | 30-120s | 10-30s | **3-5x** |
| **Chord detection** (madmom) | 20-40s | 20-40s | **1x** (no GPU) |
| **Chord detection** (BTC) | 30-60s | 15-30s | **2x** |

### Example Workflow

**CPU Mode** (typical song):
```
Download: 30s
Extract stems (4): 5 min
Detect chords: 30s
Transcribe lyrics: 60s
───────────────────────
Total: ~7 minutes
```

**GPU Mode** (same song):
```
Download: 30s
Extract stems (4): 40s
Detect chords: 30s
Transcribe lyrics: 15s
───────────────────────
Total: ~2 minutes
```

**Time Saved**: ~5 minutes per song (70% faster)

---

## Prerequisites

### Hardware

**NVIDIA GPU** with CUDA support:
- GeForce GTX 10-series (1050, 1060, 1070, 1080, etc.)
- GeForce RTX 20-series (2060, 2070, 2080, etc.)
- GeForce RTX 30-series (3060, 3070, 3080, 3090, etc.)
- GeForce RTX 40-series (4060, 4070, 4080, 4090, etc.)
- Quadro, Tesla, etc.

**VRAM**: 4+ GB recommended (minimum 2 GB)

**Compute Capability**: 3.5+ (check [NVIDIA list](https://developer.nvidia.com/cuda-gpus))

### Software

**Operating System**:
- Linux (Ubuntu/Debian recommended)
- Windows 10/11
- WSL2 (Windows Subsystem for Linux)

**NVIDIA Drivers**: Latest stable version

**Python**: 3.12+ (installed by StemTube setup)

---

## CUDA Installation

### Check Current CUDA

```bash
nvidia-smi
```

**Expected Output**:
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 535.129.03   Driver Version: 535.129.03   CUDA Version: 12.2   |
+-----------------------------------------------------------------------------+
```

**CUDA Version**: Shows maximum supported CUDA version (e.g., 12.2)

**If `nvidia-smi` not found**: NVIDIA drivers not installed (see below)

### Install NVIDIA Drivers

#### Ubuntu/Debian

```bash
# Check available drivers
ubuntu-drivers devices

# Install recommended driver
sudo ubuntu-drivers autoinstall

# Or install specific version
sudo apt install nvidia-driver-535

# Reboot
sudo reboot

# Verify
nvidia-smi
```

#### Windows

1. Download drivers from [NVIDIA website](https://www.nvidia.com/Download/index.aspx)
2. Select your GPU model
3. Download and install
4. Reboot
5. Verify: Run `nvidia-smi` in PowerShell

#### WSL2

**WSL2 uses Windows CUDA drivers** - no separate driver needed in WSL.

1. Install NVIDIA drivers in **Windows** (see above)
2. In WSL, verify:
```bash
nvidia-smi
```

Should show GPU information (using Windows drivers).

### Install CUDA Toolkit (Optional)

**Note**: StemTube uses PyTorch bundled CUDA - full toolkit not required.

**If needed for development**:

#### Ubuntu/Debian

```bash
# CUDA 12.1 (example)
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-ubuntu2204.pin
sudo mv cuda-ubuntu2204.pin /etc/apt/preferences.d/cuda-repository-pin-600
wget https://developer.download.nvidia.com/compute/cuda/12.1.0/local_installers/cuda-repo-ubuntu2204-12-1-local_12.1.0-530.30.02-1_amd64.deb
sudo dpkg -i cuda-repo-ubuntu2204-12-1-local_12.1.0-530.30.02-1_amd64.deb
sudo cp /var/cuda-repo-ubuntu2204-12-1-local/cuda-*-keyring.gpg /usr/share/keyrings/
sudo apt-get update
sudo apt-get install cuda
```

**Or use conda**:
```bash
conda install cuda -c nvidia
```

---

## cuDNN Installation

**cuDNN**: CUDA Deep Neural Network library

**Required**: For PyTorch acceleration

### Automatic Installation (Recommended)

**StemTube automatically installs cuDNN** via pip on first run.

**File**: `app.py` (lines 10-55)

```python
# On app startup
import torch

if torch.cuda.is_available():
    cuda_version = torch.version.cuda

    # Install cuDNN via pip
    if cuda_version.startswith('11'):
        os.system('pip install nvidia-cudnn-cu11')
    elif cuda_version.startswith('12'):
        os.system('pip install nvidia-cudnn-cu12')

    # Configure LD_LIBRARY_PATH
    # ... (see Automatic Configuration section)
```

**No manual steps required** - just run `python app.py`

### Manual Installation (If Needed)

#### Via pip (Easiest)

```bash
source venv/bin/activate

# For CUDA 11.x
pip install nvidia-cudnn-cu11

# For CUDA 12.x
pip install nvidia-cudnn-cu12

# For CUDA 13.x
pip install nvidia-cudnn-cu13
```

#### Via System Package Manager

**Ubuntu/Debian**:
```bash
# Add NVIDIA repository (if not already added)
sudo apt-get install nvidia-cudnn
```

**Note**: System cuDNN may conflict with pip version. Choose one method.

#### Via NVIDIA Developer Download

1. Visit [NVIDIA cuDNN download](https://developer.nvidia.com/cudnn)
2. Register/login (free)
3. Download cuDNN for your CUDA version
4. Extract and install:

```bash
tar -xzvf cudnn-linux-x86_64-8.x.x.x_cudaX.Y-archive.tar.xz

sudo cp cudnn-*-archive/include/cudnn*.h /usr/local/cuda/include
sudo cp -P cudnn-*-archive/lib/libcudnn* /usr/local/cuda/lib64
sudo chmod a+r /usr/local/cuda/include/cudnn*.h /usr/local/cuda/lib64/libcudnn*
```

---

## Verification

### Check PyTorch CUDA

```bash
source venv/bin/activate

python -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA version: {torch.version.cuda}'); print(f'cuDNN version: {torch.backends.cudnn.version()}')"
```

**Expected Output**:
```
PyTorch: 2.1.0+cu121
CUDA available: True
CUDA version: 12.1
cuDNN version: 8902
```

**If CUDA available: False**:
- PyTorch CPU-only version installed
- Reinstall PyTorch with CUDA support (see Troubleshooting)

### Check GPU Memory

```bash
nvidia-smi
```

**Expected**:
```
+-----------------------------------------------------------------------------+
| Processes:                                                                  |
|  GPU   GI   CI        PID   Type   Process name                  GPU Memory |
|        ID   ID                                                   Usage      |
|=============================================================================|
|  No running processes found                                                 |
+-----------------------------------------------------------------------------+
```

**Available Memory**: Shows in top section (e.g., "8192MiB / 8192MiB" = 8 GB total)

### Test GPU Acceleration

```python
import torch

# Check CUDA
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"CUDA devices: {torch.cuda.device_count()}")

if torch.cuda.is_available():
    print(f"Current device: {torch.cuda.current_device()}")
    print(f"Device name: {torch.cuda.get_device_name(0)}")

    # Test tensor on GPU
    x = torch.rand(1000, 1000).cuda()
    y = torch.rand(1000, 1000).cuda()
    z = torch.matmul(x, y)

    print("GPU test successful!")
```

**Expected**:
```
CUDA available: True
CUDA devices: 1
Current device: 0
Device name: NVIDIA GeForce RTX 3090
GPU test successful!
```

---

## Automatic Configuration

### LD_LIBRARY_PATH Setup

**StemTube automatically configures** `LD_LIBRARY_PATH` on startup.

**File**: `app.py` (lines 10-55)

```python
import os
import sys

# Detect CUDA
import torch
if torch.cuda.is_available():
    cuda_version = torch.version.cuda

    # Find cuDNN library path
    import nvidia.cudnn
    cudnn_lib_path = os.path.dirname(nvidia.cudnn.__file__)
    cudnn_lib_dir = os.path.join(cudnn_lib_path, 'lib')

    # Set LD_LIBRARY_PATH
    ld_library_path = os.environ.get('LD_LIBRARY_PATH', '')
    if cudnn_lib_dir not in ld_library_path:
        os.environ['LD_LIBRARY_PATH'] = f"{cudnn_lib_dir}:{ld_library_path}"

        # Restart app with new LD_LIBRARY_PATH
        os.execv(sys.executable, [sys.executable] + sys.argv)
```

**What it does**:
1. Detects CUDA version
2. Installs cuDNN if needed
3. Finds cuDNN library path
4. Sets `LD_LIBRARY_PATH` environment variable
5. Restarts app with new environment

**No manual configuration needed** - completely automatic.

### Manual LD_LIBRARY_PATH (If Needed)

**If automatic fails**, set manually:

```bash
# Find cuDNN path
python -c "import nvidia.cudnn; import os; print(os.path.dirname(nvidia.cudnn.__file__))"

# Output: /path/to/venv/lib/python3.12/site-packages/nvidia/cudnn

# Add to .bashrc or .zshrc
export LD_LIBRARY_PATH=/path/to/cudnn/lib:$LD_LIBRARY_PATH

# Reload
source ~/.bashrc
```

### Verify Configuration

```bash
echo $LD_LIBRARY_PATH
```

Should include cuDNN library path.

---

## Troubleshooting

### CUDA Not Available

**Symptom**:
```python
torch.cuda.is_available()  # Returns False
```

**Possible Causes**:

**1. PyTorch CPU-only version installed**

**Check**:
```bash
pip list | grep torch
```

**Output**:
```
torch                2.1.0+cpu
```

**Solution**: Reinstall PyTorch with CUDA:
```bash
source venv/bin/activate

# Uninstall CPU version
pip uninstall torch torchvision torchaudio

# Install CUDA version (for CUDA 11.8)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Or for CUDA 12.1
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

**2. NVIDIA drivers not installed**

**Check**:
```bash
nvidia-smi
```

**If error**: Install NVIDIA drivers (see [CUDA Installation](#cuda-installation))

**3. Mismatched CUDA versions**

**Check**:
```bash
nvidia-smi  # Shows max CUDA version
python -c "import torch; print(torch.version.cuda)"  # Shows PyTorch CUDA version
```

**Solution**: Install PyTorch matching your CUDA version.

---

### cuDNN Error

**Symptom**:
```
Could not load dynamic library 'libcudnn.so.8'
```

**Cause**: cuDNN not installed or not in `LD_LIBRARY_PATH`

**Solutions**:

**1. Automatic fix** (restart app):
```bash
python app.py
# App automatically installs cuDNN and configures LD_LIBRARY_PATH
```

**2. Manual install**:
```bash
source venv/bin/activate
pip install nvidia-cudnn-cu12  # Or cu11 for CUDA 11.x
```

**3. Set LD_LIBRARY_PATH manually** (see [Manual LD_LIBRARY_PATH](#manual-ld_library_path-if-needed))

---

### Out of Memory

**Symptom**:
```
RuntimeError: CUDA out of memory
```

**Cause**: Not enough VRAM

**Check VRAM usage**:
```bash
nvidia-smi
```

**Solutions**:

**1. Close other GPU applications**:
```bash
nvidia-smi
# Check "Processes" section
# Kill GPU-heavy processes if needed
```

**2. Restart app** (clears GPU memory):
```bash
pkill -f app.py
python app.py
```

**3. Use CPU mode** (slower but no VRAM limit):
```bash
export CUDA_VISIBLE_DEVICES=""
python app.py
```

**4. Upgrade GPU** (4+ GB VRAM recommended)

---

### Slow Performance Despite GPU

**Symptom**: GPU detected but extraction still slow

**Possible Causes**:

**1. GPU not actually used**

**Check logs**:
```bash
tail -f app.log | grep -i cuda
```

Should show:
```
[INFO] GPU detected: NVIDIA GeForce RTX 3090
[INFO] Using device: cuda
```

**2. Thermal throttling**

**Check GPU temperature**:
```bash
nvidia-smi
```

**Temperature**: Should be < 80°C

**If >80°C**: Improve cooling (clean fans, better airflow)

**3. CPU bottleneck**

**Check CPU usage**:
```bash
top
```

**If CPU at 100%**: Upgrade CPU or close background apps

---

### Multiple GPUs

**Symptom**: Have multiple GPUs, want to select specific one

**Select GPU**:
```bash
# Use GPU 0
export CUDA_VISIBLE_DEVICES=0

# Use GPU 1
export CUDA_VISIBLE_DEVICES=1

# Use both GPUs
export CUDA_VISIBLE_DEVICES=0,1

# Run app
python app.py
```

**Or in Python** (app.py):
```python
import os
os.environ['CUDA_VISIBLE_DEVICES'] = '0'  # Use GPU 0
```

---

### WSL2 GPU Issues

**Symptom**: GPU not detected in WSL2

**Prerequisites**:
1. Windows 11 or Windows 10 version 21H2+
2. NVIDIA drivers installed in **Windows** (not WSL)
3. WSL2 (not WSL1)

**Check WSL version**:
```powershell
wsl --list --verbose
```

**If WSL1**: Upgrade to WSL2:
```powershell
wsl --set-version Ubuntu 2
```

**Verify GPU in WSL**:
```bash
nvidia-smi
```

Should show GPU (using Windows drivers).

**Install CUDA in WSL** (if needed):
```bash
# Do NOT install NVIDIA drivers in WSL
# Only install CUDA toolkit
wget https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-wsl-ubuntu.pin
sudo mv cuda-wsl-ubuntu.pin /etc/apt/preferences.d/cuda-repository-pin-600
wget https://developer.download.nvidia.com/compute/cuda/12.1.0/local_installers/cuda-repo-wsl-ubuntu-12-1-local_12.1.0-1_amd64.deb
sudo dpkg -i cuda-repo-wsl-ubuntu-12-1-local_12.1.0-1_amd64.deb
sudo apt-get update
sudo apt-get install cuda
```

---

## CPU Fallback

### Disable GPU

**Temporarily**:
```bash
export CUDA_VISIBLE_DEVICES=""
python app.py
```

**Permanently** (add to `.bashrc`):
```bash
echo 'export CUDA_VISIBLE_DEVICES=""' >> ~/.bashrc
source ~/.bashrc
```

### Force CPU Mode

**In Python** (app.py):
```python
import torch

# Force CPU
device = 'cpu'

# Or check and override
if torch.cuda.is_available():
    print("GPU available but forcing CPU mode")
    device = 'cpu'
else:
    device = 'cpu'
```

### When to Use CPU Mode

**Use CPU if**:
- No NVIDIA GPU
- GPU too old (< Compute Capability 3.5)
- VRAM insufficient (< 2 GB)
- GPU errors unresolvable
- Testing/debugging

**Performance**: 4-8x slower but still functional.

---

## Performance Optimization

### Monitor GPU Usage

**Real-time monitoring**:
```bash
watch -n 1 nvidia-smi
```

**Check utilization**:
- GPU: Should be 80-100% during extraction
- Memory: Should use 2-6 GB depending on model

**If GPU < 50%**: Possible bottleneck (CPU, I/O, etc.)

### Batch Processing

**Sequential** (default):
```python
# Extract one song at a time
for song in songs:
    extract_stems(song)
```

**Batch** (future optimization):
```python
# Extract multiple songs in parallel (not yet implemented)
# Could improve GPU utilization
```

### Power Settings

**Linux**:
```bash
# Set GPU to max performance
sudo nvidia-smi -pm 1
sudo nvidia-smi -pl 350  # Max power limit (watts)
```

**Windows**:
- NVIDIA Control Panel → Manage 3D Settings
- Power management mode: Prefer maximum performance

---

## Next Steps

- [Installation Guide](../user-guides/01-INSTALLATION.md) - StemTube setup
- [Troubleshooting Guide](../user-guides/05-TROUBLESHOOTING.md) - Common issues
- [Stem Extraction Guide](../feature-guides/STEM-EXTRACTION.md) - Demucs models

---

**GPU Support**: NVIDIA CUDA 11.x-13.x
**Last Updated**: December 2025
**Performance Gain**: 4-10x faster
**Status**: Fully automated ✨
