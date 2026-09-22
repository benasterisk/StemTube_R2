// StemTube Service Worker v2.42 - offline playback through the POC mixer routes
//
// Registered only by static/js/pwa-init.js (mobile page), scope "/".
//
// Caches:
//   SHELL_CACHE  app shell (HTML, JS, CSS, worklet, CDN libs). Keys never carry the
//                ?v=<cache_buster> query string: the template stamps a new one on
//                every render, so keying on it would grow the cache forever and
//                never match offline.
//   SONGS_CACHE  songs saved for offline by StemCache.cacheSong() (pwa-init.js):
//                exactly the URLs the POC engine requests - /poc-mixer/meta/<job>,
//                /poc-mixer/audio/<job>/<stem> (stems + metronome variants) - plus
//                one manifest per song (/poc-mixer/__offline__/<job>), written LAST,
//                which marks the save as complete.
const SHELL_CACHE = 'stemtube-v2.42';
const SONGS_CACHE = 'stemtube-songs-v2';   // keep in sync with pwa-init.js

const MANIFEST_PREFIX = '/poc-mixer/__offline__/';

// Every same-origin asset templates/mobile-index.html loads (<link>/<script>), the
// CSS files mobile-style.css pulls in with @import, and the SoundTouch worklet the
// POC engine loads with audioWorklet.addModule() (static/js/poc/audio.js).
const PRECACHE_FILES = [
  '/mobile',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/css/mobile-style.css',
  '/static/css/mobile/base.css',
  '/static/css/mobile/mixer.css',
  '/static/css/mobile/lyrics.css',
  '/static/css/mobile/chords.css',
  '/static/css/mobile/controls.css',
  '/static/css/mobile/admin.css',
  '/static/css/mobile/settings.css',
  '/static/css/mobile/neumorphic.css',
  '/static/css/mobile/glassmorphism.css',
  '/static/css/mobile/cyberpunk.css',
  '/static/css/mobile/recording.css',
  '/static/css/jam.css',
  '/static/js/lib/lame.min.js',
  '/static/wasm/soundtouch.js',
  '/static/wasm/soundtouch-worklet.js',
  '/static/js/mixer/mix-exporter.js',
  '/static/js/jam-client.js',
  '/static/js/poc/api.js',
  '/static/js/poc/audio.js',
  '/static/js/poc/precount.js',
  '/static/js/poc/loop.js',
  '/static/js/mixer/mobile-poc-engine.js',
  '/static/js/mobile-metronome.js',
  '/static/js/theme-generator.js',
  '/static/js/spectrum-picker.js',
  '/static/js/follow-scroll.js',
  '/static/js/mobile-constants.js',
  '/static/js/mobile-guitar-diagram.js',
  '/static/js/mobile-neumorphic-dial.js',
  '/static/js/recording-utils.js',
  '/static/js/mobile-recording.js',
  '/static/js/mobile-app.js',
  '/static/js/mobile-admin.js',
  '/static/js/pwa-init.js',
];

// Pinned third-party files. Without socket.io the mobile app throws in initSocket()
// and never reaches the offline library, so these are part of the shell.
const CDN_FILES = [
  'https://cdn.socket.io/4.5.4/socket.io.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
];
const CDN_HOSTS = ['cdn.socket.io', 'cdnjs.cloudflare.com'];

// ---------------------------------------------------------------------------
// Install / activate
// ---------------------------------------------------------------------------

