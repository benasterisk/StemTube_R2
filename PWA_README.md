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

## Integration

Already done in `templates/mobile-index.html` (manifest and theme-color in the `<head>`, `pwa-init.js` loaded near the end of the body). For reference:

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

> **⚠️ Known limitation: offline playback is currently broken.** Caching a song still works
> from the UI (the stems are downloaded into the `stemtube-stems-v1` cache), but the cached audio
> is never played back offline:
>
> - **Wrong URL pattern:** the mobile mixer streams stems through `/poc-mixer/audio/...`, while
>   `static/sw.js` only serves cached audio for `/api/extracted_stems/`, `/api/jam/stems/` and
>   `/stems/`. Mixer requests never hit the stem cache.
> - **Hard-coded stem names:** `sw.js` only knows six stems (`vocals`, `bass`, `drums`, `guitar`,
>   `piano`, `other`), so the 17 fine stems of `mvsep_mega_fine` (kick, snare, backing_vocals, ...)
>   are not recognised.
> - **Stale precache list:** `PRECACHE_FILES` in `sw.js` does not match what `/mobile` loads today
>   (split CSS files, mixer modules, jam scripts...), so a cold offline load of `/mobile` fails.
>
> Fixing it means routing `/poc-mixer/audio/` through the stem cache, deriving stem names from
> the extraction instead of a fixed list, and regenerating the precache list.

What does work today:
- CSS/JS files under `/static/` are cached as they are fetched (cache-first)
- Songs can be cached from the library, and cache stats / clearing work
- "You are offline" banner when disconnected

### JavaScript API

```javascript
// Cache all stems of a song (from the main thread, so auth cookies are sent)
await StemCache.cacheSong(songId, stemUrls);

// List cached songs and total size
const songs = await StemCache.getCachedSongs();
const stats = await StemCache.getStats();
console.log(StemCache.formatSize(stats.totalSize)); // "45.2 MB"

// Clear the stems cache
await StemCache.clearAll();

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
