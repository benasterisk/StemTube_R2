/**
 * StemTube Mobile - Main Application Class
 * MobileApp: navigation, search, library, mixer, chords, lyrics, jam session
 * Depends on: mobile-constants.js, mobile-guitar-diagram.js, mobile-neumorphic-dial.js
 */

class MobileApp {
    constructor() {
        console.log('[MobileApp] Initializing Android-first architecture...');
        
        this.audioContext = null;
        this.masterGainNode = null;
        this.stems = {};
        this.workletLoaded = false;
        
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;
        this.startTime = 0;
        this.animationFrameId = null;
        
        this.originalBPM = 120;
        this.currentBPM = 120;
        this.currentPitchShift = 0;
        this.originalKey = 'C major';
        this.cachedTempoRatio = 1.0;
        this.cachedPitchRatio = 1.0;
        this.cachedPlaybackRate = 1.0;
        this.cachedSyncRatio = 1.0;
        this.playbackPosition = 0;
        this.lastAudioTime = null;
        
        this.currentExtractionId = null;
        this.currentExtractionVideoId = null;
        this.currentExtractionData = null;
        this.currentExtractionItem = null;
        this.masterAudioBuffer = null;
        this.masterAudioSource = null;
        this.cleanupRunning = null;
        this.currentPage = 'library';  // Default page: My Library
        this.currentMixerTab = 'controls';
        this.currentLibraryTab = 'my';  // Track library sub-tab (my/global)

        this.socket = null;
        this.jamClient = null;
        this.chords = [];
        this.chordSegments = [];
        this.chordElements = [];
        this.chordScrollContainer = null;
        this.chordTrackElement = null;
        this.lyrics = [];
        this.lyricsContainer = null;
        this.lyricLineElements = [];
        this.activeLyricIndex = -1;
        this.lyricsScrollAnimation = null;
        this.lyricsAutoScrolling = false;
        this.lyricsPastPreviewCount = 2;
        this.lyricsFuturePreviewCount = 3;
        this.lyricsUserScrolling = false;
        this.lyricsScrollResumeTimer = null;
        this.lyricsScrollHandlers = null;
        this.fullscreenLyricsOpen = false;
        this.fullscreenLyricElements = [];
        // Grid View 2 properties
        this.gridView2Open = false;
        this.gridView2Beats = [];
        this.lastGridView2BeatIndex = -1;
        this.lastGridView2ControlSync = 0;
        this.gridView2PopupInitialized = false;
        this.gridView2ControlsInitialized = false;
        this.playheadIndicator = null;
        this.myLibraryVideoIds = new Set(); // Track user's library video IDs
        this.libraryRefreshTimer = null;
        this.libraryPollingInterval = 6000;
        this.libraryLoading = false;
        this.pendingLibraryRefresh = false;
        this.extractionStatusCache = new Map();
        this.beatsPerBar = 4;
        this.chordPxPerBeat = 40;
        this.chordBPM = 120;
        this.beatOffset = 0;
        this.loadingOverlay = null;
        this.loadingText = null;
        this.chordDiagramMode = 'guitar';
        this.chordDiagramEl = null;
        this.chordDiagramPrevEl = null;
        this.chordDiagramNextEl = null;
        this.chordInstrumentButtons = [];
        this.currentChordSymbol = null;
        this.prevChordSymbol = null;
        this.nextChordSymbol = null;
        this.masterAudioCache = new Map();
        this.masterAudioCacheLimit = 4;
        this.chordDataCache = new Map();
        this.chordDataCacheLimit = 12;
        this.guitarDiagramCache = new Map();
        this.guitarDiagramCacheLimit = 20;
        this.guitarDiagramBuilder = null;
        this.chordRegenerating = false;
        this.wakeLock = null;
        this.wakeLockRequestPending = false;
        this.wakeLockVisibilityHandler = null;
        this.wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

        this.init();
    }

    async init() {
        this.log('[MobileApp] Starting initialization...');
        this.initSocket();
        this.setupNavigation();
        this.setupSearch();
        this.setupUpload();
        this.setupMixerControls();
        this.setupRefreshButtons();
        this.setupExtractionModal();
        this.setupDownloadSheet();
        this.setupExportModal();
        this.setupLoadingOverlay();
        this.setupBrowserLogging();
        this.setupSettings();

        this.initJamClient();

        document.addEventListener('touchstart', () => {
            if (!this.audioContext) this.initAudioContext();
        }, { once: true });

        // Check for Jam Guest Mode
        if (window.JAM_GUEST_MODE) {
            console.log('[MobileApp] JAM GUEST MODE detected');
            // Set initial page to mixer for guests
            this.currentPage = 'mixer';
            await this.initJamGuestMode();
            this.log('[MobileApp] Jam guest initialization complete');
            return; // Skip normal library loading for guests
        }

        await this.loadLibrary();

        // Restore state from localStorage after library is loaded
        this.restoreState();

        this.log('[MobileApp] Initialization complete');
    }

    setupBrowserLogging() {
        // Override console methods to send logs to backend
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args) => {
            originalLog.apply(console, args);
            this.sendLogToBackend('info', args.join(' '));
        };

