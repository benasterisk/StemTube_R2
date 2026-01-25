# 🔒 HTTPS Requirement for Audio Features

## ⚠️ CRITICAL: Time-Stretch & Pitch-Shift Require HTTPS

StemTube's advanced audio features (independent tempo and pitch control) **require HTTPS or localhost** to function properly.

---

## 🎵 Affected Features

The following mixer features will **NOT work** over plain HTTP:

- ✅ **Independent Tempo Control** (Time-Stretch) - Change playback speed without affecting pitch
- ✅ **Independent Pitch Control** (Pitch-Shift) - Transpose notes without changing tempo
- ✅ **SoundTouch AudioWorklet** - Professional audio processing engine

### What Happens Without HTTPS

When accessing StemTube over **HTTP** (non-secure connection):

- ❌ AudioWorklet API is **blocked** by browser security policies
- ❌ SoundTouch fails to load silently
- ❌ Tempo and pitch controls exist in UI but **do nothing**
- ⚠️ Fallback to **"magneto mode"** - tempo and pitch change together (like old cassette tape speed)

**Console warning:**
```
[SimplePitchTempo] ⚠ AudioWorklet API not available in this browser/context
[SimplePitchTempo] → Possible reasons:
[SimplePitchTempo]   1. Non-secure context (not HTTPS or localhost)
```

---

## 🔐 Why HTTPS is Required

### Web Standards Security

The **AudioWorklet API** (used by SoundTouch for real-time audio processing) is a **powerful browser feature** that can:
- Access raw audio data
- Run custom audio processing code
- Manipulate audio in real-time

For security reasons, browsers **restrict AudioWorklet** to **secure contexts only**:

| Context | AudioWorklet | Time-Stretch | Pitch-Shift |
|---------|--------------|--------------|-------------|
| **HTTPS** (SSL/TLS) | ✅ Available | ✅ Works | ✅ Works |
| **localhost** (127.0.0.1) | ✅ Available | ✅ Works | ✅ Works |
| **HTTP** (no SSL) | ❌ Blocked | ❌ Broken | ❌ Broken |

**Browser Console (HTTP):**
```javascript
audioContext.audioWorklet  // undefined (API not exposed)
```

**Browser Console (HTTPS):**
```javascript
audioContext.audioWorklet  // AudioWorklet { ... } (API available)
```

---

## ✅ Recommended Deployment Options

### Option 1: Ngrok Tunnel (Recommended for Development)

**Ngrok provides automatic HTTPS** for local development:

```bash
# Install ngrok
brew install ngrok  # macOS
# Or download from https://ngrok.com/download

# Configure custom URL (optional)
cp .env.example .env
echo "NGROK_URL=https://your-subdomain.ngrok-free.app" >> .env

# Start service with ngrok
./start_service.sh
```

**Automatic HTTPS URL:**
```
https://definite-cockatoo-bold.ngrok-free.app → localhost:5011
```

**Benefits:**
- ✅ Automatic HTTPS certificate
- ✅ Works from any device (phone, tablet, remote PC)
- ✅ No firewall configuration needed
- ✅ Free tier available

**File:** `start_service.sh` already includes ngrok integration!

---

### Option 2: Nginx Reverse Proxy with Let's Encrypt

**For production deployment** with your own domain:

```nginx
# /etc/nginx/sites-available/stemtube
server {
    listen 443 ssl http2;
    server_name stemtube.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/stemtube.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stemtube.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5011;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support for Socket.IO
    location /socket.io {
        proxy_pass http://127.0.0.1:5011;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name stemtube.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

**Setup Let's Encrypt:**
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d stemtube.yourdomain.com
```

---

### Option 3: Localhost Only (Development)

**For local-only access** (no remote access):

```bash
# Start without ngrok
python app.py
```

**Access:**
```
http://localhost:5011  ✅ Works (localhost is secure context)
http://127.0.0.1:5011  ✅ Works (localhost is secure context)
http://192.168.1.x:5011  ❌ BROKEN (LAN IP is NOT secure context)
```

**Important:** Accessing via **LAN IP address** (e.g., `http://192.168.1.100:5011`) from another device will **NOT work** - AudioWorklet will be blocked.

---

## 🖥️ Desktop vs Mobile Behavior

### Common Misconception

> "Mobile doesn't support time-stretch/pitch-shift"

**This is FALSE!** Mobile uses the **same Web Audio API + SoundTouch** architecture as desktop.

Both platforms require HTTPS:

| Platform | Architecture | HTTPS Required |
|----------|--------------|----------------|
| **Desktop** | Web Audio API + SoundTouch | ✅ Yes |
| **Mobile** | Web Audio API + SoundTouch | ✅ Yes |

**Proof in code:**

**Desktop:** `static/js/mixer/audio-engine.js:177-217`
```javascript
if (window.simplePitchTempo && window.simplePitchTempo.workletLoaded) {
    stem.soundTouchNode = new AudioWorkletNode(this.audioContext, 'soundtouch-processor');
    // ...
}
```

**Mobile:** `static/js/mobile-app.js:2386-2395`
```javascript
if (stem.soundTouchNode) {
    const tempoParam = stem.soundTouchNode.parameters.get('tempo');
    const pitchParam = stem.soundTouchNode.parameters.get('pitch');
    // ...same SoundTouch integration!
}
```

