# StemTube Service - systemctl Commands

The StemTube service is installed and configured with systemd.

## Available Commands

### Start the service
```bash
sudo systemctl start stemtube
```

### Stop the service
```bash
sudo systemctl stop stemtube
```

### Restart the service
```bash
sudo systemctl restart stemtube
```

### View service status
```bash
systemctl status stemtube
```

### Enable auto-start on boot
```bash
sudo systemctl enable stemtube
```
*(Already enabled by default)*

### Disable auto-start
```bash
sudo systemctl disable stemtube
```

## View logs

### Live logs
```bash
journalctl -u stemtube -f
```

### Last 50 logs
```bash
journalctl -u stemtube -n 50
```

### Logs since today
```bash
journalctl -u stemtube --since today
```

### Logs from the last hour
```bash
journalctl -u stemtube --since "1 hour ago"
```

## Additional log files

The service also writes logs in `logs/`:
- `logs/stemtube_app.log` - Flask app logs
- `logs/stemtube_ngrok.log` - ngrok tunnel logs
- `logs/stemtube_stop.log` - service stop logs
- `logs/stemtube.log` - main application logs
- `logs/stemtube_errors.log` - errors only
- `logs/stemtube_processing.log` - audio processing logs

## Service details

- **Service name**: `stemtube.service`
- **Config file**: `/etc/systemd/system/stemtube.service`
- **User**: `michael`
- **Working directory**: `/path/to/StemTube_R2`
- **Flask port**: `5011`
- **ngrok tunnel**: `https://definite-cockatoo-bold.ngrok-free.app`
- **Wrapper scripts**: `/usr/local/bin/ngrok`, `/usr/local/bin/ffmpeg`, `/usr/local/bin/ffprobe`

## What the service does

1. Loads environment variables from `.env`
2. Starts ngrok (HTTPS tunnel)
3. Starts the Flask app (`app.py`)
4. Writes PID files (`stemtube_app.pid`, `stemtube_ngrok.pid`)
5. Logs output to `logs/`

---

## Creating the systemd Service File

### Service File Template

Create `/etc/systemd/system/stemtube.service`:

```ini
[Unit]
Description=StemTube Web Application with ngrok Tunnel
After=network.target

[Service]
Type=forking
User=YOUR_USERNAME
Group=YOUR_USERNAME
WorkingDirectory=/path/to/stemtube_dev

ExecStart=/path/to/stemtube_dev/start_service.sh
ExecStop=/path/to/stemtube_dev/stop_service.sh

Restart=on-failure
RestartSec=10

StandardOutput=append:/path/to/stemtube_dev/logs/stemtube_service.log
StandardError=append:/path/to/stemtube_dev/logs/stemtube_service.log

# Security settings
# IMPORTANT: PrivateTmp must be FALSE for FFmpeg to work with yt-dlp
PrivateTmp=false
NoNewPrivileges=true

# Environment - IMPORTANT: Include Deno path for YouTube downloads
Environment="PATH=/home/YOUR_USERNAME/.deno/bin:/path/to/stemtube_dev/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="VIRTUAL_ENV=/path/to/stemtube_dev/venv"

[Install]
WantedBy=multi-user.target
```

**IMPORTANT: PrivateTmp must be `false`**

If `PrivateTmp=true`, the service creates an isolated /tmp directory. This causes FFmpeg to fail during post-processing because:
- yt-dlp downloads files to a temporary location
- FFmpeg (especially snap-based) cannot access files in the isolated /tmp
- Result: `ERROR: Postprocessing: ffprobe and ffmpeg not found`

### Critical: FFmpeg Configuration

If you have snap FFmpeg installed, the wrapper scripts at `/usr/local/bin/` may point to the snap version which has sandbox restrictions. Update them to use system FFmpeg:

```bash
# Check if wrappers point to snap
cat /usr/local/bin/ffmpeg
# If it shows "exec /snap/bin/ffmpeg", update it:

# Update wrappers to use system FFmpeg
sudo bash -c 'echo "#!/bin/bash
exec /usr/bin/ffmpeg \"\$@\"" > /usr/local/bin/ffmpeg'

sudo bash -c 'echo "#!/bin/bash
exec /usr/bin/ffprobe \"\$@\"" > /usr/local/bin/ffprobe'

# Verify
/usr/local/bin/ffmpeg -version
# Should show: ffmpeg version 6.x (system version, not snap 4.x)
```

**Why this matters**: Snap FFmpeg has sandbox restrictions that prevent it from accessing temporary files created by yt-dlp, causing `ffprobe and ffmpeg not found` errors during post-processing.

### Critical: Deno in PATH

**YouTube downloads require Deno** to solve JavaScript challenges. The service's PATH environment variable **must include** `~/.deno/bin`:

```ini
Environment="PATH=/home/YOUR_USERNAME/.deno/bin:/path/to/venv/bin:..."
```

Without Deno in the PATH, YouTube downloads will fail with errors like:
- `WARNING: [youtube] n challenge solving failed`
- `HTTP Error 403: Forbidden`

### Installation Steps

```bash
# 1. Create service file (replace paths and username)
sudo nano /etc/systemd/system/stemtube.service

# 2. Reload systemd
sudo systemctl daemon-reload

# 3. Enable service
sudo systemctl enable stemtube

# 4. Start service
sudo systemctl start stemtube

# 5. Verify status
systemctl status stemtube
```

### Updating PATH After Installing Deno

If you install Deno after creating the service, update the PATH:

```bash
# 1. Edit service file
sudo nano /etc/systemd/system/stemtube.service

# 2. Add ~/.deno/bin to PATH in Environment line

# 3. Reload and restart
sudo systemctl daemon-reload
sudo systemctl restart stemtube
```

---

## Troubleshooting YouTube Downloads

### "n challenge solving failed" Warning

**Cause**: Deno is not available in the service's PATH.

**Solution**:
1. Verify Deno is installed: `deno --version`
2. Check service PATH includes `~/.deno/bin`
3. Update service file and restart

### "HTTP Error 403: Forbidden"

**Cause**: YouTube blocks requests without proper authentication or JS challenge solving.

**Solutions**:
1. Ensure Deno is in service PATH (see above)
2. Make sure Firefox is installed and has been used to access YouTube (for cookies)
3. Check that the service runs as your user (not root)

### Verify Service Can Access Deno

```bash
# Check what PATH the service sees
sudo -u YOUR_USERNAME PATH="/home/YOUR_USERNAME/.deno/bin:/path/to/venv/bin:/usr/bin" deno --version

# Test yt-dlp with service environment
sudo -u YOUR_USERNAME PATH="/home/YOUR_USERNAME/.deno/bin:/path/to/venv/bin:/usr/bin" \
  /path/to/venv/bin/yt-dlp --cookies-from-browser firefox -F "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Expected output should include: `[youtube] [jsc:deno] Solving JS challenges using deno`
