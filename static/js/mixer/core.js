/**
 * StemTubes Mixer - Core Module
 * Main module for initializing and coordinating the mixer
 */

class StemMixer {
    /**
     * Mixer constructor
     */
    constructor() {
        // Mobile detection
        this.isMobile = this.detectMobile();
        this.isIOS = this.detectIOS();

        // General properties
        this.isInitialized = false;
        this.isPlaying = false;
        this.currentTime = 0;
        this.maxDuration = 0;
        this.stems = {};
        this.zoomLevels = {
            horizontal: 1.0,
            vertical: 1.0
        };
        
        // iOS audio unlock state
        this.audioUnlocked = false;

        // DOM elements of the mixer
        this.elements = {
            app: document.getElementById('mixer-app'),
            loading: document.getElementById('loading-container'),
            tracks: document.getElementById('tracks-container'),
            playBtn: document.getElementById('play-btn'),
            stopBtn: document.getElementById('stop-btn'),
            timeDisplay: document.getElementById('time-display'),
            timeline: document.getElementById('timeline'),
            playhead: document.getElementById('timeline-playhead'),
            zoomInH: document.getElementById('zoom-in-h'),
            zoomOutH: document.getElementById('zoom-out-h'),
            zoomInV: document.getElementById('zoom-in-v'),
            zoomOutV: document.getElementById('zoom-out-v'),
            zoomReset: document.getElementById('zoom-reset')
        };
        
        // Initialize modules
        this.initModules();

        // Start loading
        this.init();
    }