// One asset at a time and failures tolerated: cache.addAll() rejects the whole
// install if a single file 404s (or /mobile redirects to the login page), which
// would leave the previous, stale worker in charge.
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(PRECACHE_FILES.map(async (path) => {
    try {
      const response = await fetch(new Request(path, { cache: 'reload', credentials: 'same-origin' }));
      if (response.ok && !response.redirected) await cache.put(path, response);
    } catch (err) {
      console.warn('[SW] Precache failed:', path, err && err.message);
    }
  }));
  await Promise.all(CDN_FILES.map(async (url) => {
    try {
      // no-cors: the page loads these through plain <script>/<link> tags
      const response = await fetch(new Request(url, { mode: 'no-cors' }));
      if (response.ok || response.type === 'opaque') await cache.put(url, response);
    } catch (err) {
      console.warn('[SW] Precache failed:', url, err && err.message);
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, SONGS_CACHE];
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => !keep.includes(name))
        .map((name) => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        })))
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Background cache write: a failed put (quota, opaque edge cases) must never break
// the response already being returned to the page.
function keepAlive(event, promise) {
  const settled = promise.catch((err) => console.warn('[SW] Cache write failed:', err && err.message));
  try { event.waitUntil(settled); } catch (err) { /* event already finished: write continues */ }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Gateway errors mean the server is unreachable (tunnel down, proxy up): treat them
// like a network failure. Any other status is the server's real answer.
function isGatewayError(response) {
  return response.status === 502 || response.status === 503 || response.status === 504;
}

// /poc-mixer/<kind>/<job>[/<stem>] -> { kind, job, stem }. The job is the decoded
// extraction id (api.js sends it through encodeURIComponent).
function parsePocPath(pathname) {
  const m = pathname.match(/^\/poc-mixer\/(prepare|progress|meta|audio|detect_intro|set_metro_instrument)\/(.+)$/);
  if (!m) return null;
  let rest = m[2];
  let stem = null;
  if (m[1] === 'audio') {
    const cut = rest.lastIndexOf('/');
    if (cut <= 0) return null;
    stem = rest.slice(cut + 1);
    rest = rest.slice(0, cut);
  }
  try {
    return { kind: m[1], job: decodeURIComponent(rest), stem };
  } catch (err) {
    return null;
  }
}

async function songManifest(job) {
  const cache = await caches.open(SONGS_CACHE);
  return cache.match(MANIFEST_PREFIX + encodeURIComponent(job));
}

// Cached copy of a saved song's meta/audio. Only complete saves (manifest present)
// are served. ignoreSearch: the engine may add a ?v=<tag> cache-buster to metronome
// ids; offline the saved copy is the only one there is.
async function cachedSongFile(request, job) {
  if (!(await songManifest(job))) return null;
  const cache = await caches.open(SONGS_CACHE);
  const url = new URL(request.url);
  return cache.match(url.origin + url.pathname, { ignoreSearch: true, ignoreVary: true });
}

// Network-first for the POC routes. Online the server answer is always used (never a
// stale saved copy); the saved copy is only a fallback when the network fails.
async function handlePoc(event, poc) {
  const request = event.request;
  let response = null;
  try {
    response = await fetch(request);
    if (!isGatewayError(response)) return response;
  } catch (err) {
    response = null;
  }

  const offlineMsg = 'Offline: this song has not been saved for offline playback';
  switch (poc.kind) {
    case 'prepare':
      // Mirror routes/poc_mixer.py prepare(): {job, cached}
      if (await songManifest(poc.job)) return jsonResponse({ job: poc.job, cached: true });
      return response || jsonResponse({ error: offlineMsg }, 503);

    case 'progress':
      // Mirror _set_prep(): {stage, pct, done, error}; mobile-poc-engine.js breaks on done
      if (await songManifest(poc.job)) {
        return jsonResponse({ stage: 'done', pct: 100, done: true, error: null });
      }
      return response || jsonResponse({ stage: 'error', pct: 0, done: true, error: offlineMsg }, 503);

    case 'meta': {
      const cached = await cachedSongFile(request, poc.job);
      if (cached) return cached;
      return response || jsonResponse({ error: offlineMsg }, 503);
    }

    case 'audio': {
      // Cached bodies are always full 200 responses (decodeAudioData needs the whole
      // file); a Range header on the request is simply not honoured from cache.
      const cached = await cachedSongFile(request, poc.job);
      if (cached) return cached;
      if (response) return response;
      return Response.error();
    }

    default:
      // detect_intro / set_metro_instrument need the server. Answer with the JSON error
      // shape the POC modules already handle (plan.error) instead of a rejected fetch,
      // so a count-in request while offline degrades to a plain start.
      return response || jsonResponse({ error: 'Offline: needs a connection to the server' }, 503);
  }
}

// Same-origin static asset: network-first, cached copy only when the network fails.
// Cache-first is not safe here even for unversioned URLs: the POC ES-module imports
// (./audio.js...) and the CSS @import files never carry ?v=, so a cache-first copy
// would survive every deploy (and hard reloads). The copy is stored without the
// query string so it still matches offline whatever ?v= the page asks for.
async function handleStatic(event, url) {
  const request = event.request;
  const key = url.origin + url.pathname;
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      keepAlive(event, cache.put(key, response.clone()));
      return response;
    }
    if (!isGatewayError(response)) return response;
    const cached = await cache.match(key, { ignoreSearch: true });
    return cached || response;
  } catch (err) {
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

// Pinned CDN files (and the webfonts the Font Awesome CSS pulls in): cache-first.
async function handleCdn(event) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') keepAlive(event, cache.put(request, response.clone()));
  return response;
}

// App-shell pages ("/" renders the mobile page on phones; the manifest start_url is
// /mobile): network-first, cached copy when offline. Query strings (?tab=...) render
// the same page, so the key is the path. Other pages are not intercepted: they need
// the server anyway, and keying e.g. /mixer?extraction_id=... by path would replay
// another song's page.
const SHELL_PAGES = ['/', '/mobile'];

async function handleShellPage(event, url) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // A redirect (e.g. to /login) or an error page must not replace the app shell.
    if (response.ok && !response.redirected) {
      keepAlive(event, cache.put(url.origin + url.pathname, response.clone()));
    }
    return response;
  } catch (err) {
    const cached = await cache.match(url.origin + url.pathname, { ignoreSearch: true })
      || await cache.match('/mobile', { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // ngrok free-tier fix: add bypass header to socket.io polling requests
  // iOS Safari doesn't propagate the ngrok bypass cookie to XHR requests,
  // so socket.io polling fails. Intercept and re-fetch with the header.
  if (sameOrigin && url.pathname.startsWith('/socket.io/')) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set('ngrok-skip-browser-warning', 'true');
    const modifiedRequest = new Request(request, { headers: newHeaders });
    event.respondWith(fetch(modifiedRequest));
    return;
  }

  if (sameOrigin && url.pathname.startsWith('/poc-mixer/')) {
    const poc = parsePocPath(url.pathname);
    if (poc) {
      const method = request.method;
      const isPost = poc.kind === 'prepare' || poc.kind === 'detect_intro'
        || poc.kind === 'set_metro_instrument';
      if ((isPost && method === 'POST') || (!isPost && method === 'GET')) {
        event.respondWith(handlePoc(event, poc));
      }
    }
    return;   // other /poc-mixer/* routes (export, downloads...): network only
  }

  if (request.method !== 'GET') return;

  if (!sameOrigin) {
    if (CDN_HOSTS.includes(url.hostname)) event.respondWith(handleCdn(event));
    return;
  }

  // Other API calls: always fresh, never cached
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(handleStatic(event, url));
    return;
  }

  const isPage = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  if (isPage && SHELL_PAGES.includes(url.pathname)) {
    event.respondWith(handleShellPage(event, url));
  }
});
