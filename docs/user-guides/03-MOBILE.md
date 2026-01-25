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
cd StemTube-dev
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
- **Offline Support**: Access cached audio without internet
- **Faster Loading**: Core files cached locally
- **Splash Screen**: Branded loading screen on startup

---

## Offline Mode

StemTube supports offline playback of previously cached audio.

### How Offline Mode Works

1. **Automatic Caching**: When you play a track, audio files are automatically cached
2. **Manual Caching**: Use the Settings tab to explicitly cache tracks
3. **Offline Playback**: Cached tracks are available without internet connection
4. **Offline Banner**: A "You are offline" banner appears when disconnected

### Mobile Settings Tab

Access the **Settings** tab in the mobile interface to manage offline audio:

**Cache Management**:
- **View Cache Size**: See total storage used by cached audio
- **Clear Audio Cache**: Remove all cached audio to free storage
- **Cache Specific Tracks**: Manually cache tracks for offline use

**Settings Options**:
- **Auto-cache**: Toggle automatic caching of played tracks
- **Cache Quality**: Choose between standard and high quality caching
- **Storage Limit**: Set maximum cache size

### Caching Audio for Offline

**Automatic** (Default):
- Audio is cached as you listen
- Recent tracks available offline

**Manual**:
1. Open the track in the mixer
2. Go to **Settings** tab
3. Tap **"Cache for Offline"**
4. Track is now available offline

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
| Audio Engine | Web Audio API | HTML5 Audio Elements |
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

**Audio Engine**: HTML5 Audio Elements (consistent across browsers)

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
- Disable chords/structure if slow

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
- Still shows peaks and structure
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
4. Try simpler model (htdemucs instead of htdemucs_6s)
5. Disable chords/structure display

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

---

## Mobile Architecture

### Technical Details (For Developers)

**9 Mobile-Specific JavaScript Modules**:
1. `mobile-audio-engine.js` - HTML5 Audio Elements engine
2. `mobile-touch-fix.js` - Touch event handling improvements
3. `mobile-debug-fix.js` - Android-style controls with iOS debugging
4. `mobile-playhead-fix.js` - Missing playhead methods
5. `mobile-audio-fixes.js` - iOS unlock and Android playhead
6. `mobile-direct-fix.js` - Direct and simple mobile fix
7. `mobile-audio-patch.js` - iOS variables patch
8. `mobile-simple-fixes.js` - Simple mobile fixes

**Backend**:
- Separate route: `/mobile` (mobile_routes.py)
- Same API endpoints as desktop
- Mobile-optimized templates

**Audio Engine Differences**:
- Desktop: Web Audio API (AudioContext, AudioWorklet)
- Mobile: HTML5 Audio Elements (`<audio>` tags)
- Reason: Better compatibility and battery life

See [Mobile Architecture Guide](../feature-guides/MOBILE-ARCHITECTURE.md) for technical deep dive.

---

## Next Steps

**Learn More**:
- [Usage Guide](02-USAGE.md) - How to use all features
- [Troubleshooting](05-TROUBLESHOOTING.md) - Common issues and solutions
- [Mobile Architecture](../feature-guides/MOBILE-ARCHITECTURE.md) - Technical details

**Advanced Features**:
- [Pitch/Tempo Control](../feature-guides/PITCH-TEMPO-CONTROL.md) - Change key and speed
- [Chord Detection](../feature-guides/CHORD-DETECTION.md) - Automatic chord recognition
- [Lyrics & Karaoke](../feature-guides/LYRICS-KARAOKE.md) - Synchronized lyrics

---

**Enjoy StemTube on mobile!** 🎉

Practice karaoke anywhere, anytime.