    /**
     * Detect if on mobile
     */
    detectMobile() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        return /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    }

    /**
     * Detect if on iOS
     */
    detectIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    /**
     * Initialize mixer modules
     */
    initModules() {
        // Initialize audio engine adapted to platform
        if (this.isMobile) {
            this.audioEngine = new MobileAudioEngine(this);
        } else {
            this.audioEngine = new AudioEngine(this);
        }

        // Initialize timeline manager
        this.timeline = new Timeline(this);

        // Initialize waveform renderer
        this.waveform = new WaveformRenderer(this);

        // Initialize track controls manager
        this.trackControls = new TrackControls(this);

        // Initialize chord display manager
        this.chordDisplay = new ChordDisplay(this);

        // Initialize structure display manager
        // Use global EXTRACTION_ID since this.extractionId is not set yet
        this.structureDisplay = new StructureDisplay('#structure-container', typeof EXTRACTION_ID !== 'undefined' ? EXTRACTION_ID : null);

        // Initialize karaoke display manager
        // Use lyrics container since lyrics are shown in the lyrics tab
        this.karaokeDisplay = new KaraokeDisplay('#karaoke-container-lyrics', typeof EXTRACTION_ID !== 'undefined' ? EXTRACTION_ID : null);
        window.karaokeDisplayInstance = this.karaokeDisplay;

        // Initialize tab manager (Mixer / Chords / Lyrics)
        this.tabManager = new TabManager(this);

        // Simple pitch/tempo controls managed by SimplePitchTempoController
        this.pitchTempoControls = null;

        // Recording engine (desktop only)
        if (!this.isMobile && typeof RecordingEngine !== 'undefined') {
            this.recordingEngine = new RecordingEngine(this);
        } else {
            this.recordingEngine = null;
        }

        // Log module initialization
        console.log('[StemMixer] Modules initialized');
    }

    /**
     * Logger with timestamp
     */
    log(message) {
        console.log(`[StemMixer] ${new Date().toISOString().slice(11, 19)} - ${message}`);
    }

    /**
     * Initialize the mixer
     */
    async init() {
        this.log('Initializing mixer...');
        
        try {
            // Use the global extraction ID (prefer window property for dynamic guest mode)
            const extractionId = window.EXTRACTION_ID || (typeof EXTRACTION_ID !== 'undefined' ? EXTRACTION_ID : '');
            if (!extractionId) {
                throw new Error('Extraction ID not specified in URL');
            }

            // Define the global variable for the extraction ID
            this.extractionId = extractionId;
            this.encodedExtractionId = encodeURIComponent(extractionId);

            // Initialize audio context
            await this.audioEngine.initAudioContext();

            // Expose audio context globally for SimplePitchTempo
            window.audioContext = this.audioEngine.audioContext;
            window.dispatchEvent(new CustomEvent('audioContextReady'));

            // Configure event listeners for controls
            this.setupEventListeners();

            // Get and load stems
            await this.loadStems();

            // Create timeline
            this.timeline.createTimeMarkers();

            // Hide loading message and display mixer
            if (this.elements.loading) {
                this.elements.loading.style.display = 'none';
            }
            if (this.elements.app) {
                this.elements.app.style.display = 'flex';
            }

            // Wait for DOM elements to be completely rendered
            // then redraw waveforms and configure scroll synchronization
            setTimeout(() => {
                this.waveform.resizeAllWaveforms();
                this.waveform.updateAllWaveforms();
                this.setupScrollSynchronization();
                this.log('Waveform rendering completed after full initialization');

                // Initialize persistence after everything is loaded
                this.initPersistence();
            }, 300);

            this.isInitialized = true;
            this.log('Mixer initialized successfully!');

            // Initialize recording controls (desktop only)
            if (this.recordingEngine) {
                this.setupRecordingControls();
            }

            // Initialize visual metronome
            this.initMetronome();
        } catch (error) {
            this.log(`Error during initialization: ${error.message}`);
            this.showError(`Error: ${error.message}`);
        }
    }

    /**
     * Configure event listeners
     */
    setupEventListeners() {
        // Synchronize horizontal scrolling between waveform containers
        this.setupScrollSynchronization();

        // Play/pause button
        if (this.elements.playBtn) {
            this.elements.playBtn.addEventListener('click', () => {
                this.togglePlayback();
            });
        }

        // Stop button
        if (this.elements.stopBtn) {
            this.elements.stopBtn.addEventListener('click', () => {
                this.stop();
            });
        }

        // Timeline for playhead movement
        if (this.elements.timeline) {
            // Handler for simple clicks
            this.elements.timeline.addEventListener('click', (e) => {
                // Don't process as simple click if we were in drag mode
                if (!this.timeline.isDragging) {
                    this.timeline.handleTimelineClick(e);
                }
            });

            // Handler for drag start (scratching)
            this.elements.timeline.addEventListener('mousedown', (e) => {
                this.timeline.handleMouseDown(e);
            });
        }

        // Zoom controls
        if (this.elements.zoomInH) {
            this.elements.zoomInH.addEventListener('click', () => {
                this.zoomLevels.horizontal = Math.min(10, this.zoomLevels.horizontal * 1.2);
                this.waveform.updateAllWaveforms();
            });
        }
        
        if (this.elements.zoomOutH) {
            this.elements.zoomOutH.addEventListener('click', () => {
                this.zoomLevels.horizontal = Math.max(0.5, this.zoomLevels.horizontal / 1.2);
                this.waveform.updateAllWaveforms();
            });
        }
        
        if (this.elements.zoomInV) {
            this.elements.zoomInV.addEventListener('click', () => {
                this.zoomLevels.vertical = Math.min(10, this.zoomLevels.vertical * 1.2);
                this.waveform.updateAllWaveforms();
            });
        }
        
        if (this.elements.zoomOutV) {
            this.elements.zoomOutV.addEventListener('click', () => {
                this.zoomLevels.vertical = Math.max(0.5, this.zoomLevels.vertical / 1.2);
                this.waveform.updateAllWaveforms();
            });
        }
        
        if (this.elements.zoomReset) {
            this.elements.zoomReset.addEventListener('click', () => {
                this.zoomLevels.horizontal = 1.0;
                this.zoomLevels.vertical = 1.0;
                this.waveform.updateAllWaveforms();
            });
        }

        // Regenerate Chords button
        const regenerateChordsBtn = document.getElementById('regenerateChordsBtn');
        if (regenerateChordsBtn && this.chordDisplay) {
            regenerateChordsBtn.addEventListener('click', () => {
                this.chordDisplay.regenerateChords();
            });
        }

        // Listen for keyboard keys
        document.addEventListener('keydown', (e) => {
            // Space for play/pause
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayback();
            }
            // Escape to stop
            else if (e.code === 'Escape') {
                this.stop();
            }
        });

        this.log('Event listeners configured');
    }

    /**
     * Setup recording controls (record button, add track, latency, bleed toggle).
     * Device selector, level meter and monitor are per-track (in track-controls.js).
     */
    setupRecordingControls() {
        const recEngine = this.recordingEngine;
        if (!recEngine) return;

        const recordBtn = document.getElementById('record-btn');
        const addTrackBtn = document.getElementById('add-recording-track-btn');
        const calibrateBtn = document.getElementById('calibrate-latency-btn');
        const latencyValue = document.getElementById('latency-value');
        const bleedToggle = document.getElementById('bleed-removal-toggle');

        // "Add Track" button — creates an empty recording track
        if (addTrackBtn) {
            addTrackBtn.addEventListener('click', () => {
                const track = recEngine.addEmptyTrack();
                if (track) {
                    this.trackControls.createRecordingTrackElement(track);
                }
            });
        }

        // Record button (DAW-style)
        // Only starts/stops recording on armed tracks — never creates tracks
        if (recordBtn) {
            recordBtn.addEventListener('click', async () => {
                if (recEngine.isRecording) {
                    // Stop recording
                    const processing = this._showProcessingIndicator('Processing recording...');
                    try {
                        await recEngine.stopRecording();
                    } finally {
                        processing.remove();
                    }
                    recordBtn.classList.remove('recording');
                } else {
                    // Check for armed tracks
                    const armedTracks = recEngine.getArmedTracks();
                    if (armedTracks.length === 0) {
                        this.showToast('Arm a track first (click R on a recording track)', 'warning');
                        return;
                    }

                    // Mark armed tracks as "is-recording"
                    for (const t of armedTracks) {
                        const trackEl = document.getElementById(`rec-track-${t.id}`);
                        if (trackEl) trackEl.classList.add('is-recording');
                    }

                    // Start recording on all armed tracks
                    const currentPos = this.currentTime || 0;
                    const started = await recEngine.startRecording(currentPos);
                    if (!started) {
                        this.showToast('Could not start recording — check microphone permissions', 'error');
                        return;
                    }
                    recordBtn.classList.add('recording');

                    // Auto-play if not already playing
                    if (!this.isPlaying) {
                        this.togglePlayback();
                    }
                }
            });
        }

        // Show existing calibration value
        if (latencyValue) {
            const existing = recEngine.getEffectiveLatency();
            if (existing > 0) {
                latencyValue.textContent = `${(existing * 1000).toFixed(0)}ms`;
            }
        }

        // Calibrate latency button (automatic loopback test)
        if (calibrateBtn) {
            calibrateBtn.addEventListener('click', async () => {
                if (recEngine.isCalibrating) return;
                calibrateBtn.disabled = true;
                calibrateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
                try {
                    const latency = await recEngine.calibrateLatency();
                    const ms = (latency * 1000).toFixed(0);
                    if (latencyValue) latencyValue.textContent = `${ms}ms`;
                    this.showToast(`Latency calibrated: ${ms}ms`, 'success');
                } catch (err) {
                    console.error('[StemMixer] Calibration failed:', err);
                    this.showToast('Calibration failed — check mic permissions', 'error');
                } finally {
                    calibrateBtn.disabled = false;
                    calibrateBtn.innerHTML = '<i class="fas fa-crosshairs"></i> Calibrate';
                }
            });
        }

        // Bleed removal toggle (global setting)
        if (bleedToggle) {
            bleedToggle.addEventListener('change', (e) => {
                recEngine.bleedRemovalEnabled = e.target.checked;
            });
        }

        // Load saved recordings from server
        const extractionId = this.extractionId;
        if (extractionId) {
            recEngine.loadFromServer(extractionId).catch(err => {
                console.warn('[StemMixer] Could not load recordings:', err);
            });
        }

        this.log('Recording controls configured');
    }

    /**
     * Show a temporary processing indicator
     * @private
     */
    _showProcessingIndicator(message) {
        const el = document.createElement('div');
        el.className = 'recording-processing';
        el.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
        document.body.appendChild(el);
        return el;
    }

    /**
     * Configure horizontal scroll synchronization for all waveforms
     */
    setupScrollSynchronization() {
        // Select all waveform containers
        const waveformContainers = document.querySelectorAll('.waveform-container');

        // Add scroll event listeners to each container
        waveformContainers.forEach(container => {
            container.addEventListener('scroll', (e) => {
                const scrollLeft = e.target.scrollLeft;

                // Synchronize all other waveform containers
                waveformContainers.forEach(otherContainer => {
                    if (otherContainer !== e.target) {
                        otherContainer.scrollLeft = scrollLeft;
                    }
                });
            });
        });

        this.log('Horizontal scroll synchronization configured');
    }

    /**
     * Check stem existence via HEAD request
     */
    async checkStemExists(stemName) {
        try {
            const urlBase = window.JAM_STEM_URL_PREFIX || `/api/extracted_stems/${this.encodedExtractionId}`;
            const cacheBuster = window.JAM_STEM_CACHE_BUSTER || '';
            const url = `${urlBase}/${stemName}${cacheBuster}`;
            const response = await fetch(url, { method: 'HEAD' });
            return response.ok;
        } catch (error) {
            this.log(`Error checking stem ${stemName}: ${error.message}`);
            return false;
        }
    }

    /**
     * Load stems from server (only existing stems)
     */
    async loadStems() {
        try {
            this.log('Loading stems...');

            // Check if we have extraction information with output paths
            let stemFiles = [];

            // Handle both output_paths (from live extractions) and stems_paths (from API/database)
            let stemPaths = null;
            if (window.EXTRACTION_INFO) {
                if (window.EXTRACTION_INFO.output_paths) {
                    stemPaths = window.EXTRACTION_INFO.output_paths;
                } else if (window.EXTRACTION_INFO.stems_paths) {
                    stemPaths = typeof window.EXTRACTION_INFO.stems_paths === 'string'
                        ? JSON.parse(window.EXTRACTION_INFO.stems_paths)
                        : window.EXTRACTION_INFO.stems_paths;
                }
            }

            if (stemPaths && Object.keys(stemPaths).length > 0) {
                this.log('Using stem paths from EXTRACTION_INFO');
                // Use provided stem paths - they are guaranteed to exist
                const stemUrlBase = window.JAM_STEM_URL_PREFIX || `/api/extracted_stems/${this.encodedExtractionId}`;
                const cacheBuster = window.JAM_STEM_CACHE_BUSTER || '';
                for (const [stemName, stemPath] of Object.entries(stemPaths)) {
                    stemFiles.push({
                        name: stemName,
                        url: `${stemUrlBase}/${stemName}${cacheBuster}`
                    });
                }
            } else {
                // Fallback: check which standard stems actually exist
                this.log('Fallback: checking existing standard stems...');
                const standardStems = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];

                // Check existence of each stem in parallel
                const existenceChecks = await Promise.allSettled(
                    standardStems.map(stem => this.checkStemExists(stem))
                );

                // Keep only stems that exist
                stemFiles = [];
                const fallbackUrlBase = window.JAM_STEM_URL_PREFIX || `/api/extracted_stems/${this.encodedExtractionId}`;
                const fallbackCacheBuster = window.JAM_STEM_CACHE_BUSTER || '';
                existenceChecks.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        const stemName = standardStems[index];
                        stemFiles.push({
                            name: stemName,
                            url: `${fallbackUrlBase}/${stemName}${fallbackCacheBuster}`
                        });
                        this.log(`Stem ${stemName} detected as existing`);
                    } else {
                        this.log(`Stem ${standardStems[index]} does not exist or is not accessible`);
                    }
                });

                if (stemFiles.length === 0) {
                    throw new Error('No stem found for this extraction');
                }
            }

            this.log(`Attempting to load ${stemFiles.length} existing stems`);

            // Load all existing stems in parallel
            const loadPromises = stemFiles.map(stem => this.audioEngine.loadStem(stem.name, stem.url));
            const results = await Promise.allSettled(loadPromises);

            // Count stems loaded successfully
            let successCount = 0;
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    successCount++;
                    this.log(`Stem ${stemFiles[index].name} loaded successfully`);
                } else {
                    this.log(`Error loading stem ${stemFiles[index].name}: ${result.reason}`);
                }
            });

            if (successCount === 0) {
                throw new Error('No stem could be loaded');
            }

            this.log(`${successCount} stems loaded out of ${stemFiles.length}`);

            // Update maximum duration
            this.updateMaxDuration();

            // Render waveforms immediately after loading stems
            this.waveform.updateAllWaveforms();

            // Initialize pitch/tempo controls with analysis data
            await this.loadAnalysisDataAndInitControls();

            // Load chord data
            await this.chordDisplay.loadChordData();

            this.log('All stems have been loaded successfully');
        } catch (error) {
            this.log(`Error loading stems: ${error.message}`);
            throw error;
        }
    }

    /**
     * Load analysis data from database and initialize controls
     */
    async loadAnalysisDataAndInitControls() {
        try {
            this.log('Loading audio analysis data...');

            let analysisData = null;

            // Try to retrieve from EXTRACTION_INFO (global data)
            if (window.EXTRACTION_INFO) {
                this.log(`EXTRACTION_INFO exists: ${JSON.stringify(window.EXTRACTION_INFO)}`);
                analysisData = {
                    detected_bpm: window.EXTRACTION_INFO.detected_bpm || null,
                    detected_key: window.EXTRACTION_INFO.detected_key || null,
                    analysis_confidence: window.EXTRACTION_INFO.analysis_confidence || null,
                    chords_data: window.EXTRACTION_INFO.chords_data || null,
                    structure_data: window.EXTRACTION_INFO.structure_data || null
                };
                this.log(`Analysis data from EXTRACTION_INFO - BPM: ${analysisData.detected_bpm}, Key: ${analysisData.detected_key}, Chords: ${!!analysisData.chords_data}, Structure: ${!!analysisData.structure_data}`);
            }

            // If no data in EXTRACTION_INFO, try the API
            if (!analysisData || (!analysisData.detected_bpm && !analysisData.detected_key)) {
                this.log('Trying API for analysis data...');
                try {
                    const response = await fetch(`/api/extractions/${this.extractionId}`);
                    if (response.ok) {
                        const extractionData = await response.json();
                        analysisData = {
                            detected_bpm: extractionData.detected_bpm || null,
                            detected_key: extractionData.detected_key || null,
                            analysis_confidence: extractionData.analysis_confidence || null,
                            chords_data: extractionData.chords_data || null,
                            structure_data: extractionData.structure_data || null
                        };
                        this.log(`Analysis data from API - BPM: ${analysisData.detected_bpm}, Key: ${analysisData.detected_key}, Chords: ${!!analysisData.chords_data}, Structure: ${!!analysisData.structure_data}`);
                    }
                } catch (apiError) {
                    this.log(`API not available: ${apiError.message}`);
                }
            }

            // Use defaults ONLY if we have no data at all
            if (!analysisData || (!analysisData.detected_bpm && !analysisData.detected_key)) {
                analysisData = {
                    detected_bpm: 120,
                    detected_key: 'C major',
                    analysis_confidence: 0.0,
                    chords_data: null
                };
                this.log('Utilisation des valeurs par défaut (120 BPM, C major)');
            } else {
                // Fill in missing values with defaults but keep existing ones
                if (!analysisData.detected_bpm) analysisData.detected_bpm = 120;
                if (!analysisData.detected_key) analysisData.detected_key = 'C major';
                if (!analysisData.analysis_confidence) analysisData.analysis_confidence = 0.0;
            }

            this.log(`Données d'analyse finales - BPM: ${analysisData.detected_bpm}, Key: ${analysisData.detected_key}, Chords: ${!!analysisData.chords_data}, Structure: ${!!analysisData.structure_data}`);

            // Pass BPM to chord display
            if (this.chordDisplay && analysisData.detected_bpm) {
                this.chordDisplay.setBPM(analysisData.detected_bpm);

                // Expose chord display globally for debugging offset
                window.chordDisplay = this.chordDisplay;
            }

            // Load structure data into structure display
            this.log(`[STRUCTURE] Checking structure display - Display exists: ${!!this.structureDisplay}, Data exists: ${!!analysisData.structure_data}`);
            if (this.structureDisplay && analysisData.structure_data) {
                try {
                    // Parse structure_data if it's a JSON string
                    this.log(`[STRUCTURE] Structure data type: ${typeof analysisData.structure_data}`);
                    const structureData = typeof analysisData.structure_data === 'string'
                        ? JSON.parse(analysisData.structure_data)
                        : analysisData.structure_data;

                    this.log(`[STRUCTURE] Parsed structure data - Is Array: ${Array.isArray(structureData)}, Length: ${structureData?.length || 0}`);
                    if (structureData && Array.isArray(structureData) && structureData.length > 0) {
                        this.log(`[STRUCTURE] Loading ${structureData.length} structure sections into display (duration: ${this.maxDuration}s)`);
                        this.structureDisplay.loadStructure(structureData, this.maxDuration);
                        this.structureDisplay.setVisible(true);
                        this.log(`[STRUCTURE] Structure display set to visible`);
                    } else {
                        this.log('[STRUCTURE] No valid structure data available - hiding display');
                        this.structureDisplay.setVisible(false);
                    }
                } catch (error) {
                    this.log(`[STRUCTURE] Error loading structure data: ${error.message}`);
                    console.error('[STRUCTURE] Error details:', error);
                    this.structureDisplay.setVisible(false);
                }
            } else {
                this.log(`[STRUCTURE] Structure display not available or no data`);
            }

            // Emit event for SimplePitchTempo
            window.dispatchEvent(new CustomEvent('stemLoaded', {
                detail: analysisData
            }));

            this.log('Analysis data transmitted to controls');
        } catch (error) {
            this.log(`Error loading analysis data: ${error.message}`);

            // Fallback with default values
            const defaultAnalysisData = {
                detected_bpm: 120,
                detected_key: 'C major',
                analysis_confidence: 0.0
            };

            window.dispatchEvent(new CustomEvent('stemLoaded', {
                detail: defaultAnalysisData
            }));

            this.log('Controls initialized with default values after error');
        }
    }
    
    /**
     * Update maximum duration of stems
     */
    updateMaxDuration() {
        let maxDuration = 0;

        // Find maximum duration among all stems
        Object.values(this.stems).forEach(stem => {
            if (stem.buffer && stem.buffer.duration > maxDuration) {
                maxDuration = stem.buffer.duration;
            }
        });

        this.maxDuration = maxDuration;
        this.log(`Maximum duration updated: ${maxDuration.toFixed(2)} seconds`);
        
        return maxDuration;
    }
    
    /**
     * Toggle between play and pause
     */
    togglePlayback() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Start playback
     */
    play() {
        if (!this.isInitialized || Object.keys(this.stems).length === 0) {
            this.log('Cannot start playback: mixer not initialized or no stems available');
            return;
        }

        // iOS audio unlock removed - let audio work naturally
        this.log('Starting playback');
        this.audioEngine.play();
        this.updatePlayPauseButton();

        // Start metronome
        if (this.metronome) this.metronome.start();

        // Emit event for SimplePitchTempo
        window.dispatchEvent(new CustomEvent('playbackStarted'));
    }
    
    /**
     * Pause playback
     */
    pause() {
        this.log('Pausing playback');
        this.audioEngine.pause();
        this.updatePlayPauseButton();
        if (this.metronome) this.metronome.stop();
    }

    /**
     * Stop playback
     */
    async stop() {
        this.log('Stopping playback');

        // Stop active recording first (must complete before audio engine stops)
        if (this.recordingEngine && this.recordingEngine.isRecording) {
            const processing = this._showProcessingIndicator('Processing recording...');
            try {
                await this.recordingEngine.stopRecording();
            } finally {
                processing.remove();
            }
            const recordBtn = document.getElementById('record-btn');
            if (recordBtn) recordBtn.classList.remove('recording');
        }

        this.audioEngine.stop();
        this.updatePlayPauseButton();
        if (this.metronome) this.metronome.stop();
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Notification type (info, success, error, warning)
     */
    showToast(message, type = 'info') {
        // Create toast element if it doesn't exist
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                pointer-events: none;
            `;
            document.body.appendChild(toastContainer);
        }

        // Create toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            background-color: ${type === 'error' ? '#ff4444' : type === 'success' ? '#44ff44' : type === 'warning' ? '#ffaa00' : '#4488ff'};
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            margin-bottom: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 14px;
            max-width: 300px;
            word-wrap: break-word;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            pointer-events: auto;
        `;
        toast.textContent = message;
        
        toastContainer.appendChild(toast);

        // Entry animation
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 10);

        // Automatic removal
        setTimeout(() => {
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }
    
    /**
     * Update play/pause button appearance
     */
    updatePlayPauseButton() {
        if (!this.elements.playBtn) return;
        
        if (this.isPlaying) {
            this.elements.playBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
            this.elements.playBtn.classList.add('playing');
        } else {
            this.elements.playBtn.innerHTML = '<i class="fas fa-play"></i> Play';
            this.elements.playBtn.classList.remove('playing');
        }
    }
    
    /**
     * Show un message d'error
     */
    showError(message) {
        if (this.elements.loading) {
            this.elements.loading.innerHTML = `<div class="error-message">${message}</div>`;
        } else {
            alert(message);
        }
    }
    
    /**
     * Formatter le temps (secondes -> MM:SS)
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Update time display
     */
    updateTimeDisplay() {
        if (this.elements.timeDisplay) {
            this.elements.timeDisplay.textContent = this.formatTime(this.currentTime);
        }
    }
    
    /**
     * Initialize state persistence
     */
    initPersistence() {
        try {
            // Create persistence instance
            this.persistence = new MixerPersistence(this);

            // Restore saved state with delay to ensure everything is loaded
            setTimeout(() => {
                const restored = this.persistence.restoreState();
                if (restored) {
                    this.log('Mixer state restored from localStorage');
                } else {
                    this.log('No previous state found or different extraction');
                }
            }, 500);

            this.log('Mixer persistence initialized');
        } catch (error) {
            this.log(`Error initializing persistence: ${error.message}`);
        }
    }

    /**
     * Initialize visual metronome
     */
    initMetronome() {
        if (typeof JamMetronome === 'undefined') return;

        const container = document.getElementById('metronome-container');
        if (!container) return;

        const bpm = window.EXTRACTION_INFO?.detected_bpm || 120;
        const beatOffset = window.EXTRACTION_INFO?.beat_offset || 0;

        this.metronome = new JamMetronome(container, {
            bpm: bpm,
            beatOffset: beatOffset,
            beatsPerBar: 4,
            getCurrentTime: () => {
                if (this.audioEngine) {
                    return this.audioEngine.playbackPosition || 0;
                }
                return 0;
            },
            audioContext: this.audioEngine?.audioContext || null
        });

        // Load beat map for variable-tempo metronome
        const beatTimesRaw = window.EXTRACTION_INFO?.beat_times;
        if (beatTimesRaw) {
            const bt = typeof beatTimesRaw === 'string' ? JSON.parse(beatTimesRaw) : beatTimesRaw;
            if (Array.isArray(bt) && bt.length > 0) this.metronome.setBeatTimes(bt);
        }

        // Listen for tempo changes to update metronome BPM
        window.addEventListener('tempoChanged', (e) => {
            if (this.metronome && window.simplePitchTempo) {
                this.metronome.setBPM(window.simplePitchTempo.currentBPM);
            }
        });

        this.log('Metronome initialized');
    }
}

// Start mixer when page is loaded
document.addEventListener('DOMContentLoaded', () => {
    // In jam guest mode with no extraction data yet, wait for host to provide it
    if (window.JAM_GUEST_MODE && !window.EXTRACTION_ID) {
        console.log('[StemMixer] Guest mode — no extraction yet, waiting for host track data');
        return;
    }
    window.stemMixer = new StemMixer();
    // Expose mixer globally for SimplePitchTempo
    window.mixer = window.stemMixer;
});
