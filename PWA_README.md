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

Saving a song for offline (library button) stores exactly what the mobile mixer requests,
so it plays back without a connection:

- **What is saved** (`StemCache.cacheSong()` in `static/js/pwa-init.js`, cache
  `stemtube-songs-v2`): the song is prepared on the server (`/poc-mixer/prepare` + `progress`),
  then `/poc-mixer/meta/<job>` and every `/poc-mixer/audio/<job>/<stem>` listed in the meta
  (all stems, whatever the model, plus the metronome, its other resolutions and the baked
  count-in files). A manifest (`/poc-mixer/__offline__/<job>`) is written last; a save without
  it is incomplete and is never served. If a required file fails, the partial save is deleted.
- **How it is served** (`static/sw.js`): `/poc-mixer/*` is always network-first. Only when the
  network fails (or answers 502/503/504) does the service worker answer from the saved copy:
  `prepare`/`progress` report the song as ready, `meta`/`audio` come from the cache (query string
  ignored), and `detect_intro` / `set_metro_instrument` return a JSON error, so a count-in
  degrades to a plain start.
- **App shell**: the precache list mirrors the tags of `templates/mobile-index.html` (plus the
  CSS `@import` files, the SoundTouch worklet and the socket.io / Font Awesome CDN files), fetched
  one by one so a single failure does not abort the install. Static files are network-first with
  the cached copy (stored without `?v=`) as offline fallback; `/` and `/mobile` likewise.

Limits:
- Songs saved before the service worker v2.40 must be saved again (old copies are removed).
- A save is a snapshot: re-extracting, moving the count-in Start or changing the metronome sound
  afterwards needs the song to be removed and saved again; the last two also need the server.
- A server that is down while the phone is online (e.g. tunnel page with another status) is not
  treated as offline.
- Recordings are not saved for offline; iOS may evict the storage.

### JavaScript API

```javascript
// Save a song for offline (prepare, meta, every stem and metronome file, then manifest)
await StemCache.cacheSong(songId, { title, onProgress });

// List cached songs and total size
const songs = await StemCache.getCachedSongs();
const stats = await StemCache.getStats();
console.log(StemCache.formatSize(stats.totalSize)); // "45.2 MB"

// Remove every saved song
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