**Both use identical SoundTouch worklet!**

---

## 🧪 Testing Audio Features

### Verify HTTPS Context

Open browser console and run:

```javascript
// Check if secure context
console.log('Secure context:', window.isSecureContext);  // Should be true

// Check AudioWorklet availability
console.log('AudioWorklet available:', !!(new AudioContext()).audioWorklet);

// Check SoundTouch loaded
console.log('SoundTouch loaded:', window.simplePitchTempo?.workletLoaded);
```

**Expected Output (HTTPS/localhost):**
```
Secure context: true
AudioWorklet available: true
SoundTouch loaded: true
```

**Expected Output (HTTP):**
```
Secure context: false
AudioWorklet available: false
SoundTouch loaded: false
```

### Test Time-Stretch

1. Load a song in the mixer
2. Click **BPM +** button (increase tempo)
3. Listen to the playback

**With HTTPS:**
- ✅ Tempo increases
- ✅ Pitch stays the same
- ✅ Audio quality remains high

**Without HTTPS (magneto mode):**
- ⚠️ Tempo increases
- ❌ Pitch increases too (chipmunk effect)
- ❌ Not independent control

### Test Pitch-Shift

1. Load a song in the mixer
2. Click **Key +** button (increase pitch)
3. Listen to the playback

**With HTTPS:**
- ✅ Pitch increases (transposed up)
- ✅ Tempo stays the same
- ✅ Clean transposition

**Without HTTPS:**
- ❌ Nothing happens
- ❌ Pitch control completely broken

---

## 🛠️ Troubleshooting

### "AudioWorklet not available" Warning

**Symptoms:**
```
[SimplePitchTempo] ⚠ AudioWorklet API not available
[SimplePitchTempo] → Non-secure context (not HTTPS or localhost)
```

**Solutions:**
1. ✅ Use ngrok tunnel: `./start_service.sh`
2. ✅ Access via localhost: `http://localhost:5011`
3. ✅ Set up nginx with SSL certificate
4. ❌ DO NOT use HTTP with LAN IP address

---

### "SoundTouch failed to load" Error

**Symptoms:**
```
[SimplePitchTempo] ✗ Failed to load SoundTouch AudioWorklet
Error: Failed to fetch
```

**Possible causes:**
1. **File missing:** Check `/static/wasm/soundtouch-worklet.js` exists
2. **404 error:** Verify file is served correctly
3. **CORS issue:** Ensure same-origin or correct CORS headers
4. **Cache issue:** Clear browser cache and reload

**Verify file exists:**
```bash
ls -la static/wasm/soundtouch-worklet.js
# Should show: -rw-rw-r-- ... 43038 ... soundtouch-worklet.js
```

---

### Mobile "Magneto Mode" Behavior

**Symptoms:**
- Mobile mixer shows tempo/pitch sliders
- Tempo slider works but affects pitch too
- Pitch slider does nothing

**Cause:** Accessing mobile site via HTTP (non-HTTPS)

**Solution:** Use ngrok URL instead of direct IP:
```
❌ http://192.168.1.100:5011/mobile  (HTTP - broken)
✅ https://definite-cockatoo-bold.ngrok-free.app/mobile  (HTTPS - works!)
```

---

## 📋 Quick Reference

### Deployment Checklist

- [ ] Application running on `localhost:5011`
- [ ] Ngrok configured in `.env`
- [ ] Service started with `./start_service.sh`
- [ ] HTTPS URL working (e.g., `https://xxx.ngrok-free.app`)
- [ ] Browser console shows "Secure context: true"
- [ ] SoundTouch worklet loaded successfully
- [ ] BPM control changes tempo WITHOUT pitch change
- [ ] Key control changes pitch WITHOUT tempo change

### Feature Availability Matrix

| Access Method | Secure Context | Time-Stretch | Pitch-Shift | Recommended |
|---------------|----------------|--------------|-------------|-------------|
| `https://xxx.ngrok-free.app` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ **Best** |
| `http://localhost:5011` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Dev only |
| `http://127.0.0.1:5011` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Dev only |
| `http://192.168.1.x:5011` | ❌ No | ❌ No | ❌ No | ❌ **Broken** |
| `http://yourdomain.com` | ❌ No | ❌ No | ❌ No | ❌ **Broken** |
| `https://yourdomain.com` (SSL) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Production |

---

## 🔗 Related Files

- **`core/config.py`** - Port configuration (PORT = 5011)
- **`start_service.sh`** - Service startup with ngrok tunnel
- **`.env`** - Ngrok URL configuration
- **`static/js/mixer/simple-pitch-tempo.js`** - BPM/Key controller
- **`static/js/mixer/audio-engine.js`** - Desktop audio engine
- **`static/js/mobile-app.js`** - Mobile audio engine
- **`static/wasm/soundtouch-worklet.js`** - SoundTouch AudioWorklet

---

## 📖 Additional Resources

- **Web Audio API Security:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- **AudioWorklet:** https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- **Secure Contexts:** https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- **Ngrok Documentation:** https://ngrok.com/docs
- **Let's Encrypt:** https://letsencrypt.org/getting-started/

---

**Last Updated:** December 2025
**Status:** Mandatory for Production Deployment
**Severity:** Critical - Core Features Broken Without HTTPS
