# StemTube PWA - Integration Guide

## Files Created

```
static/
├── manifest.json          # PWA configuration (name, icons, colors)
├── sw.js                   # Service Worker (offline cache)
├── js/pwa-init.js          # Initialization (install prompt, navigation)
└── icons/
    ├── icon-192.png        # App icon
    └── icon-512.png        # High resolution icon
```

## Integration (3 lines to add)

In `templates/mobile-index.html`, add to the `<head>`:

```html
<!-- PWA Support -->
<link rel="manifest" href="/static/manifest.json">
<meta name="theme-color" content="#6c5ce7">
<script src="/static/js/pwa-init.js" defer></script>
```

## Testing

1. Restart the server
2. Open `/mobile` on your phone (via ngrok)
3. An "Install App" button should appear at the bottom right
4. Click it to install the app to your home screen

## PWA Features

### Standalone Mode
- No URL bar
- App opens in full screen
- Splash screen on startup

### Contained Navigation
- Back button closes modal / returns to menu
- Prevents accidental exits
- Double-tap back to actually quit

### Offline Mode
- CSS/JS files are cached
- Listened tracks are available offline
- "You are offline" banner when disconnected

### JavaScript API

```javascript
// Cache audio for offline playback
PWACache.cacheAudio('/audio/stems/xxx/vocals.mp3');

// Clear audio cache
PWACache.clearAudioCache();

// Get cache size
const size = await PWACache.getCacheSize();
console.log(PWACache.formatSize(size)); // "45.2 MB"

// Force installation
window.installPWA();
```

## Customization

### Change Colors
Edit `static/manifest.json`:
- `background_color`: Splash screen color
- `theme_color`: System bar color

### New Icons
Replace files in `static/icons/`:
- `icon-192.png`: 192x192px
- `icon-512.png`: 512x512px

## Debug

Open DevTools > Application > Service Workers
- View registered SW
- Force update
- View stored cache
