/**
 * StemTube PWA Initialization v2.0
 * Handles: Service Worker, Install Prompt, Navigation Containment, Offline Cache
 */

(function() {
    'use strict';

    // ========================================
    // User Settings (stored in localStorage)
    // ========================================

    const DEFAULT_SETTINGS = {
        cacheEnabled: true,
        maxCacheSizeMB: 500  // Default 500 MB
    };

    function getUserSettings() {
        try {
            const saved = localStorage.getItem('stemtube_pwa_settings');
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    }

    function saveUserSettings(settings) {
        localStorage.setItem('stemtube_pwa_settings', JSON.stringify(settings));
    }

    // ========================================
    // Service Worker Registration
    // ========================================

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js', {
                    scope: '/'
                });
                console.log('[PWA] Service Worker registered:', registration.scope);

                // Request persistent storage
                if (navigator.storage && navigator.storage.persist) {
                    const persistent = await navigator.storage.persist();
                    console.log('[PWA] Persistent storage:', persistent ? 'granted' : 'denied');
                }

                // A new service worker taking control means new shell files: reload once
                // so the open page runs them instead of the scripts it loaded earlier
                // (an installed PWA is rarely reloaded by hand).
                const hadController = !!navigator.serviceWorker.controller;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    // First install (no previous controller): the page already runs the
                    // current files, nothing to reload.
                    if (!hadController || window.__swReloading) return;
                    window.__swReloading = true;
                    location.reload();
                });
                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateNotification();
                        }
                    });
                });
            } catch (error) {
                console.error('[PWA] Service Worker registration failed:', error);
            }
        });
    }

    // ========================================
    // Offline Song Cache (POC mixer URLs)
    // ========================================
    //
    // A song saved for offline = exactly the URLs the POC engine requests when the
    // mobile mixer opens it (static/js/poc/api.js, audio.js, precount.js and
    // static/js/mixer/mobile-poc-engine.js), stored under the same keys so sw.js can
    // serve them when the network fails:
    //   /poc-mixer/meta/<job>
    //   /poc-mixer/audio/<job>/<stem>                   every meta.stems key (incl. metronome)
    //   /poc-mixer/audio/<job>/metronome_<res>          meta.metronome_resolutions (res != "1")
    //   /poc-mixer/audio/<job>/metronome_precount_<res> meta.precount.files
    //   /poc-mixer/audio/<job>/metronome_stop_<res>     meta.precount.stop_files
    // plus a manifest (/poc-mixer/__offline__/<job>) written LAST: sw.js only serves a
    // song whose manifest exists, so an interrupted save is never half-served.

    const SONGS_CACHE = 'stemtube-songs-v2';   // keep in sync with static/sw.js
    const MANIFEST_PREFIX = '/poc-mixer/__offline__/';
    const OFFLINE_SONGS_KEY = 'stemtube_offline_songs';   // mobile-app.js library metadata
    const EST_BYTES_PER_FILE = 6 * 1024 * 1024;   // ~4 min MP3 stem
    const PREPARE_TIMEOUT_MS = 20 * 60 * 1000;
    const FETCH_CONCURRENCY = 3;

    const enc = encodeURIComponent;   // same encoding as poc/api.js
    const metaUrl = (job) => `/poc-mixer/meta/${enc(job)}`;
    const audioUrl = (job, stem) => `/poc-mixer/audio/${enc(job)}/${stem}`;
    const manifestUrl = (job) => MANIFEST_PREFIX + enc(job);

    // Cache key URL -> job id (exact match: "download_1" must not also hit "download_12").
    function jobFromCacheUrl(href) {
        let path;
        try { path = new URL(href, location.origin).pathname; } catch { return null; }
        let m = path.match(/^\/poc-mixer\/(?:meta|__offline__)\/([^/]+)$/);
        if (!m) m = path.match(/^\/poc-mixer\/audio\/([^/]+)\/[^/]+$/);
        if (!m) return null;
        try { return decodeURIComponent(m[1]); } catch { return null; }
    }

    // The audio ids the engine fetches for this meta (setStems + PreCount.load).
    function audioIdsForMeta(meta) {
        const stems = Object.keys(meta.stems || {}).filter((n) => meta.stems[n]);
        const required = stems.slice();
        const optional = [];
        // audio.js only loads metronome variants when the metronome stem exists
        if (stems.includes('metronome')) {
            Object.keys(meta.metronome_resolutions || {})
                .filter((res) => res !== '1')
                .forEach((res) => optional.push(`metronome_${res}`));
            const pc = meta.precount;
            if (pc && pc.files) {
                Object.keys(pc.files).forEach((res) => optional.push(`metronome_precount_${res}`));
                Object.keys(pc.stop_files || {}).forEach((res) => optional.push(`metronome_stop_${res}`));
            }
        }
        return { stems, required, optional };
    }

    function dropOfflineMetadata(job) {
        try {
            const songs = JSON.parse(localStorage.getItem(OFFLINE_SONGS_KEY) || '{}');
            if (job === undefined) {
                localStorage.removeItem(OFFLINE_SONGS_KEY);
            } else if (songs[job]) {
                delete songs[job];
                localStorage.setItem(OFFLINE_SONGS_KEY, JSON.stringify(songs));
            }
        } catch { /* metadata is best-effort */ }
    }

    // Stored size: Content-Length when it describes the body as stored (not
    // compressed on the wire), else measured from the cached copy.
    async function storedSize(cache, url, headers) {
        const len = parseInt(headers.get('content-length') || '', 10);
        if (Number.isFinite(len) && len > 0 && !headers.get('content-encoding')) return len;
        const stored = await cache.match(url);
        return stored ? (await stored.blob()).size : 0;
    }

    async function readManifests() {
        const cache = await caches.open(SONGS_CACHE);
        const keys = await cache.keys();
        const manifests = [];
        for (const request of keys) {
            if (!new URL(request.url).pathname.startsWith(MANIFEST_PREFIX)) continue;
            try {
                const res = await cache.match(request);
                if (res) manifests.push(await res.json());
            } catch { /* corrupt manifest: ignored, removable via clearAll */ }
        }
        return manifests;
    }

    async function removeJob(job) {
        const cache = await caches.open(SONGS_CACHE);
        const keys = await cache.keys();
        let removedCount = 0;
        // manifest first, so the SW stops serving the song before its files go
        await cache.delete(manifestUrl(job));
        for (const request of keys) {
            if (jobFromCacheUrl(request.url) === job) {
                await cache.delete(request);
                removedCount++;
            }
        }
        return removedCount;
    }

    async function waitForPrepare(job, onProgress) {
        const deadline = Date.now() + PREPARE_TIMEOUT_MS;
        for (;;) {
            const res = await fetch(`/poc-mixer/progress/${enc(job)}`, { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`Preparation status unavailable (HTTP ${res.status})`);
            const p = await res.json();
            if (onProgress) onProgress(`Preparing: ${p.stage || ''}`, p.pct || 0);
            if (p.done) {
                if (p.error) throw new Error(p.error);
                return;
            }
            if (Date.now() > deadline) throw new Error('Preparation timed out');
            await new Promise((r) => setTimeout(r, 1000));
        }
    }

    window.StemCache = {
        // Get user settings
        getSettings: getUserSettings,

        // Save user settings
        saveSettings: saveUserSettings,

        // Check if caching is enabled
        isEnabled: () => getUserSettings().cacheEnabled,

        // Get max cache size in bytes
        getMaxSize: () => getUserSettings().maxCacheSizeMB * 1024 * 1024,

        /**
         * Save a song for offline playback in the mobile mixer.
         * job: the id the mixer opens the song with (mobile-app.js openMixer: extraction_id
         * or "download_<id>"). options: { title, onProgress(stage, pct) }.
         * Runs in the page (session cookie). Resolves { success, cachedCount, totalSize } or
         * { success:false, error }; a failed save removes whatever it had written.
         */
        cacheSong: async (job, options = {}) => {
            const settings = getUserSettings();
            if (!settings.cacheEnabled) return { success: false, error: 'Cache disabled' };
            if (!('caches' in window)) return { success: false, error: 'Offline storage not supported' };
            if (!navigator.onLine) return { success: false, error: 'You are offline' };
            const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

            let cache;
            let wroteAny = false;   // roll back only what THIS save wrote
            try {
                // 1. Server-side preparation (metronome, waveforms, meta.json)
                const prep = await (await fetch(`/poc-mixer/prepare/${enc(job)}`,
                    { method: 'POST', credentials: 'same-origin' })).json();
                if (prep && prep.error) throw new Error(prep.error);
                await waitForPrepare(job, onProgress);

                // 2. Meta: decides which audio files the engine will ask for
                const metaRes = await fetch(metaUrl(job), { credentials: 'same-origin' });
                if (!metaRes.ok) throw new Error(`Song data unavailable (HTTP ${metaRes.status})`);
                const metaText = await metaRes.text();
                const meta = JSON.parse(metaText);
                if (meta.error) throw new Error(meta.error);
                const { stems, required, optional } = audioIdsForMeta(meta);
                if (!stems.length) throw new Error('This song has no stems');

                // 3. Room check (estimate: real sizes are only known once downloaded)
                const stats = await window.StemCache.getStats();
                const maxSize = settings.maxCacheSizeMB * 1024 * 1024;
                const estimate = (required.length + optional.length) * EST_BYTES_PER_FILE;
                if (stats.totalSize + estimate > maxSize) {
                    return {
                        success: false,
                        error: `Cache full (${formatSize(stats.totalSize)} / ${formatSize(maxSize)})`
                    };
                }

                // Start clean: never mix files from an older save of this song
                wroteAny = true;
                await removeJob(job);
                cache = await caches.open(SONGS_CACHE);

                // 4. Audio, a few at a time (phones: memory and connection limits)
                const all = required.map((id) => ({ id, required: true }))
                    .concat(optional.map((id) => ({ id, required: false })));
                const files = [];
                let totalSize = metaText.length;
                let done = 0;
                let failedRequired = null;
                let next = 0;
                const worker = async () => {
                    while (next < all.length && !failedRequired) {
                        const item = all[next++];
                        const url = audioUrl(job, item.id);
                        try {
                            const res = await fetch(url, { credentials: 'same-origin' });
                            // Cache.put rejects partial (206) responses; the engine needs full bodies
                            if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
                            const headers = res.headers;
                            await cache.put(url, res);
                            totalSize += await storedSize(cache, url, headers);
                            files.push(url);
                        } catch (err) {
                            if (item.required) failedRequired = `${item.id}: ${err.message || err}`;
                            else console.warn('[StemCache] Optional file skipped:', item.id, err.message || err);
                        }
                        done++;
                        if (onProgress) {
                            onProgress(`Downloading ${done}/${all.length}`, Math.round(100 * done / all.length));
                        }
                    }
                };
                await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
                if (failedRequired) throw new Error(`Could not download ${failedRequired}`);

                // 5. Meta (clean headers: the server copy may be gzip-encoded) then manifest
                await cache.put(metaUrl(job), new Response(metaText, {
                    headers: { 'Content-Type': 'application/json' }
                }));
                const manifest = {
                    job,
                    title: options.title || null,
                    stems: stems.filter((n) => n !== 'metronome'),
                    files: [metaUrl(job)].concat(files),
                    size: totalSize,
                    cachedAt: new Date().toISOString()
                };
                await cache.put(manifestUrl(job), new Response(JSON.stringify(manifest), {
                    headers: { 'Content-Type': 'application/json' }
                }));

                console.log(`[StemCache] Saved ${job}: ${files.length} audio files, ${formatSize(totalSize)}`);
                return { success: true, cachedCount: files.length, totalSize, songId: job };
            } catch (err) {
                console.error('[StemCache] Save failed:', job, err.message || err);
                if (wroteAny) {
                    try { await removeJob(job); } catch { /* nothing to roll back */ }
                }
                return { success: false, error: err.message || 'Unknown error' };
            }
        },

        // Remove a song from cache (and its offline library entry)
        removeSong: async (songId) => {
            try {
                const removedCount = await removeJob(songId);
                dropOfflineMetadata(songId);
                return { success: true, removedCount };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // A song counts as cached only when its save completed (manifest present)
        isSongCached: async (songId) => {
            try {
                const cache = await caches.open(SONGS_CACHE);
                return !!(await cache.match(manifestUrl(songId)));
            } catch {
                return false;
            }
        },

        // Get cache statistics
        getStats: async () => {
            try {
                const manifests = await readManifests();
                const songs = manifests.map((m) => ({
                    songId: m.job,
                    title: m.title || null,
                    stemCount: (m.stems || []).length,
                    size: m.size || 0
                }));
                const totalSize = songs.reduce((sum, s) => sum + s.size, 0);
                const fileCount = manifests.reduce((sum, m) => sum + (m.files || []).length, 0);
                return { totalSize, fileCount, songCount: songs.length, songs };
            } catch (err) {
                console.error('[StemCache] Stats error:', err);
                return { totalSize: 0, fileCount: 0, songCount: 0, songs: [] };
            }
        },

        // Get list of cached songs
        getCachedSongs: async () => {
            const stats = await window.StemCache.getStats();
            return stats.songs || [];
        },

        // Clear all cached songs (and the offline library entries)
        clearAll: async () => {
            try {
                await caches.delete(SONGS_CACHE);
                dropOfflineMetadata();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // Format bytes to human readable
        formatSize: formatSize,

        // Get storage quota info
        getQuota: async () => {
            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                return {
                    usage: estimate.usage || 0,
                    quota: estimate.quota || 0,
                    usagePercent: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0
                };
            }
            return { usage: 0, quota: 0, usagePercent: 0 };
        }
    };

    // Offline library entries whose song is not (or no longer) in the cache - saves made
    // by the previous worker cached URLs the mixer never requested and were dropped with
    // the old cache - would open to an error offline: forget them.
    async function pruneOfflineMetadata() {
        if (!('caches' in window)) return;
        try {
            const songs = JSON.parse(localStorage.getItem(OFFLINE_SONGS_KEY) || '{}');
            const ids = Object.keys(songs);
            if (!ids.length) return;
            const cache = await caches.open(SONGS_CACHE);
            let changed = false;
            for (const id of ids) {
                if (!(await cache.match(manifestUrl(id)))) {
                    delete songs[id];
                    changed = true;
                }
            }
            if (changed) localStorage.setItem(OFFLINE_SONGS_KEY, JSON.stringify(songs));
        } catch { /* best-effort */ }
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // ========================================
    // Install Prompt Handling (Android only)
    // ========================================

    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('[PWA] Install prompt available');
        e.preventDefault();
        deferredPrompt = e;
        showInstallButton();
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed');
        deferredPrompt = null;
        hideInstallButton();
    });

    function showInstallButton() {
        let btn = document.getElementById('pwa-install-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'pwa-install-btn';
            btn.innerHTML = '<i class="fas fa-download"></i> Install App';
            btn.addEventListener('click', installApp);
            btn.style.cssText = `
                position: fixed;
                bottom: 80px;
                right: 20px;
                padding: 12px 20px;
                background: linear-gradient(135deg, #6c5ce7, #a855f7);
                color: white;
                border: none;
                border-radius: 25px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(108, 92, 231, 0.4);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            document.body.appendChild(btn);
        }
        btn.style.display = 'flex';
    }

    function hideInstallButton() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
    }

    async function installApp() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] Install outcome:', outcome);
        deferredPrompt = null;
        hideInstallButton();
    }

    window.installPWA = installApp;

    // ========================================
    // iOS Install Guide
    // ========================================

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function showIOSInstallGuide() {
        if (!isIOS() || isStandalone()) return;

        // Check if already dismissed
        if (localStorage.getItem('ios_install_dismissed')) return;

        const guide = document.createElement('div');
        guide.id = 'ios-install-guide';
        guide.innerHTML = `
            <div class="ios-guide-content">
                <button class="ios-guide-close">&times;</button>
                <p><strong>Install StemTube</strong></p>
                <p>Tap <i class="fas fa-share-square"></i> then "Add to Home Screen"</p>
            </div>
        `;
        guide.style.cssText = `
            position: fixed;
            bottom: 70px;
            left: 10px;
            right: 10px;
            background: #2d3436;
            color: white;
            padding: 15px;
            border-radius: 12px;
            z-index: 10000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        const style = document.createElement('style');
        style.textContent = `
            .ios-guide-content { display: flex; flex-direction: column; gap: 5px; }
            .ios-guide-content p { margin: 0; font-size: 14px; }
            .ios-guide-close {
                position: absolute;
                top: 5px;
                right: 10px;
                background: none;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(guide);

        guide.querySelector('.ios-guide-close').addEventListener('click', () => {
            guide.remove();
            localStorage.setItem('ios_install_dismissed', 'true');
        });

        // Auto-hide after 10 seconds
        setTimeout(() => guide.remove(), 10000);
    }

    // ========================================
    // Navigation Containment
    // ========================================

    function initNavigationContainment() {
        if (!isStandalone()) return;

        console.log('[PWA] Standalone mode - enabling navigation containment');

        if (history.length <= 1) {
            history.pushState({ page: 'home' }, '', location.href);
        }

        window.addEventListener('popstate', (e) => {
            history.pushState({ page: 'home' }, '', location.href);
            handleBackNavigation();
        });
    }

    function handleBackNavigation() {
        // Close modals
        const activeModal = document.querySelector('.modal.active, .mobile-modal.active, .bottom-sheet.active');
        if (activeModal) {
            activeModal.classList.remove('active');
            return;
        }

        // Close expanded player
        const expandedPlayer = document.querySelector('.mobile-player-expanded.active');
        if (expandedPlayer) {
            expandedPlayer.classList.remove('active');
            return;
        }

        // Go to search tab
        const activeTab = document.querySelector('.mobile-nav-item.active');
        if (activeTab && activeTab.dataset.tab !== 'search') {
            const searchTab = document.querySelector('.mobile-nav-item[data-tab="search"]');
            if (searchTab) searchTab.click();
        }
    }

    // ========================================
    // Offline Detection
    // ========================================

    function initOfflineDetection() {
        function updateOnlineStatus() {
            const isOnline = navigator.onLine;
            document.body.classList.toggle('offline', !isOnline);
            if (!isOnline) showOfflineBanner();
            else hideOfflineBanner();
        }

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        updateOnlineStatus();
    }

    function showOfflineBanner() {
        let banner = document.getElementById('offline-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'offline-banner';
            banner.innerHTML = '<i class="fas fa-wifi-slash"></i> Offline - Playing cached songs only';
            banner.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                padding: 8px;
                background: #e74c3c;
                color: white;
                text-align: center;
                font-size: 13px;
                z-index: 10000;
            `;
            document.body.appendChild(banner);
        }
        banner.style.display = 'block';
    }

    function hideOfflineBanner() {
        const banner = document.getElementById('offline-banner');
        if (banner) banner.style.display = 'none';
    }

    // ========================================
    // Update Notification
    // ========================================

    function showUpdateNotification() {
        const notification = document.createElement('div');
        notification.innerHTML = `
            <span>New version available!</span>
            <button onclick="location.reload()">Update</button>
        `;
        notification.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 20px;
            right: 20px;
            padding: 15px;
            background: #2d3436;
            color: white;
            border-radius: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10000;
        `;
        notification.querySelector('button').style.cssText = `
            padding: 8px 16px;
            background: #6c5ce7;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        `;
        document.body.appendChild(notification);
    }

    // ========================================
    // Initialize
    // ========================================

    document.addEventListener('DOMContentLoaded', () => {
        initNavigationContainment();
        initOfflineDetection();
        pruneOfflineMetadata();

        // Show iOS install guide after 3 seconds
        setTimeout(showIOSInstallGuide, 3000);

        console.log('[PWA] Initialization complete');
    });

})();
