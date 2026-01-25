// StemTube Service Worker v2.1 - Fixed stems cache-first for API
const CACHE_NAME = 'stemtube-v2.1';
const STEMS_CACHE_NAME = 'stemtube-stems-v1';

// Stem file names to cache (no ZIP, no source)
const STEM_FILES = ['vocals.mp3', 'bass.mp3', 'drums.mp3', 'guitar.mp3', 'piano.mp3', 'other.mp3'];

// Files to cache immediately on install
const PRECACHE_FILES = [
  '/mobile',
  '/static/css/mobile-style.css',
  '/static/js/mobile-app.js',
  '/static/js/app-extensions.js',
  '/static/js/pwa-init.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install: precache essential files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v2...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching app shell');
        return cache.addAll(PRECACHE_FILES);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v2...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !name.startsWith('stemtube-'))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Check if URL is a stem file (not ZIP, not source)
function isStemFile(pathname) {
  // Match /api/extracted_stems/{id}/{stem} pattern
  if (pathname.startsWith('/api/extracted_stems/')) {
    const parts = pathname.split('/');
    if (parts.length >= 4) {
      const stemName = parts[parts.length - 1];
      return STEM_FILES.some(stem => stem.replace('.mp3', '') === stemName);
    }
  }
  // Also match older /stems/ pattern
  if (pathname.includes('/stems/')) {
    if (pathname.endsWith('.zip')) return false;
    return STEM_FILES.some(stem => pathname.endsWith(stem));
  }
  return false;
}

// Fetch: smart caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // IMPORTANT: Check for stem files BEFORE skipping API calls
  // Stem files: cache-first (only stem MP3s, not ZIP or source)
  if (isStemFile(url.pathname)) {
    event.respondWith(
      caches.open(STEMS_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) {
            console.log('[SW] Stem from cache:', url.pathname);
            return cached;
          }
          // Fetch with credentials for authenticated endpoints
          return fetch(event.request, { credentials: 'include' }).then((response) => {
            // Don't auto-cache on fetch - only cache via explicit CACHE_SONG message
            return response;
          });
        });
      })
    );
    return;
  }

  // Skip other API calls (always fetch fresh)
  if (url.pathname.startsWith('/api/')) return;

  // Static files: cache-first
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages: network-first with fallback
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'CACHE_SONG':
      // Cache all stems for a song
      cacheSongStems(data.stemUrls, data.songId).then((result) => {
        event.ports[0]?.postMessage(result);
      });
      break;

    case 'REMOVE_SONG':
      // Remove cached stems for a song
      removeSongFromCache(data.songId).then((result) => {
        event.ports[0]?.postMessage(result);
      });
      break;

    case 'GET_CACHED_SONGS':
      // Get list of cached songs
      getCachedSongs().then((songs) => {
        event.ports[0]?.postMessage({ songs });
      });
      break;

    case 'GET_CACHE_STATS':
      // Get cache statistics
      getCacheStats().then((stats) => {
        event.ports[0]?.postMessage(stats);
      });
      break;

    case 'CLEAR_STEMS_CACHE':
      // Clear all cached stems
      caches.delete(STEMS_CACHE_NAME).then(() => {
        console.log('[SW] Stems cache cleared');
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'CHECK_SONG_CACHED':
      // Check if a specific song is cached
      isSongCached(data.songId).then((cached) => {
        event.ports[0]?.postMessage({ cached });
      });
      break;
  }
});

// Cache all stems for a song
async function cacheSongStems(stemUrls, songId) {
  try {
    const cache = await caches.open(STEMS_CACHE_NAME);
    let cachedCount = 0;
    let totalSize = 0;

    for (const url of stemUrls) {
      try {
        // Include credentials for authenticated endpoints
        const response = await fetch(url, { credentials: 'include' });
        if (response.ok) {
          await cache.put(url, response.clone());
          const blob = await response.blob();
          totalSize += blob.size;
          cachedCount++;
          console.log('[SW] Cached stem:', url);
        } else {
          console.warn('[SW] Failed to fetch stem:', url, response.status);
        }
      } catch (err) {
        console.error('[SW] Failed to cache:', url, err);
      }
    }

    console.log(`[SW] Cached ${cachedCount} stems for song ${songId}, total: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    return { success: true, cachedCount, totalSize, songId };
  } catch (err) {
    console.error('[SW] Cache song error:', err);
    return { success: false, error: err.message };
  }
}

// Remove a song from cache
async function removeSongFromCache(songId) {
  try {
    const cache = await caches.open(STEMS_CACHE_NAME);
    const keys = await cache.keys();
    let removedCount = 0;

    for (const request of keys) {
      if (request.url.includes(songId)) {
        await cache.delete(request);
        removedCount++;
      }
    }

    console.log(`[SW] Removed ${removedCount} cached files for song ${songId}`);
    return { success: true, removedCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Get list of cached songs (unique song IDs)
async function getCachedSongs() {
  try {
    const cache = await caches.open(STEMS_CACHE_NAME);
    const keys = await cache.keys();
    const songs = new Map();

    for (const request of keys) {
      const url = new URL(request.url);
      let songId = null;

      // Match /api/extracted_stems/{id}/{stem} pattern
      const apiMatch = url.pathname.match(/\/api\/extracted_stems\/([^/]+)\//);
      if (apiMatch) {
        songId = apiMatch[1];
      } else {
        // Also match older /audio/{id}/stems/ pattern
        const audioMatch = url.pathname.match(/\/audio\/([^/]+)\/stems\//);
        if (audioMatch) {
          songId = audioMatch[1];
        }
      }

      if (songId) {
        if (!songs.has(songId)) {
          songs.set(songId, { stemCount: 0, size: 0 });
        }
        const response = await cache.match(request);
        if (response) {
          const blob = await response.clone().blob();
          songs.get(songId).stemCount++;
          songs.get(songId).size += blob.size;
        }
      }
    }

    return Array.from(songs.entries()).map(([id, data]) => ({
      songId: id,
      stemCount: data.stemCount,
      size: data.size
    }));
  } catch (err) {
    console.error('[SW] Get cached songs error:', err);
    return [];
  }
}

// Check if a song is fully cached
async function isSongCached(songId) {
  try {
    const cache = await caches.open(STEMS_CACHE_NAME);
    const keys = await cache.keys();
    let stemCount = 0;

    for (const request of keys) {
      // Match both URL patterns
      const hasId = request.url.includes(songId);
      const isStem = request.url.includes('/stems/') || request.url.includes('/extracted_stems/');
      if (hasId && isStem) {
        stemCount++;
      }
    }

    // Consider cached if at least 4 stems are present
    return stemCount >= 4;
  } catch (err) {
    return false;
  }
}

// Get cache statistics
async function getCacheStats() {
  try {
    const cache = await caches.open(STEMS_CACHE_NAME);
    const keys = await cache.keys();
    let totalSize = 0;
    let fileCount = 0;

    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.clone().blob();
        totalSize += blob.size;
        fileCount++;
      }
    }

    const songs = await getCachedSongs();

    return {
      totalSize,
      fileCount,
      songCount: songs.length,
      songs
    };
  } catch (err) {
    return { totalSize: 0, fileCount: 0, songCount: 0, songs: [] };
  }
}
