# StemTube Installation Guide

Comprehensive installation instructions for all platforms.

---

## Table of Contents

- [System Requirements](#system-requirements)
- [Platform-Specific Setup](#platform-specific-setup)
  - [Ubuntu/Debian Linux](#ubuntudebian-linux)
  - [Windows 10/11](#windows-1011)
  - [macOS](#macos)
- [Installation Steps](#installation-steps)
- [GPU Setup](#gpu-setup)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
  - [YouTube Download Issues](#youtube-download-issues)

---

## System Requirements

### Minimum Requirements

- **OS**: Ubuntu 20.04+, Debian 11+, Windows 10/11, macOS 10.15+
- **Python**: 3.12 or higher
- **RAM**: 4 GB
- **Disk Space**: 2 GB (base installation)
- **Network**: Internet connection for downloads
- **Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Node.js**: 20+ (required runtime dependency)
- **Firefox**: Required for YouTube cookie authentication

### Recommended Requirements

- **OS**: Ubuntu 22.04 LTS or Debian 12
- **Python**: 3.12
- **RAM**: 8 GB
- **Disk Space**: 20 GB (includes models + downloads)
- **GPU**: NVIDIA GPU with CUDA 11.x-13.x
- **VRAM**: 4 GB+ (for GPU acceleration)
- **Network**: Broadband connection

### GPU Acceleration (Optional)

**Supported**:
- NVIDIA GPUs with CUDA Compute Capability 3.5+
- CUDA 11.x - 13.x
- cuDNN 8.x
- 4 GB+ VRAM recommended

**Performance Gain**:
- Stem extraction: 4-8x faster
- Lyrics transcription: 3-5x faster
- Chord detection: No significant speedup (CPU-optimized)

---

## Platform-Specific Setup

### Ubuntu/Debian Linux

**Recommended platform** - Best tested and most stable.

#### 1. Update System

```bash
sudo apt-get update
sudo apt-get upgrade -y
```

#### 2. Install System Dependencies

```bash
sudo apt-get install -y \
  python3.12 \
  python3.12-venv \
  python3-dev \
  build-essential \
  ffmpeg \
  libsndfile1 \
  libatlas-base-dev \
  liblapack-dev \
  nodejs \
  git \
  curl \
  wget \
  unzip
```

#### 3. Verify Node.js

```bash
node --version
# Expected: v20.x.x or higher
```

If Node.js is not available or too old, install from [NodeSource](https://github.com/nodesource/distributions):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 4. Verify Python Version

```bash
python3.12 --version
# Expected output: Python 3.12.x
```

If Python 3.12 not available, install from deadsnakes PPA:

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt-get update
sudo apt-get install python3.12 python3.12-venv python3.12-dev
```

---

### Windows 10/11

#### Option A: WSL2 (Recommended)

**Why WSL2**: Native Linux environment, better GPU support, easier dependency management.

1. **Enable WSL2**:

```powershell
# Run PowerShell as Administrator
wsl --install
```

2. **Install Ubuntu 22.04** from Microsoft Store

3. **Launch Ubuntu** and follow [Ubuntu/Debian Linux](#ubuntudebian-linux) instructions

4. **GPU Setup** (if applicable):
   - Install [NVIDIA CUDA on WSL2](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)
   - No need for cuDNN in WSL - use system CUDA

#### Option B: Native Windows

**Requirements**:
- Python 3.12 from [python.org](https://www.python.org/downloads/)
- FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
- Visual Studio Build Tools (for some dependencies)

1. **Install Python 3.12**:
   - Download installer from python.org
   - ✅ Check "Add Python to PATH"
   - ✅ Check "Install pip"

2. **Install FFmpeg**:
   ```powershell
   # Using Chocolatey (recommended)
   choco install ffmpeg

   # Or manual: Download, extract, add to PATH
   ```

3. **Install Visual Studio Build Tools**:
   - Download from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/)
   - Select "Desktop development with C++"

4. **Clone Repository**:
   ```powershell
   git clone https://github.com/Benasterisk/StemTube_R2.git
   cd StemTube_R2
   ```

5. **Run Setup**:
   ```powershell
   python setup_dependencies.py
   ```

**Note**: Some dependencies may require manual compilation on Windows. WSL2 is strongly recommended.

---

### macOS

#### 1. Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### 2. Install Dependencies

```bash
brew install python@3.12 ffmpeg libsndfile git
```

#### 3. Verify Installation

```bash
python3.12 --version
ffmpeg -version
```

#### 4. Install Xcode Command Line Tools

```bash
xcode-select --install
```

**GPU Support**: macOS does not support CUDA. StemTube will run in CPU mode only.

---

## Installation Steps

### 1. Clone Repository

```bash
git clone https://github.com/Benasterisk/StemTube_R2.git
cd StemTube_R2
```

**Alternative**: Download ZIP from GitHub and extract.

### 2. Run Automated Setup

```bash
python3.12 setup_dependencies.py
```

**What this script does**:
1. Creates Python virtual environment (`venv/`)
2. Detects GPU and installs appropriate PyTorch version
3. Installs all Python dependencies (~120 packages)
4. Downloads Demucs models:
   - `htdemucs` (4-stem: vocals, drums, bass, other) - ~340 MB
   - `htdemucs_6s` (6-stem: adds guitar, piano) - ~340 MB
5. Patches madmom for numpy 2.x compatibility
6. Configures GPU libraries if CUDA detected

**Time**: 5-15 minutes depending on internet speed.

**Expected Output**:
```
Setting up StemTube dependencies...
Detecting GPU...
✓ CUDA detected: 12.1
✓ Virtual environment created
✓ PyTorch installed (CUDA 12.1)
✓ Dependencies installed
✓ Demucs models downloaded
✓ madmom patched
✓ Setup complete!
```

### 3. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Generate secure secret key
python3 -c "import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))" >> .env

# Secure permissions
chmod 600 .env
```

**Edit `.env` if needed**:
```bash
nano .env
```

**Configuration options**:
```ini
# Flask secret key (REQUIRED - generated above)
FLASK_SECRET_KEY=your-secret-key-here

# Server configuration
HOST=0.0.0.0         # Listen on all interfaces
PORT=5011            # Default port

# Upload limits
MAX_CONTENT_LENGTH=524288000  # 500 MB max upload

# Database
DATABASE_PATH=data/stemtube.db

# Downloads directory
DOWNLOADS_DIR=downloads/

# Ngrok (for HTTPS)
NGROK_AUTHTOKEN=your-token-here  # Optional: Get from ngrok.com
```

### 4. Initialize Database

```bash
source venv/bin/activate
python -c "from core.downloads_db import init_db; init_db()"
```

**Expected Output**:
```
Database initialized at data/stemtube.db
Default admin user created
```

### 5. Test Installation

```bash
source venv/bin/activate
python app.py
```

**Expected Output**:
```
 * Running on http://0.0.0.0:5011
 * GPU detected: NVIDIA GeForce RTX 3090
 * Chord backend: BTC Transformer (170 vocab)
 * Press CTRL+C to quit
```

**Access**: Navigate to http://localhost:5011

**Default Login**:
- Username: `administrator`
- Password: `password`

**⚠️ Change default password immediately** in Admin Panel → User Management.

---

## GPU Setup

### NVIDIA GPU Detection

StemTube automatically detects and configures GPU on first run.

#### 1. Verify CUDA Installation

```bash
nvidia-smi
```

**Expected Output**:
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 535.129.03   Driver Version: 535.129.03   CUDA Version: 12.2   |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|===============================+======================+======================|
|   0  NVIDIA GeForce ...  Off  | 00000000:01:00.0  On |                  N/A |
|  0%   45C    P8    20W / 350W |   1024MiB / 24576MiB |      2%      Default |
+-------------------------------+----------------------+----------------------+
```

#### 2. cuDNN Installation

**Automatic (Recommended)**:
```bash
# app.py automatically installs cuDNN via pip on first run
python app.py
```

**Manual Installation**:
```bash
source venv/bin/activate

# For CUDA 11.x
pip install nvidia-cudnn-cu11

# For CUDA 12.x
pip install nvidia-cudnn-cu12
```

#### 3. Verify GPU Detection

```bash
source venv/bin/activate
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

**Expected Output**:
```
CUDA available: True
```

#### 4. Troubleshooting GPU

See [GPU Setup Guide](../setup-guides/GPU-SETUP.md) for:
- LD_LIBRARY_PATH configuration
- CUDA version mismatches
- cuDNN compatibility issues
- Memory errors

---

## Verification

### 1. Check All Services

```bash
source venv/bin/activate
python app.py
```

**Verify in terminal output**:
- ✅ Running on http://0.0.0.0:5011
- ✅ GPU detected (if applicable)
- ✅ Chord backend loaded
- ✅ Database initialized

### 2. Test Web Interface

1. Navigate to http://localhost:5011
2. Login with default credentials
3. Check "Admin Panel" accessible (if admin user)
4. Try uploading a small audio file

### 3. Test Core Features

**Download from YouTube**:
1. Paste YouTube URL
2. Click "Download"
3. Wait for completion (~30s for 4-min song)

**Extract Stems**:
1. Select downloaded file
2. Choose "htdemucs" model
3. Select all stems
4. Click "Extract"
5. Wait for completion (3-8 min CPU, 20-60s GPU)

**Open Mixer**:
1. Click "Open Mixer" on extracted download
2. Verify audio plays
3. Test stem controls (volume, mute, solo)
4. Test pitch/tempo controls (requires HTTPS)

### 4. Check Logs

```bash
# View application logs
tail -f app.log

# Check for errors
grep ERROR app.log
```

---

## Troubleshooting

### Installation Issues

#### "python3.12: command not found"

**Solution**:
```bash
# Ubuntu/Debian
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt-get update
sudo apt-get install python3.12 python3.12-venv

# macOS
brew install python@3.12

# Windows
# Download installer from python.org
```

#### "No module named 'venv'"

**Solution**:
```bash
sudo apt-get install python3.12-venv
```

#### "setup_dependencies.py failed"

**Check**:
1. Internet connection active
2. Sufficient disk space (2+ GB)
3. Python version 3.12+

**Retry**:
```bash
rm -rf venv/
python3.12 setup_dependencies.py
```

#### "Permission denied"

**Solution**:
```bash
# Don't use sudo with setup script
# Ensure you own the directory
sudo chown -R $USER:$USER /home/michael/Documents/Dev/stemtube_dev_v1.2

# Run without sudo
python3.12 setup_dependencies.py
```

### Dependency Issues

#### "Couldn't find ffmpeg or avconv"

**Solution**:
```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
choco install ffmpeg
# Or download from ffmpeg.org
```

#### "madmom import error"

**Solution**:
```bash
source venv/bin/activate
python utils/setup/patch_madmom_numpy.py
```

#### "torch not compiled with CUDA"

**Solution**:
```bash
source venv/bin/activate

# Uninstall CPU version
pip uninstall torch torchvision torchaudio

# Install CUDA version (for CUDA 12.1)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### YouTube Download Issues

#### "n challenge solving failed" or "HTTP Error 403"

**Cause**: JavaScript challenge solving requires Node.js.

**Solution**:
```bash
# Install Node.js
sudo apt-get install -y nodejs

# Verify
node --version
```

#### "Sign in to confirm you're not a bot"

**Cause**: YouTube requires authentication via browser cookies.

**Solution**:
1. Make sure Firefox is installed
2. Open Firefox and log into YouTube at least once
3. The app automatically uses Firefox cookies for authentication

#### "ffprobe and ffmpeg not found" during post-processing

**Cause**: Snap FFmpeg has sandbox restrictions that prevent access to temporary files.

**Solution 1**: Update FFmpeg wrappers to use system FFmpeg:
```bash
# Check current wrapper
cat /usr/local/bin/ffmpeg
# If it shows "exec /snap/bin/ffmpeg", fix it:

sudo bash -c 'echo "#!/bin/bash
exec /usr/bin/ffmpeg \"\$@\"" > /usr/local/bin/ffmpeg'

sudo bash -c 'echo "#!/bin/bash
exec /usr/bin/ffprobe \"\$@\"" > /usr/local/bin/ffprobe'
```

**Solution 2**: If running as systemd service, ensure `PrivateTmp=false` in the service file:
```bash
sudo nano /etc/systemd/system/stemtube.service
# Change: PrivateTmp=true
# To:     PrivateTmp=false

sudo systemctl daemon-reload
sudo systemctl restart stemtube
```

See [Service Commands](../admin-guides/SERVICE_COMMANDS.md) for complete service configuration.

### Database Issues

#### "Database is locked"

**Solution**:
```bash
# Stop all running instances
pkill -f app.py

# Restart
python app.py
```

#### "Reset database"

**⚠️ DESTRUCTIVE - Deletes all users and downloads**:
```bash
source venv/bin/activate
python utils/database/clear_database.py
```

---

## Next Steps

**For End Users**:
- [Usage Guide](02-USAGE.md) - Learn how to use all features
- [Mobile Guide](03-MOBILE.md) - Use StemTube on mobile devices
- [Troubleshooting](05-TROUBLESHOOTING.md) - Common issues and solutions

**For Administrators**:
- [Security Setup](../admin-guides/SECURITY_SETUP.md) - Production security best practices
- [Deployment Guide](../admin-guides/DEPLOYMENT.md) - Deploy to production server
- [HTTPS Setup](../admin-guides/HTTPS-SETUP.md) - Configure SSL certificates
- [Service Management](../admin-guides/SERVICE_COMMANDS.md) - systemd service setup

**For Developers**:
- [Architecture Guide](../developer-guides/ARCHITECTURE.md) - Understand system design
- [Contributing Guide](../../CONTRIBUTING.md) - Contribute to StemTube

---

## Support

- **Documentation**: [docs/](../)
- **GitHub Issues**: https://github.com/Benasterisk/StemTube_R2/issues
- **Quickstart**: [00-QUICKSTART.md](00-QUICKSTART.md)

---

**Installation complete!** Start using StemTube with the [Usage Guide](02-USAGE.md).
