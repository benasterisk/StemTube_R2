/**
 * StemTubes Mixer - Mobile Audio Engine
 * Audio engine optimized for mobile devices
 * Uses HTML5 Audio Elements instead of Web Audio API for better compatibility
 */

class MobileAudioEngine {
    /**
     * Mobile audio engine constructor
     * @param {StemMixer} mixer - Main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
        this.audioElements = {};
        this.startTime = 0;
        this.animationFrameId = null;
        this.isPausing = false;
        this.masterVolume = 1.0;
        this.allStemsLoaded = false;
        this.stemsLoadedCount = 0;
    }
    
    /**
     * Initialize mobile audio context
     */
    async initAudioContext() {
        try {
            this.mixer.log('Initializing mobile audio engine...');

            // No need for special audio context for mobile
            // We will use HTML5 audio elements

            this.mixer.log('Mobile audio engine initialized');
            return true;
        } catch (error) {
            this.mixer.log(`Error initializing mobile audio engine: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Load a stem
     * @param {string} name - Stem name
     * @param {string} url - Audio file URL
     */
    async loadStem(name, url) {
        try {
            this.mixer.log(`Loading mobile stem: ${name}`);

            // Check if file exists
            const response = await fetch(url, { method: 'HEAD' });
            if (!response.ok) {
                this.mixer.log(`Stem ${name} does not exist (${response.status})`);
                return false;
            }

            // Create HTML5 audio element
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';

            // Promise to wait for complete loading
            const loadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Loading timeout'));
                }, 10000); // 10 seconds timeout
                
                audio.addEventListener('loadedmetadata', () => {
                    clearTimeout(timeout);
                    this.mixer.log(`Metadata loaded for ${name}: ${audio.duration}s`);

                    // Add stem to mixer
                    this.mixer.stems[name] = {
                        buffer: audio,
                        duration: audio.duration,
                        waveformData: null
                    };

                    // Update mixer maximum duration
                    this.mixer.updateMaxDuration();

                    resolve();
                });

                audio.addEventListener('canplaythrough', () => {
                    this.mixer.log(`${name} ready for playback`);
                });

                audio.addEventListener('error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`Loading error: ${e.message || 'Unknown error'}`));
                });
            });

            // Load audio
            audio.src = url;

            // Wait for loading
            await loadPromise;

            // Store audio element
            this.audioElements[name] = {
                audio: audio,
                volume: 1.0,
                pan: 0,
                muted: false,
                solo: false
            };
            
            // IMPORTANT: Create track element in user interface
            if (this.mixer.trackControls) {
                this.mixer.trackControls.createTrackElement(name);
            }

            // Generate waveform data for mobile (simplified)
            this.generateMobileWaveform(name, audio);

            // Trigger waveform rendering
            if (this.mixer.waveform) {
                // Small wait to ensure DOM element is created
                setTimeout(() => {
                    this.mixer.waveform.drawWaveform(name);
                }, 100);
            }

            this.stemsLoadedCount++;

            // Trigger global waveform rendering when all stems are loaded
            // (we use a timeout to allow time for other stems to finish loading)
            setTimeout(() => {
                if (this.mixer.waveform) {
                    this.mixer.waveform.updateAllWaveforms();
                }
            }, 500);

            this.mixer.log(`Mobile stem ${name} loaded successfully`);
            return true;
        } catch (error) {
            this.mixer.log(`Error loading mobile stem ${name}: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Generate simplified waveform for mobile
     * @param {string} name - Stem name
     * @param {HTMLAudioElement} audio - Audio element
     */
    generateMobileWaveform(name, audio) {
        try {
            // Create simplified waveform data for mobile
            // (for performance reasons, we use a dummy waveform)
            const duration = audio.duration || 1;
            const sampleRate = 44100;
            const samples = Math.floor(duration * sampleRate);
            const downsampleFactor = 1000; // Reduce for better performance
            const waveformLength = Math.floor(samples / downsampleFactor);

            // Generate simple waveform based on duration
            const waveformData = new Float32Array(waveformLength);
            for (let i = 0; i < waveformLength; i++) {
                // Create dummy but visually acceptable waveform
                waveformData[i] = 0.5 + 0.3 * Math.sin(i * 0.01) * Math.random();
            }

            // Store waveform data
            if (this.mixer.stems[name]) {
                this.mixer.stems[name].waveformData = waveformData;
            }

            this.mixer.log(`Mobile waveform generated for ${name}`);
        } catch (error) {
            this.mixer.log(`Error generating waveform for ${name}: ${error.message}`);
        }
    }
    
    /**
     * Play all stems
     */
    play() {
        try {
            this.mixer.log('Mobile playback started');
            this.startTime = Date.now() - (this.mixer.currentTime * 1000);

            // Start playback of all stems
            Object.values(this.audioElements).forEach(stem => {
                stem.audio.currentTime = this.mixer.currentTime;
                stem.audio.play().catch(e => {
                    this.mixer.log(`Playback error: ${e.message}`);
                });
            });

            this.startTimeUpdate();
            return true;
        } catch (error) {
            this.mixer.log(`Error during mobile playback: ${error.message}`);
            return false;
        }
    }

    /**
     * Pause all stems
     */
    pause() {
        try {
            this.mixer.log('Mobile playback paused');
            this.isPausing = true;

            // Pause all stems
            Object.values(this.audioElements).forEach(stem => {
                stem.audio.pause();
            });

            this.stopTimeUpdate();
            this.isPausing = false;
            return true;
        } catch (error) {
            this.mixer.log(`Error during mobile pause: ${error.message}`);
            return false;
        }
    }

    /**
     * Stop all stems
     */
    stop() {
        try {
            this.mixer.log('Mobile playback stopped');

            // Stop and reset all stems
            Object.values(this.audioElements).forEach(stem => {
                stem.audio.pause();
                stem.audio.currentTime = 0;
            });

            this.mixer.currentTime = 0;
            this.stopTimeUpdate();

            // Reset chord display
            if (this.mixer.chordDisplay) {
                this.mixer.chordDisplay.reset();
            }

            return true;
        } catch (error) {
            this.mixer.log(`Error during mobile stop: ${error.message}`);
            return false;
        }
    }

    /**
     * Go to specific position
     * @param {number} time - Time in seconds
     */
    seekTo(time) {
        try {
            this.mixer.log(`Mobile seek to: ${time}s`);

            // Synchronize all stems to new position
            Object.values(this.audioElements).forEach(stem => {
                stem.audio.currentTime = time;
            });

            this.mixer.currentTime = time;
            this.startTime = Date.now() - (time * 1000);

            // Update chord display
            if (this.mixer.chordDisplay) {
                this.mixer.chordDisplay.sync(time);
            }

            // Update structure display
            if (this.mixer.structureDisplay) {
                this.mixer.structureDisplay.sync(time);
            }

            // Update karaoke display
            if (this.mixer.karaokeDisplay) {
                this.mixer.karaokeDisplay.sync(time);
            }

            return true;
        } catch (error) {
            this.mixer.log(`Error during mobile seek: ${error.message}`);
            return false;
        }
    }

    /**
     * Set stem volume
     * @param {string} name - Stem name
     * @param {number} volume - Volume (0-1)
     */
    setStemVolume(name, volume) {
        if (this.audioElements[name]) {
            this.audioElements[name].volume = volume;
            this.updateStemAudio(name);
        }
    }

    /**
     * Set stem pan (not supported on mobile)
     * @param {string} name - Stem name
     * @param {number} pan - Pan (-1 to 1)
     */
    setStemPan(name, pan) {
        if (this.audioElements[name]) {
            this.audioElements[name].pan = pan;
            // Pan is not directly supported with HTML5 Audio
            // We can simulate with left/right volume but it's limited
        }
    }

    /**
     * Mute a stem
     * @param {string} name - Stem name
     * @param {boolean} muted - Mute state
     */
    setStemMuted(name, muted) {
        if (this.audioElements[name]) {
            this.audioElements[name].muted = muted;
            this.updateStemAudio(name);
        }
    }

    /**
     * Solo a stem
     * @param {string} name - Stem name
     * @param {boolean} solo - Solo state
     */
    setStemSolo(name, solo) {
        if (this.audioElements[name]) {
            this.audioElements[name].solo = solo;

            // Update all stems to handle solo
            Object.keys(this.audioElements).forEach(stemName => {
                this.updateStemAudio(stemName);
            });
        }
    }
    
    /**
     * Update stem audio
     * @param {string} name - Stem name
     */
    updateStemAudio(name) {
        const stem = this.audioElements[name];
        if (!stem) return;

        // Check if there are soloed stems
        const hasSolo = Object.values(this.audioElements).some(s => s.solo);

        // Calculate final volume
        let finalVolume = stem.volume * this.masterVolume;

        // Determine if stem should be muted
        const shouldBeMuted = stem.muted || (hasSolo && !stem.solo);

        if (shouldBeMuted) {
            finalVolume = 0;
        }

        // Detect iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        if (isIOS) {
            // On iOS, use muted for volume changes
            stem.audio.muted = shouldBeMuted || finalVolume === 0;
            // Store volume for reference
            stem.lastVolume = finalVolume;
        } else {
            // On other platforms, use volume normally
            stem.audio.volume = Math.max(0, Math.min(1, finalVolume));
            stem.audio.muted = shouldBeMuted;
        }

        // Log for debug
        this.mixer.log(`Audio updated - ${name}: volume=${finalVolume}, muted=${stem.audio.muted}, solo=${stem.solo}, isIOS=${isIOS}`);
    }
    
    /**
     * Set master volume
     * @param {number} volume - Master volume (0-1)
     */
    setMasterVolume(volume) {
        this.masterVolume = volume;

        // Update all stems
        Object.keys(this.audioElements).forEach(name => {
            this.updateStemAudio(name);
        });
    }

    /**
     * Start time update
     */
    startTimeUpdate() {
        this.stopTimeUpdate(); // Stop old timer if it exists

        const updateLoop = () => {
            this.updateTime();
            this.animationFrameId = requestAnimationFrame(updateLoop);
        };

        this.animationFrameId = requestAnimationFrame(updateLoop);
    }

    /**
     * Update time and playhead
     */
    updateTime() {
        // Get time from first available stem
        const firstStem = Object.values(this.audioElements)[0];
        if (firstStem && firstStem.audio && !firstStem.audio.paused) {
            const currentTime = firstStem.audio.currentTime;
            this.mixer.currentTime = currentTime;

            // Update playhead
            if (this.mixer.timeline && this.mixer.timeline.updatePlayhead) {
                this.mixer.timeline.updatePlayhead(currentTime);
            }

            // Update waveforms
            if (this.mixer.waveforms) {
                Object.values(this.mixer.waveforms).forEach(waveform => {
                    if (waveform.updatePlayhead) {
                        waveform.updatePlayhead(currentTime);
                    }
                });
            }

            // Update chord display
            if (this.mixer.chordDisplay) {
                this.mixer.chordDisplay.sync(currentTime);
            }

            // Update structure display
            if (this.mixer.structureDisplay) {
                this.mixer.structureDisplay.sync(currentTime);
            }

            // Update karaoke display
            if (this.mixer.karaokeDisplay) {
                this.mixer.karaokeDisplay.sync(currentTime);
            }
        }
    }
    
    /**
     * Stop time update
     */
    stopTimeUpdate() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Get audio spectrum data (not supported on mobile)
     * @returns {Uint8Array} Empty data
     */
    getSpectrumData() {
        // Return empty data because spectrum analysis
        // is not available with HTML5 Audio
        return new Uint8Array(256);
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.stopTimeUpdate();

        Object.values(this.audioElements).forEach(stem => {
            stem.audio.pause();
            stem.audio.src = '';
        });

        this.audioElements = {};
        this.mixer.log('Mobile audio engine cleaned up');
    }
}
