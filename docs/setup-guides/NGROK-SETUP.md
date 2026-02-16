# Fix ngrok and FFmpeg for the systemd service

## Problem

Apps installed via **snap** (ngrok, FFmpeg) did not work when launched by the StemTube systemd service.

### Symptoms observed
- **ngrok**: `command not found` in service logs
- **FFmpeg**: `Permission denied` or `command not found`
- Manual runs OK, but fails via systemd

## Root Cause

systemd services have a **minimal PATH** by default that does not include `/snap/bin/`. Also, snap apps require specific environment variables (notably `HOME`) to access their isolated config.

### Technical details

1. **Limited PATH**: systemd uses only `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
2. **Snap isolation**: snap apps store config in `~/snap/app_name/version/.config/`
3. **HOME variable**: without `HOME` properly set, snap cannot locate its data

## Solution Applied

### 1. Create wrapper scripts

Wrappers in `/usr/local/bin/` (which IS in systemd PATH) redirect to snap executables:

#### ngrok wrapper
```bash
sudo bash -c 'cat > /usr/local/bin/ngrok << "EOF"
#!/bin/bash
exec /snap/bin/ngrok "$@"
EOF'
sudo chmod +x /usr/local/bin/ngrok
```

#### FFmpeg wrapper
```bash
sudo bash -c 'cat > /usr/local/bin/ffmpeg << "EOF"
#!/bin/bash
exec /snap/bin/ffmpeg "$@"
EOF'
sudo chmod +x /usr/local/bin/ffmpeg
```

#### FFprobe wrapper
```bash
sudo bash -c 'cat > /usr/local/bin/ffprobe << "EOF"
#!/bin/bash
exec /snap/bin/ffmpeg.ffprobe "$@"
EOF'
sudo chmod +x /usr/local/bin/ffprobe
```

**Note**: the snap ffprobe binary is named `ffmpeg.ffprobe`.

### 2. systemd service configuration

Edit `/etc/systemd/system/stemtube.service` to add the `HOME` variable:

```ini
[Service]
Type=forking
User=michael
Group=michael
WorkingDirectory=/path/to/Documents/Dev/StemTube_R2

# Critical environment variables
Environment="PATH=/path/to/Documents/Dev/StemTube_R2/venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=/path/to"  # IMPORTANT for snap
Environment="PYTHONUNBUFFERED=1"
```

Then reload:
```bash
sudo systemctl daemon-reload
sudo systemctl restart stemtube
```

## Verification

### Test the wrappers
```bash
# Verify the wrappers exist
ls -la /usr/local/bin/{ngrok,ffmpeg,ffprobe}

# Test execution
/usr/local/bin/ngrok version
/usr/local/bin/ffmpeg -version
/usr/local/bin/ffprobe -version
```

### Verify ngrok config
```bash
# Check that the authtoken is configured
ngrok config check

# Should show:
# Valid configuration file at /path/to/snap/ngrok/315/.config/ngrok/ngrok.yml
```

### Test the service
```bash
# Restart the service
sudo systemctl restart stemtube

# Verify both processes are running
ps aux | grep -E "(python app.py|ngrok)" | grep -v grep

# Should show:
# michael    XXXXX  ... /snap/ngrok/315/ngrok http --url=...
# michael    XXXXX  ... python app.py

# Check the ngrok tunnel
python3 -c "import requests; r=requests.get('http://localhost:4040/api/tunnels'); print('Tunnel active:', r.json()['tunnels'][0]['public_url'])"

# Should show:
# Tunnel active: https://definite-cockatoo-bold.ngrok-free.app
```

## Why this works

### Wrapper benefits

1. **PATH compatibility**: `/usr/local/bin` is in systemd PATH by default
2. **Transparency**: scripts can use `ngrok`, `ffmpeg`, etc. normally
3. **Maintenance**: one place to update if snap paths change
4. **Flexibility**: works for any user running the service

### Importance of HOME

The `HOME` variable is essential for snap because:
- Snap uses per-user isolated directories: `~/snap/app_name/`
- Without HOME, snap looks in `/root/snap/` (empty if the service user is not root)
- The ngrok authtoken is stored at `~/snap/ngrok/315/.config/ngrok/ngrok.yml`

## Common snap apps that need this fix

This approach works for any snap app launched via systemd:
- **ngrok** - HTTP/TCP tunnel
- **ffmpeg** - video/audio processing
- **node** - JavaScript runtime
- **kubectl** - Kubernetes client
- And any other snap that needs PATH or user config

## Troubleshooting

### Ngrok shows "Install your authtoken"
```bash
# Reinstall the authtoken
ngrok config add-authtoken YOUR_TOKEN

# Verify config
ngrok config check
```

### FFmpeg: "Permission denied"
```bash
# Check wrapper permissions
ls -la /usr/local/bin/ffmpeg
```

### Service still fails
```bash
# Check service logs
journalctl -u stemtube -f

# Check PATH from within service
sudo systemctl show -p Environment stemtube
```
