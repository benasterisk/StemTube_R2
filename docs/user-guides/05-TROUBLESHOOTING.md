# StemTube Troubleshooting Guide

Solutions to common issues and problems.

---

## Table of Contents

- [Installation Issues](#installation-issues)
- [Download Problems](#download-problems)
- [Extraction Failures](#extraction-failures)
- [Mixer Issues](#mixer-issues)
- [Pitch/Tempo Not Working](#pitchtempo-not-working)
- [GPU Problems](#gpu-problems)
- [Database Issues](#database-issues)
- [Network & ngrok](#network--ngrok)
- [Mobile-Specific](#mobile-specific)
- [Performance Issues](#performance-issues)

---

## Installation Issues

### Python 3.12 Not Found

**Symptom**: `python3.12: command not found`

**Causes**:
- Python 3.12 not installed
- Wrong PATH configuration

**Solutions**:

**Ubuntu/Debian**:
```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt-get update
sudo apt-get install python3.12 python3.12-venv python3.12-dev
```

**macOS**:
```bash
brew install python@3.12
```

**Windows**:
- Download installer from [python.org](https://www.python.org/downloads/)
- Check "Add Python to PATH" during installation

### setup_dependencies.py Fails

**Symptom**: Script errors during installation

**Common Errors**:

**1. "No module named 'venv'"**:
```bash
sudo apt-get install python3.12-venv
```

**2. "Permission denied"**:
```bash
# Don't use sudo
# Ensure you own the directory
sudo chown -R $USER:$USER /path/to/stemtube
python3.12 setup_dependencies.py
```

**3. "Disk space full"**:
```bash
# Check available space
df -h

# Need at least 2 GB free
# Clear space if needed
```

**4. "Network error"**:
```bash
# Check internet connection
ping google.com

# Try again
python3.12 setup_dependencies.py
```

### FFmpeg Not Found

**Symptom**: `Couldn't find ffmpeg or avconv`

**Solutions**:

**Ubuntu/Debian**:
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**macOS**:
```bash
brew install ffmpeg
```

**Windows**:
```powershell
# Using Chocolatey
choco install ffmpeg

# Or download from ffmpeg.org and add to PATH
```

**Verify**:
```bash
ffmpeg -version
```

### madmom Import Error

**Symptom**: `ImportError: cannot import name 'xxxx' from madmom`

**Cause**: numpy 2.x compatibility issue

**Solution**:
```bash
source venv/bin/activate
python utils/setup/patch_madmom_numpy.py

# Verify
python -c "import madmom; print('madmom OK')"
```

---

## Download Problems

### YouTube Download Fails

**Symptom**: "Download failed" or stuck at 0%

**Common Causes**:

**1. Video Unavailable**:
- Video deleted or private
- Geographic restrictions
- Age restrictions

**Solution**: Try a different video

**2. Network Issues**:
```bash
# Test connection
ping youtube.com

# Check if YouTube is accessible
curl -I https://www.youtube.com/
```

**3. yt-dlp Outdated**:
```bash
source venv/bin/activate
pip install --upgrade yt-dlp yt-dlp-ejs

# Restart app
python app.py
```

**4. JavaScript Runtime Missing** (since late 2025):

YouTube now requires JavaScript challenge solving. If you see warnings like:
- "Signature solving failed"
- "n challenge solving failed"
- "JS Challenge Providers: none"

**Solution**: Install Deno runtime:
```bash
# Linux/macOS
curl -fsSL https://deno.land/install.sh | sh
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex
```

Then install the EJS component:
```bash
source venv/bin/activate
pip install yt-dlp-ejs
```

**5. Rate Limiting**:
- YouTube may temporarily block requests
- Wait 15-30 minutes
- Try different video
- Use VPN if persistent

### "Invalid URL" Error

**Symptom**: Error when pasting YouTube URL

**Valid Formats**:
```
https://www.youtube.com/watch?v=VIDEO_ID
https://youtu.be/VIDEO_ID
VIDEO_ID (11 characters)
```

**Invalid Formats**:
```
https://www.youtube.com/playlist?list=... (playlists not supported)
https://music.youtube.com/... (use regular YouTube URL)
```

### Download Stuck

**Symptom**: Download progress frozen

**Solutions**:

1. **Refresh page** - Progress updates via WebSocket may have disconnected

2. **Check backend logs**:
```bash
tail -f app.log | grep download
```

3. **Restart download**:
```bash
# Cancel stuck download
# Delete from downloads list
# Try again
```

4. **Check disk space**:
```bash
df -h
# Need 100+ MB free for typical song
```

---

## Extraction Failures

### "Extraction failed" Error

**Symptom**: Extraction stops with error

**Common Causes**:

**1. Insufficient Memory**:
```bash
# Check available RAM
free -h

# Close other applications
# Restart app
python app.py
```

**Minimum RAM**: 4 GB (8 GB recommended)

**2. Corrupted Audio File**:
- Download may have failed partially
- Re-download the file
- Try file upload instead

**3. GPU Memory Error**:
```
CUDA out of memory
```

**Solution**:
```bash
# Reduce batch size or use CPU mode
# Restart app to clear GPU memory
python app.py
```

**4. Demucs Model Missing**:
```bash
# Re-download models
source venv/bin/activate
python -m demucs.pretrained download htdemucs
python -m demucs.pretrained download htdemucs_6s
```

### Extraction Takes Too Long

**Symptom**: Extraction > 10 minutes for 4-minute song

**Expected Times**:
- CPU: 3-8 minutes per song
- GPU: 20-60 seconds per song

**Solutions**:

**Enable GPU** (if available):
```bash
# Check CUDA
nvidia-smi

# Restart app - auto-detects GPU
python app.py
```

**Reduce Model Complexity**:
- Use `htdemucs` (4-stem) instead of `htdemucs_6s` (6-stem)
- Faster processing, still good quality

**Check System Load**:
```bash
# CPU usage
top

# Kill CPU-heavy processes if needed
```

### Stems Sound Distorted

**Symptom**: Extracted stems have artifacts or glitches

**Causes**:
- Low-quality source audio
- Demucs model limitations
- Audio file corruption

**Solutions**:

1. **Use High-Quality Source**:
   - Download best quality from YouTube
   - Use lossless formats (FLAC) for uploads
   - Avoid heavily compressed files (< 128kbps)

2. **Try Different Model**:
   - `htdemucs` vs `htdemucs_6s`
   - Different models perform better on different genres

3. **Re-extract**:
   - Delete extraction
   - Extract again (may help with transient errors)

---

## Mixer Issues

### Mixer Won't Open

**Symptom**: Clicking "Open Mixer" does nothing

**Causes**:
- Pop-up blocker enabled
- Extraction not complete
- Browser compatibility

**Solutions**:

1. **Check Extraction Status**:
   - Ensure status shows "Ready" or "Complete"
   - Extraction must finish before mixer available

2. **Disable Pop-up Blocker**:
   - Browser settings → Allow pop-ups for StemTube domain
   - Or manually navigate to: `/mixer/<download_id>`

3. **Check Browser Console**:
   - F12 → Console tab
   - Look for JavaScript errors
   - Report errors if found

4. **Try Different Browser**:
   - Chrome 90+ recommended
   - Firefox 88+
   - Safari 14+

### No Audio in Mixer

**Symptom**: Mixer loads but no sound plays

**Solutions**:

**1. Check Browser Autoplay Policy**:
```javascript
// Open browser console (F12)
// Paste and run:
console.log(navigator.mediaSession);
```

- Click anywhere on page first
- Then click play

**2. Check Audio Files**:
```bash
# Verify stem files exist
ls downloads/global/VIDEO_ID/stems/htdemucs/

# Should see: vocals.wav, drums.wav, bass.wav, other.wav
```

**3. Check Browser Volume**:
- Browser tab not muted (speaker icon)
- System volume not muted
- Headphones connected properly

**4. HTTPS Requirement**:
- Pitch/tempo features require HTTPS or localhost
- Use `./start_service.sh` for ngrok HTTPS
- Or access via `http://localhost:5011`

### Stems Out of Sync

**Symptom**: Stems playing at different times

**Causes**:
- Web Audio API scheduling issue
- Browser performance

**Solutions**:

1. **Reload Mixer**:
   - Close and reopen mixer
   - Stems re-synchronized on load

2. **Clear Browser Cache**:
   ```
   Browser Settings → Privacy → Clear Browsing Data
   ✅ Cached files
   ```

3. **Disable Browser Extensions**:
   - Ad blockers can interfere with audio
   - Try incognito/private mode

4. **Check System Performance**:
   - Close CPU-heavy applications
   - Reduce number of browser tabs

---

## Pitch/Tempo Not Working

### Controls Don't Respond

**Symptom**: Moving pitch/tempo sliders has no effect

**PRIMARY CAUSE**: **SharedArrayBuffer requires HTTPS or localhost**

**Solutions**:

**Option 1: Use ngrok (HTTPS)**:
```bash
./start_service.sh
# Access via: https://your-subdomain.ngrok-free.app
```

**Option 2: Use localhost**:
```
http://localhost:5011
# SharedArrayBuffer allowed on localhost
```

**Option 3: Custom HTTPS**:
- See [HTTPS Setup Guide](../admin-guides/HTTPS-SETUP.md)
- Configure SSL certificate
- Requires domain name

**Verify HTTPS Requirement**:
```javascript
// Browser console
console.log(crossOriginIsolated);
// Should be: true
```

### Browser Compatibility

**Supported Browsers**:
- Chrome 90+: ✅ Full support
- Firefox 88+: ✅ Full support
- Safari 14+: ⚠️ Partial support
- Edge 90+: ✅ Full support

**Not Supported**:
- IE 11: ❌
- Chrome < 90: ❌
- Firefox < 88: ❌

### SoundTouch Not Loading

**Symptom**: Tempo changes pitch or vice versa

**Cause**: SoundTouch worklet failed to load, using fallback `playbackRate`

**Check**:
```javascript
// Browser console
console.log('Check network tab for soundtouch-worklet.js');
// Should load without 404 error
```

**Solutions**:

1. **Verify Worklet File Exists**:
```bash
ls static/wasm/soundtouch-worklet.js
# Should exist
```

2. **Check HTTPS**:
- AudioWorklet requires HTTPS or localhost
- Use ngrok or localhost

3. **Clear Cache**:
- Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R)
- Clear browser cache

---

## GPU Problems

### GPU Not Detected

**Symptom**: "Running on CPU" despite having NVIDIA GPU

**Check CUDA**:
```bash
nvidia-smi
```

**Expected Output**:
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 535.xx.xx    Driver Version: 535.xx.xx    CUDA Version: 12.x  |
+-----------------------------------------------------------------------------+
```

**If nvidia-smi Not Found**:
- NVIDIA drivers not installed
- Install from [nvidia.com/drivers](https://www.nvidia.com/Download/index.aspx)

**If nvidia-smi Works**:

1. **Check PyTorch CUDA**:
```bash
source venv/bin/activate
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

**Expected**: `CUDA available: True`

2. **If False - Reinstall PyTorch**:
```bash
source venv/bin/activate

# For CUDA 11.8
pip uninstall torch torchvision torchaudio
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# For CUDA 12.1
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

3. **Restart App**:
```bash
python app.py
# Should auto-detect GPU and configure
```

### CUDA Out of Memory

**Symptom**:
```
RuntimeError: CUDA out of memory
```

**Solutions**:

1. **Reduce Batch Size**:
   - StemTube uses default Demucs settings
   - For low VRAM (< 4 GB), use CPU mode

2. **Close Other GPU Applications**:
```bash
# Check GPU memory usage
nvidia-smi

# Kill GPU processes if needed
```

3. **Restart App**:
```bash
# Clears GPU memory
pkill -f app.py
python app.py
```

4. **Use CPU Mode**:
```bash
# Temporarily disable GPU
export CUDA_VISIBLE_DEVICES=""
python app.py
```

### cuDNN Issues

**Symptom**:
```
Could not load dynamic library 'libcudnn.so.8'
```

**Solutions**:

1. **Auto-Install cuDNN**:
```bash
source venv/bin/activate

# For CUDA 11.x
pip install nvidia-cudnn-cu11

# For CUDA 12.x
pip install nvidia-cudnn-cu12
```

2. **Restart App**:
```bash
python app.py
# App auto-configures LD_LIBRARY_PATH
```

3. **Manual Configuration**:
See [GPU Setup Guide](../setup-guides/GPU-SETUP.md)

---

## Database Issues

### "Database is locked"

**Symptom**: Operations fail with database lock error

**Cause**: Multiple app instances running

**Solutions**:

1. **Stop All Instances**:
```bash
pkill -f app.py

# Verify no processes running
ps aux | grep app.py
```

2. **Restart Single Instance**:
```bash
python app.py
```

3. **If Persists - Check for Stale Locks**:
```bash
# Stop app
pkill -f app.py

# Remove lock file (if exists)
rm -f data/stemtube.db-journal

# Restart
python app.py
```

### Reset Database

**⚠️ DESTRUCTIVE - Deletes all users and downloads**

**When to Use**:
- Database corrupted
- Schema migration failed
- Testing/development

**Command**:
```bash
source venv/bin/activate
python utils/database/clear_database.py

# Confirm when prompted
# Recreates default admin user
```

### Orphaned Files

**Symptom**: Files exist on disk but not in database (or vice versa)

**Cleanup**:
```bash
source venv/bin/activate
python utils/database/cleanup_orphaned_files.py

# Reviews and removes:
# - Files without database entries
# - Database entries without files
```

---

## Network & ngrok

### ngrok Tunnel Fails

**Symptom**: `./start_service.sh` errors

**Common Errors**:

**1. "ngrok not found"**:
```bash
# Install ngrok
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
```

**2. "Authentication failed"**:
```bash
# Get free authtoken from ngrok.com
ngrok config add-authtoken YOUR_TOKEN_HERE
```

**3. "Too many connections"**:
- Free ngrok plan limits simultaneous connections
- Wait a few minutes
- Or upgrade ngrok plan

### ngrok Rate Limiting

**Symptom**: "429 Too Many Requests" from ngrok

**Cause**: Free ngrok plan has request limits

**Solutions**:

1. **Disable Browser Logging**:
```python
# In core/config.json
{
  "browser_logging": {
    "enabled": false  # Reduces ngrok requests
  }
}
```

2. **Upgrade ngrok Plan**:
- Visit [ngrok.com/pricing](https://ngrok.com/pricing)
- Paid plans have higher limits

3. **Use Local Access**:
- Access via `http://localhost:5011` when on same machine
- Avoids ngrok entirely

### WebSocket Disconnects

**Symptom**: Real-time updates stop working

**Solutions**:

1. **Check Network Connection**:
```bash
ping <your-server-ip>
```

2. **Refresh Page**:
- Reconnects WebSocket
- F5 or pull-to-refresh

3. **Check Server Logs**:
```bash
tail -f app.log | grep socket
```

4. **Firewall Issues**:
```bash
# Check if port 5011 accessible
sudo ufw status
sudo ufw allow 5011
```

---

## Mobile-Specific

### No Sound on iOS

**Symptom**: Mixer loads but no audio plays on iPhone/iPad

**Solutions**:

1. **Check Silent Mode**:
   - Ringer/Silent switch should be OFF (not orange)
   - Settings → Sounds & Haptics → Ringer

2. **Tap to Unlock Audio**:
   - Tap "Enable Audio" button
   - Or tap anywhere on screen, then play

3. **Disable Low Power Mode**:
   - Settings → Battery → Low Power Mode: OFF

4. **Try Different Browser**:
   - Safari: iOS default, best compatibility
   - Chrome: Alternative option

### Controls Not Responding on Android

**Symptom**: Touch controls don't work

**Solutions**:

1. **Clear Browser Cache**:
   - Chrome → Settings → Privacy → Clear Browsing Data
   - ✅ Cached images and files

2. **Disable Data Saver**:
   - Chrome → Settings → Lite mode: OFF
   - Interferes with WebSocket

3. **Try Incognito Mode**:
   - Rules out extension conflicts

4. **Update Chrome**:
   - Play Store → My apps → Chrome → Update

### Mobile Performance Slow

**Symptom**: Laggy UI, choppy playback

**Solutions**:

1. **Close Background Apps**:
   - Free up RAM
   - Android: Recent apps → Close all

2. **Reduce Quality Settings**:
   - Use htdemucs (4-stem) instead of htdemucs_6s
   - Disable chords/structure display if slow

3. **Clear Storage**:
   - Free up device storage
   - Delete old downloads

4. **Use WiFi**:
   - Better than cellular for streaming

---

## Performance Issues

### High CPU Usage

**Symptom**: Computer fans loud, system slow

**During Extraction**: **NORMAL**
- Demucs is CPU-intensive
- 80-100% CPU expected
- Lasts 3-8 minutes per song

**During Mixer**: **ABNORMAL**
- Should be < 20% CPU
- Check browser extensions
- Close other applications

### High Memory Usage

**Symptom**: App uses > 4 GB RAM

**Solutions**:

1. **Restart App Periodically**:
```bash
# Clears memory leaks
pkill -f app.py
python app.py
```

2. **Limit Simultaneous Extractions**:
- Extract one song at a time
- Queue additional extractions

3. **Clear Old Downloads**:
```bash
# Remove old files
python utils/database/cleanup_orphaned_files.py
```

### Disk Space Full

**Symptom**: "No space left on device"

**Check Usage**:
```bash
df -h
du -sh downloads/
```

**Typical Sizes**:
- Download: 5-10 MB per song
- Stems (4-stem): 20-40 MB per song
- Stems (6-stem): 30-50 MB per song

**Cleanup**:

1. **Delete Old Downloads**:
   - Admin Panel → Storage Management
   - Select old downloads → Delete

2. **Remove Orphaned Files**:
```bash
python utils/database/cleanup_orphaned_files.py
```

3. **Clear Demucs Cache**:
```bash
rm -rf ~/.cache/torch/hub/checkpoints/
```

---

## Getting Additional Help

### Check Logs

**Application Logs**:
```bash
tail -f app.log

# Filter for errors
grep ERROR app.log

# Filter for specific feature
grep chord app.log
```

**Browser Console**:
- F12 → Console tab
- Look for red error messages
- Copy full error text when reporting issues

### Report an Issue

**Before Reporting**:
1. Search existing issues on GitHub
2. Check this troubleshooting guide
3. Gather information:
   - OS and version
   - Python version: `python3.12 --version`
   - Browser and version
   - GPU info (if applicable): `nvidia-smi`
   - Full error messages
   - Steps to reproduce

**Report At**:
- GitHub Issues: https://github.com/Benasterisk/StemTube-dev/issues

**Include**:
- Clear description of problem
- Steps to reproduce
- Expected vs actual behavior
- Error messages (full text)
- System information
- Screenshots if relevant

---

## Common Error Messages

### "Flask secret key not configured"

**Solution**:
```bash
cp .env.example .env
python3 -c "import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))" >> .env
```

### "Port 5011 already in use"

**Solution**:
```bash
# Find and kill process
sudo lsof -ti:5011 | xargs kill -9

# Or use different port
export PORT=5012
python app.py
```

### "Permission denied"

**Solution**:
```bash
# Fix ownership
sudo chown -R $USER:$USER /path/to/stemtube

# Fix permissions
chmod 600 .env
chmod +x start_service.sh
```

### "Module not found"

**Solution**:
```bash
# Activate virtual environment
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt  # If exists
# Or
python setup_dependencies.py
```

---

## Quick Diagnostic Commands

**System Check**:
```bash
# Python version
python3.12 --version

# FFmpeg installed
ffmpeg -version

# Disk space
df -h

# Memory
free -h

# GPU (if applicable)
nvidia-smi
```

**App Check**:
```bash
# Activate venv
source venv/bin/activate

# Check PyTorch
python -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA: {torch.cuda.is_available()}')"

# Check Demucs
python -c "from demucs import pretrained; print('Demucs OK')"

# Check madmom
python -c "import madmom; print('madmom OK')"

# Check faster-whisper
python -c "from faster_whisper import WhisperModel; print('faster-whisper OK')"
```

**Network Check**:
```bash
# Test localhost
curl http://localhost:5011

# Test ngrok (if running)
curl https://your-subdomain.ngrok-free.app
```

---

## Still Having Issues?

If none of these solutions work:

1. **Try a fresh installation**:
   ```bash
   # Backup .env and database
   cp .env .env.backup
   cp data/stemtube.db data/stemtube.db.backup

   # Remove venv
   rm -rf venv/

   # Reinstall
   python3.12 setup_dependencies.py

   # Restore .env
   cp .env.backup .env
   ```

2. **Check system requirements**:
   - Python 3.12+
   - 4+ GB RAM
   - 2+ GB disk space
   - Modern browser

3. **Consult documentation**:
   - [Installation Guide](01-INSTALLATION.md)
   - [Usage Guide](02-USAGE.md)
   - [Architecture Guide](../developer-guides/ARCHITECTURE.md)

4. **Ask for help**:
   - GitHub Issues
   - Provide full error details
   - Include system information

---

**Most issues have simple solutions - don't give up!** 💪

Check logs, try fresh installation, and report persistent issues on GitHub.