        console.error = (...args) => {
            originalError.apply(console, args);
            this.sendLogToBackend('error', args.join(' '));
        };

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            this.sendLogToBackend('warn', args.join(' '));
        };
    }

    sendLogToBackend(level, message) {
        // Batch logs and send every 2 seconds to avoid overwhelming server
        if (!this.logQueue) this.logQueue = [];
        this.logQueue.push({ level, message, timestamp: Date.now() });

        if (!this.logTimer) {
            this.logTimer = setTimeout(() => {
                if (this.logQueue.length > 0) {
                    fetch('/api/logs/browser', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ logs: this.logQueue })
                    }).catch(() => {}); // Silent fail - don't break app if logging fails
                    this.logQueue = [];
                }
                this.logTimer = null;
            }, 2000);
        }
    }

    log(message) {
        console.log(message);
    }

    initSocket() {
        this.socket = io({
            transports: ['polling', 'websocket'],
            upgrade: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });
        this.socket.on('connect', () => console.log('[Socket] Connected, id:', this.socket.id));
        this.socket.on('connect_error', (err) => {
            console.error('[Socket] Connect error:', err.message, err.description || '', err.context || '');
        });
        this.socket.on('disconnect', (reason) => {
            console.warn('[Socket] Disconnected:', reason);
        });
        this.socket.on('reconnect', (attemptNumber) => {
            console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
        });
        this.socket.on('download_progress', (data) => this.onDownloadProgress(data));
        this.socket.on('download_complete', (data) => this.onDownloadComplete(data));
        this.socket.on('download_error', (data) => this.onDownloadError(data));
        this.socket.on('extraction_progress', (data) => this.onExtractionProgress(data));
        this.socket.on('extraction_complete', (data) => this.onExtractionComplete(data));
        this.socket.on('extraction_completed_global', () => this.loadLibrary());
        this.socket.on('extraction_refresh_needed', () => this.loadLibrary());
        this.socket.on('extraction_error', (data) => this.onExtractionError(data));
        this.socket.on('lyrics_progress', (data) => this.onLyricsProgress(data));

        // iOS: reconnect socket when app returns to foreground
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.socket && !this.socket.connected) {
                console.log('[Socket] Page visible again — reconnecting');
                this.socket.connect();
            }
        });
    }

    async initAudioContext() {
        // Check if AudioContext exists AND is not closed
        if (this.audioContext && this.audioContext.state !== 'closed') {
            console.log('[Audio] AudioContext already exists (state:', this.audioContext.state + ')');
            return;
        }

        console.log('[Audio] Initializing NEW AudioContext...');

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.connect(this.audioContext.destination);
            console.log('[Audio] AudioContext created successfully (state:', this.audioContext.state + ')');
            await this.loadSoundTouchWorklet();
        } catch (error) {
            console.error('[Audio] Failed:', error);
        }
    }

    async loadSoundTouchWorklet() {
        try {
            if (!this.audioContext.audioWorklet) throw new Error('AudioWorklet not supported');
            await this.audioContext.audioWorklet.addModule('/static/wasm/soundtouch-worklet.js');
            this.workletLoaded = true;
            console.log('[SoundTouch] Worklet loaded');
        } catch (error) {
            console.error('[SoundTouch] Failed:', error);
            this.workletLoaded = false;
        }
    }

    setupNavigation() {
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.navigateTo(btn.dataset.page));
        });

        const backBtn = document.getElementById('mobileMixerBack');
        if (backBtn) backBtn.addEventListener('click', () => {
            this.navigateTo('library');
            // Cleanup is handled by navigateTo()
        });

        document.querySelectorAll('.mobile-mixer-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchMixerTab(tab.dataset.mixerTab));
        });

        // Library sub-tabs
        document.querySelectorAll('.mobile-library-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchLibraryTab(tab.dataset.libraryTab));
        });

        // Logout button
        document.getElementById('mobileLogoutBtn')?.addEventListener('click', () => {
            if (confirm('Are you sure you want to logout?')) {
                window.location.href = '/logout';
            }
        });
    }

    switchLibraryTab(tabName) {
        document.querySelectorAll('.mobile-library-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.mobile-library-content').forEach(c => c.classList.remove('active'));

        const tab = document.querySelector('.mobile-library-tab[data-library-tab="' + tabName + '"]');
        const content = document.getElementById('mobile' + (tabName === 'my' ? 'MyLibraryContent' : 'GlobalLibraryContent'));

        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');

        this.currentLibraryTab = tabName;

        // Load the appropriate library
        if (tabName === 'my') this.loadLibrary();
        else if (tabName === 'global') this.loadGlobalLibrary();

        // Save state
        this.saveState();
    }

    async navigateTo(page) {
        console.log('[Nav]', page);

        // Clean up mixer when leaving for an unrelated page (NOT jam — mixer stays alive during jam)
        if (this.currentPage === 'mixer' && page !== 'mixer' && page !== 'jam') {
            // If jam session is active as host, keep mixer alive regardless
            const isJamHost = this.jamClient && this.jamClient.isActive() && this.jamClient.getRole() === 'host';
            if (!isJamHost) {
                console.log('[Nav] Leaving mixer, cleaning up...');
                try {
                    await this.cleanupMixer();
                } catch (e) {
                    console.warn('[Nav] Cleanup error:', e);
                }
            } else {
                console.log('[Nav] Jam active as host — keeping mixer alive');
            }
        }

        document.querySelectorAll('.mobile-page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

        const targetPage = document.getElementById('mobile' + page.charAt(0).toUpperCase() + page.slice(1) + 'Page');
        if (targetPage) targetPage.classList.add('active');

        const targetBtn = document.querySelector('.mobile-nav-btn[data-page="' + page + '"]');
        if (targetBtn) targetBtn.classList.add('active');

        this.currentPage = page;

        // When navigating to library page, use saved sub-tab or default to "My Library"
        if (page === 'library') {
            this.switchLibraryTab(this.currentLibraryTab || 'my');
        }

        // When navigating to admin page, load users
        if (page === 'admin' && window.mobileAdmin) {
            window.mobileAdmin.loadUsers();
        }

        // When navigating to settings page, load cache stats
        if (page === 'settings') {
            this.loadSettingsPage();
        }

        // When navigating to jam page, render jam UI
        if (page === 'jam') {
            this.renderJamPage();
        }

        // Save state
        this.saveState();
    }

    switchMixerTab(tabName) {
        document.querySelectorAll('.mobile-mixer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.mobile-mixer-content').forEach(c => c.classList.remove('active'));

        const tab = document.querySelector('.mobile-mixer-tab[data-mixer-tab="' + tabName + '"]');
        const content = document.getElementById('mobileMixer' + tabName.charAt(0).toUpperCase() + tabName.slice(1));

        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');
        this.currentMixerTab = tabName;

        // Save state
        this.saveState();
    }

    setupSearch() {
        const btn = document.getElementById('mobileSearchBtn');
        const input = document.getElementById('mobileSearchInput');
        if (btn) btn.addEventListener('click', () => this.performSearch());
        if (input) input.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.performSearch();
        });
    }

    setupUpload() {
        const uploadBtn = document.getElementById('mobileUploadBtn');
        const fileInput = document.getElementById('mobileFileInput');

        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const progressContainer = document.getElementById('mobileUploadProgress');
        const progressFill = document.getElementById('mobileUploadProgressFill');
        const progressText = document.getElementById('mobileUploadProgressText');

        if (progressContainer) progressContainer.style.display = 'block';

        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                if (progressFill) progressFill.style.width = percent + '%';
                if (progressText) progressText.textContent = `Uploading... ${percent}%`;
            }
        });

        xhr.addEventListener('load', async () => {
            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            event.target.value = ''; // Reset file input

            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    this.showToast(`Uploaded: ${data.title || file.name}`, 'success');
                    await this.loadLibrary(); // Refresh library
                } catch (e) {
                    this.showToast('Upload successful', 'success');
                    await this.loadLibrary();
                }
            } else {
                try {
                    const data = JSON.parse(xhr.responseText);
                    this.showToast(`Upload failed: ${data.error || 'Unknown error'}`, 'error');
                } catch (e) {
                    this.showToast(`Upload failed: HTTP ${xhr.status}`, 'error');
                }
            }
        });

        xhr.addEventListener('error', () => {
            if (progressContainer) progressContainer.style.display = 'none';
            this.showToast('Upload failed: Network error', 'error');
        });

        xhr.open('POST', '/api/upload-file');
        xhr.send(formData);
    }

    // Show toast notification for mobile
    showToast(message, type = 'info') {
        // Remove any existing toast
        const existingToast = document.querySelector('.mobile-toast');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = `mobile-toast mobile-toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto-hide after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // State Persistence: Save current state to localStorage
    saveState() {
        try {
        const state = {
            currentPage: this.currentPage,
            currentLibraryTab: this.currentLibraryTab,
            currentMixerTab: this.currentMixerTab,
            currentExtractionId: this.currentExtractionId,
            currentExtractionVideoId: this.currentExtractionVideoId,
                currentTime: this.currentTime,
                isPlaying: false,  // ALWAYS save as paused - user must press play after refresh
                currentPitchShift: this.currentPitchShift,
                currentBPM: this.currentBPM,
                timestamp: Date.now()
            };
            localStorage.setItem('mobileAppState', JSON.stringify(state));
            console.log('[State] Saved:', state);
        } catch (error) {
            console.warn('[State] Failed to save:', error);
        }
    }

    // State Persistence: Restore state from localStorage
    async restoreState() {
        try {
            const stateJson = localStorage.getItem('mobileAppState');
            if (!stateJson) {
                console.log('[State] No saved state found, using defaults');
                // Navigate to default page (library)
                this.navigateTo('library');
                this.updatePlayPauseButtons();
                return;
            }

            const state = JSON.parse(stateJson);
            console.log('[State] Restoring:', state);

            // Check if state is too old (> 24 hours)
            const age = Date.now() - (state.timestamp || 0);
            if (age > 24 * 60 * 60 * 1000) {
                console.log('[State] State too old, using defaults');
                this.navigateTo('library');
                this.updatePlayPauseButtons();
                return;
            }

            // Restore library tab
            if (state.currentLibraryTab) {
                this.currentLibraryTab = state.currentLibraryTab;
            }

            // Restore mixer state if user was in mixer
            if (state.currentPage === 'mixer' && state.currentExtractionId) {
                console.log('[State] Restoring mixer:', state.currentExtractionId);

                // Try to reopen mixer
                try {
                    const res = await fetch('/api/extractions/' + state.currentExtractionId);
                    const data = await res.json();

                    if (!data.error) {
                        // CRITICAL: Clean up any previous mixer state first (and WAIT)
                        await this.cleanupMixer();

                        this.currentExtractionId = state.currentExtractionId;
                        this.currentExtractionVideoId = state.currentExtractionVideoId || null;
                        this.currentExtractionData = data;

                        if (!this.audioContext) await this.initAudioContext();
                        await this.loadMixerData(data, { extractionId: state.currentExtractionId });

                        // Restore playback position
                        if (state.currentTime > 0) {
                            this.currentTime = state.currentTime;
                            this.seek(state.currentTime);
                        }

                        // Restore pitch/tempo
                        if (state.currentPitchShift !== undefined) {
                            this.currentPitchShift = state.currentPitchShift;
                            this.syncPitchValue(state.currentPitchShift);
                            this.setPitch(state.currentPitchShift);
                        }

                        if (state.currentBPM !== undefined) {
                            this.currentBPM = state.currentBPM;
                            const tempoRatio = this.currentBPM / this.originalBPM;
                            this.syncTempoValue(tempoRatio);
                            this.setTempo(tempoRatio);
                        }

                        // Show mixer navigation button
                        const nav = document.getElementById('mobileNavMixer');
                        if (nav) nav.style.display = 'flex';

                        // Navigate to mixer
                        this.navigateTo('mixer');

                        // Restore mixer tab
                        if (state.currentMixerTab) {
                            this.switchMixerTab(state.currentMixerTab);
                        }

                        console.log('[State] Mixer restored successfully');
                        this.updatePlayPauseButtons();
                        return;
                    }
                } catch (error) {
                    console.warn('[State] Failed to restore mixer:', error);
                }
            }

            // Fallback: restore page (search/library)
            this.navigateTo(state.currentPage || 'library');
            this.updatePlayPauseButtons();

        } catch (error) {
            console.error('[State] Failed to restore state:', error);
            this.navigateTo('library');
            this.updatePlayPauseButtons();
        }
    }

    async performSearch() {
        const query = document.getElementById('mobileSearchInput').value.trim();
        if (!query) return alert('Enter search query');
        
        const results = document.getElementById('mobileSearchResults');
        results.innerHTML = '<p class="mobile-text-center">Searching...</p>';
        
        try {
            const searchParams = new URLSearchParams({
                query,
                max_results: '10'
            });
            const res = await fetch('/api/search?' + searchParams.toString());
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || ('Search failed with status ' + res.status));
            }
            this.displaySearchResults(data);
        } catch (error) {
            results.innerHTML = '<p class="mobile-text-muted">Search failed: ' + error.message + '</p>';
        }
    }

    displaySearchResults(resultsData) {
        const container = document.getElementById('mobileSearchResults');
        container.innerHTML = '';

        const items = Array.isArray(resultsData)
            ? resultsData
            : (resultsData?.items || resultsData?.results || []);

        if (!items.length) {
            container.innerHTML = '<p class="mobile-text-muted">No results</p>';
            return;
        }

        items.forEach(item => {
            const videoId = this.extractVideoId(item);
            if (!videoId) return;

            const title = item.snippet?.title || item.title || 'Unknown Title';
            const channel = item.snippet?.channelTitle || item.channelTitle || item.channel?.name || 'Unknown Channel';
            const thumbnail = this.getThumbnailUrl(item);
            const duration = this.formatDuration(item.contentDetails?.duration || item.duration || '');

            const div = document.createElement('div');
            div.className = 'mobile-search-result';
            div.innerHTML =
                '<img src="' + (thumbnail || '/static/img/default-thumb.svg') + '" class="mobile-result-thumbnail" alt="' + this.escapeHtml(title) + '">' +
                '<div class="mobile-result-info">' +
                    '<div class="mobile-result-title">' + this.escapeHtml(title) + '</div>' +
                    '<div class="mobile-result-meta">' + this.escapeHtml(channel) + (duration ? ' · ' + duration : '') + '</div>' +
                '</div>' +
                '<button class="mobile-btn mobile-btn-icon" title="Download"><i class="fas fa-download"></i></button>';

            div.querySelector('button').addEventListener('click', () => this.downloadVideo({
                id: videoId,
                title,
                thumbnail
            }));
            container.appendChild(div);
        });
    }

    extractVideoId(item) {
        if (!item) return '';
        if (typeof item.id === 'string') return item.id;
        if (item.id?.videoId) return item.id.videoId;
        if (item.videoId) return item.videoId;
        return '';
    }

    getThumbnailUrl(item) {
        if (item?.snippet?.thumbnails) {
            const thumbs = item.snippet.thumbnails;
            return (thumbs.medium && thumbs.medium.url) ||
                (thumbs.default && thumbs.default.url) ||
                '';
        }

        if (Array.isArray(item?.thumbnails) && item.thumbnails.length) {
            const medium = item.thumbnails.find(t => t.width >= 200 && t.width <= 400);
            return (medium && medium.url) || item.thumbnails[0].url || '';
        }

        return item?.thumbnail || '';
    }

    formatDuration(duration) {
        if (!duration) return '';
        if (typeof duration === 'number') {
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60).toString().padStart(2, '0');
            return minutes + ':' + seconds;
        }

        if (typeof duration === 'string' && duration.startsWith('PT')) {
            const matchHours = duration.match(/(\d+)H/);
            const matchMinutes = duration.match(/(\d+)M/);
            const matchSeconds = duration.match(/(\d+)S/);
            const totalSeconds =
                (matchHours ? parseInt(matchHours[1], 10) * 3600 : 0) +
                (matchMinutes ? parseInt(matchMinutes[1], 10) * 60 : 0) +
                (matchSeconds ? parseInt(matchSeconds[1], 10) : 0);
            if (!totalSeconds) return '';
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
            return (matchHours ? Math.floor(totalSeconds / 3600) + ':' + (Math.floor(totalSeconds / 60) % 60).toString().padStart(2, '0') : minutes) + ':' + seconds;
        }

        return duration;
    }

    async downloadVideo(video) {
        const videoId = this.extractVideoId(video);
        if (!videoId) {
            alert('Invalid video reference');
            return;
        }

        const thumbnailUrl = video.thumbnail ||
            video.thumbnail_url ||
            `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        const payload = {
            video_id: videoId,
            title: video.title || 'Untitled',
            thumbnail_url: thumbnailUrl,
            download_type: 'audio',
            quality: 'best'
        };

        try {
            const res = await fetch('/api/downloads', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || ('Download failed with status ' + res.status));
            }

            const message = data.existing
                ? (data.global ? 'Track already available globally. Added to your library.' : 'Track already in your library.')
                : 'Download started! Check your library for progress.';
            alert(message);
            this.loadLibrary();
            this.navigateTo('library');
        } catch (error) {
            alert('Download failed: ' + error.message);
        }
    }

    setupRefreshButtons() {
        const lib = document.getElementById('mobileRefreshLibrary');
        const glob = document.getElementById('mobileRefreshGlobal');
        if (lib) lib.addEventListener('click', () => this.loadLibrary());
        if (glob) glob.addEventListener('click', () => this.loadGlobalLibrary());
    }

    setupLoadingOverlay() {
        this.loadingOverlay = document.getElementById('mobileLoadingOverlay');
        this.loadingText = document.getElementById('mobileLoadingText');
        if (this.loadingOverlay) {
            this.loadingOverlay.style.display = 'none';
        }
    }

    // ========================================
    // User Settings Page
    // ========================================

    setupSettings() {
        const cacheEnabledToggle = document.getElementById('cacheEnabled');
        const maxCacheSizeSelect = document.getElementById('maxCacheSize');
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        const refreshCacheListBtn = document.getElementById('refreshCacheList');

        // Load saved settings
        if (window.StemCache) {
            const settings = window.StemCache.getSettings();
            if (cacheEnabledToggle) cacheEnabledToggle.checked = settings.cacheEnabled;
            if (maxCacheSizeSelect) maxCacheSizeSelect.value = settings.maxCacheSizeMB.toString();
        }

        // Enable/disable cache toggle
        if (cacheEnabledToggle) {
            cacheEnabledToggle.addEventListener('change', () => {
                const settings = window.StemCache.getSettings();
                settings.cacheEnabled = cacheEnabledToggle.checked;
                window.StemCache.saveSettings(settings);
                this.showToast(settings.cacheEnabled ? 'Offline cache enabled' : 'Offline cache disabled', 'info');
            });
        }

        // Max cache size change
        if (maxCacheSizeSelect) {
            maxCacheSizeSelect.addEventListener('change', () => {
                const settings = window.StemCache.getSettings();
                settings.maxCacheSizeMB = parseInt(maxCacheSizeSelect.value);
                window.StemCache.saveSettings(settings);
                this.loadSettingsPage(); // Refresh display
                this.showToast(`Max cache set to ${maxCacheSizeSelect.value} MB`, 'info');
            });
        }

        // Clear cache button
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                if (!confirm('Clear all cached songs? This cannot be undone.')) return;

                clearCacheBtn.disabled = true;
                clearCacheBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

                try {
                    await window.StemCache.clearAll();
                    this.showToast('Cache cleared', 'success');
                    this.loadSettingsPage();
                } catch (err) {
                    this.showToast('Failed to clear cache', 'error');
                } finally {
                    clearCacheBtn.disabled = false;
                    clearCacheBtn.innerHTML = '<i class="fas fa-trash"></i> Clear All Cache';
                }
            });
        }

        // Refresh cache list button
        if (refreshCacheListBtn) {
            refreshCacheListBtn.addEventListener('click', () => {
                this.loadSettingsPage();
            });
        }
    }

    async loadSettingsPage() {
        if (!window.StemCache) {
            console.warn('[Settings] StemCache not available');
            return;
        }

        try {
            // Get cache stats
            const stats = await window.StemCache.getStats();
            const settings = window.StemCache.getSettings();
            const maxSize = settings.maxCacheSizeMB * 1024 * 1024;
            const usagePercent = maxSize > 0 ? Math.min(100, (stats.totalSize / maxSize) * 100) : 0;

            // Update usage display
            const usageText = document.getElementById('cacheUsageText');
            const progressFill = document.getElementById('cacheProgressFill');
            const songCount = document.getElementById('cacheSongCount');

            if (usageText) {
                usageText.textContent = `${window.StemCache.formatSize(stats.totalSize)} / ${settings.maxCacheSizeMB} MB`;
            }
            if (progressFill) {
                progressFill.style.width = `${usagePercent}%`;
                // Change color if near limit
                if (usagePercent > 90) {
                    progressFill.style.background = 'linear-gradient(90deg, #ff6b6b, #ff8e8e)';
                } else if (usagePercent > 70) {
                    progressFill.style.background = 'linear-gradient(90deg, #ffd93d, #ffe066)';
                } else {
                    progressFill.style.background = 'linear-gradient(90deg, var(--mobile-primary), #4ade80)';
                }
            }
            if (songCount) {
                songCount.textContent = `${stats.songCount} song${stats.songCount !== 1 ? 's' : ''} cached`;
            }

            // Update cached songs list
            await this.updateCachedSongsList(stats.songs);

            // Update storage quota info
            const quotaEl = document.getElementById('storageQuota');
            if (quotaEl) {
                const quota = await window.StemCache.getQuota();
                if (quota.quota > 0) {
                    quotaEl.textContent = `${window.StemCache.formatSize(quota.usage)} / ${window.StemCache.formatSize(quota.quota)} (${quota.usagePercent}%)`;
                } else {
                    quotaEl.textContent = 'Not available';
                }
            }
        } catch (err) {
            console.error('[Settings] Error loading cache stats:', err);
        }
    }

    async updateCachedSongsList(songs) {
        const listEl = document.getElementById('cachedSongsList');
        if (!listEl) return;

        if (!songs || songs.length === 0) {
            listEl.innerHTML = '<div class="cached-songs-empty">No songs cached yet</div>';
            return;
        }

        // Build list HTML
        let html = '';
        for (const song of songs) {
            // Try to get song title from library
            const title = await this.getSongTitleById(song.songId) || song.songId;
            html += `
                <div class="cached-song-item" data-song-id="${song.songId}">
                    <div class="cached-song-info">
                        <span class="cached-song-title">${this.escapeHtml(title)}</span>
                        <span class="cached-song-size">${song.stemCount} stems • ${window.StemCache.formatSize(song.size)}</span>
                    </div>
                    <button class="cached-song-remove" data-song-id="${song.songId}" title="Remove from cache">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        }
        listEl.innerHTML = html;

        // Add remove listeners
        listEl.querySelectorAll('.cached-song-remove').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const songId = e.currentTarget.dataset.songId;
                await this.removeSongFromCache(songId);
            });
        });
    }

    async getSongTitleById(songId) {
        // Try to find in library
        if (this.libraryData) {
            for (const song of this.libraryData) {
                if (song.id === songId || song.video_id === songId) {
                    return song.title || song.name;
                }
            }
        }
        return null;
    }

    async removeSongFromCache(songId) {
        try {
            await window.StemCache.removeSong(songId);
            this.showToast('Removed from cache', 'success');
            this.loadSettingsPage();
        } catch (err) {
            this.showToast('Failed to remove from cache', 'error');
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Cache a song for offline use (called from library)
    async cacheSongForOffline(songId, title, itemData = null) {
        console.log('[Cache] cacheSongForOffline called with songId:', songId, 'title:', title);

        if (!window.StemCache || !window.StemCache.isEnabled()) {
            this.showToast('Offline cache is disabled', 'info');
            return false;
        }

        // Build stem URLs from the extraction API
        const stemNames = ['vocals', 'bass', 'drums', 'guitar', 'piano', 'other'];
        const stemUrls = stemNames.map(stem => `/api/extracted_stems/${songId}/${stem}`);

        console.log('[Cache] Stem URLs:', stemUrls);

        this.showToast(`Caching "${title}"...`, 'info');

        try {
            // Fetch full extraction data for offline mixer
            let fullExtractionData = null;
            try {
                const res = await fetch('/api/extractions/' + songId);
                if (res.ok) {
                    fullExtractionData = await res.json();
                    console.log('[Cache] Fetched full extraction data');
                }
            } catch (e) {
                console.warn('[Cache] Could not fetch extraction data:', e);
            }

            const result = await window.StemCache.cacheSong(songId, stemUrls);
            console.log('[Cache] Result:', result);

            if (result.success) {
                // Store full extraction data for offline mixer access
                const dataToStore = fullExtractionData || itemData || {};
                dataToStore.title = title;
                this.saveOfflineSongMetadata(songId, dataToStore);
                this.showToast(`"${title}" saved for offline`, 'success');
                return true;
            } else {
                this.showToast(result.error || 'Failed to cache', 'error');
                return false;
            }
        } catch (err) {
            console.error('[Cache] Error caching song:', err);
            this.showToast('Failed to cache song', 'error');
            return false;
        }
    }

    // Store song metadata in localStorage for offline library display
    saveOfflineSongMetadata(songId, itemData) {
        try {
            const offlineSongs = JSON.parse(localStorage.getItem('stemtube_offline_songs') || '{}');
            offlineSongs[songId] = {
                ...itemData,
                cached_at: new Date().toISOString(),
                offline_id: songId
            };
            localStorage.setItem('stemtube_offline_songs', JSON.stringify(offlineSongs));
            console.log('[Offline] Saved metadata for:', songId);
        } catch (err) {
            console.warn('[Offline] Failed to save metadata:', err);
        }
    }

    // Remove song metadata from localStorage
    removeOfflineSongMetadata(songId) {
        try {
            const offlineSongs = JSON.parse(localStorage.getItem('stemtube_offline_songs') || '{}');
            delete offlineSongs[songId];
            localStorage.setItem('stemtube_offline_songs', JSON.stringify(offlineSongs));
            console.log('[Offline] Removed metadata for:', songId);
        } catch (err) {
            console.warn('[Offline] Failed to remove metadata:', err);
        }
    }

    // Get all offline songs metadata
    getOfflineSongsMetadata() {
        try {
            const offlineSongs = JSON.parse(localStorage.getItem('stemtube_offline_songs') || '{}');
            return Object.values(offlineSongs);
        } catch (err) {
            console.warn('[Offline] Failed to get metadata:', err);
            return [];
        }
    }

    // Update save offline button state based on cache status
    async updateSaveOfflineButton(btn, item) {
        if (!window.StemCache) return;

        // Use same ID format as openMixer for stems API
        const songId = item.extraction_id || (item.download_id ? `download_${item.download_id}` : null) || item.video_id;
        if (!songId) return;

        try {
            const isCached = await window.StemCache.isSongCached(songId);
            if (isCached) {
                btn.classList.add('cached');
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.title = 'Saved offline';
            } else {
                btn.classList.remove('cached');
                btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i>';
                btn.title = 'Save for offline';
            }
        } catch (err) {
            console.warn('[SaveOffline] Error checking cache status:', err);
        }
    }

    // Handle save offline button click
    async handleSaveOffline(btn, item) {
        if (!window.StemCache) {
            this.showToast('Offline cache not available', 'error');
            return;
        }

        // Use same ID format as openMixer for stems API
        const songId = item.extraction_id || (item.download_id ? `download_${item.download_id}` : null) || item.video_id;
        const title = item.title || item.name || 'Unknown';

        console.log('[SaveOffline] Item:', item);
        console.log('[SaveOffline] Using songId:', songId);

        if (!songId) {
            this.showToast('Cannot identify song', 'error');
            return;
        }

        // Check if already cached
        const isCached = await window.StemCache.isSongCached(songId);

        if (isCached) {
            // Ask to remove from cache
            if (confirm(`Remove "${title}" from offline cache?`)) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                try {
                    await window.StemCache.removeSong(songId);
                    this.removeOfflineSongMetadata(songId);
                    this.showToast('Removed from offline cache', 'success');
                    btn.classList.remove('cached');
                    btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i>';
                    btn.title = 'Save for offline';
                } catch (err) {
                    this.showToast('Failed to remove from cache', 'error');
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                } finally {
                    btn.disabled = false;
                }
            }
        } else {
            // Save to cache
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                const success = await this.cacheSongForOffline(songId, title, item);
                if (success) {
                    btn.classList.add('cached');
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                    btn.title = 'Saved offline';
                } else {
                    btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i>';
                }
            } catch (err) {
                btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i>';
            } finally {
                btn.disabled = false;
            }
        }
    }

    setupExtractionModal() {
        this.extractionModal = document.getElementById('mobileExtractionModal');
        if (!this.extractionModal) return;

        this.extractionModalShade = this.extractionModal;
        this.extractionTitleEl = document.getElementById('mobileExtractionTitle');
        this.extractionPathEl = document.getElementById('mobileExtractionPath');
        this.extractionModelSelect = document.getElementById('mobileExtractionModel');
        this.extractionModelDescription = document.getElementById('mobileExtractionModelDescription');
        this.extractionStemsContainer = document.getElementById('mobileExtractionStems');
        this.twoStemCheckbox = document.getElementById('mobileTwoStemMode');
        this.primaryStemContainer = document.getElementById('mobilePrimaryStemContainer');
        this.primaryStemSelect = document.getElementById('mobilePrimaryStem');
        this.extractionStartBtn = document.getElementById('mobileExtractionStartBtn');
        this.extractionCloseBtn = document.getElementById('mobileExtractionClose');

        this.extractionModelDescriptions = {
            htdemucs: 'Balanced 4-stem separation (recommended).',
            htdemucs_ft: 'Fine-tuned variant with smoother vocals.',
            htdemucs_6s: '6-stem separation (vocals, drums, bass, guitar, piano, other).',
            mdx_extra: 'Enhanced vocal focus (slower but cleaner vocals).',
            mdx_extra_q: 'High quality MDX (requires diffq).'
        };

        if (this.extractionModelSelect) {
            this.extractionModelSelect.addEventListener('change', () => {
                this.handleExtractionModelChange();
            });
        }

        if (this.twoStemCheckbox) {
            this.twoStemCheckbox.addEventListener('change', () => this.togglePrimaryStemVisibility());
        }

        if (this.extractionStartBtn) {
            this.extractionStartBtn.addEventListener('click', () => this.submitExtractionFromModal());
        }

        if (this.extractionCloseBtn) {
            this.extractionCloseBtn.addEventListener('click', () => this.closeExtractionModal());
        }

        this.extractionModal.addEventListener('click', (event) => {
            if (event.target === this.extractionModal) {
                this.closeExtractionModal();
            }
        });
    }

    handleExtractionModelChange() {
        if (!this.extractionModelSelect) return;
        const option = this.extractionModelSelect.selectedOptions[0];
        const stems = option?.dataset?.stems ? option.dataset.stems.split(',').map(s => s.trim()) : ['vocals', 'drums', 'bass', 'other'];
        this.renderStemCheckboxes(stems);
        this.updateExtractionModelDescription();
        this.populatePrimaryStemOptions(stems);
    }

    renderStemCheckboxes(stems, preselected = null) {
        if (!this.extractionStemsContainer) return;
        const selectedSet = new Set((preselected && preselected.length ? preselected : stems).map(s => s.trim()));
        this.extractionStemsContainer.innerHTML = '';
        stems.forEach(stem => {
            const normalized = stem.trim();
            const wrapper = document.createElement('label');
            wrapper.className = 'mobile-stem-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = normalized;
            checkbox.checked = selectedSet.has(normalized);

            const span = document.createElement('span');
            span.textContent = normalized.charAt(0).toUpperCase() + normalized.slice(1);

            wrapper.appendChild(checkbox);
            wrapper.appendChild(span);
            this.extractionStemsContainer.appendChild(wrapper);
        });
    }

    populatePrimaryStemOptions(stems) {
        if (!this.primaryStemSelect) return;
        this.primaryStemSelect.innerHTML = '';
        stems.forEach(stem => {
            const opt = document.createElement('option');
            opt.value = stem;
            opt.textContent = stem.charAt(0).toUpperCase() + stem.slice(1);
            this.primaryStemSelect.appendChild(opt);
        });
        if (stems.includes('vocals')) {
            this.primaryStemSelect.value = 'vocals';
        }
    }

    updateExtractionModelDescription() {
        if (!this.extractionModelDescription || !this.extractionModelSelect) return;
        const value = this.extractionModelSelect.value;
        this.extractionModelDescription.textContent = this.extractionModelDescriptions[value] || '';
    }

    togglePrimaryStemVisibility() {
        if (!this.primaryStemContainer || !this.twoStemCheckbox) return;
        this.primaryStemContainer.style.display = this.twoStemCheckbox.checked ? 'block' : 'none';
    }

    openExtractionModal(item) {
        if (!this.extractionModal) {
            // fallback: no modal available, run extraction directly
            this.startExtractionRequest(item);
            return;
        }
        if (!item?.file_path) {
            alert('Please wait until the download finishes before extracting.');
            return;
        }

        this.currentExtractionItem = item;
        if (this.extractionTitleEl) {
            this.extractionTitleEl.textContent = item.title || 'Untitled track';
        }
        if (this.extractionPathEl) {
            this.extractionPathEl.textContent = item.file_path;
        }

        if (this.extractionModelSelect) {
            const desiredModel = item.extraction_model || 'htdemucs';
            if (Array.from(this.extractionModelSelect.options).some(opt => opt.value === desiredModel)) {
                this.extractionModelSelect.value = desiredModel;
            } else {
                this.extractionModelSelect.value = 'htdemucs';
            }
        }

        this.handleExtractionModelChange();
        this.togglePrimaryStemVisibility();
        this.extractionModal.classList.add('visible');
    }

    closeExtractionModal() {
        if (this.extractionModal) {
            this.extractionModal.classList.remove('visible');
        }
    }

    // ========================================
    // Download Bottom Sheet
    // ========================================

    setupDownloadSheet() {
        this.downloadSheet = document.getElementById('mobileDownloadSheet');
        if (!this.downloadSheet) return;

        this.downloadSheetTitle = document.getElementById('mobileDownloadTitle');
        this.downloadOriginalBtn = document.getElementById('mobileDownloadOriginal');
        this.downloadZipBtn = document.getElementById('mobileDownloadZip');
        this.downloadStemsList = document.getElementById('mobileDownloadStemsList');
        this.removeFromLibraryBtn = document.getElementById('mobileRemoveFromLibrary');

        // Close on backdrop click
        const backdrop = this.downloadSheet.querySelector('.mobile-bottom-sheet-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => this.closeDownloadSheet());
        }

        // Original download button
        if (this.downloadOriginalBtn) {
            this.downloadOriginalBtn.addEventListener('click', () => this.downloadOriginal());
        }

        // ZIP download button
        if (this.downloadZipBtn) {
            this.downloadZipBtn.addEventListener('click', () => this.downloadZip());
        }

        // Remove from library button
        if (this.removeFromLibraryBtn) {
            this.removeFromLibraryBtn.addEventListener('click', () => this.removeFromLibrary());
        }
    }

    openDownloadSheet(item) {
        if (!this.downloadSheet || !item) return;

        this.currentDownloadItem = item;

        // Set title
        if (this.downloadSheetTitle) {
            this.downloadSheetTitle.textContent = item.title || 'Download';
        }

        // Parse stems paths
        const stemsPaths = typeof item.stems_paths === 'string'
            ? JSON.parse(item.stems_paths)
            : item.stems_paths;

        // Populate stems list
        if (this.downloadStemsList && stemsPaths) {
            this.downloadStemsList.innerHTML = '';

            const stemIcons = {
                vocals: 'fa-microphone',
                drums: 'fa-drum',
                bass: 'fa-guitar',
                guitar: 'fa-guitar',
                piano: 'fa-piano',
                other: 'fa-music'
            };

            const stemLabels = {
                vocals: 'Vocals',
                drums: 'Drums',
                bass: 'Bass',
                guitar: 'Guitar',
                piano: 'Piano',
                other: 'Other'
            };

            Object.entries(stemsPaths).forEach(([stemName, stemPath]) => {
                const btn = document.createElement('button');
                btn.className = 'mobile-stem-download';
                btn.dataset.stem = stemName;
                btn.dataset.path = stemPath;

                const icon = stemIcons[stemName] || 'fa-music';
                const label = stemLabels[stemName] || stemName.charAt(0).toUpperCase() + stemName.slice(1);

                btn.innerHTML = `<i class="fas ${icon}"></i><span>${label}</span>`;
                btn.addEventListener('click', () => this.downloadStem(stemName, stemPath));

                this.downloadStemsList.appendChild(btn);
            });
        }

        // Show/hide original download based on file_path availability
        if (this.downloadOriginalBtn) {
            this.downloadOriginalBtn.style.display = item.file_path ? 'flex' : 'none';
        }

        // Show the sheet
        this.downloadSheet.classList.add('active');
    }

    closeDownloadSheet() {
        if (this.downloadSheet) {
            this.downloadSheet.classList.remove('active');
        }
    }

    downloadOriginal() {
        if (!this.currentDownloadItem?.file_path) {
            alert('Original audio not available');
            return;
        }

        const url = '/api/download-file?file_path=' + encodeURIComponent(this.currentDownloadItem.file_path);
        this.triggerDownload(url);
        this.closeDownloadSheet();
    }

    async downloadZip() {
        if (!this.currentDownloadItem) return;

        const item = this.currentDownloadItem;
        const zipPath = item.stems_zip_path || item.zip_path;

        if (zipPath) {
            // ZIP already exists
            const url = '/api/download-file?file_path=' + encodeURIComponent(zipPath);
            this.triggerDownload(url);
            this.closeDownloadSheet();
            return;
        }

        // Need to create ZIP first
        const extractionId = item.extraction_id || item.id;
        if (!extractionId) {
            alert('Cannot create ZIP: extraction ID not found');
            return;
        }

        // Show loading state
        if (this.downloadZipBtn) {
            this.downloadZipBtn.classList.add('loading');
            this.downloadZipBtn.querySelector('span').textContent = 'Creating ZIP...';
        }

        try {
            const res = await fetch(`/api/extractions/${encodeURIComponent(extractionId)}/create-zip`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                }
            });

            const data = await res.json();

            if (data.success && data.zip_path) {
                // Update item with zip path for future use
                item.stems_zip_path = data.zip_path;
                const url = '/api/download-file?file_path=' + encodeURIComponent(data.zip_path);
                this.triggerDownload(url);
                this.closeDownloadSheet();
            } else {
                alert(data.error || 'Failed to create ZIP');
            }
        } catch (err) {
            console.error('Error creating ZIP:', err);
            alert('Error creating ZIP file');
        } finally {
            // Reset button state
            if (this.downloadZipBtn) {
                this.downloadZipBtn.classList.remove('loading');
                this.downloadZipBtn.querySelector('span').textContent = 'All Stems (ZIP)';
            }
        }
    }

    downloadStem(stemName, stemPath) {
        if (!stemPath) {
            alert(`${stemName} stem not available`);
            return;
        }

        const url = '/api/download-file?file_path=' + encodeURIComponent(stemPath);
        this.triggerDownload(url);
        this.closeDownloadSheet();
    }

    triggerDownload(url) {
        // Use hidden link to trigger download
        const link = document.createElement('a');
        link.href = url;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async confirmRemoveFromLibrary(item) {
        if (!item) return;
        this.currentDownloadItem = item;
        await this.removeFromLibrary();
    }

    async removeFromLibrary() {
        if (!this.currentDownloadItem) return;

        const item = this.currentDownloadItem;
        const title = item.title || 'this track';

        if (!confirm(`Remove "${title}" from your library?\n\nThis will not delete the actual files.`)) {
            return;
        }

        this.closeDownloadSheet();

        const videoId = item.video_id;
        if (!videoId) {
            alert('Cannot remove: video ID not found');
            return;
        }

        try {
            // Remove download access
            const downloadRes = await fetch(`/api/user/downloads/${encodeURIComponent(videoId)}/remove-from-list`, {
                method: 'DELETE',
                headers: {
                    'X-CSRF-Token': this.csrfToken
                }
            });

            // Also remove extraction access if exists
            const extractionRes = await fetch(`/api/user/extractions/${encodeURIComponent(videoId)}/remove-from-list`, {
                method: 'DELETE',
                headers: {
                    'X-CSRF-Token': this.csrfToken
                }
            });

            const downloadData = await downloadRes.json();

            if (downloadData.success) {
                // Remove item from local tracking
                this.myLibraryVideoIds.delete(videoId);

                // Remove from DOM
                const element = this.findLibraryItem(null, videoId);
                if (element) {
                    element.remove();
                }

                // Show success message
                this.showToast('Removed from library', 'success');

                // Refresh library to ensure sync
                await this.loadLibrary();
            } else {
                throw new Error(downloadData.error || 'Remove failed');
            }
        } catch (err) {
            console.error('Error removing from library:', err);
            this.showToast('Error removing from library', 'error');
        }
    }

    // ========================================
    // Export Mix Modal
    // ========================================

    setupExportModal() {
        this.exportModal = document.getElementById('mobileExportModal');
        if (!this.exportModal) return;

        this.exportFilenameInput = document.getElementById('mobileExportFilename');
        this.exportStemsCount = document.getElementById('mobileExportStemsCount');
        this.exportTempoDisplay = document.getElementById('mobileExportTempo');
        this.exportPitchDisplay = document.getElementById('mobileExportPitch');
        this.exportProgress = document.getElementById('mobileExportProgress');
        this.exportProgressBar = document.getElementById('mobileExportProgressBar');
        this.exportStatus = document.getElementById('mobileExportStatus');
        this.exportStartBtn = document.getElementById('mobileExportStart');
        this.exportCancelBtn = document.getElementById('mobileExportCancel');
        this.exportCloseBtn = document.getElementById('mobileExportClose');

        // Export button in mixer header
        const exportBtn = document.getElementById('mobileMixerExport');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.openExportModal());
        }

        // Modal buttons
        if (this.exportStartBtn) {
            this.exportStartBtn.addEventListener('click', () => this.startExport());
        }
        if (this.exportCancelBtn) {
            this.exportCancelBtn.addEventListener('click', () => this.closeExportModal());
        }
        if (this.exportCloseBtn) {
            this.exportCloseBtn.addEventListener('click', () => this.closeExportModal());
        }

        // Close on backdrop click
        this.exportModal.addEventListener('click', (e) => {
            if (e.target === this.exportModal) {
                this.closeExportModal();
            }
        });
    }

    openExportModal() {
        if (!this.exportModal) return;

        // Generate default filename from current track title
        const title = document.getElementById('mobileMixerTitle')?.textContent || 'mix';
        const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        if (this.exportFilenameInput) {
            this.exportFilenameInput.value = `${safeTitle}_mix`;
        }

        // Count active stems
        const activeStems = Object.values(this.stems || {}).filter(s => !s.muted && s.buffer);
        if (this.exportStemsCount) {
            this.exportStemsCount.textContent = `${activeStems.length} active`;
        }

        // Show tempo
        const tempoRatio = this.currentBPM && this.originalBPM
            ? (this.currentBPM / this.originalBPM)
            : 1.0;
        if (this.exportTempoDisplay) {
            this.exportTempoDisplay.textContent = `${Math.round(tempoRatio * 100)}%`;
            if (this.currentBPM) {
                this.exportTempoDisplay.textContent += ` (${Math.round(this.currentBPM)} BPM)`;
            }
        }

        // Show pitch
        const pitchSemitones = this.currentPitchShift || 0;
        if (this.exportPitchDisplay) {
            this.exportPitchDisplay.textContent = pitchSemitones >= 0
                ? `+${pitchSemitones} st`
                : `${pitchSemitones} st`;
        }

        // Reset progress
        if (this.exportProgress) this.exportProgress.style.display = 'none';
        if (this.exportProgressBar) this.exportProgressBar.style.width = '0%';
        if (this.exportStartBtn) {
            this.exportStartBtn.disabled = false;
            this.exportStartBtn.classList.remove('exporting');
            this.exportStartBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }

        // Show modal
        this.exportModal.classList.add('visible');
    }

    closeExportModal() {
        if (this.exportModal) {
            this.exportModal.classList.remove('visible');
        }
    }

    async startExport() {
        if (!this.stems || Object.keys(this.stems).length === 0) {
            this.showToast('No stems loaded', 'error');
            return;
        }

        const filename = this.exportFilenameInput?.value?.trim() || 'mix';

        // Collect mixer state
        const mixerState = {
            stems: {},
            tempo: this.currentBPM && this.originalBPM
                ? (this.currentBPM / this.originalBPM)
                : 1.0,
            pitch: this.currentPitchShift || 0,
            title: filename
        };

        // Collect stem states
        for (const [name, stem] of Object.entries(this.stems)) {
            if (stem.buffer) {
                mixerState.stems[name] = {
                    buffer: stem.buffer,
                    volume: stem.gainNode?.gain?.value ?? 1.0,
                    pan: stem.panNode?.pan?.value ?? 0,
                    muted: stem.muted || false
                };
            }
        }

        // Show progress
        if (this.exportProgress) this.exportProgress.style.display = 'block';
        if (this.exportStartBtn) {
            this.exportStartBtn.disabled = true;
            this.exportStartBtn.classList.add('exporting');
            this.exportStartBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        }

        try {
            const exporter = new MixExporter({
                sampleRate: 44100,
                bitRate: 192,
                onProgress: (percent, status) => {
                    if (this.exportProgressBar) {
                        this.exportProgressBar.style.width = `${percent}%`;
                    }
                    if (this.exportStatus) {
                        this.exportStatus.textContent = status;
                    }
                }
            });

            const mp3Blob = await exporter.exportMix(mixerState);

            // Download
            exporter.downloadBlob(mp3Blob, `${filename}.mp3`);

            this.showToast('Mix exported successfully!', 'success');
            this.closeExportModal();

        } catch (error) {
            console.error('Export error:', error);
            this.showToast(`Export failed: ${error.message}`, 'error');

            // Reset button
            if (this.exportStartBtn) {
                this.exportStartBtn.disabled = false;
                this.exportStartBtn.classList.remove('exporting');
                this.exportStartBtn.innerHTML = '<i class="fas fa-download"></i> Export';
            }
        }
    }

    getSelectedStemsFromModal() {
        if (!this.extractionStemsContainer) return [];
        const inputs = this.extractionStemsContainer.querySelectorAll('input[type="checkbox"]');
        const selected = [];
        inputs.forEach(input => {
            if (input.checked) selected.push(input.value);
        });
        return selected;
    }

    async submitExtractionFromModal() {
        if (!this.currentExtractionItem) {
            this.closeExtractionModal();
            return;
        }
        const selectedStems = this.getSelectedStemsFromModal();
        if (!selectedStems.length) {
            alert('Please select at least one stem to extract.');
            return;
        }

        const config = {
            model_name: this.extractionModelSelect ? this.extractionModelSelect.value : 'htdemucs',
            selected_stems: selectedStems,
            two_stem_mode: this.twoStemCheckbox ? this.twoStemCheckbox.checked : false,
            primary_stem: this.primaryStemSelect ? this.primaryStemSelect.value : 'vocals'
        };

        this.closeExtractionModal();
        await this.startExtractionRequest(this.currentExtractionItem, config);
    }

    async loadLibrary() {
        if (this.libraryLoading) {
            this.pendingLibraryRefresh = true;
            return;
        }

        this.libraryLoading = true;
        try {
            const res = await fetch('/api/downloads');
            const items = await res.json();
            const normalized = Array.isArray(items) ? items : [];

            this.myLibraryVideoIds.clear();
            normalized.forEach(item => {
                if (item.video_id) this.myLibraryVideoIds.add(item.video_id);
            });

            this.displayLibrary(normalized, 'mobileLibraryList', false);
            this.updateLibraryAutoRefresh(normalized);
        } catch (error) {
            console.error('[Library]', error);
            // Offline mode: show cached songs
            if (!navigator.onLine) {
                console.log('[Library] Offline - showing cached songs');
                const offlineSongs = this.getOfflineSongsMetadata();
                if (offlineSongs.length > 0) {
                    this.displayLibrary(offlineSongs, 'mobileLibraryList', false, true);
                    this.showToast('Showing offline songs', 'info');
                } else {
                    const container = document.getElementById('mobileLibraryList');
                    if (container) {
                        container.innerHTML = '<p class="mobile-text-muted">No cached songs. Save songs for offline while connected.</p>';
                    }
                }
            }
            this.updateLibraryAutoRefresh([]);
        } finally {
            this.libraryLoading = false;
            if (this.pendingLibraryRefresh) {
                this.pendingLibraryRefresh = false;
                this.loadLibrary();
            }
        }
    }

    async loadGlobalLibrary() {
        try {
            const res = await fetch('/api/library');
            const data = await res.json();
            this.displayLibrary(data.items || [], 'mobileGlobalList', true);
        } catch (error) {
            console.error('[GlobalLibrary]', error);
            // Offline mode: show cached songs in global library too
            if (!navigator.onLine) {
                console.log('[GlobalLibrary] Offline - showing cached songs');
                const offlineSongs = this.getOfflineSongsMetadata();
                this.displayLibrary(offlineSongs, 'mobileGlobalList', true, true);
            }
        }
    }

    displayLibrary(items, containerId, isGlobal, isOffline = false) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        if (!items.length) {
            container.innerHTML = isOffline
                ? '<p class="mobile-text-muted">No cached songs available offline</p>'
                : '<p class="mobile-text-muted">No items</p>';
            return;
        }

        // Show offline banner if in offline mode
        if (isOffline) {
            const banner = document.createElement('div');
            banner.className = 'mobile-offline-banner';
            banner.innerHTML = '<i class="fas fa-wifi-slash"></i> Offline Mode - Showing cached songs only';
            container.appendChild(banner);
        }

        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        this.setupChordInstrumentToggle();

        items.forEach(item => {
            const hasStems = isOffline ? true : (item.extracted || item.has_extraction || item.user_has_extraction_access);
            const alreadyInLibrary = this.myLibraryVideoIds.has(item.video_id);
            const div = document.createElement('div');
            div.className = 'mobile-library-item' + (isOffline ? ' offline-item' : '');
            const statusInfo = this.getStatusInfo(item, hasStems, isGlobal, alreadyInLibrary);

            if (statusInfo.downloadId) div.dataset.downloadId = statusInfo.downloadId;
            if (item.video_id) div.dataset.videoId = item.video_id;
            if (statusInfo.extractionId) div.dataset.extractionId = statusInfo.extractionId;
            // For offline items, use the stored offline_id
            if (isOffline && item.offline_id) {
                div.dataset.extractionId = item.offline_id;
            }
            div.dataset.status = statusInfo.statusKey;
            if (isOffline) div.dataset.offline = 'true';

            let actions = '';
            if (isOffline) {
                // Offline mode: only show Mix button for cached songs
                actions = '<div class="mobile-library-extracted"><i class="fas fa-cloud"></i> Cached</div>' +
                          '<button class="mobile-btn mobile-btn-primary mix-btn">Mix</button>';
            } else if (isGlobal) {
                if (alreadyInLibrary) {
                    actions = '<div class="mobile-library-status"><i class="fas fa-check"></i> In Library</div>';
                } else if (hasStems) {
                    actions = '<button class="mobile-btn mobile-btn-small add-btn">Add</button>';
                } else {
                    actions = '<div class="mobile-library-status">Not extracted</div>';
                }
            } else {
                // Don't show Extract button during extraction (extracting, queued, processing)
                const isExtractionInProgress = ['extracting', 'queued', 'processing'].includes(statusInfo.statusKey);
                // Remove button always available for My Library items
                const removeBtn = '<button class="remove-btn" title="Remove from library"><i class="fas fa-trash-alt"></i></button>';
                if (hasStems) {
                    actions = '<div class="mobile-library-extracted"><i class="fas fa-check-circle"></i> Ready</div>' +
                              '<button class="mobile-btn mobile-btn-primary mix-btn">Mix</button>' +
                              '<button class="save-offline-btn" title="Save for offline"><i class="fas fa-cloud-download-alt"></i></button>' +
                              '<button class="download-btn" title="Download"><i class="fas fa-download"></i></button>' +
                              removeBtn;
                } else if (isExtractionInProgress) {
                    // Show remove button even during extraction
                    actions = removeBtn;
                } else {
                    actions = '<button class="mobile-btn mobile-btn-small extract-btn">Extract</button>' + removeBtn;
                }
            }

            const actionsHtml = '<div class="mobile-library-actions">' + (actions || '') + '</div>';
            const statusDetail = statusInfo.detail ? '<span class="mobile-status-detail">' + this.escapeHtml(statusInfo.detail) + '</span>' : '';
            const progressMeta = statusInfo.meta ? this.escapeHtml(statusInfo.meta) : '';
            const progressClass = statusInfo.showProgress ? 'mobile-progress-container' : 'mobile-progress-container is-hidden';
            const thumbnail = item.thumbnail_url || item.thumbnail || '/static/img/default-thumb.svg';

            div.innerHTML = `
                <img src="${thumbnail}" class="mobile-library-thumbnail" alt="${this.escapeHtml(item.title || 'Track')}">
                <div class="mobile-library-info">
                    <div class="mobile-library-title">${this.escapeHtml(item.title || 'Untitled')}</div>
                    <div class="mobile-library-status-line">
                        <span class="mobile-status-pill ${statusInfo.statusClass}">${this.escapeHtml(statusInfo.statusText)}</span>
                        ${statusDetail}
                    </div>
                    <div class="${progressClass}">
                        <div class="mobile-progress-track">
                            <div class="mobile-progress-fill" style="width: ${statusInfo.progressPercent}%"></div>
                        </div>
                        <div class="mobile-progress-meta">
                            <span class="mobile-progress-value">${statusInfo.progressPercent}%</span>
                            <span class="mobile-progress-extra">${progressMeta}</span>
                        </div>
                    </div>
                    ${actionsHtml}
                </div>
            `;
            div.__libraryItem = item;
            
            if (isGlobal) {
                const btn = div.querySelector('.add-btn');
                if (btn) btn.addEventListener('click', e => { e.stopPropagation(); this.addToMyLibrary(item); });
            } else {
                const extract = div.querySelector('.extract-btn');
                const mix = div.querySelector('.mix-btn');
                const download = div.querySelector('.download-btn');
                const remove = div.querySelector('.remove-btn');
                if (extract) extract.addEventListener('click', e => { e.stopPropagation(); this.extractStems(item); });
                if (mix) mix.addEventListener('click', e => { e.stopPropagation(); this.openMixer(item); });
                if (download) download.addEventListener('click', e => { e.stopPropagation(); this.openDownloadSheet(item); });
                if (remove) remove.addEventListener('click', e => { e.stopPropagation(); this.confirmRemoveFromLibrary(item); });

                // Save offline button
                const saveOffline = div.querySelector('.save-offline-btn');
                if (saveOffline) {
                    // Check if already cached and update button state
                    this.updateSaveOfflineButton(saveOffline, item);
                    saveOffline.addEventListener('click', e => {
                        e.stopPropagation();
                        this.handleSaveOffline(saveOffline, item);
                    });
                }
            }

            container.appendChild(div);
        });

        // Batch fetch extraction statuses for items without stems (instead of individual calls)
        if (!isGlobal) {
            const videoIdsToCheck = items
                .filter(item => !item.extracted && !item.has_extraction && !item.user_has_extraction_access && item.video_id)
                .map(item => item.video_id);
            if (videoIdsToCheck.length > 0) {
                this.batchFetchExtractionStatuses(videoIdsToCheck, container);
            }
        }
    }

    async batchFetchExtractionStatuses(videoIds, container) {
        try {
            const res = await fetch('/api/downloads/batch-extraction-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_ids: videoIds })
            });
            if (!res.ok) return;
            const data = await res.json();
            const statuses = data.statuses || {};

            for (const videoId of videoIds) {
                const status = statuses[videoId];
                if (!status) continue;
                const element = container.querySelector(`[data-video-id="${videoId}"]`);
                if (!element) continue;
                const item = element.__libraryItem;

                if (status.status === 'extracted') {
                    this.markItemReady(element, item, status);
                } else if (status.status === 'extracted_no_access') {
                    this.markItemNeedsAccess(element, item, status);
                }
            }
        } catch (err) {
            console.warn('[Library] Batch extraction status check failed:', err);
        }
    }
    
    getStatusInfo(item, hasStems, isGlobal, alreadyInLibrary) {
        const downloadId = item.download_id || item.id || '';
        const extractionId = item.extraction_id || '';
        let statusKey = '';
        if (item.status) {
            if (typeof item.status === 'string') statusKey = item.status.toLowerCase();
            else if (item.status.value) statusKey = item.status.value.toLowerCase();
        }

        let statusText = 'Idle';
        if (isGlobal) {
            if (alreadyInLibrary) {
                statusKey = 'ready';
                statusText = 'In Library';
            } else if (hasStems) {
                statusKey = 'ready';
                statusText = 'Ready Globally';
            } else {
                statusKey = 'not-extracted';
                statusText = 'Not extracted';
            }
        } else {
            switch (statusKey) {
                case 'downloading':
                case 'active':
                    statusKey = 'downloading';
                    statusText = 'Downloading';
                    break;
                case 'queued':
                    statusText = 'Queued';
                    break;
                case 'extracting':
                    statusText = 'Extracting';
                    break;
                case 'failed':
                case 'error':
                    statusKey = 'failed';
                    statusText = 'Failed';
                    break;
                case 'completed':
                    statusKey = hasStems ? 'ready' : 'completed';
                    statusText = hasStems ? 'Ready' : 'Downloaded';
                    break;
                case 'cancelled':
                    statusText = 'Cancelled';
                    break;
                default:
                    statusKey = hasStems ? 'ready' : 'idle';
                    statusText = hasStems ? 'Ready' : 'Idle';
            }
        }

        const baseProgress = this.normalizeProgress(item.progress);
        const showProgress = !isGlobal && (this.statusNeedsProgress(statusKey) || (baseProgress > 0 && baseProgress < 100));
        const metaParts = [];
        if (item.speed) metaParts.push(item.speed);
        if (item.eta) metaParts.push(item.eta);
        if (!metaParts.length && item.status_message) metaParts.push(item.status_message);
        const metaText = metaParts.join(' • ');

        return {
            downloadId,
            extractionId,
            statusKey,
            statusText,
            statusClass: 'status-' + statusKey,
            showProgress,
            progressPercent: this.formatProgressPercent(showProgress ? baseProgress : 0),
            meta: showProgress ? metaText : '',
            detail: showProgress ? '' : metaText
        };
    }

    statusNeedsProgress(statusKey) {
        return ['downloading', 'queued', 'extracting', 'processing', 'active'].includes(statusKey);
    }

    normalizeProgress(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.min(100, Math.max(0, num));
    }

    formatProgressPercent(value) {
        const rounded = Math.round(value);
        if (!Number.isFinite(rounded)) return 0;
        return Math.min(100, Math.max(0, rounded));
    }

    ensureExtractionStatusForItem(element, item, statusInfo) {
        if (!item?.video_id) return;
        if (statusInfo.statusKey === 'ready') return;
        if (['downloading', 'queued', 'extracting'].includes(statusInfo.statusKey)) return;
        this.fetchExtractionStatus(item.video_id)
            .then(status => {
                if (!status) return;
                if (status.status === 'extracted') {
                    this.markItemReady(element, item, status);
                } else if (status.status === 'extracted_no_access') {
                    this.markItemNeedsAccess(element, item, status);
                }
            })
            .catch(err => console.warn('[Library] Extraction status check failed:', err));
    }

    fetchExtractionStatus(videoId) {
        if (!videoId) return Promise.resolve(null);
        if (!this.extractionStatusCache) this.extractionStatusCache = new Map();
        if (this.extractionStatusCache.has(videoId)) {
            return this.extractionStatusCache.get(videoId);
        }
        const promise = fetch(`/api/downloads/${encodeURIComponent(videoId)}/extraction-status`)
            .then(async res => {
                if (!res.ok) return null;
                return res.json();
            })
            .finally(() => {
                // Keep cache only briefly to avoid hammering API on repeated renders
                setTimeout(() => this.extractionStatusCache.delete(videoId), 5000);
            });
        this.extractionStatusCache.set(videoId, promise);
        return promise;
    }

    markItemReady(element, item, status) {
        const record = element.__libraryItem || item || {};
        element.__libraryItem = record;
        element.dataset.status = 'ready';
        const pill = element.querySelector('.mobile-status-pill');
        if (pill) {
            pill.textContent = 'Ready';
            pill.className = 'mobile-status-pill status-ready';
        }
        const detail = element.querySelector('.mobile-status-detail');
        if (detail) {
            detail.textContent = status?.extraction_model || 'Stems available';
        }
        const progress = element.querySelector('.mobile-progress-container');
        if (progress) progress.classList.add('is-hidden');

        const actions = element.querySelector('.mobile-library-actions') || element.appendChild(document.createElement('div'));
        actions.classList.add('mobile-library-actions');
        actions.innerHTML = '';

        const readyLabel = document.createElement('div');
        readyLabel.className = 'mobile-library-extracted';
        readyLabel.innerHTML = '<i class="fas fa-check-circle"></i> Ready';
        const mixBtn = document.createElement('button');
        mixBtn.className = 'mobile-btn mobile-btn-primary mix-btn';
        mixBtn.textContent = 'Mix';
        mixBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.openMixer(record);
        });

        actions.appendChild(readyLabel);
        actions.appendChild(mixBtn);

        if (status?.extraction_id) element.dataset.extractionId = status.extraction_id;
        if (record) {
            record.extracted = true;
            record.has_extraction = true;
        }
    }

    markItemNeedsAccess(element, item, status) {
        const record = element.__libraryItem || item || {};
        element.__libraryItem = record;
        element.dataset.status = 'needs-access';
        const pill = element.querySelector('.mobile-status-pill');
        if (pill) {
            pill.textContent = 'Extracted';
            pill.className = 'mobile-status-pill status-queued';
        }
        const detail = element.querySelector('.mobile-status-detail');
        if (detail) detail.textContent = 'Tap to request access';
        const progress = element.querySelector('.mobile-progress-container');
        if (progress) progress.classList.add('is-hidden');

        const actions = element.querySelector('.mobile-library-actions') || element.appendChild(document.createElement('div'));
        actions.classList.add('mobile-library-actions');
        actions.innerHTML = '';

        const requestBtn = document.createElement('button');
        requestBtn.className = 'mobile-btn mobile-btn-small';
        requestBtn.textContent = 'Request Access';
        requestBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.requestExtractionAccess(record?.video_id, actions, element);
        });
        actions.appendChild(requestBtn);
    }

    async requestExtractionAccess(videoId, container, element) {
        if (!videoId) return;
        try {
            container.classList.add('mobile-loading');
            container.innerHTML = '<span class="mobile-text-muted">Requesting access...</span>';
            const res = await fetch('/api/extractions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ video_id: videoId, grant_access_only: true })
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Failed');
            alert(data.message || 'Access granted!');
            this.loadLibrary();
        } catch (error) {
            alert('Access request failed: ' + error.message);
            container.innerHTML = '';
            const retry = document.createElement('button');
            retry.className = 'mobile-btn mobile-btn-small';
            retry.textContent = 'Retry Access';
            retry.addEventListener('click', e => {
                e.stopPropagation();
                this.requestExtractionAccess(videoId, container, element);
            });
            container.appendChild(retry);
        } finally {
            container.classList.remove('mobile-loading');
        }
    }

    updateLibraryAutoRefresh(items) {
        const needsRefresh = items.some(item => {
            const rawStatus = (item.status && item.status.value) ? item.status.value : (item.status || '');
            return this.statusNeedsProgress(rawStatus.toString().toLowerCase());
        });
        if (needsRefresh) {
            if (!this.libraryRefreshTimer) {
                this.libraryRefreshTimer = setInterval(() => this.loadLibrary(), this.libraryPollingInterval);
            }
        } else {
            this.clearLibraryAutoRefresh();
        }
    }

    clearLibraryAutoRefresh() {
        if (this.libraryRefreshTimer) {
            clearInterval(this.libraryRefreshTimer);
            this.libraryRefreshTimer = null;
        }
    }

    findLibraryItem(downloadId, videoId, extractionId) {
        const items = document.querySelectorAll('.mobile-library-item');
        let found = null;
        items.forEach(el => {
            if (found) return;
            if (downloadId && el.dataset.downloadId === String(downloadId)) found = el;
            else if (videoId && el.dataset.videoId === String(videoId)) found = el;
            else if (extractionId && el.dataset.extractionId === String(extractionId)) found = el;
        });
        return found;
    }

    showProgressContainer(element) {
        if (!element) return;
        const container = element.querySelector('.mobile-progress-container');
        if (container) container.classList.remove('is-hidden');
    }

    updateProgressElements(element, progress, meta) {
        if (!element) return;
        this.showProgressContainer(element);
        const fill = element.querySelector('.mobile-progress-fill');
        const value = element.querySelector('.mobile-progress-value');
        const extra = element.querySelector('.mobile-progress-extra');
        if (fill) fill.style.width = this.formatProgressPercent(progress) + '%';
        if (value) value.textContent = this.formatProgressPercent(progress) + '%';
        if (extra) extra.textContent = meta || '';
    }

    updateStatusPill(element, statusKey, text, detail) {
        if (!element) return;
        element.dataset.status = statusKey;
        const pill = element.querySelector('.mobile-status-pill');
        if (pill) {
            pill.textContent = text;
            pill.className = 'mobile-status-pill status-' + statusKey;
        }
        const detailEl = element.querySelector('.mobile-status-detail');
        if (detailEl) detailEl.textContent = detail || '';

        // Hide/show Extract button based on extraction status
        const extractBtn = element.querySelector('.extract-btn');
        if (extractBtn) {
            const isExtractionInProgress = ['extracting', 'queued', 'processing'].includes(statusKey);
            extractBtn.style.display = isExtractionInProgress ? 'none' : '';
        }
    }

    formatSpeedEta(speed, eta) {
        const parts = [];
        if (speed) parts.push(speed);
        if (eta) parts.push(eta);
        return parts.join(' • ');
    }

    onDownloadProgress(data) {
        const element = this.findLibraryItem(data.download_id, data.video_id);
        if (!element) {
            this.loadLibrary();
            return;
        }
        const progress = this.normalizeProgress(data.progress);
        const meta = this.formatSpeedEta(data.speed, data.eta) || 'Downloading...';
        this.updateStatusPill(element, 'downloading', 'Downloading', '');
        this.updateProgressElements(element, progress, meta);
    }

    onDownloadComplete() {
        this.loadLibrary();
    }

    onDownloadError(data) {
        const element = this.findLibraryItem(data.download_id);
        if (!element) {
            this.loadLibrary();
            return;
        }
        this.updateStatusPill(element, 'failed', 'Failed', data.error_message || 'Download failed');
        this.updateProgressElements(element, 0, data.error_message || '');
    }

    onExtractionProgress(data) {
        const element = this.findLibraryItem(data.download_id, data.video_id, data.extraction_id);
        if (!element) {
            this.loadLibrary();
            return;
        }
        const progress = this.normalizeProgress(data.progress);
        const meta = data.status_message || 'Extracting...';
        this.updateStatusPill(element, 'extracting', 'Extracting', meta);
        this.updateProgressElements(element, progress, meta);
        if (data.extraction_id) element.dataset.extractionId = data.extraction_id;
    }

    onExtractionComplete() {
        this.loadLibrary();
    }

    onExtractionError(data) {
        const element = this.findLibraryItem(null, null, data.extraction_id);
        if (!element) {
            this.loadLibrary();
            return;
        }
        this.updateStatusPill(element, 'failed', 'Extraction failed', data.error_message || '');
        this.updateProgressElements(element, 0, data.error_message || '');
    }

    async addToMyLibrary(item) {
        if (!item || !item.id) {
            alert('Unable to add this item right now.');
            return;
        }

        const userHasDownload = Boolean(item.user_has_download_access);
        const userHasExtraction = Boolean(item.user_has_extraction_access);
        const downloadAvailable = Boolean(item.can_add_download || item.has_download || item.file_path);
        const extractionAvailable = Boolean(item.can_add_extraction || item.has_extraction || item.extracted);

        const actions = [];

        if (downloadAvailable && !userHasDownload) {
            actions.push({
                type: 'download',
                url: `/api/library/${item.id}/add-download`
            });
        }

        if (extractionAvailable && !userHasExtraction) {
            actions.push({
                type: 'extraction',
                url: `/api/library/${item.id}/add-extraction`
            });
        }

        if (!actions.length) {
            alert('This track is already in your library.');
            return;
        }

        try {
            for (const action of actions) {
                const res = await fetch(action.url, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'}
                });

                let data = {};
                try {
                    data = await res.json();
                } catch (_) {
                    data = {};
                }

                if (!res.ok || data.error) {
                    throw new Error(data.error || `Unable to add ${action.type}`);
                }
            }

            alert('Added!');
            await this.loadLibrary();
            await this.loadGlobalLibrary();
        } catch (error) {
            console.error('[AddToLibrary]', error);
            alert('Failed: ' + error.message);
        }
    }

    async extractStems(item) {
        if (!item || !item.file_path) {
            alert('Please wait for the download to finish before extracting.');
            return;
        }
        this.openExtractionModal(item);
    }

    async startExtractionRequest(item, config = {}) {
        if (!item || !item.file_path) {
            alert('Please wait for the download to finish before extracting.');
            return;
        }

        const fallbackStems = Array.isArray(item.selected_stems) && item.selected_stems.length
            ? item.selected_stems
            : ['vocals', 'drums', 'bass', 'other'];

        const payload = {
            video_id: item.video_id,
            audio_path: item.file_path,
            model_name: config.model_name || item.model_name || 'htdemucs',
            selected_stems: Array.isArray(config.selected_stems) && config.selected_stems.length ? config.selected_stems : fallbackStems,
            two_stem_mode: Boolean(config.two_stem_mode || (item.two_stem_mode && item.two_stem_mode !== 'false')),
            primary_stem: config.primary_stem || item.primary_stem || 'vocals',
            title: item.title || ''
        };

        try {
            const res = await fetch('/api/extractions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || ('Extraction failed with status ' + res.status));
            }

            const downloadId = item.download_id || item.id || '';
            const libraryItem = this.findLibraryItem(downloadId, item.video_id);

            if (data.in_progress && data.extraction_id === 'in_progress') {
                alert(data.message || 'Extraction already running by another user. We will refresh when it completes.');
                if (libraryItem) {
                    this.updateStatusPill(libraryItem, 'queued', 'Queued', 'Waiting for existing extraction...');
                    this.updateProgressElements(libraryItem, 0, 'Waiting...');
                }
                this.loadLibrary();
                return;
            }

            if (libraryItem) {
                this.updateStatusPill(libraryItem, 'queued', 'Queued', 'Preparing extraction…');
                this.updateProgressElements(libraryItem, 0, 'Queued');
                if (data.extraction_id) {
                    libraryItem.dataset.extractionId = data.extraction_id;
                }
            }

            if (data.existing) {
                alert(data.message || 'Stems already available. Added to your library.');
                await this.loadLibrary();
                return;
            }

            alert('Extraction started! This card will update as it processes.');
            await this.loadLibrary();
        } catch (error) {
            alert('Extraction failed: ' + error.message);
        }
    }

    async openMixer(item) {
        this.showLoading('Loading stems…');
        try {
            // Use extraction_id (download_X format) if available, otherwise construct from download_id
            // For offline items, use offline_id
            const id = item.offline_id || item.extraction_id || (item.download_id ? `download_${item.download_id}` : null) || item.video_id;

            let data;

            // Check if we should use offline mode
            const isOfflineItem = item.offline_id || !navigator.onLine;

            if (isOfflineItem) {
                // Try to get data from offline storage first
                const offlineData = this.getOfflineSongData(id);
                if (offlineData) {
                    console.log('[Mixer] Using offline data for:', id);
                    data = offlineData;
                } else if (!navigator.onLine) {
                    throw new Error('This song is not available offline');
                }
            }

            // If not offline or no offline data, fetch from API
            if (!data) {
                const res = await fetch('/api/extractions/' + id);
                data = await res.json();
                if (data.error) throw new Error(data.error);
            }

            // Clean up previous mixer — keep AudioContext alive if jam session is active
            const isJamHost = this.jamClient && this.jamClient.isActive() && this.jamClient.getRole() === 'host';
            if (isJamHost) {
                // Light cleanup: stop playback and clear stems but keep AudioContext
                await this.lightMixerCleanup();
            } else {
                await this.cleanupMixer();
            }

            this.currentExtractionId = id;
            this.currentExtractionData = data;

            if (!this.audioContext) await this.initAudioContext();
            await this.loadMixerData(data, { showLoader: false, extractionId: id });

            const nav = document.getElementById('mobileNavMixer');
            if (nav) nav.style.display = 'flex';
            this.navigateTo('mixer');

            // Save state after opening mixer
            this.saveState();

            // Jam session: broadcast track load and current tempo to guests
            this._jamBroadcastTrackLoad();
            this._jamBroadcastTempo(this.currentBPM, this.originalBPM, 1.0);
        } catch (error) {
            alert('Failed: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    // Get offline song data for mixer
    getOfflineSongData(songId) {
        try {
            const offlineSongs = JSON.parse(localStorage.getItem('stemtube_offline_songs') || '{}');
            return offlineSongs[songId] || null;
        } catch (err) {
            console.warn('[Offline] Failed to get song data:', err);
            return null;
        }
    }

    async cleanupMixer() {
        if (this.cleanupRunning) {
            return this.cleanupRunning;
        }
        this.cleanupRunning = this.performMixerCleanup().finally(() => {
            this.cleanupRunning = null;
        });
        return this.cleanupRunning;
    }

    async performMixerCleanup() {
        console.log('[Cleanup] ========== Starting COMPLETE mixer cleanup ==========');

        // Stop playback animation FIRST
        this.stopPlaybackAnimation();
        this.isPlaying = false;
        this.updatePlayPauseButtons();
        console.log('[Cleanup] Playback stopped');

        // Clean up all stems thoroughly
        const stemNames = Object.keys(this.stems);
        console.log('[Cleanup] Cleaning up', stemNames.length, 'stems:', stemNames);

        Object.keys(this.stems).forEach(name => {
            const stem = this.stems[name];

            // Stop and disconnect source
            if (stem.source) {
                try {
                    stem.source.stop(0);
                    stem.source.disconnect();
                    console.log('[Cleanup] Stopped and disconnected source for:', name);
                } catch (e) {
                    console.warn('[Cleanup] Error stopping source:', name, e);
                }
                stem.source = null;
            }

            // Disconnect SoundTouch node
            if (stem.soundTouchNode) {
                try {
                    stem.soundTouchNode.disconnect();
                    console.log('[Cleanup] Disconnected SoundTouch node for:', name);
                } catch (e) {
                    console.warn('[Cleanup] Error disconnecting SoundTouch:', name, e);
                }
                stem.soundTouchNode = null;
            }

            // Disconnect gain node
            if (stem.gainNode) {
                try {
                    stem.gainNode.disconnect();
                    console.log('[Cleanup] Disconnected gain node for:', name);
                } catch (e) {
                    console.warn('[Cleanup] Error disconnecting gain:', name, e);
                }
                stem.gainNode = null;
            }

            // Disconnect pan node
            if (stem.panNode) {
                try {
                    stem.panNode.disconnect();
                    console.log('[Cleanup] Disconnected pan node for:', name);
                } catch (e) {
                    console.warn('[Cleanup] Error disconnecting pan:', name, e);
                }
                stem.panNode = null;
            }

            // Clear buffer reference (allow GC)
            stem.buffer = null;
        });

        // Clear stems object completely
        this.stems = {};
        this.masterAudioBuffer = null;
        this.masterAudioSource = null;
        console.log('[Cleanup] All stems cleared');

        // CRITICAL: Close AudioContext and WAIT for it to complete
        if (this.audioContext) {
            const currentState = this.audioContext.state;
            console.log('[Cleanup] AudioContext state before close:', currentState);

            if (currentState !== 'closed') {
                try {
                    // Disconnect master gain first
                    if (this.masterGainNode) {
                        this.masterGainNode.disconnect();
                        console.log('[Cleanup] Master gain disconnected');
                        this.masterGainNode = null;
                    }

                    // Close AudioContext and WAIT for completion
                    console.log('[Cleanup] Closing AudioContext...');
                    await this.audioContext.close();
                    console.log('[Cleanup] AudioContext.close() completed, final state:', this.audioContext.state);
                } catch (e) {
                    console.error('[Cleanup] Error closing AudioContext:', e);
                }
            }

            // Reset AudioContext reference
            this.audioContext = null;
            this.workletLoaded = false;
            console.log('[Cleanup] AudioContext reference cleared');

            // CRITICAL: Wait a bit to ensure browser has fully cleaned up
            await new Promise(resolve => setTimeout(resolve, 100));
            console.log('[Cleanup] Waited 100ms for browser cleanup');
        } else {
            console.log('[Cleanup] No AudioContext to clean up');
        }

        // Reset playback state
        this.currentTime = 0;
        this.duration = 0;
        this.startTime = 0;

        // Clear chords and lyrics
        this.chords = [];
        this.lyrics = [];
        this.playheadIndicator = null;

        // Clear track controls UI
        const tracksContainer = document.getElementById('mobileTracksContainer');
        if (tracksContainer) {
            tracksContainer.innerHTML = '';
        }

        // Clear waveform
        const waveformCanvas = document.getElementById('mobileWaveformCanvas');
        if (waveformCanvas) {
            const ctx = waveformCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
            }
        }
        const timeline = document.getElementById('mobileWaveformTimeline');
        if (timeline) timeline.innerHTML = '';

        this.currentChordSymbol = null;
        if (this.chordDiagramEl) {
            this.setChordDiagramMessage(DEFAULT_CHORD_MESSAGE);
        }
        // reset mixer metadata to avoid stale reloads
        this.currentExtractionId = null;
        this.currentExtractionVideoId = null;
        this.currentExtractionData = null;
        this.currentExtractionItem = null;
        this.currentPitchShift = 0;
        this.originalBPM = 120;
        this.currentBPM = 120;
        this.originalKey = 'C major';
        this.saveState();

        console.log('[Cleanup] ========== COMPLETE mixer cleanup finished ==========');
    }

    /**
     * Light cleanup for jam sessions: stops playback and disconnects stems,
     * but keeps AudioContext alive so new stems can load without user gesture.
     */
    async lightMixerCleanup() {
        console.log('[Cleanup] Light cleanup (preserving AudioContext)');

        // Stop playback
        this.stopPlaybackAnimation();
        this.isPlaying = false;
        this.updatePlayPauseButtons();

        // Disconnect and clear stems
        Object.keys(this.stems).forEach(name => {
            const stem = this.stems[name];
            try {
                if (stem.source) { stem.source.stop(0); stem.source.disconnect(); }
                if (stem.soundTouchNode) { stem.soundTouchNode.disconnect(); }
                if (stem.gainNode) { stem.gainNode.disconnect(); }
                if (stem.panNode) { stem.panNode.disconnect(); }
            } catch (e) { /* ignore */ }
        });
        this.stems = {};
        this.masterAudioBuffer = null;
        this.masterAudioSource = null;

        // Reset playback state
        this.currentTime = 0;
        this.startTime = 0;

        // Clear UI but keep AudioContext
        const tracksContainer = document.getElementById('mobileTracksContainer');
        if (tracksContainer) tracksContainer.innerHTML = '';

        const waveformCanvas = document.getElementById('mobileWaveformCanvas');
        if (waveformCanvas) {
            const ctx = waveformCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        }

        console.log('[Cleanup] Light cleanup done — AudioContext preserved');
    }

    async loadMixerData(data, options = {}) {
        const showLoader = options.showLoader !== false;
        const cacheKey = options.extractionId || this.currentExtractionId;
        if (showLoader) this.showLoading('Loading stems…');
        try {
            console.log('[LoadMixer] Starting with data:', data);
            document.getElementById('mobileMixerTitle').textContent = data.title || 'Unknown';

            if (data.detected_bpm) {
                this.originalBPM = data.detected_bpm;
                this.currentBPM = data.detected_bpm;
                console.log('[LoadMixer] BPM set to:', this.originalBPM);
            }
            this.syncTempoValueBPM(this.currentBPM);

            if (data.detected_key) {
                this.originalKey = data.detected_key;
                console.log('[LoadMixer] Key set to:', this.originalKey);
            }
            this.syncKeyDisplay();

        const stemsPaths = typeof data.stems_paths === 'string' ? JSON.parse(data.stems_paths) : data.stems_paths;
        console.log('[LoadMixer] Stems paths:', stemsPaths);

        if (!stemsPaths) {
            console.error('[LoadMixer] No stems paths found!');
            throw new Error('No stems');
        }

        this.stems = {};
        const container = document.getElementById('mobileTracksContainer');
        if (container) {
            container.innerHTML = '';
            console.log('[LoadMixer] Cleared tracks container');
        } else {
            console.error('[LoadMixer] Tracks container not found!');
        }

        const stemNames = Object.keys(stemsPaths);
        console.log('[LoadMixer] Loading', stemNames.length, 'stems:', stemNames);

        const loadStart = performance.now();
        await Promise.all(stemNames.map(name => this.loadStem(name, stemsPaths[name])));
        console.log(`[LoadMixer] All stems loaded in ${(performance.now() - loadStart).toFixed(0)}ms`);

        const loadedStems = Object.keys(this.stems);
        console.log('[LoadMixer] Loaded stems:', loadedStems);

        const durations = Object.values(this.stems).map(s => s.buffer ? s.buffer.duration : 0).filter(d => d > 0);
        if (durations.length) {
            this.duration = Math.max(...durations);
            console.log('[LoadMixer] Duration set to:', this.duration);
        } else {
            console.error('[LoadMixer] No valid durations found!');
        }

        await this.ensureMasterAudioBuffer(data);

        // Render waveform
        console.log('[LoadMixer] Rendering waveform...');
        this.renderWaveform();

        if (typeof data.beat_offset === 'number') {
            this.beatOffset = data.beat_offset;
        } else {
            this.beatOffset = 0;
        }
        this.beatsPerBar = data.beats_per_bar || data.time_signature?.beats || 4;
        this.chordBPM = this.currentBPM || this.originalBPM || 120;

        const chordPayload = data.chords_data ?? data.chords ?? null;
        this.currentExtractionVideoId = data.video_id || this.currentExtractionVideoId || null;
        let parsedChords = null;
        if (chordPayload) {
            try {
                parsedChords = typeof chordPayload === 'string' ? JSON.parse(chordPayload) : chordPayload;
            } catch (err) {
                console.warn('[LoadMixer] Failed to parse chords payload:', err);
            }
            if (parsedChords && !Array.isArray(parsedChords) && Array.isArray(parsedChords.chords)) {
                parsedChords = parsedChords.chords;
            }
        }

        if (Array.isArray(parsedChords)) {
            this.chords = parsedChords;
            if (cacheKey) this.setChordCache(cacheKey, parsedChords);
            console.log('[LoadMixer] Loaded', this.chords.length, 'chords');
            this.preloadChordDiagrams();
            this.displayChords();
            this.initGridView2Popup();
        } else if (cacheKey && this.chordDataCache.has(cacheKey)) {
            this.chords = this.cloneChordArray(this.chordDataCache.get(cacheKey));
            console.log('[LoadMixer] Loaded chords from cache:', this.chords.length);
            this.preloadChordDiagrams();
            this.displayChords();
            this.initGridView2Popup();
        } else {
            this.chords = [];
            console.log('[LoadMixer] No chords data');
            this.displayChords();
            this.initGridView2Popup();
        }

        // Backend can return either 'lyrics' or 'lyrics_data'
        const lyricsData = data.lyrics || data.lyrics_data;

        if (lyricsData) {
            this.lyrics = typeof lyricsData === 'string' ? JSON.parse(lyricsData) : lyricsData;
            console.log('[LoadMixer] Loaded', this.lyrics.length, 'lyrics');
            this.displayLyrics();
        } else {
            this.lyrics = [];
            console.log('[LoadMixer] No lyrics data');
        }

            this.updateTimeDisplay();

            // Initialize metronome
            this.initMetronome(data);

            console.log('[LoadMixer] Complete!');
        } finally {
            if (showLoader) this.hideLoading();
        }
    }

    initMetronome(data) {
        if (typeof JamMetronome === 'undefined') {
            console.warn('[Metronome] JamMetronome class not available');
            return;
        }

        // Destroy previous instance
        if (this.metronome) {
            this.metronome.destroy();
            this.metronome = null;
        }

        // Gather all metronome containers (main + synced copies in tabs/popups)
        const containers = document.querySelectorAll(
            '#mobileMetronomeContainer, .mobile-metronome-sync'
        );
        if (!containers.length) {
            console.warn('[Metronome] No containers found');
            return;
        }

        const bpm = data?.detected_bpm || this.currentBPM || 120;
        const beatOffset = data?.beat_offset || 0;
        console.log(`[Metronome] Initializing: BPM=${bpm}, beatOffset=${beatOffset}, containers=${containers.length}`);

        this.metronome = new JamMetronome(containers, {
            bpm: bpm,
            beatOffset: beatOffset,
            beatsPerBar: 4,
            getCurrentTime: (atAudioTime) => {
                // If an audioContext time is provided, compute precise position
                // at that exact instant (eliminates ~16ms rAF lag)
                if (atAudioTime !== undefined && this.lastAudioTime !== null && this.isPlaying) {
                    const delta = atAudioTime - this.lastAudioTime;
                    const ratio = this.cachedSyncRatio || (this.currentBPM / this.originalBPM) || 1.0;
                    return this.playbackPosition + delta * ratio;
                }
                return this.currentTime || 0;
            },
            audioContext: this.audioContext,
            getPlaybackRate: () => {
                return this.cachedSyncRatio || (this.currentBPM / this.originalBPM) || 1.0;
            }
        });

        // Load beat positions for downbeat accent (must be set BEFORE beat times for extrapolation)
        const beatPosRaw = data?.beat_positions;
        if (beatPosRaw) {
            const bp = typeof beatPosRaw === 'string' ? JSON.parse(beatPosRaw) : beatPosRaw;
            if (Array.isArray(bp) && bp.length > 0) this.metronome.setBeatPositions(bp);
        }

        // Load beat map for variable-tempo metronome
        const beatTimesRaw = data?.beat_times;
        if (beatTimesRaw) {
            const bt = typeof beatTimesRaw === 'string' ? JSON.parse(beatTimesRaw) : beatTimesRaw;
            if (Array.isArray(bt) && bt.length > 0) this.metronome.setBeatTimes(bt);
        }

        console.log(`[Metronome] Created with ${this.metronome.dotSets.length} container(s)`);
    }

    async loadStem(name, path) {
        console.log('[LoadStem] Starting:', name, 'path:', path);
        try {
            const url = '/api/extracted_stems/' + this.currentExtractionId + '/' + name;
            const t0 = performance.now();

            const res = await fetch(url);

            if (!res.ok) {
                if (res.status === 404) {
                    console.warn('[LoadStem]', name, '404 Not Found - skipping');
                    return;
                }
                throw new Error('HTTP ' + res.status);
            }

            const arrayBuffer = await res.arrayBuffer();
            const t1 = performance.now();
            console.log(`[LoadStem] ${name} fetched ${(arrayBuffer.byteLength / 1048576).toFixed(1)}MB in ${(t1 - t0).toFixed(0)}ms`);

            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const t2 = performance.now();
            console.log(`[LoadStem] ${name} decoded in ${(t2 - t1).toFixed(0)}ms (duration: ${audioBuffer.duration.toFixed(1)}s)`);

            console.log('[LoadStem]', name, 'creating audio nodes...');
            await this.createAudioNodesForStem(name, audioBuffer);

            console.log('[LoadStem]', name, 'creating track control...');
            this.createTrackControl(name);

            console.log('[LoadStem]', name, 'COMPLETE ✓');
        } catch (error) {
            console.error('[LoadStem]', name, 'FAILED:', error);
            console.error('[LoadStem]', name, 'Error stack:', error.stack);
        }
    }

    async createAudioNodesForStem(name, buffer) {
        console.log('[CreateNodes]', name, 'creating audio nodes...');
        console.log('[CreateNodes]', name, 'workletLoaded:', this.workletLoaded);
        const playbackRate = this.cachedPlaybackRate || (this.currentBPM / this.originalBPM) || 1.0;

        const gain = this.audioContext.createGain();
        gain.gain.value = 1.0;
        console.log('[CreateNodes]', name, 'created GainNode');

        const pan = this.audioContext.createStereoPanner();
        pan.pan.value = 0;
        console.log('[CreateNodes]', name, 'created StereoPannerNode');

        let soundTouch = null;
        if (this.workletLoaded) {
            try {
                console.log('[CreateNodes]', name, 'creating SoundTouch AudioWorkletNode...');
                soundTouch = new AudioWorkletNode(this.audioContext, 'soundtouch-processor');
                const tempo = this.cachedTempoRatio || (this.currentBPM / this.originalBPM);
                const pitch = this.cachedPitchRatio || Math.pow(2, this.currentPitchShift / 12);
                soundTouch.parameters.get('tempo').value = tempo;
                soundTouch.parameters.get('pitch').value = pitch;
                soundTouch.parameters.get('rate').value = 1.0;
                soundTouch.connect(gain);
                console.log('[CreateNodes]', name, 'SoundTouch created and configured (tempo:', tempo, 'pitch:', pitch, ', playbackRate:', playbackRate, ')');
            } catch (e) {
                console.error('[CreateNodes]', name, 'SoundTouch creation failed:', e);
                soundTouch = null;
            }
        } else {
            console.warn('[CreateNodes]', name, 'SoundTouch worklet not loaded, using direct connection');
        }

        gain.connect(pan);
        pan.connect(this.masterGainNode);
        console.log('[CreateNodes]', name, 'connected audio graph');

        this.stems[name] = {
            name,
            buffer,
            source: null,
            soundTouchNode: soundTouch,
            gainNode: gain,
            panNode: pan,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false
        };
        console.log('[CreateNodes]', name, 'stem object created and stored');
    }

    createTrackControl(name) {
        const container = document.getElementById('mobileTracksContainer');
        if (!container) return;
        
        const div = document.createElement('div');
        div.className = 'mobile-track';
        div.innerHTML = '<div class="mobile-track-header"><span class="mobile-track-name">' + name + '</span><div class="mobile-track-buttons"><button class="mobile-track-btn mute-btn" data-track="' + name + '">MUTE</button><button class="mobile-track-btn solo-btn" data-track="' + name + '">SOLO</button></div></div><div class="mobile-track-controls"><div class="mobile-track-control"><span class="mobile-track-label">Volume</span><input type="range" class="mobile-track-slider volume-slider" data-track="' + name + '" min="0" max="100" value="100"><span class="mobile-track-value">100%</span></div><div class="mobile-track-control"><span class="mobile-track-label">Pan</span><input type="range" class="mobile-track-slider pan-slider" data-track="' + name + '" min="-100" max="100" value="0"><span class="mobile-track-value">0</span></div></div>';
        
        div.querySelector('.volume-slider').addEventListener('input', e => {
            const v = parseInt(e.target.value);
            e.target.nextElementSibling.textContent = v + '%';
            this.setVolume(name, v / 100);
        });
        
        div.querySelector('.pan-slider').addEventListener('input', e => {
            const p = parseInt(e.target.value);
            e.target.nextElementSibling.textContent = p;
            this.setPan(name, p / 100);
        });
        
        div.querySelector('.mute-btn').addEventListener('click', function() {
            window.mobileApp.toggleMute(name);
            this.classList.toggle('active');
        });
        
        div.querySelector('.solo-btn').addEventListener('click', () => {
            this.toggleSolo(name);
            this.updateSoloButtons();
        });
        
        container.appendChild(div);
    }

    setupMixerControls() {
        // Setup play/stop buttons for all three tabs (Mix, Chords, Lyrics)
        const playBtnIds = ['mobilePlayBtn', 'mobilePlayBtnChords', 'mobilePlayBtnLyrics'];
        const stopBtnIds = ['mobileStopBtn', 'mobileStopBtnChords', 'mobileStopBtnLyrics'];

        playBtnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => this.togglePlayback());
        });

        stopBtnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => this.stop());
        });

        // Seek bar (interactive scrubbing)
        const seekBar = document.getElementById('mobileSeekBar');
        if (seekBar) {
            seekBar.addEventListener('touchstart', e => this.handleSeekTouch(e));
            seekBar.addEventListener('touchmove', e => this.handleSeekTouch(e));
            seekBar.addEventListener('click', e => this.handleSeekClick(e));
        }

        // Setup neumorphic tempo/pitch popups (replaces all tempo/pitch sliders)
        this.setupNeumorphicDialControls();

        // Lyrics regeneration (LrcLib -> Whisper fallback)
        const regenerateLyrics = document.getElementById('mobileRegenerateLyrics');
        if (regenerateLyrics) regenerateLyrics.addEventListener('click', () => this.regenerateLyrics());

        // Fullscreen Lyrics popup
        const fullscreenLyricsBtn = document.getElementById('mobileFullScreenLyrics');
        if (fullscreenLyricsBtn) fullscreenLyricsBtn.addEventListener('click', () => this.openFullscreenLyrics());

        const closeFullscreenLyricsBtn = document.getElementById('fullscreen-lyrics-popup-close');
        if (closeFullscreenLyricsBtn) closeFullscreenLyricsBtn.addEventListener('click', () => this.closeFullscreenLyrics());

        // Close fullscreen lyrics popup on overlay click
        const fullscreenLyricsPopup = document.getElementById('fullscreen-lyrics-popup');
        if (fullscreenLyricsPopup) {
            fullscreenLyricsPopup.addEventListener('click', (e) => {
                if (e.target === fullscreenLyricsPopup) this.closeFullscreenLyrics();
            });
        }

        // Fullscreen lyrics size slider
        const fullscreenSizeSlider = document.getElementById('fullscreenLyricsSizeSlider');
        if (fullscreenSizeSlider) {
            fullscreenSizeSlider.addEventListener('input', (e) => this.applyFullscreenLyricsScale(parseFloat(e.target.value)));
        }

        // Setup fullscreen lyrics controls
        this.initFullscreenLyricsControls();

        // Setup grid view 2 controls
        this.initGridView2Controls();

        const regenerateChordsBtn = document.getElementById('mobileRegenerateChords');
        if (regenerateChordsBtn) regenerateChordsBtn.addEventListener('click', () => this.regenerateChords());

        // Ensure initial button state matches playback flag
        this.updatePlayPauseButtons();
    }

    setupNeumorphicDialControls() {
        // Tempo trigger button and popup
        const tempoTrigger = document.getElementById('mobileTempoTrigger');
        const tempoPopup = document.getElementById('mobileTempoPopup');
        const tempoPopupClose = document.getElementById('tempoPopupClose');
        const tempoDialElement = document.getElementById('tempoDialControl');
        const tempoResetBtn = document.getElementById('tempoResetBtn');

        // Pitch trigger button and popup
        const pitchTrigger = document.getElementById('mobilePitchTrigger');
        const pitchPopup = document.getElementById('mobilePitchPopup');
        const pitchPopupClose = document.getElementById('pitchPopupClose');
        const pitchDialElement = document.getElementById('pitchDialControl');
        const pitchResetBtn = document.getElementById('pitchResetBtn');

        // Initialize Tempo dial (BPM mode)
        if (tempoDialElement) {
            this.tempoDial = new NeumorphicDial(tempoDialElement, {
                formatValue: (v) => Math.round(v) + ' BPM',
                onChange: (bpm) => {
                    const ratio = bpm / this.originalBPM;
                    this.syncTempoValueBPM(bpm);
                    this.setTempo(ratio);
                },
                onChangeEnd: () => this.saveState()
            });
        }

        // Initialize Pitch dial
        if (pitchDialElement) {
            this.pitchDial = new NeumorphicDial(pitchDialElement, {
                formatValue: (v) => (v >= 0 ? '+' : '') + Math.round(v),
                onChange: (value) => {
                    const rounded = Math.round(value);
                    this.syncPitchValue(rounded);
                    this.setPitch(rounded);
                },
                onChangeEnd: () => this.saveState()
            });
        }

        // Tempo popup open from ANY trigger button with .tempo-popup-trigger class
        document.querySelectorAll('.tempo-popup-trigger').forEach(trigger => {
            trigger.addEventListener('click', () => {
                // Update dial value to current BPM before opening
                if (this.tempoDial) {
                    this.tempoDial.setValue(this.currentBPM || 120);
                }
                tempoPopup.classList.add('active');
                tempoPopup.setAttribute('aria-hidden', 'false');
            });
        });

        // Tempo popup close
        if (tempoPopupClose && tempoPopup) {
            tempoPopupClose.addEventListener('click', () => {
                tempoPopup.classList.remove('active');
                tempoPopup.setAttribute('aria-hidden', 'true');
            });
        }
        if (tempoPopup) {
            tempoPopup.addEventListener('click', (e) => {
                if (e.target === tempoPopup) {
                    tempoPopup.classList.remove('active');
                    tempoPopup.setAttribute('aria-hidden', 'true');
                }
            });
        }

        // Pitch popup open from ANY trigger button with .pitch-popup-trigger class
        document.querySelectorAll('.pitch-popup-trigger').forEach(trigger => {
            trigger.addEventListener('click', () => {
                // Update dial value to current pitch before opening
                if (this.pitchDial) {
                    this.pitchDial.setValue(this.currentPitchShift || 0);
                }
                pitchPopup.classList.add('active');
                pitchPopup.setAttribute('aria-hidden', 'false');
            });
        });

        // Pitch popup close
        if (pitchPopupClose && pitchPopup) {
            pitchPopupClose.addEventListener('click', () => {
                pitchPopup.classList.remove('active');
                pitchPopup.setAttribute('aria-hidden', 'true');
            });
        }
        if (pitchPopup) {
            pitchPopup.addEventListener('click', (e) => {
                if (e.target === pitchPopup) {
                    pitchPopup.classList.remove('active');
                    pitchPopup.setAttribute('aria-hidden', 'true');
                }
            });
        }

        // Reset buttons
        if (tempoResetBtn) {
            tempoResetBtn.addEventListener('click', () => {
                const defaultBPM = this.originalBPM || 120;
                if (this.tempoDial) this.tempoDial.setValue(defaultBPM);
                this.syncTempoValueBPM(defaultBPM);
                this.setTempo(1.0);
                this.saveState();
            });
        }
        if (pitchResetBtn) {
            pitchResetBtn.addEventListener('click', () => {
                const defaultPitch = 0;
                if (this.pitchDial) this.pitchDial.setValue(defaultPitch);
                this.syncPitchValue(defaultPitch);
                this.setPitch(defaultPitch);
                this.saveState();
            });
        }
    }

    syncTempoValueBPM(bpm) {
        // Synchronize tempo BPM value across all displays
        const roundedBPM = Math.round(bpm);

        // Update all elements with .tempo-bpm-display class
        document.querySelectorAll('.tempo-bpm-display').forEach(el => {
            el.textContent = roundedBPM + ' BPM';
        });

        // Update neumorphic dial
        if (this.tempoDial) this.tempoDial.setValue(roundedBPM);

        // Update dial value display
        const tempoDialValue = document.getElementById('tempoDialValue');
        if (tempoDialValue) tempoDialValue.textContent = roundedBPM + ' BPM';

        // Update popup BPM sliders (fullscreen lyrics, gridview2) - legacy support
        document.querySelectorAll('.popup-tempo-bpm-sync').forEach(slider => {
            slider.value = roundedBPM;
        });
        document.querySelectorAll('.popup-tempo-bpm-value-sync').forEach(el => {
            el.textContent = roundedBPM + ' BPM';
        });
    }

    // Legacy function for ratio-based sync (kept for backward compatibility)
    syncTempoValue(ratio) {
        const bpm = Math.round(this.originalBPM * ratio);
        this.syncTempoValueBPM(bpm);
    }

    syncPitchValue(value) {
        // Synchronize pitch/key across all displays
        const rounded = Math.round(value);

        // Update dial position
        if (this.pitchDial) this.pitchDial.setValue(rounded);

        // Update key display (tonality) - syncKeyDisplay updates all .key-display elements
        this.syncKeyDisplay();
    }

    syncKeyDisplay() {
        // Synchronize key/tonality display across all displays
        // Format: "G major" -> "G" or "A minor" -> "Am"
        if (!this.originalKey) {
            document.querySelectorAll('.key-display').forEach(el => {
                el.textContent = 'C';
            });
            return;
        }

        const parts = this.originalKey.split(' ');
        const root = parts[0] || 'C';
        const mode = parts[1] || 'major';

        // Convert to chord format for transposition (e.g., "Am" for minor)
        const chordFormat = mode === 'minor' ? root + 'm' : root;
        const transposed = this.transposeChord(chordFormat, this.currentPitchShift);

        document.querySelectorAll('.key-display').forEach(el => {
            el.textContent = transposed;
        });
    }

    togglePlayback() {
        this.isPlaying ? this.pause() : this.play();
    }

    updatePlayPauseButtons() {
        const iconClass = this.isPlaying ? 'fa-pause' : 'fa-play';
        const playBtnIds = ['mobilePlayBtn', 'mobilePlayBtnChords', 'mobilePlayBtnLyrics', 'gridview2PlayBtn', 'fullscreenLyricsPlayBtn'];
        playBtnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.innerHTML = `<i class="fas ${iconClass}"></i>`;
            }
        });
    }

    async requestWakeLock() {
        if (!this.wakeLockSupported || this.wakeLockRequestPending) return false;

        this.wakeLockRequestPending = true;
        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                this.wakeLock = null;
                if (this.isPlaying && typeof document !== 'undefined' && document.visibilityState === 'visible') {
                    this.requestWakeLock().catch(err => {
                        console.warn('[WakeLock] Failed to re-acquire after release:', err);
                    });
                }
            });

            if (!this.wakeLockVisibilityHandler && typeof document !== 'undefined') {
                this.wakeLockVisibilityHandler = async () => {
                    if (document.visibilityState === 'visible' && this.isPlaying) {
                        await this.requestWakeLock();
                    }
                };
                document.addEventListener('visibilitychange', this.wakeLockVisibilityHandler);
            }

            console.log('[WakeLock] Screen wake lock acquired');
            return true;
        } catch (error) {
            console.warn('[WakeLock] Failed to acquire screen wake lock:', error);
            this.wakeLock = null;
            return false;
        } finally {
            this.wakeLockRequestPending = false;
        }
    }

    releaseWakeLock() {
        if (this.wakeLockVisibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.wakeLockVisibilityHandler);
            this.wakeLockVisibilityHandler = null;
        }

        if (this.wakeLock) {
            const lock = this.wakeLock;
            this.wakeLock = null;
            lock.release().catch(() => {});
        }
    }

    async play() {
        if (this.isPlaying || this._precountActive) return;

        // Ensure audio context is ready (critical for mobile)
        if (!this.audioContext) {
            console.error('[Play] AudioContext not initialized');
            return;
        }

        console.log('[Play] Starting playback, AudioContext state:', this.audioContext.state);

        // Resume audio context if suspended (required for mobile autoplay policy)
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('[Play] AudioContext resumed');
            } catch (error) {
                console.error('[Play] Failed to resume AudioContext:', error);
                return;
            }
        }

        // Check if we have stems loaded
        const stemCount = Object.keys(this.stems).length;
        if (stemCount === 0) {
            console.error('[Play] No stems loaded');
            alert('No audio loaded. Please wait for stems to load.');
            return;
        }

        // Determine precount beats
        let precountBeats = 0;
        if (this.metronome && this.metronome.getPrecountBars() > 0) {
            precountBeats = this.metronome.getPrecountBars() * this.metronome.beatsPerBar;
        }

        if (precountBeats > 0 && this.metronome.bpm > 0) {
            // Use beat map duration for accurate timing (matches startPrecount's internal click spacing)
            const precountDuration = this.metronome.getPrecountDuration(precountBeats);
            const stemStartTime = this.audioContext.currentTime + precountDuration;

            const playbackStart = this.currentTime || 0;

            console.log(`[Play] Precount: ${precountBeats} beats (${precountDuration.toFixed(2)}s), stems scheduled at ${stemStartTime.toFixed(3)}`);

            // Create and schedule stems NOW, but they start at stemStartTime (sample-accurate)
            this.setPlaybackPosition(Math.max(0, Math.min(playbackStart, this.duration || Infinity)));
            Object.keys(this.stems).forEach(name => this.startStemSource(name, stemStartTime));

            // Track time from when stems actually start
            this.lastAudioTime = stemStartTime;

            this._precountActive = true;
            this._precountBeatsUsed = precountBeats;

            // Start precount (visual dots + audible clicks — all pre-scheduled on Web Audio clock)
            this.metronome.startPrecount(precountBeats, () => {
                // Stems already playing via Web Audio scheduling — just update UI state
                this._precountActive = false;
                this.isPlaying = true;
                this.updatePlayPauseButtons();
                this.syncPopupControlsState();
                this.startPlaybackAnimation();

                if (this.activeLyricIndex >= 0) {
                    this.scrollLyricsToIndex(this.activeLyricIndex, true);
                }
                if (this.fullscreenLyricsOpen && this.activeLyricIndex >= 0) {
                    this.scrollToFullscreenLyric(this.activeLyricIndex, true);
                }
                if (this.wakeLockSupported) {
                    this.requestWakeLock().catch(error => {
                        console.warn('[WakeLock] Unable to keep screen awake:', error);
                    });
                }

                // Start normal metronome — precount ended on beat 3, so beat 0 (downbeat) should click
                if (this.metronome) this.metronome.start();

                const extra = { precount_beats: this._precountBeatsUsed };
                this._jamBroadcastPlayback('play', this.currentTime || 0, extra);
                this._jamStartSyncHeartbeat();
            });
        } else {
            this._precountBeatsUsed = 0;
            this._startPlaybackInternal();
        }
    }

    _startPlaybackInternal() {
        console.log('[Play] Starting', Object.keys(this.stems).length, 'stems');

        // Reset precise playback tracking (needed for hybrid tempo)
        this.setPlaybackPosition(Math.max(0, Math.min(this.currentTime || 0, this.duration || Infinity)));
        this.lastAudioTime = this.audioContext.currentTime;

        Object.keys(this.stems).forEach(name => this.startStemSource(name));

        this.isPlaying = true;
        this.updatePlayPauseButtons();
        this.syncPopupControlsState();

        this.startPlaybackAnimation();

        // Initial scroll to current lyric position on playback start
        if (this.activeLyricIndex >= 0) {
            this.scrollLyricsToIndex(this.activeLyricIndex, true);
        }
        // Also scroll fullscreen popup if open
        if (this.fullscreenLyricsOpen && this.activeLyricIndex >= 0) {
            this.scrollToFullscreenLyric(this.activeLyricIndex, true);
        }

        if (this.wakeLockSupported) {
            this.requestWakeLock().catch(error => {
                console.warn('[WakeLock] Unable to keep screen awake:', error);
            });
        }

        // Start metronome
        if (this.metronome) this.metronome.start();

        // Jam session: broadcast play command
        const extra = this._precountBeatsUsed > 0 ? { precount_beats: this._precountBeatsUsed } : {};
        this._jamBroadcastPlayback('play', this.currentTime || 0, extra);
        this._jamStartSyncHeartbeat();
    }

    /**
     * Create and start a stem audio source.
     * @param {string} name - Stem name
     * @param {number} when - AudioContext time to start (0 = now)
     */
    startStemSource(name, when = 0) {
        const stem = this.stems[name];
        if (!stem || !stem.buffer) {
            console.warn('[StartStem] Skipping', name, '- no buffer');
            return;
        }

        if (stem.source) {
            try { stem.source.stop(); } catch(e) {}
        }

        stem.source = this.audioContext.createBufferSource();
        stem.source.buffer = stem.buffer;
        const playbackRate = this.cachedPlaybackRate || 1.0;
        stem.source.playbackRate.value = playbackRate;
        console.log('[StartStem]', name, 'playbackRate set to', playbackRate.toFixed(3));

        if (stem.soundTouchNode) {
            stem.source.connect(stem.soundTouchNode);
            console.log('[StartStem]', name, '→ SoundTouch → Gain → Pan → Master');
        } else {
            stem.source.connect(stem.gainNode);
            console.log('[StartStem]', name, '→ Gain → Pan → Master (no SoundTouch)');
        }

        this.updateStemGain(name);
        const startOffset = Math.min(this.currentTime, stem.buffer.duration);
        stem.source.start(when, startOffset);
        console.log('[StartStem]', name, 'started at offset', startOffset.toFixed(2) + 's',
            when > 0 ? `(scheduled at ${when.toFixed(3)})` : '(immediate)');
    }

    pause() {
        // Cancel any active precount and stop pre-scheduled stems
        if (this._precountActive) {
            this._precountActive = false;
            if (this.metronome) this.metronome.cancelPrecount();
            // Stop stems that were pre-scheduled but haven't started yet
            Object.values(this.stems).forEach(s => {
                if (s.source) {
                    try { s.source.stop(); } catch(e) {}
                    s.source = null;
                }
            });
            this.updatePlayPauseButtons();
            return;
        }

        if (!this.isPlaying) return;

        this.updatePlaybackClock();

        Object.values(this.stems).forEach(s => {
            if (s.source) {
                try { s.source.stop(); } catch(e) {}
                s.source = null;
            }
        });

        this.isPlaying = false;
        this.updatePlayPauseButtons();
        this.syncPopupControlsState();

        this.stopPlaybackAnimation();
        this.releaseWakeLock();

        // Stop metronome
        if (this.metronome) this.metronome.stop();

        // Jam session: broadcast pause command
        this._jamBroadcastPlayback('pause', this.currentTime || 0);
        this._jamStopSyncHeartbeat();

        // Save state when pausing
        this.saveState();
    }

    stop() {
        // pause() handles precount cancellation + pre-scheduled stem cleanup
        this.pause();
        this.seek(0);
        // Jam session: broadcast stop command
        this._jamBroadcastPlayback('stop', 0);
        this._jamStopSyncHeartbeat();
        // Save state when stopping
        this.saveState();
    }

    seek(time) {
        const newTime = Math.max(0, Math.min(time, this.duration));
        const wasPlaying = this.isPlaying;

        if (this.isPlaying) this.pause();
        this.setPlaybackPosition(newTime);
        this.updateTimeDisplay();
        this.updateProgressBar();
        if (wasPlaying) this.play();

        // Jam session: broadcast seek command
        this._jamBroadcastPlayback('seek', newTime);

        // Save state after seeking
        this.saveState();
    }

    seekToPosition(time) {
        // Seek without broadcasting — used by jam guests receiving commands
        const newTime = Math.max(0, Math.min(time, this.duration || Infinity));
        const wasPlaying = this.isPlaying;

        if (this.isPlaying) this.pause();
        this.setPlaybackPosition(newTime);
        this.updateTimeDisplay();
        this.updateProgressBar();
        if (wasPlaying) this.play();
    }

    handleSeekTouch(e) {
        e.preventDefault();
        if (this.duration <= 0) return;

        const touch = e.touches[0];
        const bar = document.getElementById('mobileSeekBar');
        const rect = bar.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        this.seek(percent * this.duration);
    }

    handleSeekClick(e) {
        e.preventDefault();
        if (this.duration <= 0) return;

        const bar = document.getElementById('mobileSeekBar');
        const rect = bar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        this.seek(percent * this.duration);
    }

    startPlaybackAnimation() {
        this.stopPlaybackAnimation();
        this.lastStateSave = Date.now();  // Track last save time

        const animate = () => {
            if (this.isPlaying) {
                this.updatePlaybackClock();
                if (this.currentTime >= this.duration) {
                    this.stop();
                    return;
                }
                this.updateTimeDisplay();
                this.updateProgressBar();
                this.syncChordPlayhead();
                this.updateActiveLyric();

                // Save state every 5 seconds during playback
                const now = Date.now();
                if (now - this.lastStateSave > 5000) {
                    this.saveState();
                    this.lastStateSave = now;
                }

                this.animationFrameId = requestAnimationFrame(animate);
            }
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    updatePlaybackClock() {
        if (!this.audioContext) return this.currentTime;

        const now = this.audioContext.currentTime;
        if (this.lastAudioTime === null) {
            this.lastAudioTime = now;
        }

        if (this.isPlaying) {
            const delta = now - this.lastAudioTime;
            const ratio = this.cachedSyncRatio || (this.currentBPM / this.originalBPM) || 1.0;
            this.playbackPosition += delta * ratio;
            if (this.playbackPosition < 0) this.playbackPosition = 0;

            const maxDuration = (typeof this.duration === 'number' && this.duration > 0) ? this.duration : null;
            if (maxDuration !== null) {
                this.playbackPosition = Math.min(this.playbackPosition, maxDuration);
            }

            this.currentTime = this.playbackPosition;
        }

        this.lastAudioTime = now;
        return this.currentTime;
    }

    setPlaybackPosition(position) {
        const maxDuration = (typeof this.duration === 'number' && this.duration > 0) ? this.duration : null;
        const clamped = maxDuration !== null ? Math.min(position, maxDuration) : position;
        this.playbackPosition = Math.max(0, clamped);
        this.currentTime = this.playbackPosition;
        this.lastAudioTime = this.audioContext ? this.audioContext.currentTime : null;
    }

    stopPlaybackAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    async ensureMasterAudioBuffer(data) {
        const sourcePath = data?.audio_path || data?.file_path;
        if (!sourcePath) {
            this.masterAudioBuffer = null;
            this.masterAudioSource = null;
            return;
        }
        if (this.masterAudioBuffer && this.masterAudioSource === sourcePath) {
            return;
        }
        await this.loadMasterAudio(sourcePath);
    }

    async loadMasterAudio(filePath) {
        try {
            if (this.masterAudioCache.has(filePath)) {
                console.log('[MasterAudio] Using cached buffer for', filePath);
                this.masterAudioBuffer = this.masterAudioCache.get(filePath);
                this.masterAudioSource = filePath;
                return;
            }

            console.log('[MasterAudio] Loading original audio from', filePath);
            const url = '/api/download-file?file_path=' + encodeURIComponent(filePath);
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            const arrayBuffer = await res.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.masterAudioBuffer = audioBuffer;
            this.masterAudioSource = filePath;
            this.storeInCache(this.masterAudioCache, filePath, audioBuffer, this.masterAudioCacheLimit);
            console.log('[MasterAudio] Loaded master audio. Duration:', audioBuffer.duration);
        } catch (error) {
            console.warn('[MasterAudio] Failed to load original audio:', error);
            this.masterAudioBuffer = null;
            this.masterAudioSource = null;
        }
    }

    updateProgressBar() {
        const percent = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;

        // Update vertical playhead
        const playhead = document.getElementById('mobilePlayhead');
        if (playhead) {
            playhead.style.left = percent + '%';
        }

        // Update seek bar progress
        const seekProgress = document.getElementById('mobileSeekProgress');
        const seekHandle = document.getElementById('mobileSeekHandle');
        if (seekProgress) seekProgress.style.width = percent + '%';
        if (seekHandle) seekHandle.style.left = percent + '%';
    }

    updateTimeDisplay() {
        // Update time displays across all three tabs
        const currIds = ['mobileCurrentTime', 'mobileCurrentTimeChords', 'mobileCurrentTimeLyrics'];
        const durIds = ['mobileDuration', 'mobileDurationChords', 'mobileDurationLyrics'];

        currIds.forEach(id => {
            const elem = document.getElementById(id);
            if (elem) elem.textContent = this.formatTime(this.currentTime);
        });

        durIds.forEach(id => {
            const elem = document.getElementById(id);
            if (elem) elem.textContent = this.formatTime(this.duration);
        });
    }

    getLyricsAdjustedTime() {
        // SoundTouch modifies playback speed without changing AudioContext.currentTime rate
        // Lyrics timestamps are from the ORIGINAL audio
        //
        // At tempo 0.8x (slower): After 12.5s of playback, we've played 10s of original content
        //   → lyricTime = 12.5 * 0.8 = 10s ✓
        //
        // At tempo 1.2x (faster): After 8.33s of playback, we've played 10s of original content
        //   → lyricTime = 8.33 * 1.2 = 10s ✓
        //
        // Formula: adjustedTime = currentTime * tempoRatio
        const tempoRatio = this.currentBPM / this.originalBPM;
        const adjustedTime = this.currentTime * tempoRatio;

        // Debug log to understand what's happening
        if (Math.floor(this.currentTime * 10) % 10 === 0) {  // Log every second
            console.log('[Lyrics Tempo] currentTime:', this.currentTime.toFixed(2),
                       'originalBPM:', this.originalBPM, 'currentBPM:', this.currentBPM,
                       'ratio:', tempoRatio.toFixed(3), 'adjustedTime:', adjustedTime.toFixed(2));
        }

        return adjustedTime;
    }

    setTempo(ratio) {
        // Calculate actual BPM from ratio
        const newBPM = this.originalBPM * ratio;
        this.currentBPM = Math.max(50, Math.min(300, newBPM));

        // Recalculate actual ratio based on clamped BPM
        const actualRatio = this.currentBPM / this.originalBPM;

        console.log('[Tempo] Setting tempo - ratio:', ratio, 'originalBPM:', this.originalBPM, 'newBPM:', this.currentBPM, 'actualRatio:', actualRatio);

        const targets = this.calculateTempoPitchTargets();
        console.log('[Tempo] Targets → playbackRate:', targets.playbackRate.toFixed(3), 'SoundTouch tempo:', targets.soundTouchTempo.toFixed(3), 'SoundTouch pitch:', targets.soundTouchPitch.toFixed(3), 'mode:', targets.isAcceleration ? 'hybrid-accel' : 'stretch');
        this.applyTempoPitchTargets(targets);

        // Update metronome BPM
        if (this.metronome) this.metronome.setBPM(this.currentBPM);

        // Jam session: broadcast tempo change
        this._jamBroadcastTempo(this.currentBPM, this.originalBPM, actualRatio);
    }

    setPitch(semitones) {
        this.currentPitchShift = Math.max(-12, Math.min(12, semitones));
        const targets = this.calculateTempoPitchTargets();
        console.log('[Pitch] Setting pitch:', semitones, 'semitones → SoundTouch pitch:', targets.soundTouchPitch.toFixed(3), 'playbackRate:', targets.playbackRate.toFixed(3));
        this.applyTempoPitchTargets(targets);
        this.updateChordLabels();
        this.updateLyricsChordTransposition();
        this.updateGridView2Chords();
        this.updateFullscreenLyricsChords();

        // Jam session: broadcast pitch change
        const keyEl = document.getElementById('mobileCurrentKey');
        this._jamBroadcastPitch(this.currentPitchShift, keyEl?.textContent || 'C');
    }

    calculateTempoPitchTargets() {
        const tempoRatio = this.currentBPM / this.originalBPM;
        const pitchRatio = Math.pow(2, this.currentPitchShift / 12);
        const isAcceleration = tempoRatio > 1.0 + 0.001;
        const playbackRate = isAcceleration ? tempoRatio : 1.0;
        const soundTouchTempo = isAcceleration ? 1.0 : tempoRatio;
        let soundTouchPitch = pitchRatio / playbackRate;
        soundTouchPitch = Math.max(0.25, Math.min(4.0, soundTouchPitch));

        return {
            tempoRatio,
            pitchRatio,
            isAcceleration,
            playbackRate,
            soundTouchTempo,
            soundTouchPitch,
            syncRatio: isAcceleration ? playbackRate : soundTouchTempo
        };
    }

    applyTempoPitchTargets(targets) {
        this.cachedPlaybackRate = targets.playbackRate;
        this.cachedSyncRatio = targets.syncRatio;
        this.cachedTempoRatio = targets.soundTouchTempo;
        this.cachedPitchRatio = targets.soundTouchPitch;
        this.playbackPosition = this.currentTime;
        this.lastAudioTime = this.audioContext ? this.audioContext.currentTime : null;

        Object.values(this.stems).forEach(stem => {
            if (stem.source && stem.source.playbackRate) {
                try {
                    const audioTime = this.audioContext ? this.audioContext.currentTime : 0;
                    stem.source.playbackRate.setValueAtTime(targets.playbackRate, audioTime);
                } catch (error) {
                    console.warn('[Tempo] Failed to update playbackRate for', stem.name, error);
                }
            }

            if (stem.soundTouchNode) {
                const tempoParam = stem.soundTouchNode.parameters.get('tempo');
                const pitchParam = stem.soundTouchNode.parameters.get('pitch');
                const rateParam = stem.soundTouchNode.parameters.get('rate');

                if (tempoParam) tempoParam.value = targets.soundTouchTempo;
                if (pitchParam) pitchParam.value = targets.soundTouchPitch;
                if (rateParam) rateParam.value = 1.0;
            }
        });
    }

    setVolume(name, vol) {
        const s = this.stems[name];
        if (!s) return;
        s.volume = Math.max(0, Math.min(1, vol));
        this.updateStemGain(name);
    }

    setPan(name, pan) {
        const s = this.stems[name];
        if (!s || !s.panNode) return;
        s.pan = Math.max(-1, Math.min(1, pan));
        s.panNode.pan.value = s.pan;
    }

    toggleMute(name) {
        const s = this.stems[name];
        if (!s) return;
        s.muted = !s.muted;
        this.updateStemGain(name);
    }

    toggleSolo(name) {
        const s = this.stems[name];
        if (!s) return;
        s.solo = !s.solo;
        Object.keys(this.stems).forEach(n => this.updateStemGain(n));
    }

    updateStemGain(name) {
        const s = this.stems[name];
        if (!s || !s.gainNode) return;
        
        const hasSolo = Object.values(this.stems).some(x => x.solo);
        let gain = s.volume;
        if (s.muted || (hasSolo && !s.solo)) gain = 0;
        s.gainNode.gain.value = gain;
    }

    updateSoloButtons() {
        document.querySelectorAll('.solo-btn').forEach(btn => {
            const name = btn.dataset.track;
            const s = this.stems[name];
            if (s && s.solo) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    showLoading(message = 'Loading…') {
        if (!this.loadingOverlay || !this.loadingText) return;
        this.loadingText.textContent = message;
        this.loadingOverlay.style.display = 'flex';
    }

    hideLoading() {
        if (this.loadingOverlay) {
            this.loadingOverlay.style.display = 'none';
        }
    }

    displayChords() {
        const container = document.getElementById('mobileChordTimeline');
        if (!container || !this.chords.length) {
            if (container) container.innerHTML = '<p class="mobile-text-muted">No chords detected</p>';
            this.setChordDiagramMessage('No chord data available.');
            this.chordSegments = [];
            return;
        }

        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        this.setupChordInstrumentToggle();

        const bpm = this.chordBPM || this.currentBPM || this.originalBPM || 120;
        const beatsPerBar = Math.max(2, Math.min(12, this.beatsPerBar || 4));
        const beatDuration = 60 / bpm;
        const measureSeconds = beatDuration * beatsPerBar;

        this.chordPxPerBeat = 100; // Fixed width per beat for grid
        this.chordBPM = bpm;
        this.chordSegments = [];
        this.chordElements = [];
        this.beatElements = []; // All beat elements including empty ones
        this.currentChordIndex = -1;

        // Apply beatOffset to align chord timestamps with the beat grid
        const offset = this.beatOffset || 0;

        // Quantize chords to nearest STRONG beat (1 or 3) with beatOffset
        const quantizedChords = [...this.chords].map(chord => {
            const originalTime = (chord.timestamp || 0) - offset;

            // Find the measure this chord belongs to
            const measureIndex = Math.floor(Math.max(0, originalTime) / measureSeconds);
            const measureStart = measureIndex * measureSeconds;

            // Strong beats are at 0 (beat 1) and 2*beatDuration (beat 3)
            const beat1Time = measureStart;
            const beat3Time = measureStart + (2 * beatDuration);

            // Check distance to each strong beat
            const distToBeat1 = Math.abs(originalTime - beat1Time);
            const distToBeat3 = Math.abs(originalTime - beat3Time);

            // Tolerance: snap to strong beat if within 0.7 of a beat duration
            const strongBeatTolerance = beatDuration * 0.7;

            let quantizedTime;
            if (distToBeat1 <= strongBeatTolerance) {
                quantizedTime = beat1Time;
            } else if (distToBeat3 <= strongBeatTolerance) {
                quantizedTime = beat3Time;
            } else {
                // Fall back to nearest beat
                quantizedTime = Math.round(originalTime / beatDuration) * beatDuration;
            }

            return {
                ...chord,
                timestamp: Math.max(0, quantizedTime),
                originalTimestamp: chord.timestamp
            };
        }).sort((a, b) => a.timestamp - b.timestamp);

        // Build chordSegments for diagram display
        quantizedChords.forEach((chord, index) => {
            this.chordSegments.push({
                chord: chord.chord || '',
                start: chord.timestamp,
                end: quantizedChords[index + 1]?.timestamp ?? this.duration,
                sourceIndex: index
            });
        });

        // Calculate total measures needed
        const totalDuration = this.duration || 180;
        const totalMeasures = Math.ceil(totalDuration / measureSeconds);

        // Create ALL measures with beat slots
        const measures = [];
        let lastActiveChord = '';
        let chordIndex = 0;

        for (let measureNum = 0; measureNum < totalMeasures; measureNum++) {
            const measureStartTime = measureNum * measureSeconds;
            const measure = {
                number: measureNum + 1,
                startTime: measureStartTime,
                beats: []
            };

            for (let beat = 0; beat < beatsPerBar; beat++) {
                const beatTime = measureStartTime + (beat * beatDuration);

                // Find chord active at this beat
                while (chordIndex < quantizedChords.length - 1 &&
                       quantizedChords[chordIndex + 1].timestamp <= beatTime + 0.01) {
                    chordIndex++;
                }

                const activeChord = quantizedChords[chordIndex];
                const chordName = activeChord?.chord || '';

                // Check if chord changes at this beat
                if (chordName && chordName !== lastActiveChord) {
                    measure.beats.push({
                        chord: chordName,
                        timestamp: beatTime,
                        index: chordIndex,
                        sourceIndex: chordIndex,
                        empty: false
                    });
                    lastActiveChord = chordName;
                } else {
                    measure.beats.push({
                        empty: true,
                        currentChord: lastActiveChord,
                        timestamp: beatTime
                    });
                }
            }

            measures.push(measure);
        }

        // Get lyrics if available
        const lyricsArray = this.lyrics || [];

        // Render the linear grid view
        container.innerHTML = '';
        const scroll = document.createElement('div');
        scroll.className = 'chord-linear-scroll';

        const track = document.createElement('div');
        track.className = 'chord-linear-track';

        measures.forEach((measure, measureIndex) => {
            const measureEl = document.createElement('div');
            measureEl.className = 'chord-linear-measure';
            measureEl.dataset.measureNumber = measure.number;
            measureEl.dataset.startTime = measure.startTime;

            // Chord grid row
            const chordRow = document.createElement('div');
            chordRow.className = 'chord-linear-chord-row';

            measure.beats.forEach((beat, beatIndex) => {
                const beatEl = document.createElement('div');
                beatEl.className = 'chord-linear-beat';

                // Calculate beat timestamp
                const beatDuration = measureSeconds / beatsPerBar;
                const beatTimestamp = measure.startTime + (beatIndex * beatDuration);

                beatEl.dataset.beatTime = beatTimestamp;
                beatEl.dataset.measureIndex = measureIndex;
                beatEl.dataset.beatIndex = beatIndex;

                if (beat.empty) {
                    beatEl.classList.add('empty');
                    beatEl.innerHTML = '<div class="chord-linear-beat-name">—</div>';
                    // Store the current chord for empty beats
                    beatEl.dataset.currentChord = beat.currentChord || '';
                } else {
                    beatEl.dataset.index = beat.sourceIndex;
                    beatEl.dataset.timestamp = beat.timestamp;
                    beatEl.dataset.currentChord = beat.chord;
                    const transposedChord = this.transposeChord(beat.chord, this.currentPitchShift);
                    beatEl.innerHTML = `<div class="chord-linear-beat-name">${transposedChord}</div>`;

                    this.chordElements.push(beatEl);
                }

                beatEl.addEventListener('click', () => this.seek(beatTimestamp));
                this.beatElements.push(beatEl);

                chordRow.appendChild(beatEl);
            });

            measureEl.appendChild(chordRow);

            // Lyrics row
            const lyricsRow = document.createElement('div');
            lyricsRow.className = 'chord-linear-lyrics-row';

            // Find lyrics that fall in this measure
            const measureEndTime = measure.startTime + measureSeconds;
            const measureLyrics = lyricsArray.filter(lyric => {
                const lyricTime = lyric.start || 0;
                return lyricTime >= measure.startTime && lyricTime < measureEndTime;
            });

            if (measureLyrics.length > 0) {
                const lyricsText = measureLyrics.map(l => l.text || '').join(' ');
                lyricsRow.textContent = lyricsText;
            } else {
                lyricsRow.innerHTML = '&nbsp;';
            }

            measureEl.appendChild(lyricsRow);
            track.appendChild(measureEl);
        });

        // Add playhead
        this.playheadIndicator = document.createElement('div');
        this.playheadIndicator.className = 'chord-linear-playhead';
        track.appendChild(this.playheadIndicator);

        scroll.appendChild(track);
        container.appendChild(scroll);

        this.chordScrollContainer = scroll;
        this.chordTrackElement = track;

        console.log(`[Chords] Grid: ${this.beatElements.length} beats, BPM=${bpm}, offset=${this.beatOffset || 0}`);

        // Block manual horizontal scroll while allowing code-controlled scrollTo()
        this.preventManualHorizontalScroll(scroll);

        this.syncChordPlayhead(true);
        const firstSegmentChord = this.chordSegments[0]?.chord || this.chords[0]?.chord || '';
        const thirdSegmentChord = this.chordSegments[2]?.chord || this.chords[2]?.chord || ''; // Anticipate 2 beats ahead
        const initialChordSymbol = this.currentChordSymbol || this.transposeChord(firstSegmentChord, this.currentPitchShift);
        const initialNextSymbol = this.transposeChord(thirdSegmentChord, this.currentPitchShift);
        this.renderChordDiagramCarousel('', initialChordSymbol, initialNextSymbol);
    }

    // Prevent manual horizontal scroll while allowing programmatic scrollTo()
    preventManualHorizontalScroll(scrollContainer) {
        if (!scrollContainer) return;

        // Block horizontal wheel scroll
        scrollContainer.addEventListener('wheel', (e) => {
            // If scrolling horizontally (shift+wheel or trackpad horizontal swipe)
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
            }
        }, { passive: false });

        // Block horizontal touch scroll on mobile
        let touchStartX = 0;
        let touchStartY = 0;

        scrollContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        scrollContainer.addEventListener('touchmove', (e) => {
            if (!e.touches.length) return;

            const touchX = e.touches[0].clientX;
            const touchY = e.touches[0].clientY;
            const deltaX = Math.abs(touchX - touchStartX);
            const deltaY = Math.abs(touchY - touchStartY);

            // If horizontal swipe is stronger than vertical
            if (deltaX > deltaY && deltaX > 10) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    preloadChordDiagrams(maxChords = 40) {
        if (!Array.isArray(this.chords) || !this.chords.length) return;
        const seen = new Set();
        const tasks = [];
        for (const entry of this.chords) {
            if (tasks.length >= maxChords) break;
            const symbol = (entry?.chord || '').trim();
            if (!symbol || seen.has(symbol)) continue;
            const parsed = this.parseChordSymbol(symbol);
            if (!parsed) continue;
            const root = this.normalizeNoteName(parsed.root);
            const suffixCandidates = Array.isArray(parsed.suffixCandidates) && parsed.suffixCandidates.length
                ? parsed.suffixCandidates
                : [this.getSuffixForQuality(parsed.quality)];
            seen.add(symbol);
            tasks.push(
                this.loadGuitarChordPositions(root, suffixCandidates).catch(() => {})
            );
        }
        if (tasks.length) {
            Promise.allSettled(tasks).catch(() => {});
        }
    }

    isChordTimelineVisible() {
        if (!this.chordScrollContainer) return true;
        const rect = this.chordScrollContainer.getBoundingClientRect();
        const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        return rect.bottom > 0 && rect.top < viewHeight * 0.7;
    }

    syncChordPlayhead(force = false) {
        if (!this.beatElements || !this.beatElements.length) return;

        // Find current beat based on actual time (no tempo adjustment needed - timestamps are in original time)
        const currentTime = this.currentTime - (this.beatOffset || 0);
        const beatIdx = this.getBeatIndexForTime(currentTime);
        if (beatIdx === -1) return;

        // Highlight the beat
        if (force || beatIdx !== this.currentChordIndex) {
            this.currentChordIndex = beatIdx;
            this.highlightBeat(beatIdx);
            if (beatIdx !== this._lastLoggedBeat) {
                this._lastLoggedBeat = beatIdx;
                console.log(`[ChordSync] t=${this.currentTime.toFixed(2)}, beatIdx=${beatIdx}, beatTime=${this.beatElements[beatIdx]?.dataset.beatTime}`);
            }
        }

        // Scroll to keep highlighted beat in 2nd position (using actual DOM position)
        if (this.chordScrollContainer) {
            const activeBeat = this.beatElements[beatIdx];
            if (activeBeat) {
                // Get the actual position of the beat element in the DOM
                const beatLeft = activeBeat.offsetLeft;

                // Fixed position at 2nd beat (80px from left edge of viewport for mobile)
                // 0-indexed: box 0, 1 = 2nd box - better for anticipating chord changes on mobile
                const fixedPlayheadPos = 1 * 80;

                // Scroll so the active beat appears at the fixed position
                const targetScroll = Math.max(0, beatLeft - fixedPlayheadPos);

                this.chordScrollContainer.scrollTo({
                    left: targetScroll,
                    behavior: 'auto'
                });
            }
        }

        // Sync Grid View if open
        this.syncGridView2();
    }

    getBeatIndexForTime(time) {
        if (!this.beatElements || !this.beatElements.length) return -1;

        // Find which beat element contains this time
        for (let i = 0; i < this.beatElements.length; i++) {
            const beatEl = this.beatElements[i];
            const beatTime = parseFloat(beatEl.dataset.beatTime);
            const nextBeatTime = i < this.beatElements.length - 1
                ? parseFloat(this.beatElements[i + 1].dataset.beatTime)
                : this.duration;

            if (time >= beatTime && time < nextBeatTime) {
                return i;
            }
        }

        // Return last beat if time is beyond all beats
        return this.beatElements.length - 1;
    }

    getChordIndexForTime(time) {
        const segments = this.chordSegments.length ? this.chordSegments : null;
        if (!segments || !segments.length) return -1;
        const offsetTime = time - (this.beatOffset || 0);
        for (let i = segments.length - 1; i >= 0; i--) {
            const start = segments[i].start || 0;
            const end = segments[i].end ?? this.duration;
            if (offsetTime >= start && offsetTime < end) return i;
        }
        return segments.length - 1;
    }

    highlightBeat(beatIndex) {
        if (!this.beatElements || !this.beatElements.length) return;

        const active = this.beatElements[beatIndex];
        if (!active) return;

        // Remove active class from all beats
        this.beatElements.forEach(el => el.classList.remove('active'));
        active.classList.add('active');

        // Highlight parent measure
        const measures = this.chordTrackElement?.querySelectorAll('.chord-linear-measure');
        if (measures) {
            measures.forEach(m => m.classList.remove('active'));
            const parentMeasure = active.closest('.chord-linear-measure');
            if (parentMeasure) parentMeasure.classList.add('active');
        }

        // Get current, previous and next chord names for the carousel
        const currentChordName = active.dataset.currentChord || '';
        const prevBeat = this.beatElements[beatIndex - 1];
        const nextBeat = this.beatElements[beatIndex + 2]; // Anticipate 2 beats ahead

        const prevChordName = prevBeat ? (prevBeat.dataset.currentChord || '') : '';
        const nextChordName = nextBeat ? (nextBeat.dataset.currentChord || '') : '';

        // Transpose all chords
        const transposedCurrent = this.transposeChord(currentChordName, this.currentPitchShift);
        const transposedPrev = this.transposeChord(prevChordName, this.currentPitchShift);
        const transposedNext = this.transposeChord(nextChordName, this.currentPitchShift);

        this.currentChordSymbol = transposedCurrent;
        this.prevChordSymbol = transposedPrev;
        this.nextChordSymbol = transposedNext;

        // Render the carousel with all three diagrams
        this.renderChordDiagramCarousel(transposedPrev, transposedCurrent, transposedNext);
    }

    highlightChord(index) {
        if (!this.chordElements || !this.chordElements.length) return;

        // Don't highlight if this is an empty slot
        const active = this.chordElements[index];
        if (!active || active.classList.contains('empty')) return;

        this.chordElements.forEach(el => el.classList.remove('active'));
        active.classList.add('active');

        // Highlight parent measure
        const measures = this.chordTrackElement?.querySelectorAll('.chord-linear-measure');
        if (measures) {
            measures.forEach(m => m.classList.remove('active'));
            const parentMeasure = active.closest('.chord-linear-measure');
            if (parentMeasure) parentMeasure.classList.add('active');
        }

        // Get current, previous and next chords
        const chordSource = this.chordSegments[index] || this.chords[index] || null;
        const prevSource = this.chordSegments[index - 1] || this.chords[index - 1] || null;
        const nextSource = this.chordSegments[index + 2] || this.chords[index + 2] || null; // Anticipate 2 ahead

        const currentChordName = this.transposeChord(chordSource?.chord || '', this.currentPitchShift);
        const prevChordName = this.transposeChord(prevSource?.chord || '', this.currentPitchShift);
        const nextChordName = this.transposeChord(nextSource?.chord || '', this.currentPitchShift);

        this.currentChordSymbol = currentChordName;
        this.prevChordSymbol = prevChordName;
        this.nextChordSymbol = nextChordName;

        this.renderChordDiagramCarousel(prevChordName, currentChordName, nextChordName);
    }

    updateChordLabels() {
        this.setupChordInstrumentToggle();
        if (!this.chordElements || !this.chordElements.length) {
            const firstChord = this.chordSegments[0]?.chord || this.chords[0]?.chord;
            const thirdChord = this.chordSegments[2]?.chord || this.chords[2]?.chord; // Anticipate 2 ahead
            if (firstChord) {
                const chordName = this.transposeChord(firstChord, this.currentPitchShift);
                const nextChordName = thirdChord ? this.transposeChord(thirdChord, this.currentPitchShift) : '';
                this.currentChordSymbol = chordName;
                this.nextChordSymbol = nextChordName;
                this.prevChordSymbol = '';
                this.renderChordDiagramCarousel('', chordName, nextChordName);
            } else {
                this.setChordDiagramMessage(DEFAULT_CHORD_MESSAGE);
            }
            return;
        }
        if (!this.chordElements) return;
        this.chordElements.forEach((el, idx) => {
            const chord = this.chordSegments[idx]?.chord || el.dataset.chord || el.dataset.currentChord || '';
            const name = el.querySelector('.chord-linear-beat-name');
            if (name) name.textContent = this.transposeChord(chord, this.currentPitchShift);
        });
        if (typeof this.currentChordIndex === 'number' && this.currentChordIndex >= 0) {
            const idx = this.currentChordIndex;
            const chordData = this.chordSegments[idx] || this.chords[idx];
            const prevData = this.chordSegments[idx - 1] || this.chords[idx - 1];
            const nextData = this.chordSegments[idx + 2] || this.chords[idx + 2]; // Anticipate 2 ahead

            const currentChordName = this.transposeChord(chordData?.chord || '', this.currentPitchShift);
            const prevChordName = this.transposeChord(prevData?.chord || '', this.currentPitchShift);
            const nextChordName = this.transposeChord(nextData?.chord || '', this.currentPitchShift);

            this.currentChordSymbol = currentChordName;
            this.prevChordSymbol = prevChordName;
            this.nextChordSymbol = nextChordName;

            this.renderChordDiagramCarousel(prevChordName, currentChordName, nextChordName);
        }
    }

    transposeChord(chord, semitones) {
        if (!chord || !semitones) return chord || '';

        const rootMatch = chord.match(/^([A-G][#b]?)/);
        if (!rootMatch) return chord;

        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const root = rootMatch[1];
        const quality = chord.substring(root.length);

        const normalized = root
            .replace('Db', 'C#')
            .replace('Eb', 'D#')
            .replace('Gb', 'F#')
            .replace('Ab', 'G#')
            .replace('Bb', 'A#');

        const idx = noteNames.indexOf(normalized);
        if (idx === -1) return chord;

        let nextIdx = (idx + semitones) % 12;
        if (nextIdx < 0) nextIdx += 12;

        return noteNames[nextIdx] + quality;
    }

    setupChordInstrumentToggle() {
        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        if (this.chordInstrumentButtons.length === 0) {
            const buttons = document.querySelectorAll('[data-chord-instrument]');
            if (!buttons.length) return;
            this.chordInstrumentButtons = Array.from(buttons);
            this.chordInstrumentButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.chordInstrument;
                    if (!mode || mode === this.chordDiagramMode) return;
                    this.chordDiagramMode = mode;
                    this.chordInstrumentButtons.forEach(b => b.classList.toggle('active', b.dataset.chordInstrument === this.chordDiagramMode));
                    // Refresh the carousel with current chords
                    if (this.currentChordSymbol) {
                        this.renderChordDiagramCarousel(this.prevChordSymbol || '', this.currentChordSymbol, this.nextChordSymbol || '');
                    }
                });
            });
        }
        this.chordInstrumentButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.chordInstrument === this.chordDiagramMode));
    }

    setChordDiagramMessage(message) {
        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        if (!this.chordDiagramEl) return;
        this.currentChordSymbol = null;
        this.chordDiagramEl.innerHTML = `<p class="mobile-text-muted">${message}</p>`;
        this.setupChordInstrumentToggle();
    }

    renderChordDiagram(chordName) {
        this.setupChordInstrumentToggle();
        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        if (!this.chordDiagramEl) return;
        if (!chordName) {
            this.setChordDiagramMessage(DEFAULT_CHORD_MESSAGE);
            return;
        }
        this.currentChordSymbol = chordName;
        const parsed = this.parseChordSymbol(chordName);
        if (!parsed) {
            this.setChordDiagramMessage('Diagram unavailable for this chord.');
            return;
        }
        if (this.chordDiagramMode === 'piano') {
            this.renderPianoDiagram(parsed, chordName);
        } else {
            this.renderGuitarDiagram(parsed, chordName);
        }
    }

    renderChordDiagramCarousel(prevChordName, currentChordName, nextChordName) {
        this.setupChordInstrumentToggle();

        // Initialize diagram elements if not already done
        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        if (!this.chordDiagramPrevEl) {
            this.chordDiagramPrevEl = document.getElementById('mobileChordDiagramPrev');
        }
        if (!this.chordDiagramNextEl) {
            this.chordDiagramNextEl = document.getElementById('mobileChordDiagramNext');
        }

        // Render current chord (center, large)
        if (currentChordName) {
            const parsed = this.parseChordSymbol(currentChordName);
            if (parsed) {
                this.currentChordSymbol = currentChordName;
                if (this.chordDiagramMode === 'piano') {
                    this.renderPianoDiagramInElement(parsed, currentChordName, this.chordDiagramEl);
                } else {
                    this.renderGuitarDiagramInElement(parsed, currentChordName, this.chordDiagramEl);
                }
            } else if (this.chordDiagramEl) {
                this.chordDiagramEl.innerHTML = '<p class="mobile-text-muted">—</p>';
            }
        } else if (this.chordDiagramEl) {
            this.chordDiagramEl.innerHTML = '<p class="mobile-text-muted">—</p>';
        }

        // Render previous chord (left, small)
        if (prevChordName && this.chordDiagramPrevEl) {
            const parsed = this.parseChordSymbol(prevChordName);
            if (parsed) {
                this.prevChordSymbol = prevChordName;
                if (this.chordDiagramMode === 'piano') {
                    this.renderPianoDiagramInElement(parsed, prevChordName, this.chordDiagramPrevEl);
                } else {
                    this.renderGuitarDiagramInElement(parsed, prevChordName, this.chordDiagramPrevEl);
                }
            } else {
                this.chordDiagramPrevEl.innerHTML = '<p class="mobile-text-muted">—</p>';
            }
        } else if (this.chordDiagramPrevEl) {
            this.chordDiagramPrevEl.innerHTML = '<p class="mobile-text-muted">—</p>';
        }

        // Render next chord (right, small)
        if (nextChordName && this.chordDiagramNextEl) {
            const parsed = this.parseChordSymbol(nextChordName);
            if (parsed) {
                this.nextChordSymbol = nextChordName;
                if (this.chordDiagramMode === 'piano') {
                    this.renderPianoDiagramInElement(parsed, nextChordName, this.chordDiagramNextEl);
                } else {
                    this.renderGuitarDiagramInElement(parsed, nextChordName, this.chordDiagramNextEl);
                }
            } else {
                this.chordDiagramNextEl.innerHTML = '<p class="mobile-text-muted">—</p>';
            }
        } else if (this.chordDiagramNextEl) {
            this.chordDiagramNextEl.innerHTML = '<p class="mobile-text-muted">—</p>';
        }
    }

    parseChordSymbol(chord) {
        if (!chord) return null;
        const match = chord.match(/^([A-G][#b]?)(.*)$/);
        if (!match) return null;
        const rawRoot = match[1];
        const normalizedRoot = this.normalizeNoteName(rawRoot);
        const remainder = this.sanitizeChordSuffix(match[2] || '');
        const { baseSuffix, bassNote } = this.extractSuffixParts(remainder);
        const quality = this.getQualityFromSuffix(baseSuffix);
        const qualitySuffix = this.getSuffixForQuality(quality);
        const suffixCandidates = this.buildSuffixCandidates(baseSuffix, bassNote, qualitySuffix);
        return {
            root: normalizedRoot,
            quality,
            suffixCandidates,
            baseSuffix,
            bassNote
        };
    }

    sanitizeChordSuffix(value) {
        if (!value) return '';
        let result = value
            .replace(/♭/g, 'b')
            .replace(/♯/g, '#')
            .replace(/–|−/g, '-')
            .replace(/Δ/g, 'maj')
            .replace(/Ø/g, 'm7b5')
            .replace(/ø/g, 'm7b5')
            .replace(/°/g, 'dim')
            .replace(/^\+/, 'aug')
            .replace(/\s+/g, '')
            .replace(/[()]/g, '');

        if (/^M(?=[0-9A-Za-z#b+\-])/.test(result)) {
            result = 'maj' + result.slice(1);
        }
        if (/^Maj/.test(result)) {
            result = 'maj' + result.slice(3);
        }
        result = result.toLowerCase();

        if (/^mi(?=[a-z0-9#b+\-])/.test(result)) {
            result = 'm' + result.slice(2);
        }
        if (/^min(?=[a-z0-9#b+\-])/.test(result)) {
            result = 'm' + result.slice(3);
        }

        return result;
    }

    extractSuffixParts(suffix) {
        if (!suffix) {
            return { baseSuffix: 'major', bassNote: '' };
        }
        const [base, bass] = suffix.split('/');
        return {
            baseSuffix: this.normalizeSuffixBase(base),
            bassNote: this.normalizeBassNote(bass)
        };
    }

    normalizeSuffixBase(token) {
        if (!token) return 'major';
        const lowered = token.toLowerCase();
        if (!lowered || lowered === 'maj') return 'major';
        if (['m', 'min', 'minor', '-'].includes(lowered)) return 'minor';
        if (lowered === 'sus') return 'sus4';
        if (lowered === 'dom7') return '7';
        if (lowered === 'dom9') return '9';
        if (lowered === 'dom11') return '11';
        if (lowered === 'dom13') return '13';
        return lowered;
    }

    normalizeBassNote(note) {
        if (!note) return '';
        const cleaned = note.replace(/[^A-G#b]/gi, '');
        if (!cleaned) return '';
        const normalized = this.normalizeNoteName(cleaned);
        return normalized ? normalized.toLowerCase() : '';
    }

    buildSuffixCandidates(baseSuffix, bassNote, fallbackSuffix) {
        const candidates = [];
        const pushCandidate = (suffix, includeBass = true) => {
            if (!suffix) return;
            const normalized = suffix.toLowerCase();
            if (includeBass && bassNote) {
                const withBass = `${normalized}_${bassNote}`;
                if (!candidates.includes(withBass)) candidates.push(withBass);
            }
            if (!candidates.includes(normalized)) candidates.push(normalized);
        };

        if (baseSuffix) pushCandidate(baseSuffix, true);
        if (fallbackSuffix) pushCandidate(fallbackSuffix, true);
        if (baseSuffix) pushCandidate(baseSuffix, false);
        if (fallbackSuffix && fallbackSuffix !== baseSuffix) pushCandidate(fallbackSuffix, false);

        if (baseSuffix !== 'major') pushCandidate('major', false);
        if (baseSuffix !== 'minor' && fallbackSuffix !== 'minor') {
            pushCandidate('minor', false);
        }

        return candidates.filter(Boolean);
    }

    getQualityFromSuffix(suffix) {
        const target = (suffix || '').toLowerCase();
        for (const pattern of CHORD_QUALITY_MAP) {
            if (pattern.match.test(target)) {
                return pattern.key;
            }
        }
        if (!target || target === 'major') return 'major';
        if (target === 'minor') return 'minor';
        return target || 'major';
    }

    getSuffixForQuality(quality) {
        if (!quality) return 'major';
        return QUALITY_TO_SUFFIX[quality] || quality || 'major';
    }

    shouldPreferBarreVoicing(chord, label) {
        if (!chord) return false;
        const root = chord.root || '';
        const normalizedLabel = (label || '').trim();
        const openChordList = [
            'A', 'C', 'D', 'E', 'G',
            'Am', 'Dm', 'Em',
            'A7', 'B7', 'C7', 'D7', 'E7', 'G7',
            'Amaj7', 'Cmaj7', 'Dmaj7', 'Emaj7', 'Gmaj7',
            'Am7', 'Dm7', 'Em7',
            'E9', 'G9',
            'Aadd9', 'Cadd9', 'Dadd9', 'Eadd9', 'Gadd9',
            'Asus2', 'Dsus2', 'Esus2', 'Gsus2',
            'Asus4', 'Csus4', 'Dsus4', 'Esus4', 'Gsus4',
            'A6', 'C6', 'D6', 'E6', 'G6',
            'Adim', 'Ddim', 'Edim',
            'Eaug', 'Caug'
        ];
        const forcedBarreRoots = ['F', 'F#', 'G#', 'A#', 'Bb', 'B', 'C#', 'D#', 'Eb', 'Ab'];

        if (openChordList.includes(normalizedLabel)) {
            return false;
        }

        const normalizedRoot = this.normalizeNoteName(root);
        if (forcedBarreRoots.includes(normalizedRoot)) {
            return true;
        }

        if (/#|b/.test(root)) return true;
        const suffix = chord.baseSuffix || '';
        return /(add9|9|11|13|dim|aug|m7b5|sus2sus4)/.test(suffix);
    }

    normalizeNoteName(note) {
        if (!note) return '';
        const replaced = note.replace('♭', 'b');
        const normalized = replaced.length > 1
            ? replaced[0].toUpperCase() + replaced.slice(1)
            : replaced.toUpperCase();
        return FLAT_TO_SHARP[normalized] || normalized;
    }

    getNoteIndex(note) {
        return NOTE_NAMES.indexOf(note);
    }

    getGuitarDiagramBuilder() {
        if (!this.guitarDiagramBuilder) {
            this.guitarDiagramBuilder = new GuitarDiagramBuilder();
        }
        return this.guitarDiagramBuilder;
    }

    hasCachedGuitarDiagram(root, suffixCandidates = []) {
        if (!root || !this.guitarDiagramCache) return false;
        const candidates = Array.isArray(suffixCandidates) && suffixCandidates.length
            ? suffixCandidates
            : ['major'];
        for (const suffix of candidates) {
            if (!suffix) continue;
            const key = `${root}_${suffix.toLowerCase()}`;
            if (this.guitarDiagramCache.has(key)) return true;
        }
        return false;
    }

    async loadGuitarChordPositions(root, suffixCandidates = []) {
        if (!root) return { positions: [], suffix: null };
        const candidates = Array.isArray(suffixCandidates) && suffixCandidates.length
            ? suffixCandidates
            : ['major'];
        const tried = new Set();

        for (const suffix of candidates) {
            if (!suffix) continue;
            const normalized = suffix.toLowerCase();
            if (tried.has(normalized)) continue;
            tried.add(normalized);
            const cacheKey = `${root}_${normalized}`;
            if (this.guitarDiagramCache.has(cacheKey)) {
                const cached = this.guitarDiagramCache.get(cacheKey);
                if (cached.length) return { positions: cached, suffix: normalized };
                continue;
            }

            const positions = await this.fetchGuitarChordPositions(root, normalized);
            if (positions.length) {
                this.storeInCache(this.guitarDiagramCache, cacheKey, positions, this.guitarDiagramCacheLimit);
                return { positions, suffix: normalized };
            }
        }

        return { positions: [], suffix: null };
    }

    async fetchGuitarChordPositions(root, suffix) {
        const encodedRoot = encodeURIComponent(root);
        const encodedSuffix = encodeURIComponent(suffix);
        const path = `/static/js/datas/guitar-chords-db-json/${encodedRoot}/${encodedSuffix}.json`;
        try {
            const res = await fetch(path);
            if (!res.ok) {
                if (res.status === 404) {
                    return [];
                }
                throw new Error(`Failed to load chord diagram (${res.status})`);
            }
            const json = await res.json();
            return Array.isArray(json?.positions) ? json.positions : [];
        } catch (err) {
            console.warn('[ChordDiagram] Load failed:', err);
            return [];
        }
    }

    renderGuitarDiagram(chord, label) {
        if (!this.chordDiagramEl) {
            this.chordDiagramEl = document.getElementById('mobileChordDiagram');
        }
        if (!this.chordDiagramEl) return;

        const root = this.normalizeNoteName(chord.root);
        const suffixCandidates = Array.isArray(chord.suffixCandidates) && chord.suffixCandidates.length
            ? chord.suffixCandidates
            : [this.getSuffixForQuality(chord.quality)];
        const preferBarre = this.shouldPreferBarreVoicing(chord, label);
        if (!this.hasCachedGuitarDiagram(root, suffixCandidates)) {
            this.chordDiagramEl.innerHTML = '<p class="mobile-text-muted">Loading chord diagram…</p>';
        }

        this.loadGuitarChordPositions(root, suffixCandidates)
            .then(({ positions }) => {
                if (!positions.length) {
                    this.setChordDiagramMessage('Diagram unavailable for this chord.');
                    return;
                }

                const selection = this.pickGuitarPosition(positions, { preferBarre, label });
                if (!selection) {
                    this.setChordDiagramMessage('Diagram unavailable for this chord.');
                    return;
                }

                const { position, frets, minFret, maxFret } = selection;
                if (!frets || frets.length !== 6) {
                    this.setChordDiagramMessage('Diagram unavailable for this chord.');
                    return;
                }

                const { baseFret, rows } = this.determineFretWindow(frets, position, minFret, maxFret);
                const fingers = this.parseFingerString(position.fingers);

                const relativeFrets = frets.map(fret => {
                    if (fret <= 0) return fret;
                    return Math.max(1, fret - baseFret + 1);
                });

                const builder = this.getGuitarDiagramBuilder();
                const svg = builder.build({
                    frets: relativeFrets,
                    fingers,
                    baseFret
                }, { rows });

                const wrapper = document.createElement('div');
                wrapper.className = 'guitar-diagram';

                const labelEl = document.createElement('div');
                labelEl.className = 'mobile-chord-diagram-label';
                labelEl.textContent = label;
                wrapper.appendChild(labelEl);

                const svgContainer = document.createElement('div');
                svgContainer.className = 'guitar-svg-wrapper';
                svgContainer.appendChild(svg);
                wrapper.appendChild(svgContainer);

                const fretLabelEl = document.createElement('div');
                fretLabelEl.className = 'guitar-fret-label';
                fretLabelEl.textContent = baseFret > 1 ? `Fret ${baseFret}` : 'Open position';
                wrapper.appendChild(fretLabelEl);

                this.chordDiagramEl.innerHTML = '';
                this.chordDiagramEl.appendChild(wrapper);
            })
            .catch(err => {
                console.warn('[ChordDiagram] Guitar render failed:', err);
                this.setChordDiagramMessage('Diagram unavailable for this chord.');
            });
    }

    renderPianoDiagram(chord, label) {
        const rootIndex = this.getNoteIndex(chord.root);
        if (rootIndex === -1) {
            this.setChordDiagramMessage('Diagram unavailable for this chord.');
            return;
        }
        const intervals = PIANO_INTERVALS[chord.quality] || PIANO_INTERVALS.major;
        const notes = intervals.map(offset => (rootIndex + offset) % 12);

        const whiteKeysHTML = WHITE_KEYS.map(note => {
            const noteIndex = NOTE_NAMES.indexOf(note);
            const active = notes.includes(noteIndex);
            return `<div class="piano-white-key${active ? ' active' : ''}"><span>${note}</span></div>`;
        }).join('');

        const whiteWidth = 100 / WHITE_KEYS.length;
        const blackKeysHTML = BLACK_KEYS.map(entry => {
            const noteIndex = NOTE_NAMES.indexOf(entry.note);
            if (noteIndex === -1) return '';
            const active = notes.includes(noteIndex);
            const left = ((entry.anchor + 1) * whiteWidth) - (whiteWidth * 0.35);
            return `<div class="piano-black-key${active ? ' active' : ''}" style="left:${left}%"></div>`;
        }).join('');

        this.chordDiagramEl.innerHTML = `
            <div class="mobile-chord-diagram-label">${label}</div>
            <div class="piano-diagram">
                <div class="piano-wrapper">
                    <div class="piano-white-keys">${whiteKeysHTML}</div>
                    <div class="piano-black-keys">${blackKeysHTML}</div>
                </div>
            </div>
        `;
    }

    renderGuitarDiagramInElement(chord, label, targetElement) {
        if (!targetElement) return;

        const root = this.normalizeNoteName(chord.root);
        const suffixCandidates = Array.isArray(chord.suffixCandidates) && chord.suffixCandidates.length
            ? chord.suffixCandidates
            : [this.getSuffixForQuality(chord.quality)];
        const preferBarre = this.shouldPreferBarreVoicing(chord, label);

        if (!this.hasCachedGuitarDiagram(root, suffixCandidates)) {
            targetElement.innerHTML = '<p class="mobile-text-muted">Loading…</p>';
        }

        this.loadGuitarChordPositions(root, suffixCandidates)
            .then(({ positions }) => {
                if (!positions.length) {
                    targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                    return;
                }

                const selection = this.pickGuitarPosition(positions, { preferBarre, label });
                if (!selection) {
                    targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                    return;
                }

                const { position, frets, minFret, maxFret } = selection;
                if (!frets || frets.length !== 6) {
                    targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                    return;
                }

                const { baseFret, rows } = this.determineFretWindow(frets, position, minFret, maxFret);
                const fingers = this.parseFingerString(position.fingers);

                const relativeFrets = frets.map(fret => {
                    if (fret <= 0) return fret;
                    return Math.max(1, fret - baseFret + 1);
                });

                const builder = this.getGuitarDiagramBuilder();
                const svg = builder.build({
                    frets: relativeFrets,
                    fingers,
                    baseFret
                }, { rows });

                const wrapper = document.createElement('div');
                wrapper.className = 'guitar-diagram';

                const labelEl = document.createElement('div');
                labelEl.className = 'mobile-chord-diagram-label';
                labelEl.textContent = label;
                wrapper.appendChild(labelEl);

                const svgContainer = document.createElement('div');
                svgContainer.className = 'guitar-svg-wrapper';
                svgContainer.appendChild(svg);
                wrapper.appendChild(svgContainer);

                const fretLabelEl = document.createElement('div');
                fretLabelEl.className = 'guitar-fret-label';
                fretLabelEl.textContent = baseFret > 1 ? `Fret ${baseFret}` : 'Open position';
                wrapper.appendChild(fretLabelEl);

                targetElement.innerHTML = '';
                targetElement.appendChild(wrapper);
            })
            .catch(err => {
                console.warn('[ChordDiagram] Guitar render failed:', err);
                targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
            });
    }

    renderPianoDiagramInElement(chord, label, targetElement) {
        if (!targetElement) return;

        const rootIndex = this.getNoteIndex(chord.root);
        if (rootIndex === -1) {
            targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
            return;
        }
        const intervals = PIANO_INTERVALS[chord.quality] || PIANO_INTERVALS.major;
        const notes = intervals.map(offset => (rootIndex + offset) % 12);

        const whiteKeysHTML = WHITE_KEYS.map(note => {
            const noteIndex = NOTE_NAMES.indexOf(note);
            const active = notes.includes(noteIndex);
            return `<div class="piano-white-key${active ? ' active' : ''}"><span>${note}</span></div>`;
        }).join('');

        const whiteWidth = 100 / WHITE_KEYS.length;
        const blackKeysHTML = BLACK_KEYS.map(entry => {
            const noteIndex = NOTE_NAMES.indexOf(entry.note);
            if (noteIndex === -1) return '';
            const active = notes.includes(noteIndex);
            const left = ((entry.anchor + 1) * whiteWidth) - (whiteWidth * 0.35);
            return `<div class="piano-black-key${active ? ' active' : ''}" style="left:${left}%"></div>`;
        }).join('');

        targetElement.innerHTML = `
            <div class="mobile-chord-diagram-label">${label}</div>
            <div class="piano-diagram">
                <div class="piano-wrapper">
                    <div class="piano-white-keys">${whiteKeysHTML}</div>
                    <div class="piano-black-keys">${blackKeysHTML}</div>
                </div>
            </div>
        `;
    }

    storeInCache(map, key, value, limit = 10) {
        if (!map) return;
        if (map.has(key)) map.delete(key);
        map.set(key, value);
        while (map.size > limit) {
            const oldest = map.keys().next().value;
            map.delete(oldest);
        }
    }

    setChordCache(key, chords) {
        if (!key || !Array.isArray(chords)) return;
        this.storeInCache(this.chordDataCache, key, this.cloneChordArray(chords), this.chordDataCacheLimit);
    }

    cloneChordArray(arr) {
        return Array.isArray(arr) ? arr.map(ch => ({ ...ch })) : [];
    }

    parseFrets(fretsString) {
        if (!fretsString) return null;
        const result = [];
        for (let i = 0; i < fretsString.length && result.length < 6; i++) {
            const char = fretsString[i];
            if (char === 'x' || char === 'X') {
                result.push(-1);
            } else if (/[0-9]/.test(char)) {
                result.push(parseInt(char, 10));
            } else if (/[a-z]/i.test(char)) {
                result.push(this.fretLetterToNumber(char));
            }
        }
        while (result.length < 6) result.push(0);
        return result;
    }

    fretLetterToNumber(char) {
        if (!char) return 0;
        const lower = char.toLowerCase();
        const code = lower.charCodeAt(0);
        if (code < 97 || code > 122) return 0;
        return 10 + (code - 97);
    }

    parseFingerString(fingerString) {
        if (!fingerString) return Array(6).fill(0);
        const result = [];
        for (let i = 0; i < fingerString.length && result.length < 6; i++) {
            const char = fingerString[i];
            result.push(/[0-9]/.test(char) ? parseInt(char, 10) : 0);
        }
        while (result.length < 6) result.push(0);
        return result;
    }

    pickGuitarPosition(positions, options = {}) {
        if (!Array.isArray(positions) || !positions.length) return null;
        let best = null;
        let bestScore = Infinity;
        const preferBarre = Boolean(options.preferBarre);
        const label = (options.label || '').trim().toLowerCase();
        const forceBarreLabel = ['bm', 'f#m', 'g#m', 'bbm', 'abm', 'b#m'].includes(label);

        positions.forEach(position => {
            const frets = this.parseFrets(position.frets);
            if (!Array.isArray(frets) || frets.length !== 6) return;
            const positive = frets.filter(f => f > 0);
            if (!positive.length) return;
            const minFret = Math.min(...positive);
            const maxFret = Math.max(...positive);
            const span = maxFret - minFret;
            const effectiveBase = Math.min(this.getBaseFret(position, minFret), minFret);
            const muted = frets.filter(f => f < 0).length;
            const open = frets.filter(f => f === 0).length;
            const hasBarre = typeof position.barres !== 'undefined';
            let score = (span * 3) + effectiveBase + (muted * 0.25) - (open * 0.1);
            if (preferBarre || forceBarreLabel) {
                score += open * 1.5;
                if (effectiveBase < 2) score += 3;
                if (effectiveBase < 4) score += 2;
                if (!hasBarre) score += 6;
                if ((open > 0 || effectiveBase <= 2) && !hasBarre) score += 4;
                if (hasBarre) score -= 2;
            } else {
                score -= open * 0.2;
            }
            if (score < bestScore) {
                bestScore = score;
                best = { position, frets, minFret, maxFret };
            }
        });

        if (best) return best;
        const fallback = positions[0];
        return fallback ? { position: fallback, frets: this.parseFrets(fallback.frets) || [], minFret: 1, maxFret: 4 } : null;
    }

    getBaseFret(position, fallback = null) {
        const raw = parseInt(position?.baseFret || position?.basefret || 'NaN', 10);
        if (Number.isFinite(raw) && raw > 0) return raw;
        if (Number.isFinite(fallback) && fallback > 0) return fallback;
        return 1;
    }

    determineFretWindow(frets, position, minFret = null, maxFret = null) {
        const positive = frets.filter(f => f > 0);
        if (!positive.length) return { baseFret: 1, rows: 4 };
        const minVal = Number.isFinite(minFret) ? minFret : Math.min(...positive);
        const maxVal = Number.isFinite(maxFret) ? maxFret : Math.max(...positive);
        const rawBase = this.getBaseFret(position, minVal) || minVal;
        let baseFret = Math.min(rawBase, minVal);
        const maxRows = 6;
        const minRows = 4;

        while ((maxVal - baseFret + 1) > maxRows) {
            baseFret += 1;
        }

        let rows = maxVal - baseFret + 1;
        if (rows < minRows) rows = minRows;
        if (rows > maxRows) rows = maxRows;
        return { baseFret, rows };
    }

    async regenerateChords() {
        const targetId = this.currentExtractionVideoId || this.currentExtractionId;
        if (!targetId) {
            return alert('Load a track before regenerating chords.');
        }
        if (this.chordRegenerating) return;
        const btn = document.getElementById('mobileRegenerateChords');
        const original = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Regenerating...';
        }
        this.chordRegenerating = true;
        try {
            const url = `/api/extractions/${targetId}/chords/regenerate`;
            const res = await fetch(url, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || ('HTTP ' + res.status));
            }
            const payload = Array.isArray(data.chords) ? data.chords : data.chords_data;
            let parsed = payload;
            if (typeof payload === 'string') {
                parsed = JSON.parse(payload);
            }
            if (!Array.isArray(parsed)) {
                throw new Error('Chord data missing from response');
            }
            this.chords = parsed;
            if (typeof data.beat_offset === 'number') {
                this.beatOffset = data.beat_offset;
            }
            if (this.currentExtractionData) {
                this.currentExtractionData.chords_data = JSON.stringify(parsed);
                if (typeof data.beat_offset === 'number') {
                    this.currentExtractionData.beat_offset = data.beat_offset;
                }
            }
            if (this.currentExtractionId) {
                this.setChordCache(this.currentExtractionId, parsed);
            }
            this.displayChords();
            this.initGridView2Popup();
            alert('Chords regenerated successfully!');
        } catch (error) {
            console.error('[Chords] Regeneration failed:', error);
            alert('Chord regeneration failed: ' + error.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
            this.chordRegenerating = false;
        }
    }

    /**
     * Parse a video title into artist and track components
     */
    parseTitle(title) {
        if (!title) return { artist: '', track: '' };

        let cleanTitle = title;

        // Remove common YouTube suffixes
        const patterns = [
            /\s*[\(\[]\s*(Official\s*)?(Music\s*)?(Video|Audio|Lyrics?|Visualizer|Clip)\s*[\)\]]/gi,
            /\s*[\(\[]\s*(HD|HQ|4K|1080p|720p)\s*[\)\]]/gi,
            /\s*[\(\[]\s*(Live|Acoustic|Remix|Cover|Version)\s*[\)\]]/gi,
            /\s*[\(\[]\s*\d{4}\s*[\)\]]/gi
        ];

        for (const pattern of patterns) {
            cleanTitle = cleanTitle.replace(pattern, '');
        }

        cleanTitle = cleanTitle.trim();

        // Split on " - "
        if (cleanTitle.includes(' - ')) {
            const parts = cleanTitle.split(' - ', 2);
            return {
                artist: parts[0].trim(),
                track: parts[1].trim()
            };
        }

        // No separator - return full title as track
        return { artist: '', track: cleanTitle };
    }

    /**
     * Show two-phase dialog for lyrics regeneration (mobile version).
     * Phase 1: Search form (artist/track inputs)
     * Phase 2: Track selection from Musixmatch results
     */
    showLyricsDialog() {
        return new Promise((resolve) => {
            const title = this.currentExtractionData?.title || '';
            const parsed = this.parseTitle(title);

            const overlay = document.createElement('div');
            overlay.className = 'lyrics-dialog-overlay';
            document.body.appendChild(overlay);

            const stopPropagation = (e) => { e.stopPropagation(); };
            overlay.addEventListener('keydown', stopPropagation);
            overlay.addEventListener('keyup', stopPropagation);
            overlay.addEventListener('keypress', stopPropagation);

            const cleanup = () => {
                overlay.removeEventListener('keydown', stopPropagation);
                overlay.removeEventListener('keyup', stopPropagation);
                overlay.removeEventListener('keypress', stopPropagation);
                overlay.remove();
            };

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(null);
                }
            });

            let selectedTrackId = null;

            // --- Phase 1: Search form ---
            const showPhase1 = (prefillArtist, prefillTrack) => {
                overlay.innerHTML = `
                    <div class="lyrics-dialog">
                        <h3>Regenerate Lyrics</h3>
                        <p class="lyrics-dialog-hint">Edit artist and track for Musixmatch search:</p>

                        <div class="lyrics-dialog-field">
                            <label for="lyrics-artist-m">Artist</label>
                            <input type="text" id="lyrics-artist-m" value="${this.escapeHtml(prefillArtist)}" placeholder="e.g. The Police">
                        </div>

                        <div class="lyrics-dialog-field">
                            <label for="lyrics-track-m">Track</label>
                            <input type="text" id="lyrics-track-m" value="${this.escapeHtml(prefillTrack)}" placeholder="e.g. So Lonely">
                        </div>

                        <div class="lyrics-dialog-buttons">
                            <button class="lyrics-dialog-btn lyrics-dialog-cancel">Cancel</button>
                            <button class="lyrics-dialog-btn lyrics-dialog-whisper">Whisper Only</button>
                            <button class="lyrics-dialog-btn lyrics-dialog-search primary">Search Musixmatch</button>
                        </div>
                    </div>
                `;

                setTimeout(() => {
                    const artistInput = overlay.querySelector('#lyrics-artist-m');
                    if (artistInput) artistInput.focus();
                }, 100);

                overlay.querySelector('.lyrics-dialog-cancel').addEventListener('click', () => {
                    cleanup();
                    resolve(null);
                });

                overlay.querySelector('.lyrics-dialog-whisper').addEventListener('click', () => {
                    cleanup();
                    resolve({ artist: '', track: '', forceWhisper: true, skipOnsetSync: false, musixmatchTrackId: null });
                });

                const doSearch = () => {
                    const artist = overlay.querySelector('#lyrics-artist-m').value.trim();
                    const track = overlay.querySelector('#lyrics-track-m').value.trim();
                    if (!artist && !track) return;
                    showSearching(artist, track);
                };

                overlay.querySelector('.lyrics-dialog-search').addEventListener('click', doSearch);

                const handleKeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        doSearch();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cleanup();
                        resolve(null);
                    }
                };
                overlay.addEventListener('keydown', handleKeydown);
            };

            // --- Searching state ---
            const showSearching = async (artist, track) => {
                const query = (artist + ' ' + track).trim();
                overlay.innerHTML = `
                    <div class="lyrics-dialog">
                        <h3>Searching Musixmatch</h3>
                        <div class="lyrics-dialog-spinner">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Searching for: ${this.escapeHtml(query)}</span>
                        </div>
                    </div>
                `;

                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

                    const response = await fetch('/api/musixmatch/search', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers,
                        body: JSON.stringify({ artist, track })
                    });

                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error('HTTP ' + response.status + ': ' + errText);
                    }

                    const data = await response.json();
                    if (data.error) throw new Error(data.error);

                    showPhase2(artist, track, data.results || []);

                } catch (err) {
                    overlay.innerHTML = `
                        <div class="lyrics-dialog">
                            <h3>Search Failed</h3>
                            <p class="lyrics-dialog-hint" style="color: #f44336;">${this.escapeHtml(err.message)}</p>
                            <div class="lyrics-dialog-buttons">
                                <button class="lyrics-dialog-btn lyrics-dialog-back">Back</button>
                            </div>
                        </div>
                    `;
                    overlay.querySelector('.lyrics-dialog-back').addEventListener('click', () => {
                        showPhase1(artist, track);
                    });
                }
            };

            // --- Phase 2: Track selection ---
            const showPhase2 = (artist, track, results) => {
                selectedTrackId = null;

                const badgeHtml = (r) => {
                    if (r.has_richsync) return '<span class="lyrics-dialog-track-badge badge-richsync" title="Word-level timestamps">W</span>';
                    if (r.has_subtitles) return '<span class="lyrics-dialog-track-badge badge-subtitles" title="Line-level timestamps">L</span>';
                    return '<span class="lyrics-dialog-track-badge badge-unknown" title="Unknown">?</span>';
                };

                let resultsHtml = '';
                if (results.length === 0) {
                    resultsHtml = '<p class="lyrics-dialog-hint">No results found. Try different search terms.</p>';
                } else {
                    resultsHtml = '<div class="lyrics-dialog-results">';
                    results.forEach((r, i) => {
                        resultsHtml += `
                            <div class="lyrics-dialog-track${i === 0 ? ' selected' : ''}" data-track-id="${r.track_id}">
                                <span class="lyrics-dialog-track-radio">${i === 0 ? '\u25CF' : '\u25CB'}</span>
                                <div class="lyrics-dialog-track-info">
                                    <span class="lyrics-dialog-track-name">${this.escapeHtml(r.track_name)}</span>
                                    <span class="lyrics-dialog-track-artist">${this.escapeHtml(r.artist_name)}</span>
                                    ${r.album_name ? '<span class="lyrics-dialog-track-album">' + this.escapeHtml(r.album_name) + '</span>' : ''}
                                </div>
                                ${badgeHtml(r)}
                            </div>
                        `;
                    });
                    resultsHtml += '</div>';
                    selectedTrackId = results[0].track_id;
                }

                overlay.innerHTML = `
                    <div class="lyrics-dialog lyrics-dialog-phase2">
                        <h3>Select Track</h3>
                        <p class="lyrics-dialog-hint">Results for: ${this.escapeHtml(artist)} - ${this.escapeHtml(track)}</p>
                        ${resultsHtml}
                        <div class="lyrics-dialog-buttons">
                            <button class="lyrics-dialog-btn lyrics-dialog-back">Back</button>
                            <button class="lyrics-dialog-btn lyrics-dialog-musixmatch"${results.length === 0 ? ' disabled' : ''}>Musixmatch Only</button>
                            <button class="lyrics-dialog-btn lyrics-dialog-submit primary"${results.length === 0 ? ' disabled' : ''}>Musixmatch + Sync</button>
                        </div>
                    </div>
                `;

                overlay.querySelectorAll('.lyrics-dialog-track').forEach(row => {
                    row.addEventListener('click', () => {
                        overlay.querySelectorAll('.lyrics-dialog-track').forEach(r => {
                            r.classList.remove('selected');
                            r.querySelector('.lyrics-dialog-track-radio').textContent = '\u25CB';
                        });
                        row.classList.add('selected');
                        row.querySelector('.lyrics-dialog-track-radio').textContent = '\u25CF';
                        selectedTrackId = parseInt(row.dataset.trackId);
                    });
                });

                overlay.querySelector('.lyrics-dialog-back').addEventListener('click', () => {
                    showPhase1(artist, track);
                });

                const musixmatchBtn = overlay.querySelector('.lyrics-dialog-musixmatch');
                const submitBtn = overlay.querySelector('.lyrics-dialog-submit');

                if (musixmatchBtn && !musixmatchBtn.disabled) {
                    musixmatchBtn.addEventListener('click', () => {
                        if (!selectedTrackId) return;
                        cleanup();
                        resolve({ artist, track, forceWhisper: false, skipOnsetSync: true, musixmatchTrackId: selectedTrackId });
                    });
                }

                if (submitBtn && !submitBtn.disabled) {
                    submitBtn.addEventListener('click', () => {
                        if (!selectedTrackId) return;
                        cleanup();
                        resolve({ artist, track, forceWhisper: false, skipOnsetSync: false, musixmatchTrackId: selectedTrackId });
                    });
                }

                const handleKeydown = (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        cleanup();
                        resolve(null);
                    }
                };
                overlay.addEventListener('keydown', handleKeydown);
            };

            showPhase1(parsed.artist, parsed.track);
        });
    }

    /**
     * Map source identifiers to human-readable labels
     */
    getSourceLabel(source) {
        const labels = {
            'musixmatch+onset': 'Musixmatch + Vocal Sync',
            'musixmatch': 'Musixmatch',
            'syncedlyrics': 'Musixmatch (word-level)',
            'lrclib+whisper': 'LrcLib + Whisper',
            'lrclib': 'LrcLib',
            'whisper': 'Whisper AI'
        };
        return labels[source] || source;
    }

    /**
     * Handle lyrics progress updates from SocketIO
     */
    onLyricsProgress(data) {
        if (!this.lyricsRegenerating) return;
        const btn = document.getElementById('mobileRegenerateLyrics');
        if (!btn) return;
        const step = data.step || '';
        const message = data.message || '';
        const display = step ? `${step}: ${message}` : message;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${this.escapeHtml(display)}`;
    }

    /**
     * Regenerate lyrics with Musixmatch dialog and progress feedback
     */
    async regenerateLyrics() {
        if (!this.currentExtractionId) {
            console.error('[Lyrics] No extraction ID');
            return alert('No track loaded');
        }

        const btn = document.getElementById('mobileRegenerateLyrics');
        if (!btn) {
            console.error('[Lyrics] Button not found');
            return;
        }

        // Show dialog to get artist/track and source preference
        const dialogResult = await this.showLyricsDialog();
        if (!dialogResult) {
            console.log('[Lyrics] Dialog cancelled');
            return;
        }

        console.log('[Lyrics] Regenerating lyrics with:', dialogResult);

        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Regenerating...';
        btn.disabled = true;
        this.lyricsRegenerating = true;

        try {
            const url = '/api/extractions/' + this.currentExtractionId + '/lyrics/regenerate';
            console.log('[Lyrics] Fetching:', url);

            const res = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({
                    artist: dialogResult.artist,
                    track: dialogResult.track,
                    force_whisper: dialogResult.forceWhisper,
                    skip_onset_sync: dialogResult.skipOnsetSync,
                    musixmatch_track_id: dialogResult.musixmatchTrackId || null
                })
            });

            console.log('[Lyrics] Response status:', res.status);

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error('HTTP ' + res.status + ': ' + errorText);
            }

            const data = await res.json();
            console.log('[Lyrics] Response data:', data);

            if (data.error) throw new Error(data.error);

            const lyricsData = data.lyrics || data.lyrics_data;

            if (lyricsData) {
                this.lyrics = typeof lyricsData === 'string' ? JSON.parse(lyricsData) : lyricsData;
                const source = data.source || 'unknown';
                console.log('[Lyrics] Loaded', this.lyrics.length, 'segments from source:', source);
                this.displayLyrics();
                // Update extraction data so jam guests get lyrics on join
                if (this.currentExtractionData) {
                    this.currentExtractionData.lyrics_data = this.lyrics;
                }

                // Build success message with source info and alignment stats
                const sourceLabel = this.getSourceLabel(source);
                let message = `Lyrics loaded (${sourceLabel}): ${this.lyrics.length} segments`;

                const stats = data.alignment_stats;
                if (stats && stats.match_rate !== undefined) {
                    message += `\n\nSync statistics:`;
                    message += `\n- Words matched: ${stats.matched_words}/${stats.total_words} (${stats.match_rate}%)`;
                    if (stats.global_offset_sec !== undefined) {
                        message += `\n- Global offset: ${stats.global_offset_sec}s`;
                    }
                }

                alert(message);
            } else {
                console.warn('[Lyrics] No lyrics data in response');
                alert('Lyrics regeneration completed but no data returned');
            }
        } catch (error) {
            console.error('[Lyrics] Regeneration failed:', error);
            alert('Lyrics regeneration failed: ' + error.message);
        } finally {
            this.lyricsRegenerating = false;
            btn.innerHTML = orig;
            btn.disabled = false;
        }
    }

    displayLyrics() {
        const container = document.getElementById('mobileLyricsDisplay');
        if (!container) {
            console.warn('[Lyrics] Container not found');
            return;
        }

        this.lyricsContainer = container;

        if (!this.lyrics.length) {
            container.innerHTML = '<p class="mobile-lyrics-placeholder">No lyrics available. Generate lyrics to see them here.</p>';
            this.detachLyricsScrollHandlers();
            this.lyricLineElements = [];
            this.activeLyricIndex = -1;
            this.lyricsUserScrolling = false;
            if (this.lyricsScrollResumeTimer) {
                clearTimeout(this.lyricsScrollResumeTimer);
                this.lyricsScrollResumeTimer = null;
            }
            return;
        }

        console.log('[Lyrics] Rendering', this.lyrics.length, 'segments with word-level timing');
        container.innerHTML = '';
        this.lyricLineElements = [];
        this.activeLyricIndex = -1;
        this.cancelLyricsScrollAnimation();
        this.attachLyricsScrollHandlers();

        // Reset scroll position
        container.scrollTop = 0;

        // Build chord lookup for songbook display
        const chordLookup = this.buildChordLookupForLyrics();

        // Create a line for each segment
        this.lyrics.forEach((segment, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'mobile-lyrics-line';
            lineDiv.dataset.index = index;
            lineDiv.dataset.start = segment.start || 0;
            lineDiv.dataset.end = segment.end || 0;

            // Add timestamp
            const timeSpan = document.createElement('span');
            timeSpan.className = 'mobile-lyrics-time';
            timeSpan.textContent = this.formatTime(segment.start || 0);
            lineDiv.appendChild(timeSpan);

            // Add text container for words with chord annotations (songbook style)
            const textContainer = document.createElement('div');
            textContainer.className = 'mobile-lyrics-text songbook-style';

            // If we have word-level timestamps, render words with chord annotations
            if (segment.words && segment.words.length > 0) {
                segment.words.forEach((wordData, wordIndex) => {
                    const wordWrapper = document.createElement('span');
                    wordWrapper.className = 'mobile-lyrics-word-wrapper';

                    // Check if there's a chord change at this word
                    const chordInfo = this.findChordAtTime(wordData.start, chordLookup);
                    if (chordInfo && chordInfo.isChange) {
                        const chordLabel = document.createElement('span');
                        chordLabel.className = 'mobile-lyrics-chord';
                        chordLabel.dataset.originalChord = chordInfo.chord;
                        chordLabel.dataset.chordTime = chordInfo.timestamp;
                        chordLabel.textContent = this.transposeChord(chordInfo.chord, this.currentPitchShift);
                        wordWrapper.appendChild(chordLabel);
                    }

                    const wordSpan = document.createElement('span');
                    wordSpan.className = 'mobile-lyrics-word';
                    wordSpan.dataset.wordIndex = wordIndex;
                    wordSpan.dataset.start = wordData.start || 0;
                    wordSpan.dataset.end = wordData.end || 0;
                    wordSpan.textContent = wordData.word;

                    wordWrapper.appendChild(wordSpan);
                    textContainer.appendChild(wordWrapper);
                });
                console.log('[Lyrics] Line', index, 'rendered with', segment.words.length, 'words (songbook style)');
            } else {
                // Fallback: no word timestamps, check for chord at line start
                const chordInfo = this.findChordAtTime(segment.start, chordLookup);
                if (chordInfo) {
                    const chordLabel = document.createElement('span');
                    chordLabel.className = 'mobile-lyrics-chord';
                    chordLabel.dataset.originalChord = chordInfo.chord;
                    chordLabel.textContent = this.transposeChord(chordInfo.chord, this.currentPitchShift);
                    textContainer.appendChild(chordLabel);
                }
                const textSpan = document.createElement('span');
                textSpan.textContent = segment.text || '';
                textContainer.appendChild(textSpan);
                console.log('[Lyrics] Line', index, 'rendered without word timing (fallback)');
            }

            lineDiv.appendChild(textContainer);

            // Click to seek
            lineDiv.addEventListener('click', () => {
                console.log('[Lyrics] Seek to', segment.start);
                this.seek(segment.start || 0);
            });

            container.appendChild(lineDiv);
        });

        this.lyricLineElements = Array.from(container.querySelectorAll('.mobile-lyrics-line'));
        this.applyLyricLineStates(this.activeLyricIndex);
        console.log('[Lyrics] Rendered', this.lyrics.length, 'lines with songbook-style chord annotations');
    }

    buildChordLookupForLyrics() {
        // Build a sorted list of chord changes with timestamps
        if (!this.chords || this.chords.length === 0) return [];

        const lookup = [];
        let lastChord = null;

        this.chords.forEach(chord => {
            const chordName = chord.chord || '';
            const timestamp = chord.timestamp || 0;

            // Only add if it's a new chord (chord change)
            if (chordName && chordName !== lastChord) {
                lookup.push({
                    chord: chordName,
                    timestamp: timestamp,
                    isChange: true
                });
                lastChord = chordName;
            }
        });

        return lookup;
    }

    findChordAtTime(time, chordLookup) {
        if (!chordLookup || chordLookup.length === 0) return null;

        // Find the chord that starts closest to (and before or at) this time
        // with a tolerance window for matching
        const tolerance = 0.5; // 500ms tolerance

        for (let i = chordLookup.length - 1; i >= 0; i--) {
            const chordInfo = chordLookup[i];
            const diff = time - chordInfo.timestamp;

            // Chord starts within tolerance before or at the word
            if (diff >= -tolerance && diff <= tolerance) {
                // Mark as already used to avoid duplicates
                if (!chordInfo.used) {
                    chordInfo.used = true;
                    return chordInfo;
                }
            }
        }

        return null;
    }

    updateLyricsChordTransposition() {
        // Update all chord labels in lyrics when pitch changes
        const chordLabels = document.querySelectorAll('.mobile-lyrics-chord');
        chordLabels.forEach(label => {
            const originalChord = label.dataset.originalChord;
            if (originalChord) {
                label.textContent = this.transposeChord(originalChord, this.currentPitchShift);
            }
        });
    }

    updateActiveLyric() {
        if (!this.lyrics.length || !this.lyricsContainer) return;

        const currentTime = this.currentTime;
        const segmentIndex = this.findCurrentLyricIndex(currentTime);

        if (segmentIndex === -1) {
            if (this.activeLyricIndex !== -1) {
                this.clearWordHighlights(this.activeLyricIndex);
                this.activeLyricIndex = -1;
            }
            return;
        }

        if (segmentIndex !== this.activeLyricIndex) {
            this.clearWordHighlights(this.activeLyricIndex);
            this.activeLyricIndex = segmentIndex;
            this.applyLyricLineStates(segmentIndex);
            this.scrollLyricsToIndex(segmentIndex);
        }

        this.highlightLyricWords(segmentIndex, currentTime);

        // Update fullscreen lyrics if open
        this.updateFullscreenLyrics();
    }

    findCurrentLyricIndex(currentTime) {
        if (!this.lyrics.length) return -1;

        const tolerance = 0.2;
        const activeIndex = this.activeLyricIndex;

        if (activeIndex >= 0) {
            const activeSeg = this.lyrics[activeIndex];
            if (activeSeg && currentTime >= (activeSeg.start - tolerance) && currentTime <= (activeSeg.end + tolerance)) {
                return activeIndex;
            }

            if (activeSeg && currentTime > activeSeg.end) {
                for (let i = activeIndex + 1; i < this.lyrics.length; i++) {
                    const seg = this.lyrics[i];
                    if (!seg) continue;
                    if (currentTime < seg.start - tolerance) break;
                    if (currentTime <= seg.end + tolerance) {
                        return i;
                    }
                }
            } else if (activeSeg && currentTime < activeSeg.start) {
                for (let i = activeIndex - 1; i >= 0; i--) {
                    const seg = this.lyrics[i];
                    if (!seg) continue;
                    if (currentTime >= seg.start - tolerance && currentTime <= seg.end + tolerance) {
                        return i;
                    }
                    if (currentTime > seg.end) break;
                }
            }
        }

        for (let i = 0; i < this.lyrics.length; i++) {
            const seg = this.lyrics[i];
            if (!seg) continue;
            if (currentTime >= (seg.start - tolerance) && currentTime <= (seg.end + tolerance)) {
                return i;
            }
            if (currentTime < seg.start) break;
        }

        const lastSegment = this.lyrics[this.lyrics.length - 1];
        if (lastSegment && currentTime > lastSegment.end) {
            return this.lyrics.length - 1;
        }

        return -1;
    }

    applyLyricLineStates(activeIndex) {
        if (!this.lyricLineElements.length) return;

        const pastPreview = this.lyricsPastPreviewCount;
        const futurePreview = this.lyricsFuturePreviewCount;

        this.lyricLineElements.forEach((line, i) => {
            line.classList.remove('recent-past', 'hidden-past', 'hidden-future', 'up-next', 'active', 'past', 'future');

            if (activeIndex === -1) {
                if (i === 0) {
                    line.classList.add('up-next', 'future');
                } else {
                    line.classList.add('future');
                }
                return;
            }

            if (i === activeIndex) {
                line.classList.add('active');
                return;
            }

            if (i < activeIndex) {
                line.classList.add('past');
                if (i >= activeIndex - pastPreview) {
                    line.classList.add('recent-past');
                } else {
                    line.classList.add('hidden-past');
                }
                return;
            }

            line.classList.add('future');
            if (i <= activeIndex + futurePreview) {
                line.classList.add('up-next');
            } else {
                line.classList.add('hidden-future');
            }
        });
    }

    scrollLyricsToIndex(index, immediate = false) {
        if (!this.lyricsContainer || index < 0 || !this.lyricLineElements[index]) return;
        if (!immediate && this.isPlaying && this.lyricsUserScrolling) return;

        const container = this.lyricsContainer;
        const line = this.lyricLineElements[index];

        // Position the active line at 35% from top (slightly above center)
        // This allows users to see upcoming lyrics while keeping current line visible
        const containerHeight = container.clientHeight;
        const targetOffset = containerHeight * 0.35;

        // Calculate target scroll position
        const lineTop = line.offsetTop;
        const lineHeight = line.clientHeight;
        const lineCenterY = lineTop + (lineHeight / 2);

        // Target position to place line center at 35% of viewport
        let targetTop = lineCenterY - targetOffset;

        // Clamp to valid scroll range
        const maxScroll = Math.max(0, container.scrollHeight - containerHeight);
        const clampedTarget = Math.max(0, Math.min(targetTop, maxScroll));

        if (immediate) {
            this.cancelLyricsScrollAnimation();
            this.lyricsAutoScrolling = true;
            container.scrollTop = clampedTarget;
            this.lyricsAutoScrolling = false;
            return;
        }

        if (Math.abs(container.scrollTop - clampedTarget) < 1) return;
        this.animateLyricsScroll(clampedTarget);
    }

    animateLyricsScroll(target) {
        if (!this.lyricsContainer) return;

        this.cancelLyricsScrollAnimation();
        this.lyricsAutoScrolling = true;

        const container = this.lyricsContainer;
        const start = container.scrollTop;
        const distance = target - start;

        if (Math.abs(distance) < 0.5) {
            container.scrollTop = target;
            this.lyricsAutoScrolling = false;
            return;
        }

        // Smooth, gentle scroll animation
        const duration = 600;
        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
        const startTime = performance.now();

        const step = (now) => {
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = easeOutCubic(progress);
            container.scrollTop = start + distance * eased;

            if (progress < 1) {
                this.lyricsScrollAnimation = requestAnimationFrame(step);
            } else {
                this.lyricsScrollAnimation = null;
                this.lyricsAutoScrolling = false;
            }
        };

        this.lyricsScrollAnimation = requestAnimationFrame(step);
    }

    cancelLyricsScrollAnimation() {
        if (this.lyricsScrollAnimation) {
            cancelAnimationFrame(this.lyricsScrollAnimation);
            this.lyricsScrollAnimation = null;
        }
        this.lyricsAutoScrolling = false;
    }

    clearWordHighlights(index) {
        if (index < 0 || !this.lyricLineElements[index]) return;

        const line = this.lyricLineElements[index];
        const wordSpans = line.querySelectorAll('.mobile-lyrics-word');

        wordSpans.forEach((wordSpan) => {
            wordSpan.classList.remove('word-past', 'word-current', 'word-future');
            wordSpan.style.background = '';
            wordSpan.style.webkitBackgroundClip = '';
            wordSpan.style.backgroundClip = '';
            wordSpan.style.webkitTextFillColor = '';
        });
    }

    highlightLyricWords(segmentIndex, currentTime) {
        if (segmentIndex < 0 || !this.lyricLineElements[segmentIndex]) return;

        const line = this.lyricLineElements[segmentIndex];
        const wordSpans = line.querySelectorAll('.mobile-lyrics-word');

        wordSpans.forEach((wordSpan) => {
            const wordStart = parseFloat(wordSpan.dataset.start) || 0;
            const wordEnd = parseFloat(wordSpan.dataset.end) || 0;

            wordSpan.classList.remove('word-past', 'word-current', 'word-future');

            if (currentTime < wordStart) {
                wordSpan.classList.add('word-future');
                wordSpan.style.background = '';
                wordSpan.style.webkitBackgroundClip = '';
                wordSpan.style.backgroundClip = '';
                wordSpan.style.webkitTextFillColor = '';
            } else if (currentTime >= wordStart && currentTime <= wordEnd) {
                wordSpan.classList.add('word-current');
                const progress = wordEnd > wordStart ? (currentTime - wordStart) / (wordEnd - wordStart) : 1;
                const fillPercent = Math.min(100, Math.max(0, progress * 100));
                wordSpan.style.background = `linear-gradient(to right, var(--mobile-primary) ${fillPercent}%, rgba(255, 255, 255, 0.6) ${fillPercent}%)`;
                wordSpan.style.webkitBackgroundClip = 'text';
                wordSpan.style.backgroundClip = 'text';
                wordSpan.style.webkitTextFillColor = 'transparent';
            } else {
                wordSpan.classList.add('word-past');
                wordSpan.style.background = 'var(--mobile-primary)';
                wordSpan.style.webkitBackgroundClip = 'text';
                wordSpan.style.backgroundClip = 'text';
                wordSpan.style.webkitTextFillColor = 'transparent';
            }
        });
    }

    attachLyricsScrollHandlers() {
        if (!this.lyricsContainer) return;

        this.detachLyricsScrollHandlers();

        const pointerDownHandler = () => this.onLyricsManualScrollStart();
        const pointerReleaseHandler = () => this.onLyricsManualScrollEnd();
        const wheelHandler = () => {
            this.onLyricsManualScrollStart();
            this.onLyricsManualScrollEnd(1500);
        };
        const touchMoveHandler = () => this.onLyricsManualScrollStart();
        const scrollHandler = () => {
            if (this.lyricsAutoScrolling || !this.isPlaying) return;
            this.onLyricsManualScrollStart();
            this.onLyricsManualScrollEnd(1500);
        };

        this.lyricsContainer.addEventListener('pointerdown', pointerDownHandler);
        this.lyricsContainer.addEventListener('pointerup', pointerReleaseHandler);
        this.lyricsContainer.addEventListener('pointercancel', pointerReleaseHandler);
        this.lyricsContainer.addEventListener('pointerleave', pointerReleaseHandler);
        this.lyricsContainer.addEventListener('wheel', wheelHandler, { passive: true });
        this.lyricsContainer.addEventListener('touchmove', touchMoveHandler, { passive: true });
        this.lyricsContainer.addEventListener('scroll', scrollHandler, { passive: true });

        this.lyricsScrollHandlers = {
            pointerDownHandler,
            pointerReleaseHandler,
            wheelHandler,
            touchMoveHandler,
            scrollHandler
        };
    }

    detachLyricsScrollHandlers() {
        if (!this.lyricsContainer || !this.lyricsScrollHandlers) return;

        const handlers = this.lyricsScrollHandlers;
        this.lyricsContainer.removeEventListener('pointerdown', handlers.pointerDownHandler);
        this.lyricsContainer.removeEventListener('pointerup', handlers.pointerReleaseHandler);
        this.lyricsContainer.removeEventListener('pointercancel', handlers.pointerReleaseHandler);
        this.lyricsContainer.removeEventListener('pointerleave', handlers.pointerReleaseHandler);
        this.lyricsContainer.removeEventListener('wheel', handlers.wheelHandler);
        this.lyricsContainer.removeEventListener('touchmove', handlers.touchMoveHandler);
        this.lyricsContainer.removeEventListener('scroll', handlers.scrollHandler);
        this.lyricsScrollHandlers = null;
        if (this.lyricsScrollResumeTimer) {
            clearTimeout(this.lyricsScrollResumeTimer);
            this.lyricsScrollResumeTimer = null;
        }
    }

    onLyricsManualScrollStart() {
        if (!this.isPlaying) return;

        if (!this.lyricsUserScrolling) {
            this.lyricsUserScrolling = true;
            this.cancelLyricsScrollAnimation();
        }

        if (this.lyricsScrollResumeTimer) {
            clearTimeout(this.lyricsScrollResumeTimer);
            this.lyricsScrollResumeTimer = null;
        }
    }

    onLyricsManualScrollEnd(delay = 1500) {
        if (!this.lyricsUserScrolling) return;

        if (!this.isPlaying) {
            this.lyricsUserScrolling = false;
            return;
        }

        if (this.lyricsScrollResumeTimer) {
            clearTimeout(this.lyricsScrollResumeTimer);
        }

        this.lyricsScrollResumeTimer = setTimeout(() => {
            this.lyricsUserScrolling = false;
            if (this.activeLyricIndex >= 0) {
                this.scrollLyricsToIndex(this.activeLyricIndex);
            }
        }, delay);
    }

    renderWaveform() {
        const canvas = document.getElementById('mobileWaveformCanvas');
        if (!canvas) {
            console.warn('[Waveform] Canvas not found');
            return;
        }

        const ctx = canvas.getContext('2d');

        const parentWidth = canvas.parentElement.offsetWidth;
        const parentHeight = canvas.parentElement.offsetHeight;
        const width = parentWidth > 0 ? parentWidth : Math.min(window.innerWidth - 24, 800);
        const height = parentHeight > 0 ? parentHeight : 120;

        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        const pointCount = Math.max(500, Math.floor(width * window.devicePixelRatio));
        let data = null;

        if (this.masterAudioBuffer) {
            data = this.buildWaveformDataFromBuffer(this.masterAudioBuffer, pointCount);
        }

        if (!data || !data.length) {
            const stemBuffers = Object.values(this.stems).map(s => s.buffer).filter(Boolean);
            if (!stemBuffers.length) {
                console.warn('[Waveform] No audio buffers available for waveform rendering');
                return;
            }
            data = this.buildMasterWaveformData(stemBuffers, pointCount);
        }

        if (!data || !data.length) {
            console.warn('[Waveform] Unable to render waveform - no data');
            return;
        }

        ctx.fillStyle = '#282828';
        ctx.fillRect(0, 0, width, height);

        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.fillStyle = '#1DB954';
        ctx.globalAlpha = 0.6;

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            const yMin = (1 + min) * amp;
            const yMax = (1 + max) * amp;

            ctx.fillRect(i, yMin, 1, yMax - yMin);
        }

        ctx.globalAlpha = 1.0;
        console.log('[Waveform] Rendered master waveform:', width + 'x' + height);

        // Render timeline markers
        this.renderTimeline();
    }

    buildWaveformDataFromBuffer(buffer, pointCount = 1000) {
        if (!buffer || !pointCount) return null;
        const channel = buffer.getChannelData(0);
        const length = channel.length;
        if (!length) return null;

        const data = new Float32Array(pointCount);
        const blockSize = Math.floor(length / pointCount);
        if (!blockSize) return Array.from(channel.slice(0, pointCount));

        for (let i = 0; i < pointCount; i++) {
            const start = i * blockSize;
            let sum = 0;
            for (let j = 0; j < blockSize && (start + j) < length; j++) {
                sum += channel[start + j];
            }
            data[i] = sum / blockSize;
        }

        let maxVal = 0;
        for (let i = 0; i < pointCount; i++) {
            const abs = Math.abs(data[i]);
            if (abs > maxVal) maxVal = abs;
        }

        if (maxVal > 0) {
            for (let i = 0; i < pointCount; i++) {
                data[i] /= maxVal;
            }
        }

        return Array.from(data);
    }

    buildMasterWaveformData(buffers, pointCount = 1000) {
        if (!buffers.length || pointCount <= 0) return null;
        const maxSamples = Math.max(...buffers.map(b => b.length));
        if (!maxSamples) return null;

        const data = new Float32Array(pointCount);
        const counts = new Uint32Array(pointCount);

        buffers.forEach(buffer => {
            if (!buffer.numberOfChannels) return;
            const channel = buffer.getChannelData(0);
            const len = channel.length;
            for (let i = 0; i < len; i++) {
                const bucket = Math.min(pointCount - 1, Math.floor((i / maxSamples) * pointCount));
                data[bucket] += channel[i];
                counts[bucket]++;
            }
        });

        let maxVal = 0;
        for (let i = 0; i < pointCount; i++) {
            if (counts[i] > 0) {
                data[i] /= counts[i];
            }
            const abs = Math.abs(data[i]);
            if (abs > maxVal) maxVal = abs;
        }

        if (maxVal > 0) {
            for (let i = 0; i < pointCount; i++) {
                data[i] /= maxVal;
            }
        }

        return Array.from(data);
    }

    renderTimeline() {
        const timeline = document.getElementById('mobileWaveformTimeline');
        if (!timeline || this.duration <= 0) {
            console.warn('[Timeline] Cannot render - timeline element or duration missing');
            return;
        }

        timeline.innerHTML = '';

        // Determine interval based on duration
        let interval;
        if (this.duration < 90) {
            interval = 15; // 15s for songs < 1.5min
        } else if (this.duration < 300) {
            interval = 30; // 30s for songs < 5min
        } else if (this.duration < 600) {
            interval = 60; // 1min for songs < 10min
        } else {
            interval = 120; // 2min for longer songs
        }

        console.log('[Timeline] Rendering with', interval, 's interval for duration', this.duration);

        // Generate markers
        const markers = [];
        for (let time = 0; time <= this.duration; time += interval) {
            markers.push(time);
        }

        // Always include the end time if it's not already there
        if (markers[markers.length - 1] < this.duration) {
            markers.push(Math.floor(this.duration));
        }

        console.log('[Timeline] Creating', markers.length, 'markers:', markers);

        // Create marker elements
        markers.forEach(time => {
            const marker = document.createElement('div');
            marker.className = 'mobile-timeline-marker';

            const tick = document.createElement('div');
            tick.className = 'mobile-timeline-tick';

            const label = document.createElement('div');
            label.className = 'mobile-timeline-label';
            label.textContent = this.formatTime(time);

            marker.appendChild(tick);
            marker.appendChild(label);
            timeline.appendChild(marker);
        });

        console.log('[Timeline] Rendered', markers.length, 'markers');
    }

    formatTime(s) {
        if (isNaN(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + sec.toString().padStart(2, '0');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    syncPopupControlsState() {
        try {
        // Sync play button state (include both popup and mobile sync classes)
        const playBtns = document.querySelectorAll('.popup-play-sync, .mobile-play-sync');
        playBtns.forEach(btn => {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
            }
            btn.classList.toggle('playing', this.isPlaying);
        });

        // Sync time display
        const timeDisplays = document.querySelectorAll('.popup-time-sync');
        timeDisplays.forEach(el => {
            el.textContent = this.formatTime(this.currentTime);
        });

        const durationDisplays = document.querySelectorAll('.popup-duration-sync');
        durationDisplays.forEach(el => {
            el.textContent = this.formatTime(this.duration);
        });

        // Sync tempo displays (BPM-based)
        const currentBPM = this.currentBPM || 120;

        // Update all BPM displays
        document.querySelectorAll('.tempo-bpm-display').forEach(el => {
            if (isFinite(currentBPM) && currentBPM > 0) {
                el.textContent = Math.round(currentBPM) + ' BPM';
            }
        });

        // Update dial if exists
        if (this.tempoDial) {
            this.tempoDial.setValue(Math.round(currentBPM));
        }

        // Sync pitch displays
        const pitch = this.currentPitchShift || 0;
        const pitchFormatted = (pitch >= 0 ? '+' : '') + Math.round(pitch);

        document.querySelectorAll('.pitch-display').forEach(el => {
            el.textContent = pitchFormatted;
        });

        // Update dial if exists
        if (this.pitchDial) {
            this.pitchDial.setValue(Math.round(pitch));
        }

        // Legacy sync for popup sliders (if any remain)
        document.querySelectorAll('.popup-pitch-sync').forEach(slider => {
            slider.value = pitch;
        });
        document.querySelectorAll('.popup-pitch-value-sync').forEach(el => {
            el.textContent = pitchFormatted;
        });
        } catch (err) {
            console.error('[syncPopupControlsState] Error:', err);
        }
    }

    // ============================================
    // GRID VIEW - MODERN CHORDS GRID POPUP
    // ============================================

    initGridView2Popup() {
        // Prevent duplicate initialization
        if (this.gridView2PopupInitialized) return;

        const openBtn = document.getElementById('mobileGridView2Btn');
        const closeBtn = document.getElementById('gridview2-popup-close');
        const popup = document.getElementById('gridview2-popup');

        if (!openBtn || !closeBtn || !popup) return;

        openBtn.addEventListener('click', () => this.openGridView2Popup());
        closeBtn.addEventListener('click', () => this.closeGridView2Popup());

        // Close on overlay click
        popup.addEventListener('click', (e) => {
            if (e.target === popup) this.closeGridView2Popup();
        });

        // Close on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && popup.getAttribute('aria-hidden') === 'false') {
                this.closeGridView2Popup();
            }
        });

        // Mark as initialized to prevent duplicate event listeners
        this.gridView2PopupInitialized = true;
    }

    initGridView2Controls() {
        // Prevent duplicate initialization
        if (this.gridView2ControlsInitialized) return;

        const playBtn = document.getElementById('gridview2PlayBtn');
        const stopBtn = document.getElementById('gridview2StopBtn');

        // Use togglePlayback for consistent behavior
        if (playBtn) {
            playBtn.addEventListener('click', () => this.togglePlayback());
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stop());
        }

        // Note: Tempo/Pitch sliders have been replaced with neumorphic trigger buttons
        // The triggers are handled in setupNeumorphicDialControls()
        this.gridView2ControlsInitialized = true;
    }

    openGridView2Popup() {
        const popup = document.getElementById('gridview2-popup');
        const content = document.getElementById('gridview2-content');

        if (!popup || !content) {
            console.warn('[GridView2] Missing popup elements');
            return;
        }

        if (!this.chords || this.chords.length === 0) {
            alert('No chords available. Generate chords first.');
            return;
        }

        // Render the grid
        this.renderGridView2(content);

        // Open popup
        popup.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        this.gridView2Open = true;

        // Sync controls state
        this.syncPopupControlsState();

        // IMMEDIATE positioning on current beat - NO ANIMATION
        const currentBeatIdx = this.getBeatIndexForTime(this.currentTime - (this.beatOffset || 0));
        if (currentBeatIdx >= 0) {
            // Use setTimeout to ensure DOM is rendered
            setTimeout(() => {
                this.highlightGridView2Beat(currentBeatIdx, true);
            }, 0);
        }

        console.log('[GridView2] Opened with', this.gridView2Beats.length, 'beats');
    }

    closeGridView2Popup() {
        const popup = document.getElementById('gridview2-popup');
        if (!popup) return;

        popup.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        this.gridView2Open = false;
        this.gridView2Beats = [];

        console.log('[GridView2] Closed');
    }

    renderGridView2(container) {
        container.innerHTML = '';
        this.gridView2Beats = [];

        if (!this.chords || this.chords.length === 0) {
            container.innerHTML = `
                <div class="gridview2-empty">
                    <i class="fas fa-music"></i>
                    <p>No chords available</p>
                </div>
            `;
            return;
        }

        // Calculate timing based on BPM
        const bpm = this.chordBPM || this.currentBPM || this.originalBPM || 120;
        const beatsPerBar = Math.max(2, Math.min(12, this.beatsPerBar || 4));
        const beatDuration = 60 / bpm; // Duration of one beat in seconds
        const measureDuration = beatDuration * beatsPerBar;

        // Calculate total number of measures needed
        const totalDuration = this.duration || 180; // fallback to 3 minutes
        const totalMeasures = Math.ceil(totalDuration / measureDuration);

        // Build a chord lookup: for each beat position, what chord is active?
        // Apply beatOffset to align chord timestamps with the beat grid
        const offset = this.beatOffset || 0;

        // Sort chords by timestamp and QUANTIZE to nearest STRONG beat (1 or 3)
        const sortedChords = [...this.chords]
            .map(chord => {
                // Apply beat offset to align with grid
                const originalTime = (chord.timestamp || 0) - offset;

                // Find the measure this chord belongs to
                const measureIndex = Math.floor(originalTime / measureDuration);
                const measureStart = measureIndex * measureDuration;
                const timeInMeasure = originalTime - measureStart;

                // Strong beats are at 0 (beat 1) and 2*beatDuration (beat 3)
                const beat1Time = measureStart;
                const beat3Time = measureStart + (2 * beatDuration);
                const beat2Time = measureStart + beatDuration;
                const beat4Time = measureStart + (3 * beatDuration);

                // Check distance to each strong beat first
                const distToBeat1 = Math.abs(originalTime - beat1Time);
                const distToBeat3 = Math.abs(originalTime - beat3Time);

                // Tolerance: snap to strong beat if within 0.7 of a beat duration
                const strongBeatTolerance = beatDuration * 0.7;

                let quantizedTime;
                if (distToBeat1 <= strongBeatTolerance) {
                    quantizedTime = beat1Time;
                } else if (distToBeat3 <= strongBeatTolerance) {
                    quantizedTime = beat3Time;
                } else {
                    // Fall back to nearest beat
                    quantizedTime = Math.round(originalTime / beatDuration) * beatDuration;
                }

                return {
                    ...chord,
                    timestamp: quantizedTime,
                    originalTimestamp: originalTime
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);

        // Create ALL measures from start to end
        let lastShownChord = ''; // Track what chord name was shown on previous beat
        let chordIndex = 0;

        for (let measureNum = 0; measureNum < totalMeasures; measureNum++) {
            const measureStartTime = measureNum * measureDuration;
            const measureDiv = document.createElement('div');
            measureDiv.className = 'gridview2-measure';

            // Add measure number badge
            const measureNumEl = document.createElement('span');
            measureNumEl.className = 'gridview2-measure-number';
            measureNumEl.textContent = `M${measureNum + 1}`;
            measureDiv.appendChild(measureNumEl);

            // Create exactly beatsPerBar beats for this measure
            for (let beatInMeasure = 0; beatInMeasure < beatsPerBar; beatInMeasure++) {
                const beatTime = measureStartTime + (beatInMeasure * beatDuration);

                // Find the chord that is active at this beat time
                // (the most recent chord that started before or at this time)
                while (chordIndex < sortedChords.length - 1 &&
                       (sortedChords[chordIndex + 1].timestamp || 0) <= beatTime + 0.01) {
                    chordIndex++;
                }

                // Get current chord at this beat time
                const activeChord = sortedChords[chordIndex];
                const chordName = activeChord?.chord || '';

                const beatDiv = document.createElement('div');
                beatDiv.className = 'gridview2-beat';
                beatDiv.dataset.beatTime = beatTime;
                beatDiv.dataset.measure = measureNum;
                beatDiv.dataset.beat = beatInMeasure;
                beatDiv.dataset.globalIndex = this.gridView2Beats.length;
                beatDiv.dataset.currentChord = chordName;

                // Show chord name if it's different from the previous beat
                if (chordName && chordName !== lastShownChord) {
                    const transposedChord = this.transposeChord(chordName, this.currentPitchShift);
                    beatDiv.textContent = transposedChord;
                    lastShownChord = chordName;
                } else {
                    // Continuation beat - show dash
                    beatDiv.classList.add('is-empty');
                    beatDiv.textContent = '—';
                }

                // Click to seek
                beatDiv.addEventListener('click', () => this.seek(beatTime));

                this.gridView2Beats.push(beatDiv);
                measureDiv.appendChild(beatDiv);
            }

            container.appendChild(measureDiv);
        }
    }

    highlightGridView2Beat(beatIndex, immediate = false) {
        if (!this.gridView2Open) return;
        if (!this.gridView2Beats || !this.gridView2Beats.length) return;

        const activeBeat = this.gridView2Beats[beatIndex];
        if (!activeBeat) return;

        // Update classes for all beats (past/active/future)
        this.gridView2Beats.forEach((beat, idx) => {
            beat.classList.remove('active', 'past', 'future');
            if (idx < beatIndex) {
                beat.classList.add('past');
            } else if (idx > beatIndex) {
                beat.classList.add('future');
            }
        });

        // Highlight active beat
        activeBeat.classList.add('active');

        // Scroll to show the MEASURE at the top of viewport
        const content = document.getElementById('gridview2-content');
        if (!content) return;

        // Get the measure element containing the active beat
        const measureEl = activeBeat.parentElement;
        if (!measureEl) return;

        const measureRect = measureEl.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();

        // Position measure at top of content area (with padding for transport bar)
        const paddingTop = 100; // Space from top of content
        const measureTop = measureRect.top - contentRect.top;
        const targetScrollTop = measureEl.offsetTop - paddingTop;

        // Scroll to position the measure at the top
        if (Math.abs(content.scrollTop - targetScrollTop) > 10) {
            content.scrollTop = targetScrollTop;
        }
    }

    syncGridView2() {
        if (!this.gridView2Open) return;
        if (!this.gridView2Beats || !this.gridView2Beats.length) return;

        const currentTime = this.currentTime - (this.beatOffset || 0);

        // Find the correct beat index based on beatTime
        let beatIdx = -1;
        for (let i = 0; i < this.gridView2Beats.length; i++) {
            const beatTime = parseFloat(this.gridView2Beats[i].dataset.beatTime);
            const nextBeatTime = i < this.gridView2Beats.length - 1
                ? parseFloat(this.gridView2Beats[i + 1].dataset.beatTime)
                : this.duration;

            if (currentTime >= beatTime && currentTime < nextBeatTime) {
                beatIdx = i;
                break;
            }
        }

        // Fallback to last beat if past all beats
        if (beatIdx === -1 && currentTime >= parseFloat(this.gridView2Beats[this.gridView2Beats.length - 1].dataset.beatTime)) {
            beatIdx = this.gridView2Beats.length - 1;
        }

        if (beatIdx >= 0 && beatIdx !== this.lastGridView2BeatIndex) {
            this.highlightGridView2Beat(beatIdx);
            this.lastGridView2BeatIndex = beatIdx;
        }

        // Throttle syncPopupControlsState to max once per 200ms (prevents mobile crash)
        const now = Date.now();
        if (!this.lastGridView2ControlSync || (now - this.lastGridView2ControlSync) > 200) {
            this.syncPopupControlsState();
            this.lastGridView2ControlSync = now;
        }
    }

    updateGridView2Chords() {
        if (!this.gridView2Open || !this.gridView2Beats || !this.gridView2Beats.length) return;

        let lastShownChord = '';
        this.gridView2Beats.forEach(beatDiv => {
            const originalChord = beatDiv.dataset.currentChord;
            if (originalChord && !beatDiv.classList.contains('is-empty')) {
                // Only update beats that show chords (not continuation dashes)
                if (originalChord !== lastShownChord) {
                    const transposed = this.transposeChord(originalChord, this.currentPitchShift);
                    beatDiv.textContent = transposed;
                    lastShownChord = originalChord;
                }
            }
        });
    }

    updateFullscreenLyricsChords() {
        document.querySelectorAll('.fs-lyrics-chord').forEach(el => {
            const original = el.dataset.originalChord;
            if (original) {
                el.textContent = this.transposeChord(original, this.currentPitchShift);
            }
        });
    }

    // ============================================
    // FULLSCREEN LYRICS POPUP
    // ============================================

    openFullscreenLyrics() {
        const popup = document.getElementById('fullscreen-lyrics-popup');
        const content = document.getElementById('fullscreen-lyrics-content');

        if (!popup || !content) {
            console.warn('[FullscreenLyrics] Missing popup elements');
            return;
        }

        if (!this.lyrics || this.lyrics.length === 0) {
            alert('No lyrics available. Generate lyrics first.');
            return;
        }

        // Render lyrics fresh (not clone) with own element structure
        this.renderFullscreenLyrics(content);

        // Open popup
        popup.classList.add('active');
        popup.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        this.fullscreenLyricsOpen = true;

        // Apply current state
        if (this.activeLyricIndex >= 0) {
            this.applyFullscreenLyricStates(this.activeLyricIndex);
            this.scrollToFullscreenLyric(this.activeLyricIndex, true);
        }

        // Sync controls state
        this.syncPopupControlsState();
        console.log('[FullscreenLyrics] Opened with', this.lyrics.length, 'lines');
    }

    closeFullscreenLyrics() {
        const popup = document.getElementById('fullscreen-lyrics-popup');
        if (!popup) return;

        popup.classList.remove('active');
        popup.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        this.fullscreenLyricsOpen = false;
        this.fullscreenLyricElements = [];

        // Reset size slider
        const sizeSlider = document.getElementById('fullscreenLyricsSizeSlider');
        if (sizeSlider) sizeSlider.value = '1';

        // Reset content transform
        const content = document.getElementById('fullscreen-lyrics-content');
        if (content) {
            content.style.removeProperty('transform');
            content.style.removeProperty('transform-origin');
        }

        console.log('[FullscreenLyrics] Closed');
    }

    renderFullscreenLyrics(container) {
        container.innerHTML = '';
        this.fullscreenLyricElements = [];

        // Build chord lookup for display
        const chordLookup = this.buildChordLookupForLyrics();

        this.lyrics.forEach((segment, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'fs-lyrics-line';
            lineDiv.dataset.index = index;
            lineDiv.dataset.start = segment.start || 0;
            lineDiv.dataset.end = segment.end || 0;

            // Text container
            const textContainer = document.createElement('div');
            textContainer.className = 'fs-lyrics-text';

            if (segment.words && segment.words.length > 0) {
                segment.words.forEach((wordData, wordIndex) => {
                    const wordWrapper = document.createElement('span');
                    wordWrapper.className = 'fs-lyrics-word-wrapper';

                    // Check for chord at this word
                    const chordInfo = this.findChordAtTime(wordData.start, chordLookup);
                    if (chordInfo && chordInfo.isChange) {
                        const chordLabel = document.createElement('span');
                        chordLabel.className = 'fs-lyrics-chord';
                        chordLabel.dataset.originalChord = chordInfo.chord;
                        chordLabel.textContent = this.transposeChord(chordInfo.chord, this.currentPitchShift);
                        wordWrapper.appendChild(chordLabel);
                    }

                    const wordSpan = document.createElement('span');
                    wordSpan.className = 'fs-lyrics-word';
                    wordSpan.dataset.wordIndex = wordIndex;
                    wordSpan.dataset.start = wordData.start || 0;
                    wordSpan.dataset.end = wordData.end || 0;
                    wordSpan.textContent = wordData.word;

                    wordWrapper.appendChild(wordSpan);
                    textContainer.appendChild(wordWrapper);
                });
            } else {
                // Fallback for segments without word timing
                const textSpan = document.createElement('span');
                textSpan.className = 'fs-lyrics-word';
                textSpan.textContent = segment.text || '';
                textContainer.appendChild(textSpan);
            }

            lineDiv.appendChild(textContainer);

            // Click to seek
            lineDiv.addEventListener('click', () => {
                this.seek(segment.start || 0);
            });

            container.appendChild(lineDiv);
        });

        this.fullscreenLyricElements = Array.from(container.querySelectorAll('.fs-lyrics-line'));
    }

    applyFullscreenLyricStates(activeIndex) {
        if (!this.fullscreenLyricElements || this.fullscreenLyricElements.length === 0) return;

        const pastPreview = 2;
        const futurePreview = 3;

        this.fullscreenLyricElements.forEach((line, i) => {
            line.classList.remove('active', 'past', 'recent-past', 'hidden-past', 'future', 'up-next', 'hidden-future');

            if (i === activeIndex) {
                line.classList.add('active');
            } else if (i < activeIndex) {
                if (i >= activeIndex - pastPreview) {
                    line.classList.add('recent-past');
                } else {
                    line.classList.add('hidden-past');
                }
                line.classList.add('past');
            } else {
                if (i <= activeIndex + futurePreview) {
                    line.classList.add('up-next');
                } else {
                    line.classList.add('hidden-future');
                }
                line.classList.add('future');
            }
        });
    }

    scrollToFullscreenLyric(index, immediate = false) {
        if (!this.fullscreenLyricElements || index < 0 || index >= this.fullscreenLyricElements.length) return;

        const content = document.getElementById('fullscreen-lyrics-content');
        const line = this.fullscreenLyricElements[index];
        if (!content || !line) return;

        const containerHeight = content.clientHeight;

        // Validate container is laid out
        if (containerHeight < 50) {
            setTimeout(() => this.scrollToFullscreenLyric(index, immediate), 100);
            return;
        }

        // Position line at 25% from top (like desktop but with more margin for mobile controls)
        const topMargin = containerHeight * 0.25;

        // Use getBoundingClientRect for accurate positioning (like desktop)
        const lineRect = line.getBoundingClientRect();
        const containerRect = content.getBoundingClientRect();
        const lineTopInContainer = lineRect.top - containerRect.top + content.scrollTop;

        let targetTop = lineTopInContainer - topMargin;
        const maxScroll = Math.max(0, content.scrollHeight - containerHeight);
        targetTop = Math.max(0, Math.min(targetTop, maxScroll));

        if (immediate) {
            content.scrollTop = targetTop;
            this.lastFullscreenScrollTime = Date.now();
            this.lastFullscreenScrollIndex = index;
            return;
        }

        // Skip if already at position
        if (Math.abs(content.scrollTop - targetTop) < 5) return;

        // Throttle smooth scrolls to max once per 300ms to avoid overwhelming mobile browsers
        const now = Date.now();
        if (this.lastFullscreenScrollTime && (now - this.lastFullscreenScrollTime) < 300 && this.lastFullscreenScrollIndex === index) {
            return;
        }

        this.lastFullscreenScrollTime = now;
        this.lastFullscreenScrollIndex = index;
        content.scrollTop = targetTop; // Use immediate scroll instead of smooth on mobile
    }

    highlightFullscreenWords(segmentIndex, currentTime) {
        if (!this.fullscreenLyricElements || segmentIndex < 0 || segmentIndex >= this.fullscreenLyricElements.length) return;

        const line = this.fullscreenLyricElements[segmentIndex];
        if (!line) return;

        const wordSpans = line.querySelectorAll('.fs-lyrics-word');

        wordSpans.forEach((wordSpan) => {
            const wordStart = parseFloat(wordSpan.dataset.start);
            const wordEnd = parseFloat(wordSpan.dataset.end);

            // Clear previous states
            wordSpan.classList.remove('word-future', 'word-current', 'word-past');
            wordSpan.style.background = '';
            wordSpan.style.webkitBackgroundClip = '';
            wordSpan.style.backgroundClip = '';
            wordSpan.style.webkitTextFillColor = '';

            if (isNaN(wordStart) || isNaN(wordEnd)) return;

            if (currentTime < wordStart) {
                // Future word
                wordSpan.classList.add('word-future');
            } else if (currentTime >= wordStart && currentTime <= wordEnd) {
                // Current word - gradient fill effect (like desktop)
                wordSpan.classList.add('word-current');
                const duration = wordEnd - wordStart;
                if (duration > 0) {
                    const progress = (currentTime - wordStart) / duration;
                    const fillPercent = Math.min(100, Math.max(0, progress * 100));
                    wordSpan.style.background = `linear-gradient(to right, var(--mobile-primary) ${fillPercent}%, rgba(255, 255, 255, 0.6) ${fillPercent}%)`;
                    wordSpan.style.webkitBackgroundClip = 'text';
                    wordSpan.style.backgroundClip = 'text';
                    wordSpan.style.webkitTextFillColor = 'transparent';
                }
            } else {
                // Past word - fully highlighted
                wordSpan.classList.add('word-past');
                wordSpan.style.background = 'var(--mobile-primary)';
                wordSpan.style.webkitBackgroundClip = 'text';
                wordSpan.style.backgroundClip = 'text';
                wordSpan.style.webkitTextFillColor = 'transparent';
            }
        });
    }

    updateFullscreenLyrics() {
        try {
            if (!this.fullscreenLyricsOpen || !this.fullscreenLyricElements || this.fullscreenLyricElements.length === 0) return;

            // Update line states
            this.applyFullscreenLyricStates(this.activeLyricIndex);

            // Highlight words in current line
            if (this.activeLyricIndex >= 0) {
                this.highlightFullscreenWords(this.activeLyricIndex, this.currentTime);
            }

            // Scroll to active line
            this.scrollToFullscreenLyric(this.activeLyricIndex);
        } catch (err) {
            console.error('[updateFullscreenLyrics] Error:', err);
        }
    }

    applyFullscreenLyricsScale(scale) {
        const content = document.getElementById('fullscreen-lyrics-content');
        if (!content) return;

        const clamped = Math.min(1.6, Math.max(0.8, scale || 1));

        content.style.setProperty('transform', `scale(${clamped})`, 'important');
        content.style.setProperty('transform-origin', 'top left', 'important');

        // Update size display
        const sizeValue = document.getElementById('fullscreenLyricsSizeValue');
        if (sizeValue) {
            sizeValue.textContent = clamped.toFixed(1) + 'x';
        }

        // Refocus on active line
        if (this.activeLyricIndex >= 0) {
            setTimeout(() => this.scrollToFullscreenLyric(this.activeLyricIndex, true), 100);
        }
    }

    initFullscreenLyricsControls() {
        const playBtn = document.getElementById('fullscreenLyricsPlayBtn');
        const stopBtn = document.getElementById('fullscreenLyricsStopBtn');

        if (playBtn) {
            playBtn.addEventListener('click', () => this.togglePlayback());
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stop());
        }

        // Note: Tempo/Pitch sliders have been replaced with neumorphic trigger buttons
        // The triggers are handled in setupNeumorphicDialControls()
    }

    // ============================================
    // Jam Session Methods
    // ============================================

    initJamClient() {
        if (!this.socket || typeof JamClient === 'undefined') {
            console.warn('[Jam] Socket or JamClient not available, retrying...');
            setTimeout(() => this.initJamClient(), 500);
            return;
        }

        this.jamClient = new JamClient(this.socket);

        this.jamClient.onCreated((data) => {
            if (data.error) {
                console.error('[Jam] Session creation failed:', data.error);
                this.showToast(data.error, 'error');
                return;
            }
            console.log('[Jam] Session created:', data.code);
            this.renderJamPage();
            // Broadcast current track and tempo if one is loaded
            if (this.currentExtractionId && this.currentExtractionData) {
                console.log('[Jam] Broadcasting current track after session creation');
                this._jamBroadcastTrackLoad();
                this._jamBroadcastTempo(this.currentBPM, this.originalBPM, this.currentBPM / this.originalBPM);
            }
        });

        this.jamClient.onParticipantUpdate((data) => {
            this.updateJamParticipantList(data.participants);
        });

        this.jamClient.onSessionEnded((data) => {
            this.showToast('Jam session ended', 'info');
            this.renderJamPage();
        });

        console.log('[Jam] Mobile JamClient initialized');

        // Auto-reclaim active session on page reload (e.g. pull-to-refresh)
        this._autoReclaimJamSession();
    }

    async _autoReclaimJamSession() {
        try {
            const resp = await fetch('/api/jam/my-session');
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.active) {
                console.log('[Jam] Active session found, auto-reclaiming:', data.code);
                this.jamClient.createSession();
            }
        } catch (e) {
            // Ignore — non-critical
        }
    }

    async initJamGuestMode() {
        console.log('[Jam Guest] Initializing guest mode...');
        console.log('[Jam Guest] Code:', window.JAM_CODE);
        console.log('[Jam Guest] Name:', window.JAM_GUEST_NAME);
        console.log('[Jam Guest] Extraction data:', window.JAM_EXTRACTION_DATA);

        // Show ON STAGE banner
        const banner = document.getElementById('onStageBanner');
        if (banner) {
            banner.style.display = 'flex';
            const text = banner.querySelector('.on-stage-text');
            if (text) text.textContent = `ON STAGE - ${window.JAM_CODE}`;
        }

        // Start socket/jamClient connection in parallel (no user gesture needed)
        const clientReady = this._waitForJamClient();

        // iOS Safari requires AudioContext creation INSIDE a user gesture.
        // Show "Tap to Enter" overlay and wait for the user to tap.
        const overlay = document.getElementById('jamGuestEntryOverlay');
        if (overlay) {
            await new Promise((resolve) => {
                const btn = document.getElementById('jamGuestEntryBtn');
                if (!btn) { resolve(); return; }
                const handler = async (e) => {
                    e.preventDefault();
                    btn.removeEventListener('click', handler);
                    btn.removeEventListener('touchend', handler);
                    btn.textContent = 'Connecting...';
                    btn.disabled = true;

                    // Create and resume AudioContext INSIDE user gesture
                    await this.initAudioContext();
                    if (this.audioContext && this.audioContext.state === 'suspended') {
                        try { await this.audioContext.resume(); } catch (err) {
                            console.warn('[Jam Guest] AudioContext resume failed:', err);
                        }
                    }
                    console.log('[Jam Guest] AudioContext state after gesture:', this.audioContext?.state);

                    overlay.style.display = 'none';
                    resolve();
                };
                btn.addEventListener('touchend', handler, { passive: false });
                btn.addEventListener('click', handler);
            });
        } else {
            // Fallback: no overlay (desktop or template issue)
            await this.initAudioContext();
            if (this.audioContext && this.audioContext.state === 'suspended') {
                try { await this.audioContext.resume(); } catch (err) {
                    console.warn('[Jam Guest] AudioContext resume failed:', err);
                }
            }
        }

        // Wait for jam client to be ready (may already be done)
        await clientReady;

        if (!this.jamClient) {
            this.showToast('Connection failed - please refresh', 'error');
            return;
        }

        // Hide transport controls for jam guests (host controls playback)
        this._hideGuestTransportControls();

        // Setup guest listeners using jamClient callbacks
        this._setupJamGuestListeners();

        // Join the jam session using jamClient
        console.log('[Jam Guest] Joining session:', window.JAM_CODE);
        this.jamClient.joinSession(window.JAM_CODE);

        // If extraction data is provided, load it immediately
        if (window.JAM_EXTRACTION_DATA && Object.keys(window.JAM_EXTRACTION_DATA).length > 0) {
            console.log('[Jam Guest] Loading provided extraction data');
            await this._loadJamGuestTrack(window.JAM_EXTRACTION_DATA);
        } else {
            console.log('[Jam Guest] No extraction data, waiting for host to load track');
            this.showLoading('Waiting for host to load a track...');
        }
    }

    _hideGuestTransportControls() {
        // Hide play/stop buttons across all tabs and popups
        document.querySelectorAll(
            '.mobile-play-sync, .mobile-stop-sync, ' +
            '#fullscreenLyricsPlayBtn, #fullscreenLyricsStopBtn, ' +
            '#gridview2PlayBtn, #gridview2StopBtn'
        ).forEach(el => el.style.display = 'none');

        // Make tempo/pitch triggers read-only
        document.querySelectorAll('.tempo-popup-trigger, .pitch-popup-trigger').forEach(el => {
            el.style.pointerEvents = 'none';
            el.style.opacity = '0.5';
        });

        // Hide regenerate buttons only (keep Grid View and Fullscreen Lyrics buttons)
        document.querySelectorAll(
            '#mobileRegenerateChords, #mobileRegenerateLyrics'
        ).forEach(el => el.style.display = 'none');

        console.log('[Jam Guest] Transport controls hidden');
    }

    async _waitForJamClient() {
        let attempts = 0;
        const maxAttempts = 40; // 10 seconds total
        while (!this.jamClient && attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 250));
            attempts++;
        }
        if (!this.jamClient) {
            console.error(`[Jam Guest] JamClient not available after ${maxAttempts * 250}ms`);
        } else {
            console.log(`[Jam Guest] JamClient ready after ${attempts * 250}ms`);
        }
    }

    _setupJamGuestListeners() {
        console.log('[Jam Guest] Setting up guest listeners via jamClient');

        // Track loaded by host
        this.jamClient.onTrackLoaded(async (data) => {
            console.log('[Jam Guest] Track loaded by host:', data);
            if (data.extraction_data) {
                await this._loadJamGuestTrack(data.extraction_data);
            }
        });

        // Playback commands from host
        this.jamClient.onPlayback((data) => {
            console.log('[Jam Guest] Playback command:', data);
            this._handleJamPlaybackCommand(data);
        });

        // Tempo change from host
        this.jamClient.onTempo((data) => {
            console.log('[Jam Guest] Tempo change:', data);
            if (data.bpm) {
                this.currentBPM = data.bpm;
                this.syncTempoValueBPM(data.bpm);
                this._applyTempoChange(data.bpm);
            }
        });

        // Pitch change from host
        this.jamClient.onPitch((data) => {
            console.log('[Jam Guest] Pitch change:', data);
            if (data.pitch_shift !== undefined) {
                this.currentPitchShift = data.pitch_shift;
                this.syncKeyDisplay();
                this._applyPitchChange(data.pitch_shift);
            }
        });

        // Sync from host (periodic sync)
        this.jamClient.onSync((data) => {
            this._handleJamSync(data);
        });

        // Join confirmation
        this.jamClient.onJoined((data) => {
            console.log('[Jam Guest] Joined session:', data);
            if (data.error) {
                console.error('[Jam Guest] Join error:', data.error);
                this.showToast(`Failed to join: ${data.error}`, 'error');
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
                return;
            }
            // If extraction data comes with join, load it (may already be loading from JAM_EXTRACTION_DATA)
            if (data.extraction_data && Object.keys(data.extraction_data).length > 0 && !this.currentExtractionData) {
                this._loadJamGuestTrack(data.extraction_data);
            }
            // Apply pending state if provided
            if (data.state) {
                this._pendingJamState = data.state;
            }
        });

        // Session ended
        this.jamClient.onSessionEnded(() => {
            console.log('[Jam Guest] Session ended by host');
            this.showToast('Jam session ended by host', 'info');
            // Redirect to home after a delay
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        });

        // Host disconnect/reconnect handling
        this._jamHostDisconnectTimer = null;
        this.jamClient.onHostStatus((data) => {
            if (data.status === 'disconnected') {
                // Pause playback immediately
                if (this.isPlaying) {
                    this.pause();
                }

                // Show disconnect overlay with countdown
                this._showJamHostDisconnectOverlay(data.timeout || 10);

            } else if (data.status === 'reconnected') {
                // Hide overlay, clear timer
                this._hideJamHostDisconnectOverlay();

                // Resync state from host (host just reloaded — stopped)
                const state = data.state;
                if (state) {
                    if (state.bpm) {
                        this.currentBPM = state.bpm;
                        this.syncTempoValueBPM(state.bpm);
                    }
                    if (state.pitch_shift !== undefined) {
                        this.currentPitchShift = state.pitch_shift;
                        this.syncKeyDisplay();
                    }
                    // Stay stopped — host will send play command when ready
                    if (this.isPlaying) {
                        this.pause();
                    }
                }
                console.log('[Jam Guest] Host reconnected, waiting for host to resume playback');
            }
        });
    }

    async _loadJamGuestTrack(extractionData) {
        console.log('[Jam Guest] Loading track:', extractionData.title);
        this.showLoading(`Loading: ${extractionData.title || 'Track'}...`);

        // Stop current playback and clean up old audio nodes before loading new track
        await this.lightMixerCleanup();

        // Store extraction data
        this.currentExtractionData = extractionData;
        this.currentExtractionId = extractionData.extraction_id || extractionData.id || `jam_${Date.now()}`;
        this.currentExtractionVideoId = extractionData.video_id || null;

        // Set up stem URL prefix for jam stems
        const jamCode = window.JAM_CODE.replace('JAM-', '');
        window.JAM_STEM_URL_PREFIX = `/api/jam/stems/${jamCode}`;
        window.JAM_STEM_CACHE_BUSTER = `?eid=${encodeURIComponent(this.currentExtractionId)}`;

        // Parse stem paths (could be string or object)
        let stemPaths = extractionData.output_paths || extractionData.stems_paths;
        if (typeof stemPaths === 'string') {
            try {
                stemPaths = JSON.parse(stemPaths);
            } catch (e) {
                console.error('[Jam Guest] Failed to parse stem paths:', e);
                stemPaths = {};
            }
        }

        if (!stemPaths || Object.keys(stemPaths).length === 0) {
            // Fallback: fetch extraction data from server
            console.warn('[Jam Guest] No stem paths in initial data, fetching from server...');
            try {
                const jamCode = window.JAM_CODE.replace('JAM-', '');
                const resp = await fetch(`/api/jam/extraction/${jamCode}`);
                if (resp.ok) {
                    const serverData = await resp.json();
                    stemPaths = serverData.output_paths || serverData.stems_paths;
                    if (typeof stemPaths === 'string') {
                        stemPaths = JSON.parse(stemPaths);
                    }
                    // Merge any missing fields from server response
                    if (!extractionData.title && serverData.title) extractionData.title = serverData.title;
                    if (!extractionData.detected_bpm && serverData.detected_bpm) extractionData.detected_bpm = serverData.detected_bpm;
                    if (!extractionData.detected_key && serverData.detected_key) extractionData.detected_key = serverData.detected_key;
                    if (!extractionData.chords && serverData.chords) extractionData.chords = serverData.chords;
                    if (!extractionData.chords_data && serverData.chords_data) extractionData.chords_data = serverData.chords_data;
                    if (!extractionData.lyrics && serverData.lyrics) extractionData.lyrics = serverData.lyrics;
                    if (!extractionData.lyrics_data && serverData.lyrics_data) extractionData.lyrics_data = serverData.lyrics_data;
                    console.log('[Jam Guest] Got stem paths from server:', stemPaths);
                }
            } catch (fetchErr) {
                console.error('[Jam Guest] Server fallback failed:', fetchErr);
            }
        }

        if (!stemPaths || Object.keys(stemPaths).length === 0) {
            console.error('[Jam Guest] No stem paths available (initial data + server fallback)');
            this.hideLoading();
            this.showToast('No stems available', 'error');
            return;
        }

        console.log('[Jam Guest] Stem paths:', stemPaths);

        // Navigate to mixer
        this.navigateTo('mixer');

        // Set title
        const titleEl = document.getElementById('mobileMixerTitle');
        if (titleEl) titleEl.textContent = extractionData.title || 'Jam Session';

        // Show the mixer nav button
        const mixerNav = document.getElementById('mobileNavMixer');
        if (mixerNav) mixerNav.style.display = 'flex';

        // Set original BPM and key
        this.originalBPM = extractionData.detected_bpm || extractionData.bpm || 120;
        this.currentBPM = this.originalBPM;
        this.originalKey = extractionData.detected_key || extractionData.key || 'C major';
        this.beatOffset = extractionData.beat_offset || 0;

        // Update displays
        this.syncTempoValueBPM(this.currentBPM);
        this.syncKeyDisplay();

        // Load stems
        try {
            await this.loadStemsForJamGuest(stemPaths);
            console.log('[Jam Guest] Stems loaded successfully');

            // Load chords if available
            if (extractionData.chords || extractionData.chords_data) {
                const chordPayload = extractionData.chords_data || extractionData.chords;
                let parsedChords = null;
                try {
                    parsedChords = typeof chordPayload === 'string' ? JSON.parse(chordPayload) : chordPayload;
                    if (parsedChords && !Array.isArray(parsedChords) && Array.isArray(parsedChords.chords)) {
                        parsedChords = parsedChords.chords;
                    }
                } catch (e) {
                    console.warn('[Jam Guest] Failed to parse chords:', e);
                }
                if (Array.isArray(parsedChords)) {
                    this.chords = parsedChords;
                    this.beatsPerBar = extractionData.beats_per_bar || 4;
                    this.chordBPM = this.currentBPM;
                    this.displayChords();
                    this.initGridView2Popup();
                }
            }

            // Load lyrics if available
            if (extractionData.lyrics || extractionData.lyrics_data) {
                const lyricsPayload = extractionData.lyrics_data || extractionData.lyrics;
                let parsedLyrics = null;
                try {
                    parsedLyrics = typeof lyricsPayload === 'string' ? JSON.parse(lyricsPayload) : lyricsPayload;
                    // Handle wrapped format: {lyrics: [...]} or {words: [...]}
                    if (parsedLyrics && !Array.isArray(parsedLyrics)) {
                        if (Array.isArray(parsedLyrics.lyrics)) parsedLyrics = parsedLyrics.lyrics;
                        else if (Array.isArray(parsedLyrics.words)) parsedLyrics = parsedLyrics.words;
                        else if (Array.isArray(parsedLyrics.segments)) parsedLyrics = parsedLyrics.segments;
                    }
                } catch (e) {
                    console.warn('[Jam Guest] Failed to parse lyrics:', e);
                }
                if (Array.isArray(parsedLyrics) && parsedLyrics.length > 0) {
                    this.lyrics = parsedLyrics;
                    this.displayLyrics();
                    console.log('[Jam Guest] Loaded', parsedLyrics.length, 'lyrics segments');
                } else {
                    console.warn('[Jam Guest] Lyrics data found but not an array:', typeof parsedLyrics);
                }
            } else {
                console.log('[Jam Guest] No lyrics in extraction data');
            }

            // Initialize metronome for guest
            this.initMetronome(extractionData);

            // Apply pending state if any (convert state to playback command)
            if (this._pendingJamState) {
                console.log('[Jam Guest] Applying pending state:', this._pendingJamState);
                setTimeout(() => {
                    this._applyJamState(this._pendingJamState);
                    this._pendingJamState = null;
                }, 500);
            }
        } catch (error) {
            console.error('[Jam Guest] Failed to load stems:', error);
            this.showToast('Failed to load stems', 'error');
        }

        this.hideLoading();
    }

    async loadStemsForJamGuest(stemPaths) {
        console.log('[Jam Guest] Loading stems...');

        // AudioContext should already be initialized via user gesture in initJamGuestMode
        if (!this.audioContext || this.audioContext.state === 'closed') {
            console.warn('[Jam Guest] AudioContext not ready — reinitializing');
            await this.initAudioContext();
        }

        // Clear existing stems and track container
        this.stems = {};
        const container = document.getElementById('mobileTracksContainer');
        if (container) container.innerHTML = '';

        const stemEntries = Object.entries(stemPaths);
        const jamCode = window.JAM_CODE.replace('JAM-', '');

        // Cache-busting: use extraction ID so SW doesn't serve stale stems after track change
        const eid = this.currentExtractionId || Date.now();

        // Load ALL stems in parallel (Promise.allSettled for resilience)
        const results = await Promise.allSettled(stemEntries.map(async ([stemName]) => {
            const url = `/api/jam/stems/${jamCode}/${stemName}?eid=${encodeURIComponent(eid)}`;
            const t0 = performance.now();

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const t1 = performance.now();
            console.log(`[Jam Guest] ${stemName} fetched ${(arrayBuffer.byteLength / 1048576).toFixed(1)}MB in ${(t1 - t0).toFixed(0)}ms`);

            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const t2 = performance.now();
            console.log(`[Jam Guest] ${stemName} decoded in ${(t2 - t1).toFixed(0)}ms`);

            await this.createAudioNodesForStem(stemName, audioBuffer);
            this.createTrackControl(stemName);
        }));

        const loaded = results.filter(r => r.status === 'fulfilled').length;
        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                console.error(`[Jam Guest] Error loading stem ${stemEntries[i][0]}:`, r.reason);
            }
        });

        if (loaded === 0) {
            throw new Error('No stems could be loaded');
        }

        // Get duration from first loaded stem
        const firstStem = Object.values(this.stems)[0];
        if (firstStem && firstStem.buffer) {
            this.duration = firstStem.buffer.duration;
            this.updateTimeDisplay();
        }

        // Draw waveform
        this.renderWaveform();

        console.log(`[Jam Guest] Successfully loaded ${loaded}/${stemEntries.length} stems`);
    }

    _handleJamPlaybackCommand(data) {
        if (!this.stems || Object.keys(this.stems).length === 0) {
            console.warn('[Jam Guest] Cannot handle playback - no stems loaded');
            this._pendingJamState = data;
            return;
        }

        // Ensure AudioContext is running (defensive for iOS)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            console.warn('[Jam Guest] AudioContext suspended during playback — attempting resume');
            this.audioContext.resume().catch(e => console.error('[Jam Guest] Resume failed:', e));
        }

        const command = data.command;
        const position = data.position || 0;

        console.log(`[Jam Guest] Handling playback command: ${command} at ${position}s`);

        switch (command) {
            case 'play':
                this.currentTime = position;
                this.playbackPosition = position;
                // Host sent precount — pre-schedule stems and run precount for seamless start
                if (data.precount_beats > 0 && this.metronome && this.metronome.bpm > 0) {
                    const precountDuration = this.metronome.getPrecountDuration(data.precount_beats);
                    const stemStartTime = this.audioContext.currentTime + precountDuration;
                    const guestPlaybackStart = position;

                    console.log(`[Jam Guest] Precount: ${data.precount_beats} beats, stems at ${stemStartTime.toFixed(3)}`);

                    // Pre-schedule stems on Web Audio clock
                    this.setPlaybackPosition(Math.max(0, Math.min(guestPlaybackStart, this.duration || Infinity)));
                    Object.keys(this.stems).forEach(name => this.startStemSource(name, stemStartTime));
                    this.lastAudioTime = stemStartTime;

                    this._precountActive = true;
                    this.metronome.startPrecount(data.precount_beats, () => {
                        // Stems already playing — just update UI
                        this._precountActive = false;
                        this.isPlaying = true;
                        this.updatePlayPauseButtons();
                        this.syncPopupControlsState();
                        this.startPlaybackAnimation();
                        if (this.metronome) this.metronome.start();
                    });
                } else {
                    this._startPlaybackInternal();
                }
                break;
            case 'pause':
                this.pause();
                break;
            case 'stop':
                this.stop();
                break;
            case 'seek':
                this.seekToPosition(position);
                break;
        }
    }

    _applyJamState(state) {
        if (!this.stems || Object.keys(this.stems).length === 0) {
            console.warn('[Jam Guest] Cannot apply state — no stems loaded');
            this._pendingJamState = state;
            return;
        }

        console.log('[Jam Guest] Applying jam state:', state);

        // Apply tempo if different
        if (state.bpm && state.bpm !== this.currentBPM) {
            this.currentBPM = state.bpm;
            this.syncTempoValueBPM(state.bpm);
            this._applyTempoChange(state.bpm);
        }

        // Apply pitch if different
        if (state.pitch_shift !== undefined && state.pitch_shift !== this.currentPitchShift) {
            this.currentPitchShift = state.pitch_shift;
            this._applyPitchChange(state.pitch_shift);
        }

        // Seek to position and start playback if host is playing
        const position = state.position || 0;
        if (state.is_playing) {
            this.currentTime = position;
            this.playbackPosition = position;
            this.play();
        } else if (position > 0) {
            this.seekToPosition(position);
        }
    }

    _handleJamSync(data) {
        if (!this.stems || Object.keys(this.stems).length === 0) return;

        // Sync tempo if host BPM differs
        if (data.bpm && data.bpm !== this.currentBPM) {
            this.currentBPM = data.bpm;
            this.syncTempoValueBPM(data.bpm);
            this._applyTempoChange(data.bpm);
        }

        const hostPosition = data.position || 0;
        const hostIsPlaying = data.is_playing;

        // If host is playing but guest is not, start playing at host's position
        if (hostIsPlaying && !this.isPlaying) {
            console.log(`[Jam Guest] Host is playing but guest is not — syncing to ${hostPosition}s`);
            this.currentTime = hostPosition;
            this.playbackPosition = hostPosition;
            this.play();
            return;
        }

        // If host stopped but guest is still playing, stop
        if (!hostIsPlaying && this.isPlaying) {
            console.log('[Jam Guest] Host stopped — stopping guest');
            this.pause();
            return;
        }

        // Drift correction when both are playing
        if (hostIsPlaying && this.isPlaying) {
            const drift = Math.abs(this.currentTime - hostPosition);
            if (drift > 0.5) {
                console.log(`[Jam Guest] Sync correction: drift=${drift.toFixed(2)}s, seeking to ${hostPosition}`);
                this.seekToPosition(hostPosition);
            }
        }
    }

    _applyTempoChange(bpm) {
        // Use the same setTempo path as the host for full audio pipeline update
        const ratio = bpm / this.originalBPM;
        this.setTempo(ratio);
    }

    _applyPitchChange(semitones) {
        // Use the same setPitch path as the host for full audio pipeline update
        this.setPitch(semitones);
    }

    _jamBroadcastPlayback(command, position, extra = {}) {
        if (this.jamClient && this.jamClient.isActive() && this.jamClient.getRole() === 'host') {
            this.jamClient.sendPlayback(command, position, extra);
        }
    }

    _jamBroadcastTrackLoad() {
        if (!this.jamClient || !this.jamClient.isActive() || this.jamClient.getRole() !== 'host') {
            console.log('[Jam] Not broadcasting track — conditions not met:', {
                hasClient: !!this.jamClient,
                isActive: this.jamClient?.isActive(),
                role: this.jamClient?.getRole()
            });
            return;
        }
        if (!this.currentExtractionId || !this.currentExtractionData) {
            console.log('[Jam] Not broadcasting track — no data:', {
                id: this.currentExtractionId,
                hasData: !!this.currentExtractionData
            });
            return;
        }
        console.log('[Jam] Broadcasting track:', {
            id: this.currentExtractionId,
            title: this.currentExtractionData?.title,
            hasStemsPaths: !!this.currentExtractionData?.stems_paths
        });
        this.jamClient.loadTrack(this.currentExtractionId, this.currentExtractionData);
    }

    _jamBroadcastTempo(bpm, originalBpm, syncRatio) {
        if (this.jamClient && this.jamClient.isActive() && this.jamClient.getRole() === 'host') {
            this.jamClient.sendTempo(bpm, originalBpm, syncRatio);
        }
    }

    _jamBroadcastPitch(pitchShift, currentKey) {
        if (this.jamClient && this.jamClient.isActive() && this.jamClient.getRole() === 'host') {
            this.jamClient.sendPitch(pitchShift, currentKey);
        }
    }

    _jamStartSyncHeartbeat() {
        this._jamStopSyncHeartbeat();
        if (!this.jamClient || !this.jamClient.isActive() || this.jamClient.getRole() !== 'host') return;
        this._jamSyncInterval = setInterval(() => {
            if (!this.isPlaying || !this.jamClient || !this.jamClient.isActive()) {
                this._jamStopSyncHeartbeat();
                return;
            }
            this.jamClient.socket.emit('jam_sync', {
                code: this.jamClient.getCode(),
                position: this.currentTime || 0,
                bpm: this.currentBPM || 120,
                is_playing: true,
                timestamp: Date.now()
            });
        }, 5000);
    }

    _jamStopSyncHeartbeat() {
        if (this._jamSyncInterval) {
            clearInterval(this._jamSyncInterval);
            this._jamSyncInterval = null;
        }
    }

    _showJamHostDisconnectOverlay(timeout) {
        // Create overlay if it doesn't exist
        let overlay = document.getElementById('jamHostDisconnectedOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'jamHostDisconnectedOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:20px;';
            overlay.innerHTML = `
                <i class="fas fa-wifi" style="font-size:40px;color:#ff6b6b;margin-bottom:16px;opacity:0.8;"></i>
                <h2 style="margin:0 0 8px;font-size:1.3rem;">Host Disconnected</h2>
                <p style="color:#aaa;margin:0 0 20px;font-size:0.9rem;">Waiting for the host to reconnect...</p>
                <div id="jamDisconnectCountdown" style="font-size:48px;font-weight:700;color:#ff6b6b;font-family:monospace;margin-bottom:20px;">${timeout}</div>
                <p id="jamDisconnectMessage" style="color:#888;font-size:0.8rem;margin:0 0 16px;">Session will close if host doesn't return</p>
                <button id="jamDisconnectLeaveBtn" style="background:rgba(220,53,69,0.15);color:#dc3545;border:1px solid rgba(220,53,69,0.3);padding:10px 24px;border-radius:8px;cursor:pointer;font-size:0.9rem;">
                    <i class="fas fa-sign-out-alt"></i> Leave Now
                </button>`;
            document.body.appendChild(overlay);
            document.getElementById('jamDisconnectLeaveBtn').addEventListener('click', () => {
                window.location.href = '/mobile';
            });
        }

        overlay.style.display = 'flex';
        const countdownEl = document.getElementById('jamDisconnectCountdown');
        const messageEl = document.getElementById('jamDisconnectMessage');
        let remaining = timeout;
        countdownEl.textContent = remaining;
        messageEl.textContent = 'Session will close if host doesn\'t return';

        if (this._jamHostDisconnectTimer) clearInterval(this._jamHostDisconnectTimer);
        this._jamHostDisconnectTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(this._jamHostDisconnectTimer);
                this._jamHostDisconnectTimer = null;
                countdownEl.textContent = '...';
                messageEl.textContent = 'Still waiting for host — you can leave anytime';
            } else {
                countdownEl.textContent = remaining;
            }
        }, 1000);
    }

    _hideJamHostDisconnectOverlay() {
        if (this._jamHostDisconnectTimer) {
            clearInterval(this._jamHostDisconnectTimer);
            this._jamHostDisconnectTimer = null;
        }
        const overlay = document.getElementById('jamHostDisconnectedOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    renderJamPage() {
        const container = document.getElementById('mobileJamContent');
        if (!container) return;

        if (this.jamClient && this.jamClient.isActive()) {
            this.showJamActiveView(container);
        } else {
            this.showJamCreateView(container);
        }
    }

    showJamCreateView(container) {
        window._jamStartSession = () => {
            if (!this.jamClient) {
                this.showToast('Jam not ready — try refreshing', 'error');
                return;
            }
            this.jamClient.createSession();
        };

        container.innerHTML = `
            <div class="mobile-jam-create-section">
                <div class="mobile-jam-icon"><i class="fas fa-users"></i></div>
                <h2>Jam Session</h2>
                <p class="mobile-jam-description">
                    Create a jam session and invite others to listen along in sync.
                    Share via QR code or link — no login required for guests.
                </p>
                <button type="button" class="mobile-jam-create-btn" id="mobileJamCreateBtn"
                        onclick="window._jamStartSession()">
                    <i class="fas fa-play-circle"></i> Start Jam Session
                </button>
            </div>
        `;
    }

    showJamActiveView(container) {
        const code = this.jamClient.getCode();
        const shareUrl = `${window.location.origin}/jam/${code.replace('JAM-', '')}`;

        container.innerHTML = `
            <div class="mobile-jam-active-section">
                <div class="mobile-jam-code-label">SESSION CODE</div>
                <div class="mobile-jam-code-display">${code}</div>

                <div class="mobile-jam-qr-container" id="mobileJamQR"></div>

                <div class="mobile-jam-share-row">
                    <input class="mobile-jam-url-input" type="text" value="${shareUrl}" readonly id="mobileJamUrl">
                    <button class="mobile-jam-copy-btn" id="mobileJamCopyBtn">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>

                <div class="mobile-jam-share-buttons">
                    <button class="mobile-jam-share-btn jam-share-whatsapp" id="mobileJamShareWhatsapp">
                        <i class="fab fa-whatsapp"></i> WhatsApp
                    </button>
                    <button class="mobile-jam-share-btn jam-share-email" id="mobileJamShareEmail">
                        <i class="fas fa-envelope"></i> Email
                    </button>
                    <button class="mobile-jam-share-btn jam-share-sms" id="mobileJamShareSms">
                        <i class="fas fa-sms"></i> SMS
                    </button>
                </div>

                <div class="mobile-jam-participants" id="mobileJamParticipants">
                    <h3>Participants</h3>
                    <div class="mobile-jam-participants-list" id="mobileJamParticipantsList"></div>
                </div>

                <button class="mobile-jam-end-btn" id="mobileJamEndBtn"
                        style="touch-action:manipulation;">
                    <i class="fas fa-times-circle"></i> End Session
                </button>
                <button class="mobile-jam-newcode-btn" id="mobileJamNewCodeBtn"
                        style="touch-action:manipulation;">
                    <i class="fas fa-sync-alt"></i> Get New Code
                </button>
            </div>
        `;

        // Generate QR code
        this.generateJamQRCode(shareUrl);

        // Use requestAnimationFrame + dual touchend/click for iOS reliability
        requestAnimationFrame(() => {
            // Copy button
            const copyBtn = document.getElementById('mobileJamCopyBtn');
            if (copyBtn) {
                let copyFired = false;
                const copyHandler = (e) => {
                    e.preventDefault();
                    if (copyFired) return;
                    copyFired = true;
                    setTimeout(() => { copyFired = false; }, 500);
                    const urlInput = document.getElementById('mobileJamUrl');
                    navigator.clipboard.writeText(urlInput.value).then(() => {
                        this.showToast('Link copied!', 'success');
                    }).catch(() => {
                        urlInput.select();
                        document.execCommand('copy');
                        this.showToast('Link copied!', 'success');
                    });
                };
                copyBtn.addEventListener('touchend', copyHandler, { passive: false });
                copyBtn.addEventListener('click', copyHandler);
            }

            // Share buttons
            const msg = `Join my jam session on StemTube! ${shareUrl}`;

            const whatsappBtn = document.getElementById('mobileJamShareWhatsapp');
            if (whatsappBtn) {
                let wFired = false;
                const wHandler = (e) => {
                    e.preventDefault();
                    if (wFired) return;
                    wFired = true;
                    setTimeout(() => { wFired = false; }, 500);
                    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                };
                whatsappBtn.addEventListener('touchend', wHandler, { passive: false });
                whatsappBtn.addEventListener('click', wHandler);
            }

            const emailBtn = document.getElementById('mobileJamShareEmail');
            if (emailBtn) {
                let eFired = false;
                const eHandler = (e) => {
                    e.preventDefault();
                    if (eFired) return;
                    eFired = true;
                    setTimeout(() => { eFired = false; }, 500);
                    window.location.href = `mailto:?subject=${encodeURIComponent('Join my Jam Session')}&body=${encodeURIComponent(msg)}`;
                };
                emailBtn.addEventListener('touchend', eHandler, { passive: false });
                emailBtn.addEventListener('click', eHandler);
            }

            const smsBtn = document.getElementById('mobileJamShareSms');
            if (smsBtn) {
                let sFired = false;
                const sHandler = (e) => {
                    e.preventDefault();
                    if (sFired) return;
                    sFired = true;
                    setTimeout(() => { sFired = false; }, 500);
                    window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
                };
                smsBtn.addEventListener('touchend', sHandler, { passive: false });
                smsBtn.addEventListener('click', sHandler);
            }

            // End session button
            const endBtn = document.getElementById('mobileJamEndBtn');
            if (endBtn) {
                let endFired = false;
                const endHandler = (e) => {
                    e.preventDefault();
                    if (endFired) return;
                    endFired = true;
                    setTimeout(() => { endFired = false; }, 500);
                    this.endJamSession();
                };
                endBtn.addEventListener('touchend', endHandler, { passive: false });
                endBtn.addEventListener('click', endHandler);
            }

            // Get New Code button
            const newCodeBtn = document.getElementById('mobileJamNewCodeBtn');
            if (newCodeBtn) {
                let ncFired = false;
                const ncHandler = (e) => {
                    e.preventDefault();
                    if (ncFired) return;
                    ncFired = true;
                    setTimeout(() => { ncFired = false; }, 500);
                    this._handleGetNewCode();
                };
                newCodeBtn.addEventListener('touchend', ncHandler, { passive: false });
                newCodeBtn.addEventListener('click', ncHandler);
            }
        });

        // Update participant list with current data
        if (this.jamClient.participants.length > 0) {
            this.updateJamParticipantList(this.jamClient.participants);
        }
    }

    updateJamParticipantList(participants) {
        const listEl = document.getElementById('mobileJamParticipantsList');
        if (!listEl) return;

        listEl.innerHTML = participants.map(p => `
            <div class="mobile-jam-participant ${p.role === 'host' ? 'mobile-jam-participant-host' : ''}">
                <i class="fas ${p.role === 'host' ? 'fa-crown' : 'fa-user'} jam-participant-icon"></i>
                <span class="jam-participant-name">${p.name}</span>
            </div>
        `).join('');
    }

    endJamSession() {
        if (!confirm('End this jam session? All participants will be disconnected.')) return;
        if (this.jamClient) {
            this.jamClient.endSession();
        }
        this.renderJamPage();
    }

    _handleGetNewCode() {
        if (!confirm('Delete your current jam code and get a new one?\nAll guests with the old QR code will need the new one.')) return;
        if (this.jamClient) {
            this.jamClient.endSession();
            this.jamClient.socket.emit('jam_delete_code', {});
            this.jamClient.socket.once('jam_code_deleted', () => {
                this.showToast('Code deleted. Start a new session to get a fresh code.', 'success');
                this.renderJamPage();
            });
            // Fallback if no response within 3s
            setTimeout(() => {
                this.renderJamPage();
            }, 3000);
        }
    }

    async generateJamQRCode(url) {
        const container = document.getElementById('mobileJamQR');
        if (!container) return;

        // Load QRCode library dynamically if not loaded
        if (typeof QRCode === 'undefined') {
            try {
                await this._loadQRScript('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js');
            } catch (e) {
                console.warn('[Jam] QRCode library failed to load');
                container.innerHTML = `<div class="jam-qr-fallback">${url}</div>`;
                return;
            }
        }

        try {
            const canvas = document.createElement('canvas');
            await QRCode.toCanvas(canvas, url, {
                width: 180,
                margin: 2,
                color: { dark: '#ffffff', light: '#00000000' }
            });
            container.innerHTML = '';
            container.appendChild(canvas);
        } catch (e) {
            console.error('[Jam] QR generation error:', e);
            container.innerHTML = `<div class="jam-qr-fallback">${url}</div>`;
        }
    }

    _loadQRScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[MobileApp] DOM ready');
    window.mobileApp = new MobileApp();
});
