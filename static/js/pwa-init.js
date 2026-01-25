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
    // Stems Cache Management API
    // ========================================

    async function sendToSW(type, data = {}) {
        return new Promise((resolve, reject) => {
            if (!navigator.serviceWorker.controller) {
                reject(new Error('No service worker controller'));
                return;
            }

            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => resolve(e.data);

            navigator.serviceWorker.controller.postMessage(
                { type, data },
                [channel.port2]
            );

            // Timeout after 30 seconds
            setTimeout(() => reject(new Error('Timeout')), 30000);
        });
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

        // Cache a song (all stems) - done from main thread to have auth cookies
        cacheSong: async (songId, stemUrls) => {
            const settings = getUserSettings();
            if (!settings.cacheEnabled) {
                return { success: false, error: 'Cache disabled' };
            }

            // Check if we have room
            const stats = await window.StemCache.getStats();
            const estimatedSize = 55 * 1024 * 1024; // ~55 MB per song
            const maxSize = settings.maxCacheSizeMB * 1024 * 1024;

            if (stats.totalSize + estimatedSize > maxSize) {
                return {
                    success: false,
                    error: `Cache full (${formatSize(stats.totalSize)} / ${formatSize(maxSize)})`
                };
            }

            // Cache from main thread (has access to auth cookies)
            try {
                console.log('[StemCache] Opening cache...');
                const cache = await caches.open('stemtube-stems-v1');
                let cachedCount = 0;
                let totalSize = 0;

                console.log('[StemCache] Fetching stems:', stemUrls);

                for (const url of stemUrls) {
                    try {
                        console.log('[StemCache] Fetching:', url);
                        // Fetch with credentials from main thread
                        const response = await fetch(url, { credentials: 'include' });
                        console.log('[StemCache] Response:', url, response.status, response.statusText);

                        if (response.ok) {
                            const clonedResponse = response.clone();
                            await cache.put(url, clonedResponse);
                            const blob = await response.blob();
                            totalSize += blob.size;
                            cachedCount++;
                            console.log('[StemCache] Cached:', url, formatSize(blob.size));
                        } else {
                            console.warn('[StemCache] Failed to fetch:', url, response.status, response.statusText);
                        }
                    } catch (err) {
                        console.error('[StemCache] Error caching:', url, err.message || err);
                    }
                }

                console.log(`[StemCache] Done: ${cachedCount}/${stemUrls.length} stems, total: ${formatSize(totalSize)}`);

                if (cachedCount === 0) {
                    return { success: false, error: 'No stems could be cached - check console for details' };
                }
                return { success: true, cachedCount, totalSize, songId };
            } catch (err) {
                console.error('[StemCache] Cache error:', err.message || err);
                return { success: false, error: err.message || 'Unknown error' };
            }
        },

        // Remove a song from cache
        removeSong: async (songId) => {
            try {
                const cache = await caches.open('stemtube-stems-v1');
                const keys = await cache.keys();
                let removedCount = 0;

                for (const request of keys) {
                    if (request.url.includes(songId)) {
                        await cache.delete(request);
                        removedCount++;
                    }
                }
                return { success: true, removedCount };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // Check if a song is cached
        isSongCached: async (songId) => {
            try {
                const cache = await caches.open('stemtube-stems-v1');
                const keys = await cache.keys();
                let stemCount = 0;

                for (const request of keys) {
                    if (request.url.includes(songId) &&
                        (request.url.includes('/stems/') || request.url.includes('/extracted_stems/'))) {
                        stemCount++;
                    }
                }
                return stemCount >= 4;
            } catch {
                return false;
            }
        },

        // Get cache statistics
        getStats: async () => {
            try {
                const cache = await caches.open('stemtube-stems-v1');
                const keys = await cache.keys();
                const songs = new Map();
                let totalSize = 0;
                let fileCount = 0;

                for (const request of keys) {
                    const url = new URL(request.url);
                    let songId = null;

                    // Match /api/extracted_stems/{id}/{stem}
                    const apiMatch = url.pathname.match(/\/api\/extracted_stems\/([^/]+)\//);
                    if (apiMatch) {
                        songId = apiMatch[1];
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
                            totalSize += blob.size;
                            fileCount++;
                        }
                    }
                }

                const songsList = Array.from(songs.entries()).map(([id, data]) => ({
                    songId: id,
                    stemCount: data.stemCount,
                    size: data.size
                }));

                return { totalSize, fileCount, songCount: songsList.length, songs: songsList };
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

        // Clear all cached stems
        clearAll: async () => {
            try {
                await caches.delete('stemtube-stems-v1');
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

        // Show iOS install guide after 3 seconds
        setTimeout(showIOSInstallGuide, 3000);

        console.log('[PWA] Initialization complete');
    });

})();
