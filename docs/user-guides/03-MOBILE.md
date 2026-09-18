# StemTube Mobile Guide

Complete guide to using StemTube on iOS and Android devices.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installing as PWA](#installing-as-pwa)
- [Offline Mode](#offline-mode)
- [Mobile Features](#mobile-features)
- [iOS Specific](#ios-specific)
- [Android Specific](#android-specific)
- [Mobile Mixer](#mobile-mixer)
- [Performance Tips](#performance-tips)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Accessing Mobile Interface

**HTTPS Required**: Mobile features require HTTPS due to browser security policies.

**Step 1: Start with HTTPS**
```bash
cd StemTube_R2
./start_service.sh
```

**Step 2: Get ngrok URL**
Look for output in terminal:
```
ngrok tunnel active:
https://abc123.ngrok-free.app
```

**Step 3: Access on Mobile**
- Open browser on mobile device
- Navigate to: `https://your-subdomain.ngrok-free.app/mobile`
- Bookmark for easy access

**Supported Browsers**:
- **iOS**: Safari 14+, Chrome 90+
- **Android**: Chrome 90+, Firefox 88+, Samsung Internet

---

## Installing as PWA

StemTube can be installed as a Progressive Web App (PWA) for a native app-like experience.

### iOS Installation

1. Open the mobile interface in **Safari** (required for iOS PWA)
2. Navigate to: `https://your-subdomain.ngrok-free.app/mobile`
3. Tap the **Share** button (square with arrow)
4. Scroll down and tap **"Add to Home Screen"**
5. Name the app and tap **Add**
6. Launch StemTube from your home screen

### Android Installation

1. Open the mobile interface in **Chrome**
2. Navigate to: `https://your-subdomain.ngrok-free.app/mobile`
3. Look for the **"Install App"** button at the bottom of the screen
4. Tap **Install** in the prompt
5. Launch StemTube from your home screen or app drawer

**Alternative Method (Android)**:
- Tap the three-dot menu in Chrome
- Select **"Add to Home screen"** or **"Install app"**

### PWA Benefits

- **Standalone Mode**: No browser URL bar, full-screen experience
- **Home Screen Icon**: Launch like a native app
- **Offline Support**: Songs saved from the library play without a connection (see [Offline Mode](#offline-mode))
- **Faster Loading**: Core files cached locally
- **Splash Screen**: Branded loading screen on startup

---

## Offline Mode

Songs saved for offline play in the mobile mixer without a connection. Saving stores exactly
what the mixer requests: the song's meta, every stem (any model, including the 17 fine stems),
the metronome and the count-in files. The service worker (`static/sw.js`) always tries the
network first and only falls back to the saved copy when the server cannot be reached.

### How Offline Caching Works

1. **Manual Caching**: Tap the cache (download) button on a song in the library
2. **No Automatic Caching**: Playing a track does not cache its stems
3. **Offline Playback**: Saved songs open in the mixer offline; a count-in falls back to a plain start and the metronome sound cannot be changed until you reconnect
4. **Offline Banner**: A "You are offline" banner appears when disconnected

### Mobile Settings Tab

Access the **Settings** tab, **Offline Storage** card, to manage cached audio:

- **Enable offline cache**: Toggle caching on or off
- **Max storage**: Set the maximum cache size (100 MB to 2 GB)
- **Storage used**: See total storage used by cached stems
- **Clear**: Remove all cached audio to free storage

### Caching Audio for Offline

1. Open the **Library**
2. Tap the cache button on a song
3. Wait for the "saved for offline" toast
4. Tap the button again to remove the song from the cache

### Storage Considerations

- **Stems**: Each extracted song uses 20-50 MB
- **Recommended**: Keep 500 MB - 1 GB free for caching
- **Clear Cache**: Use Settings tab when storage is low

---

## Mobile Features

### Optimized Mobile Interface

The mobile interface (`/mobile` route) provides:

**Touch-Optimized Controls**:
- Large touch targets (minimum 44x44px)
- Responsive sliders and buttons
- Swipe gestures for timeline navigation
- Pinch-to-zoom on waveform

**Compact Layout**:
- Vertical stacking for portrait mode
- Collapsible sections to save screen space
- Focused lyrics view (current line + 2 previous)
- Minimal chrome, maximum content

**Platform-Specific Fixes**:
- **iOS**: Audio unlock mechanism, Web Audio API restrictions
- **Android**: Touch event handling, playback controls
- **Cross-Platform**: Consistent experience across devices

**Shared Transport**:
- Pitch/tempo/playback synchronized across tabs
- Open mixer on desktop, control from mobile
- Or vice versa - settings shared via LocalStorage

### Mobile vs Desktop

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Audio Engine | Web Audio API (POC engine) | Web Audio API (same POC engine) |
| Waveform | Full detail | Simplified |
| Lyrics | Full view | Focused (3 lines) |
| Chords | Timeline display | Compact progression |
| Touch | Mouse | Touch-optimized |
| Screen | Wide layout | Vertical stack |

---

## iOS Specific

### iOS Audio Unlock

**iOS Restriction**: Safari requires user interaction before audio playback.

**StemTube Solution**: Automatic unlock mechanism

**How It Works**:
1. First time visiting page: "Tap to enable audio" button appears
2. Tap button: iOS audio unlocked
3. Subsequent visits: Audio works automatically
4. Unlock state preserved in session

**Manual Unlock** (if automatic fails):
1. Tap anywhere on page
2. Click play button
3. iOS audio should unlock

**Troubleshooting iOS Audio**:
- **No sound**: Ensure ringer/silent switch is OFF (not in silent mode)
- **First play fails**: Tap screen, then play again
- **Audio cuts out**: Avoid locking screen during playback
- **Background playback**: Not supported (browser limitation)

### iOS Safari Quirks

**Playback Controls**:
- Use native iOS audio controls (appears in Control Center)
- Lock screen controls available
- AirPlay supported

**PWA Support** (Add to Home Screen):
1. Open mobile interface in Safari
2. Tap Share button
3. Select "Add to Home Screen"
4. Launch as standalone app

**iOS Versions**:
- iOS 14+: Full support
- iOS 13: Partial support (some Web Audio API limitations)
- iOS 12 and below: Not supported

### iOS Performance

**Recommended Settings**:
- Close background apps
- Ensure sufficient storage (2+ GB free)
- Use WiFi for downloads (not cellular)
- Disable Low Power Mode during playback

**Battery Life**:
- Stem extraction: Heavy battery usage (plug in recommended)
- Mixer playback: Moderate usage (2-3 hours typical)
- Background: Minimal usage

---

## Android Specific

### Android Audio

**Audio Engine**: Web Audio API — the same POC engine as the desktop mixer

**Playback**:
- No unlock required (unlike iOS)
- Immediate playback on page load (if autoplay enabled)
- Background playback supported (browser dependent)

**Supported Browsers**:
- Chrome 90+ (recommended)
- Firefox 88+
- Samsung Internet 14+
- Edge 90+

### Android Touch Handling

**Touch Events**: Custom handlers for responsive controls

**Features**:
- Fast touch response
- Gesture support (swipe, pinch)
- Prevent accidental double-tap zoom
- Scroll-lock during slider adjustment

**Troubleshooting Android Touch**:
- **Controls not responding**: Clear browser cache, reload page
- **Slider jumps**: Use slower touch movements
- **Accidental zoom**: Double-tap zoom disabled in mixer

### Android Performance

**Chrome Recommended**: Best performance and compatibility

**Performance Tips**:
- Close background apps
- Use "Lite" mode in Chrome for slower devices
- Disable Chrome Data Saver (can interfere with WebSocket)
- Clear cache regularly

**Low-End Devices**:
- 4-stem models work best
- Reduce waveform detail (automatic)
- Disable chords display if slow

---

## Mobile Mixer

### Mobile Mixer Interface

**Layout** (Vertical Stack):
```
┌─────────────────────┐
│   Playback Controls  │ ← Play/Pause, Time
├─────────────────────┤
│   Timeline          │ ← Waveform + Playhead
├─────────────────────┤
│   Current Chords    │ ← Chord progression
├─────────────────────┤
│   Lyrics (Focused)  │ ← Current + 2 previous lines
├─────────────────────┤
│   Track Controls    │ ← Volume sliders (collapsible)
│     Vocals          │
│     Drums           │
│     Bass            │
│     Other           │
├─────────────────────┤
│   Global Controls   │ ← Pitch, Tempo, Master Volume
└─────────────────────┘
```

### Touch Gestures

**Timeline**:
- **Tap**: Seek to position
- **Drag**: Scrub through song
- **Swipe left/right**: Jump ±10 seconds
- **Pinch**: Zoom waveform (experimental)

**Sliders**:
- **Drag**: Adjust value
- **Tap above/below**: Increment/decrement
- **Double-tap**: Reset to default

**Track Controls**:
- **Tap track name**: Expand/collapse controls
- **Swipe track**: Quick mute toggle

### Mobile-Specific Features

**Simplified Waveform**:
- Lower detail for faster rendering
- Still shows peaks
- Color-coded by stem

**Focused Lyrics**:
- Current line highlighted
- Previous 2 lines in gray
- Upcoming lines hidden (tap to expand)
- Auto-scroll follows playback

**Compact Chord Display**:
- Timeline progression (horizontal)
- Current chord highlighted
- Previous/next chords visible
- Tap chord to see full name

**Collapsible Sections**:
- Tap section header to expand/collapse
- Saves screen space
- Settings remembered

### Shared State Across Devices

**How It Works**:
- Mixer settings saved to LocalStorage
- LocalStorage scoped to domain (same for mobile and desktop)
- Changes on one device reflected on other

**Synchronized Settings**:
- Track volumes, pan, solo, mute
- Pitch shift, tempo
- Current playback position (on close/open)

**Use Cases**:
- Start mixer on desktop, continue on mobile
- Adjust settings on mobile, see changes on desktop
- Collaborate: Multiple users control same mixer

---

## Performance Tips

### Optimizing Mobile Experience

**WiFi Recommended**:
- Stem extraction: Large data transfer (100+ MB)
- File uploads: Audio files (5-30 MB typical)
- Mixer: Real-time WebSocket updates

**Cellular Usage**:
- Downloads work (may be slow)
- Stem extraction: Not recommended (heavy data)
- Mixer playback: Works (streaming ~1 MB/min)

**Battery Optimization**:
- Plug in during stem extraction
- Reduce screen brightness
- Close background apps
- Disable location services

**Storage Management**:
- Downloads: 5-10 MB per song
- Stems: 20-50 MB per extraction
- Clear old downloads regularly
- Use "Delete" to free space

### Browser Settings

**Chrome (Android)**:
- Settings → Site Settings → StemTube URL
- ✅ Allow JavaScript
- ✅ Allow Sound
- ✅ Allow Popups (for mixer)
- ❌ Disable Data Saver (interferes with WebSocket)

**Safari (iOS)**:
- Settings → Safari → Advanced
- ✅ Enable JavaScript
- ✅ Block Pop-ups: OFF (for mixer)
- Settings → Safari → Privacy
- ❌ Prevent Cross-Site Tracking: OFF (for ngrok)

---

## Troubleshooting

### Common Mobile Issues

#### "This site can't be reached"

**Causes**:
- ngrok tunnel closed
- Mobile device on different network
- Firewall blocking connection

**Solutions**:
1. Check ngrok still running on server
2. Ensure mobile device has internet access
3. Try different network (WiFi vs cellular)
4. Restart ngrok: `./start_service.sh`

#### Audio Not Playing (iOS)

**Causes**:
- Silent mode enabled
- Audio not unlocked
- Browser restriction

**Solutions**:
1. Check ringer/silent switch (should be OFF)
2. Tap "Enable Audio" button
3. Tap screen, then play
4. Refresh page and try again
5. Try different browser (Chrome instead of Safari)

#### Audio Not Playing (Android)

**Causes**:
- Do Not Disturb mode
- Media volume muted
- Browser permission denied

**Solutions**:
1. Check media volume (use volume buttons)
2. Disable Do Not Disturb
3. Grant audio permission: Settings → Apps → Browser → Permissions
4. Try different browser

#### Slow Performance

**Causes**:
- Low-end device
- Too many background apps
- Poor network connection
- Browser cache full

**Solutions**:
1. Close background apps
2. Clear browser cache
3. Use WiFi instead of cellular
4. Try simpler model (htdemucs instead of htdemucs_6s or mvsep_mega_fine - 17 stems is heavy on a phone)
5. Disable chords display

#### Controls Not Responding

**Causes**:
- Touch events not registered
- JavaScript error
- Browser compatibility

**Solutions**:
1. Reload page (pull down to refresh)
2. Clear browser cache
3. Try different browser
4. Check console for errors (enable Developer Mode)

#### WebSocket Disconnects

**Causes**:
- Network interruption
- ngrok rate limiting
- Server restart

**Solutions**:
1. Check network connection
2. Refresh page to reconnect
3. Wait a few seconds, try again
4. Check server logs for errors

#### Mixer Not Loading

**Causes**:
- Extraction not complete
- Browser pop-up blocker
- JavaScript disabled

**Solutions**:
1. Ensure extraction finished (check status)
2. Disable pop-up blocker for StemTube domain
3. Enable JavaScript in browser settings
4. Try opening mixer in new tab manually: `/mixer/<download_id>`

#### Cached Song Won't Play Offline

**Cause**: The song was saved before the offline fix (old copies are removed), the save did not
finish, or the server is unreachable while the phone still reports being online.

**Solution**: Open `/mobile` online, save the song again and wait for the "saved for offline"
toast (see [Offline Mode](#offline-mode)).

#### Recording Fails to Decode (iOS)

**How it works**: When the browser cannot decode a recorded take directly, `recording-utils.js`
falls back to a server-side conversion at `/api/recordings/convert` (ffmpeg converts the take to WAV).

**Cause of a failure**: the take is too large (over 64 MB), ffmpeg cannot decode it, or the
conversion times out - the server answers with a `413`, `422` or `504` error.

**Solution**: Record shorter takes, check the server log for `[RECORDINGS]` lines, or record from
the desktop mixer instead.

---

## Mobile Architecture

### Technical Details (For Developers)

**Audio engine**: the mobile PWA runs the same POC Web Audio engine as the desktop mixer
(`static/js/poc/audio.js`, SoundTouch worklet), wired to the mobile UI by
`static/js/mixer/mobile-poc-engine.js`. The older `mobile-audio-engine.js` (HTML5 `<audio>`
elements) and the `mobile-*-fix.js` series are no longer loaded by any page.

**Main mobile modules**: `mobile-app.js` (navigation, library, mixer, chords, lyrics, jam),
`mobile-constants.js`, `mobile-guitar-diagram.js`, `mobile-neumorphic-dial.js`,
`mobile-admin.js`, `mobile-recording.js`, `mobile-metronome.js`.

**Backend**:
- Separate route: `/mobile` (mobile_routes.py)
- Same API endpoints as desktop
- Jam guests are served this same PWA (`/jam/<code>`)

See the [Frontend Guide](../developer-guides/FRONTEND-GUIDE.md) for the technical details.

---

## Next Steps

**Learn More**:
- [Usage Guide](02-USAGE.md) - How to use all features
- [Troubleshooting](05-TROUBLESHOOTING.md) - Common issues and solutions
- [Frontend Guide](../developer-guides/FRONTEND-GUIDE.md) - Mobile PWA and mixer engine

**Advanced Features**:
- [Chord Detection](../feature-guides/CHORD-DETECTION.md) - Automatic chord recognition
- [Processing Flow](../PROCESSING_FLOW.md) - Lyrics pipeline (LRCLIB + Whisper)

---

**Enjoy StemTube on mobile!** 🎉

Practice karaoke anywhere, anytime.
