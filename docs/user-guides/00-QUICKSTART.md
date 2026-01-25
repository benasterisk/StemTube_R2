# StemTube Quickstart Guide

Get StemTube running in 5 minutes with this minimal setup guide.

---

## Prerequisites

- Ubuntu/Debian Linux (or WSL on Windows)
- Python 3.12+
- 4 GB RAM minimum
- 2 GB free disk space

---

## 5-Minute Setup

### 1. Install System Dependencies

```bash
sudo apt-get update && sudo apt-get install -y \
  python3.12 python3.12-venv python3-dev build-essential \
  ffmpeg libsndfile1 libatlas-base-dev liblapack-dev
```

### 2. Clone Repository

```bash
git clone https://github.com/Benasterisk/StemTube-dev.git
cd StemTube-dev
```

### 3. Run Automated Setup

```bash
python3.12 setup_dependencies.py
```

**This script automatically:**
- Creates Python virtual environment
- Installs PyTorch (CPU or CUDA)
- Installs all dependencies
- Downloads Demucs models (~2 GB)
- Patches madmom for numpy compatibility

**Time**: 3-10 minutes depending on internet speed.

### 4. Configure Security

```bash
# Create .env file from template
cp .env.example .env

# Generate secure secret key
python3 -c "import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))" >> .env

# Secure the file
chmod 600 .env
```

### 5. Start StemTube

**Option A: Local Access Only (HTTP)**

```bash
source venv/bin/activate
python app.py
```

Access at: **http://localhost:5011**

**Option B: Remote Access with HTTPS (Recommended)**

```bash
./start_service.sh
```

Access at:
- Local: **http://localhost:5011**
- Remote: **https://your-subdomain.ngrok-free.app** (shown in terminal)
- Mobile: **https://your-subdomain.ngrok-free.app/mobile**

---

## First Use

1. **Navigate to** http://localhost:5011
2. **Login** with default credentials:
   - Username: `administrator`
   - Password: `password`
3. **Change password** immediately (Admin Panel → User Management)
4. **Paste YouTube URL** or upload audio file
5. **Extract stems** with Demucs
6. **Open mixer** to control stems independently

---

## Quick Feature Overview

| Feature | What It Does |
|---------|-------------|
| **YouTube Download** | Download audio from YouTube (no API key needed) |
| **Stem Extraction** | Separate vocals, drums, bass, other (AI-powered) |
| **Chord Detection** | Detect chords automatically (3 backends available) |
| **Karaoke Mode** | Display synchronized lyrics word-by-word |
| **Pitch/Tempo Control** | Change pitch ±12 semitones, tempo 0.5x-2.0x |
| **Mobile Interface** | Full-featured iOS/Android controls at `/mobile` |

---

## GPU Acceleration (Optional)

If you have an NVIDIA GPU:

```bash
# Check CUDA availability
nvidia-smi

# Restart app - GPU will be auto-detected
python app.py
```

**Performance gain**: 4-10x faster stem extraction with GPU.

See [GPU Setup Guide](../setup-guides/GPU-SETUP.md) for troubleshooting.

---

## Common Issues

### "Port 5011 already in use"

```bash
# Find and kill process using port 5011
sudo lsof -ti:5011 | xargs kill -9

# Or use different port
export PORT=5012
python app.py
```

### "Permission denied" when installing

```bash
# Don't use sudo with pip
# setup_dependencies.py handles virtual environment
python3.12 setup_dependencies.py
```

### GPU not detected

```bash
# Check CUDA installation
nvidia-smi

# If CUDA installed, app will auto-detect on restart
# See GPU Setup Guide for manual configuration
```

### Pitch/tempo controls not working

**Cause**: SharedArrayBuffer requires HTTPS or localhost.

**Solutions**:
1. Use `./start_service.sh` (automatic ngrok HTTPS)
2. Access via localhost: http://localhost:5011
3. See [HTTPS Setup Guide](../admin-guides/HTTPS-SETUP.md)

---

## Next Steps

**For End Users:**
- [Installation Guide](01-INSTALLATION.md) - Detailed setup instructions
- [Usage Guide](02-USAGE.md) - How to use all features
- [Mobile Guide](03-MOBILE.md) - Mobile interface details
- [Troubleshooting](05-TROUBLESHOOTING.md) - Comprehensive issue resolution

**For Administrators:**
- [Security Setup](../admin-guides/SECURITY_SETUP.md) - Production security
- [Deployment Guide](../admin-guides/DEPLOYMENT.md) - Production deployment
- [HTTPS Setup](../admin-guides/HTTPS-SETUP.md) - SSL certificate setup

**For Developers:**
- [Architecture Guide](../developer-guides/ARCHITECTURE.md) - System design
- [API Reference](../developer-guides/API-REFERENCE.md) - All endpoints
- [Contributing Guide](../../CONTRIBUTING.md) - How to contribute

---

## Need Help?

- **Documentation**: [docs/](../)
- **GitHub Issues**: https://github.com/Benasterisk/StemTube-dev/issues
- **Troubleshooting**: [05-TROUBLESHOOTING.md](05-TROUBLESHOOTING.md)

---

**You're now ready to use StemTube!** 🎉

Extract stems, detect chords, and enjoy karaoke mode.
