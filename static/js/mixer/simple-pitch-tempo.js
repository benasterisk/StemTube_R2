/**
 * Simple BPM & Pitch Controls for StemTube Mixer
 * Intégration simple des contrôles +/- BPM et Key dans la barre de transport
 */

class SimplePitchTempoController {
    constructor() {
        this.originalBPM = 120;
        this.currentBPM = 120;
        this.originalKey = 'C';
        this.currentKey = 'C';
        this.currentPitchShift = 0; // En semitones

        this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        this.audioContext = null;
        this.stemNodes = {};
        this.workletLoaded = false;

        // Cache for SoundTouch parameters (used when stems are created during playback)
        this.cachedTempoRatio = 1.0;
        this.cachedPitchRatio = 1.0;
        this.cachedPlaybackRate = 1.0;
        this.cachedSyncRatio = 1.0; // Effective tempo vs real-time (used for transports/lyrics)

        this.init();
    }
    
    async init() {
        console.log('[SimplePitchTempo] Initializing...');

        // Setup event listeners FIRST (before audio context)
        this.setupEventListeners();
        this.updateDisplay();

        // Listen for audio context ready event (ALWAYS attach the listener)
        window.addEventListener('audioContextReady', async () => {
            console.log('[SimplePitchTempo] audioContextReady event received');
            this.audioContext = window.audioContext;
            await this.loadSoundTouchWorklet();
        });

        // Also check if audio context already exists
        if (window.audioContext) {
            console.log('[SimplePitchTempo] AudioContext already exists, loading worklet now');
            this.audioContext = window.audioContext;
            await this.loadSoundTouchWorklet();
        } else {
            console.log('[SimplePitchTempo] Waiting for audioContextReady event...');
        }

        console.log('[SimplePitchTempo] Initialization complete - Event listeners attached');
    }
    
    async loadSoundTouchWorklet() {
        try {
            console.log('[SimplePitchTempo] Loading SoundTouch AudioWorklet...');
            console.log('[SimplePitchTempo] AudioContext state:', this.audioContext.state);
            console.log('[SimplePitchTempo] AudioContext sampleRate:', this.audioContext.sampleRate);
            console.log('[SimplePitchTempo] AudioContext type:', this.audioContext.constructor.name);
            console.log('[SimplePitchTempo] Window location:', window.location.href);
            console.log('[SimplePitchTempo] Is secure context:', window.isSecureContext);

            // Check if AudioWorklet API is available
            if (!this.audioContext.audioWorklet) {
                console.warn('[SimplePitchTempo] ⚠ AudioWorklet API not available in this browser/context');
                console.warn('[SimplePitchTempo] → Possible reasons:');
                console.warn('[SimplePitchTempo]   1. Non-secure context (not HTTPS or localhost)');
                console.warn('[SimplePitchTempo]   2. Browser security policy changed');
                console.warn('[SimplePitchTempo]   3. Browser version too old');
                console.warn('[SimplePitchTempo] → SoundTouch tempo/pitch control will not be available');
                console.warn('[SimplePitchTempo] → Falling back to basic playback');
                console.warn('[SimplePitchTempo] → Current URL:', window.location.href);
                console.warn('[SimplePitchTempo] → Secure context:', window.isSecureContext);
                this.workletLoaded = false;

                // Show visual warning to user if not secure context
                if (!window.isSecureContext) {
                    this.showHTTPSWarning();
                }

                return;
            }

            console.log('[SimplePitchTempo] AudioWorklet API detected, loading module...');
            await this.audioContext.audioWorklet.addModule('/static/wasm/soundtouch-worklet.js');

            this.workletLoaded = true;
            console.log('[SimplePitchTempo] ✓ SoundTouch AudioWorklet loaded successfully');
        } catch (error) {
            console.error('[SimplePitchTempo] ✗ Failed to load SoundTouch AudioWorklet:');
            console.error('[SimplePitchTempo] Error type:', error.constructor.name);
            console.error('[SimplePitchTempo] Error message:', error.message);
            console.error('[SimplePitchTempo] Error stack:', error.stack);
            console.error('[SimplePitchTempo] Full error object:', error);
            console.warn('[SimplePitchTempo] → Falling back to basic playback (no tempo/pitch control)');
            this.workletLoaded = false;

            // Show visual warning to user if not secure context
            if (!window.isSecureContext) {
                this.showHTTPSWarning();
            }
        }
    }

    /**
     * Display visual warning about HTTPS requirement
     */
    showHTTPSWarning() {
        // Check if warning already displayed
        if (document.getElementById('https-warning-banner')) {
            return;
        }

        // Create warning banner
        const banner = document.createElement('div');
        banner.id = 'https-warning-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
            color: white;
            padding: 12px 20px;
            text-align: center;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideDown 0.3s ease-out;
        `;

        banner.innerHTML = `
            <div style="max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 20px;">⚠️</span>
                <strong>HTTPS Required:</strong>
                <span>Time-stretch and pitch-shift features are disabled (non-secure connection).</span>
                <span style="opacity: 0.9;">→ Use HTTPS or localhost to enable independent tempo/pitch control.</span>
                <a href="https://github.com/Benasterisk/StemTube_R2/blob/main/HTTPS_REQUIREMENT.md"
                   target="_blank"
                   style="color: white; text-decoration: underline; font-weight: 600; margin-left: 10px;">
                    Learn More
                </a>
                <button id="close-https-warning"
                        style="background: rgba(255,255,255,0.2); border: 1px solid white; color: white;
                               padding: 4px 12px; border-radius: 4px; cursor: pointer; margin-left: 10px;
                               font-weight: 600; transition: background 0.2s;">
                    ✕ Dismiss
                </button>
            </div>
        `;

        // Add animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    transform: translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            #close-https-warning:hover {
                background: rgba(255,255,255,0.3) !important;
            }
        `;
        document.head.appendChild(style);

        // Insert banner at top of page
        document.body.insertBefore(banner, document.body.firstChild);

        // Add close button handler
        const closeBtn = document.getElementById('close-https-warning');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                banner.style.animation = 'slideDown 0.3s ease-out reverse';
                setTimeout(() => banner.remove(), 300);
            });
        }

        console.log('[SimplePitchTempo] ⚠️ HTTPS warning banner displayed to user');
    }
    
    setupEventListeners() {
        console.log('[SimplePitchTempo] Setting up event listeners...');

        // Contrôles BPM
        const bpmUpBtn = document.getElementById('bpm-up');
        const bpmDownBtn = document.getElementById('bpm-down');
        const bpmResetBtn = document.getElementById('bpm-reset');

        if (bpmUpBtn) {
            bpmUpBtn.addEventListener('click', () => {
                console.log('[SimplePitchTempo] BPM+ button clicked');
                this.adjustBPM(1);
            });
            console.log('[SimplePitchTempo] ✓ BPM+ button listener attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ BPM+ button not found!');
        }

        if (bpmDownBtn) {
            bpmDownBtn.addEventListener('click', () => {
                console.log('[SimplePitchTempo] BPM- button clicked');
                this.adjustBPM(-1);
            });
            console.log('[SimplePitchTempo] ✓ BPM- button listener attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ BPM- button not found!');
        }

        if (bpmResetBtn) {
            bpmResetBtn.addEventListener('click', () => {
                console.log('[SimplePitchTempo] BPM Reset button clicked');
                this.resetBPM();
            });
            console.log('[SimplePitchTempo] ✓ BPM Reset button listener attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ BPM Reset button not found!');
        }

        const bpmInput = document.getElementById('current-bpm');
        if (bpmInput) {
            const commitBpmInput = () => {
                const parsedValue = parseFloat(bpmInput.value);
                if (Number.isFinite(parsedValue)) {
                    this.setBPM(parsedValue);
                } else {
                    this.updateDisplay(); // revert to last valid value
                }
            };

            bpmInput.addEventListener('change', () => {
                console.log('[SimplePitchTempo] BPM input change detected');
                commitBpmInput();
            });

            bpmInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitBpmInput();
                    bpmInput.blur();
                }
            });

            bpmInput.addEventListener('focus', () => bpmInput.select());

            console.log('[SimplePitchTempo] ✓ BPM input listeners attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ BPM input field not found!');
        }

        // Contrôles Key
        const keyUpBtn = document.getElementById('key-up');
        const keyDownBtn = document.getElementById('key-down');
        const keyResetBtn = document.getElementById('key-reset');

        if (keyUpBtn) {
            keyUpBtn.addEventListener('click', () => {
                console.log('[SimplePitchTempo] Key+ button clicked');
                this.adjustKey(1);
            });
            console.log('[SimplePitchTempo] ✓ Key+ button listener attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ Key+ button not found!');
        }

        if (keyDownBtn) {
            keyDownBtn.addEventListener('click', () => {
                console.log('[SimplePitchTempo] Key- button clicked');
                this.adjustKey(-1);
            });
            console.log('[SimplePitchTempo] ✓ Key- button listener attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ Key- button not found!');
        }

        if (keyResetBtn) {
            keyResetBtn.addEventListener('click', () => {
                console.log('[SimplePitchTempo] Key Reset button clicked');
                this.resetKey();
            });
            console.log('[SimplePitchTempo] ✓ Key Reset button listener attached');
        } else {
            console.warn('[SimplePitchTempo] ✗ Key Reset button not found!');
        }

        // Listen for mixer events
        window.addEventListener('stemLoaded', (event) => {
            console.log('[SimplePitchTempo] Stem loaded:', event.detail);
            this.updateAnalysisFromData(event.detail);
        });

        window.addEventListener('playbackStarted', () => {
            console.log('[SimplePitchTempo] Playback started, applying effects...');
            this.applyEffectsToStems();
        });

        console.log('[SimplePitchTempo] Event listeners setup complete');
    }
    
    updateAnalysisFromData(data) {
        console.log('[SimplePitchTempo] Received analysis data:', data);
        
        // Get les données d'analyse BPM/Key si disponibles
        if (data.detected_bpm && data.detected_bpm !== 120) {
            this.originalBPM = data.detected_bpm;
            this.currentBPM = data.detected_bpm;
            console.log(`[SimplePitchTempo] BPM détecté mis à jour: ${this.originalBPM}`);
        }
        
        if (data.detected_key && data.detected_key !== 'C major') {
            // Extraire la note principale (avant le space pour major/minor)
            const keyParts = data.detected_key.split(' ');
            if (keyParts[0] && this.noteNames.includes(keyParts[0])) {
                this.originalKey = keyParts[0];
                this.currentKey = keyParts[0];
                console.log(`[SimplePitchTempo] Tonalité détectée mise à jour: ${this.originalKey}`);
            }
        }
        
        console.log(`[SimplePitchTempo] Final values - BPM: ${this.currentBPM}, Key: ${this.currentKey}`);
        this.updateDisplay();
    }
    
    adjustBPM(delta) {
        // Calculate what the new BPM would be
        const targetBPM = this.currentBPM + delta;

        // Apply smart limits based on original BPM to prevent artifacts
        const maxSafeBPM = Math.min(300, this.originalBPM * 2.0);  // Max 2x increase
        const minSafeBPM = Math.max(50, this.originalBPM * 0.5);   // Min 0.5x decrease

        const newBPM = Math.max(minSafeBPM, Math.min(maxSafeBPM, targetBPM));

        if (newBPM === this.currentBPM) {
            // Check if we hit a limit and warn user
            if (targetBPM > maxSafeBPM) {
                console.warn(`[SimplePitchTempo] BPM limited to ${maxSafeBPM} to prevent artifacts (attempted ${targetBPM})`);
            } else if (targetBPM < minSafeBPM) {
                console.warn(`[SimplePitchTempo] BPM limited to ${minSafeBPM} to prevent artifacts (attempted ${targetBPM})`);
            }
            return;
        }

        // Calculate tempo ratio to check for artifacts threshold
        const tempoRatio = newBPM / this.originalBPM;

        // Warn user about potential artifacts at high tempo increases
        if (tempoRatio > 1.5) {
            console.warn(`[SimplePitchTempo] High tempo ratio ${tempoRatio.toFixed(2)}x may cause artifacts`);
        }

        console.log(`[SimplePitchTempo] BPM: ${this.currentBPM} → ${newBPM} (ratio: ${tempoRatio.toFixed(2)}x)`);
        this.currentBPM = newBPM;

        this.applyEffectsToStems();
        this.updateDisplay();

        // Update chord display with new BPM
        this.updateChordDisplayBPM();

        // Update lyrics display with new tempo ratio
        this.updateLyricsDisplayTempo();
    }
    
    adjustKey(delta) {
        const currentIndex = this.noteNames.indexOf(this.currentKey);
        if (currentIndex === -1) return;
        
        let newIndex = (currentIndex + delta) % 12;
        if (newIndex < 0) newIndex += 12;
        
        const oldKey = this.currentKey;
        this.currentKey = this.noteNames[newIndex];
        
        // Calculer le shift en semitones
        this.currentPitchShift = (newIndex - this.noteNames.indexOf(this.originalKey)) % 12;
        if (this.currentPitchShift > 6) this.currentPitchShift -= 12;
        if (this.currentPitchShift < -6) this.currentPitchShift += 12;
        
        console.log(`[SimplePitchTempo] Key: ${oldKey} → ${this.currentKey} (${this.currentPitchShift >= 0 ? '+' : ''}${this.currentPitchShift} semitones)`);

        this.applyEffectsToStems();
        this.updateDisplay();

        // Update chord display with pitch shift
        this.updateChordDisplayPitch();
    }
    
    async applyEffectsToStems() {
        if (!this.audioContext || !this.workletLoaded) {
            console.warn('[SimplePitchTempo] Cannot apply effects: AudioContext or SoundTouch not ready');
            return;
        }

        const tempoRatio = this.currentBPM / this.originalBPM;
        const pitchRatio = Math.pow(2, this.currentPitchShift / 12);

        // Apply smart limits to reduce artifacts
        const safeTempoRatio = this.applySafeLimits(tempoRatio);
        const safePitchRatio = this.applySafeLimits(pitchRatio);

        // Warn if we had to limit the values
        if (Math.abs(safeTempoRatio - tempoRatio) > 0.01) {
            console.warn(`[SimplePitchTempo] Tempo limited from ${tempoRatio.toFixed(3)} to ${safeTempoRatio.toFixed(3)} to reduce artifacts`);
        }
        if (Math.abs(safePitchRatio - pitchRatio) > 0.01) {
            console.warn(`[SimplePitchTempo] Pitch limited from ${pitchRatio.toFixed(3)} to ${safePitchRatio.toFixed(3)} to reduce artifacts`);
        }

        const isAcceleration = safeTempoRatio > 1.0 + 0.001;
        const playbackRate = isAcceleration ? safeTempoRatio : 1.0;
        const soundTouchTempo = isAcceleration ? 1.0 : safeTempoRatio;
        let soundTouchPitch = safePitchRatio / playbackRate;
        soundTouchPitch = Math.max(0.25, Math.min(4.0, soundTouchPitch));
        const syncRatio = isAcceleration ? playbackRate : soundTouchTempo;

        console.log(`[SimplePitchTempo] Applying effects - tempo=${safeTempoRatio.toFixed(3)} (${isAcceleration ? 'hybrid accel' : 'stretch'}), playbackRate=${playbackRate.toFixed(3)}, SoundTouch tempo=${soundTouchTempo.toFixed(3)}, SoundTouch pitch=${soundTouchPitch.toFixed(3)}`);

        // Cache the parameters for when stems are created
        this.cachedTempoRatio = soundTouchTempo;
        this.cachedPitchRatio = soundTouchPitch;
        this.cachedPlaybackRate = playbackRate;
        this.cachedSyncRatio = syncRatio;

        // Accéder aux stems du mixer principal si disponible
        if (window.mixer && window.mixer.stems) {
            let updatedCount = 0;
            for (const [stemName, stemData] of Object.entries(window.mixer.stems)) {
                if (stemData.source) {
                    try {
                        stemData.source.playbackRate.setValueAtTime(playbackRate, this.audioContext.currentTime);
                    } catch (playbackError) {
                        console.warn(`[SimplePitchTempo] ✗ Failed to set playbackRate for ${stemName}:`, playbackError);
                    }
                }

                if (stemData.soundTouchNode) {
                    try {
                        stemData.soundTouchNode.parameters.get('tempo').value = soundTouchTempo;
                        stemData.soundTouchNode.parameters.get('pitch').value = soundTouchPitch;
                        stemData.soundTouchNode.parameters.get('rate').value = 1.0;
                        updatedCount++;
                        console.log(`[SimplePitchTempo] ✓ Updated ${stemName}: tempo=${soundTouchTempo.toFixed(3)}, pitch=${soundTouchPitch.toFixed(3)}, playbackRate=${playbackRate.toFixed(3)}`);
                    } catch (error) {
                        console.warn(`[SimplePitchTempo] ✗ Failed to update ${stemName}:`, error);
                    }
                }
            }

            if (updatedCount === 0) {
                console.log('[SimplePitchTempo] No active soundTouch nodes found - parameters cached for next playback');
            } else {
                console.log(`[SimplePitchTempo] Updated ${updatedCount} stem(s) with new parameters`);
            }
        } else {
            console.log('[SimplePitchTempo] Mixer not ready - parameters cached for when stems are created');
        }

        // Exposer l'instance globalement pour l'audio-engine
        window.mixer = window.mixer || {};
        window.mixer.stems = window.mixer.stems || {};
    }
    
    /**
     * Apply safe limits to prevent severe artifacts
     * Higher ratios (especially tempo increases) cause more artifacts
     */
    applySafeLimits(ratio) {
        // More conservative limits for tempo increases to reduce artifacts
        const minRatio = 0.5;  // 50% minimum (less artifacts when slowing down)
        const maxRatio = 2.0;  // 200% maximum (reduce from 4.0x to prevent artifacts)
        
        // Apply gradual quality degradation warnings
        if (ratio > 1.8) {
            console.warn(`[SimplePitchTempo] Ratio ${ratio.toFixed(2)}x approaching quality limits`);
        }
        
        return Math.max(minRatio, Math.min(maxRatio, ratio));
    }
    
    updateDisplay() {
        console.log(`[SimplePitchTempo] Updating display - BPM: ${this.currentBPM}, Key: ${this.currentKey}`);

        // Update l'affichage BPM
        const bpmDisplay = document.getElementById('current-bpm');
        if (bpmDisplay) {
            if (bpmDisplay.tagName === 'INPUT') {
                bpmDisplay.value = this.currentBPM.toString();
            } else {
                bpmDisplay.textContent = this.currentBPM.toString();
            }
            console.log(`[SimplePitchTempo] ✓ BPM display updated to ${this.currentBPM}`);
        } else {
            console.warn('[SimplePitchTempo] ✗ BPM display element not found');
        }

        // Update l'affichage Key
        const keyDisplay = document.getElementById('current-key');
        if (keyDisplay) {
            keyDisplay.textContent = this.currentKey;
            console.log(`[SimplePitchTempo] ✓ Key display updated to ${this.currentKey}`);
        } else {
            console.warn('[SimplePitchTempo] ✗ Key display element not found');
        }

        // Calculate smart limits based on original BPM
        const maxSafeBPM = Math.min(300, this.originalBPM * 2.0);
        const minSafeBPM = Math.max(50, this.originalBPM * 0.5);

        // Activer/désactiver les buttons selon les limites intelligentes
        const bpmUpBtn = document.getElementById('bpm-up');
        const bpmDownBtn = document.getElementById('bpm-down');

        if (bpmUpBtn) {
            const shouldDisable = this.currentBPM >= maxSafeBPM;
            bpmUpBtn.disabled = shouldDisable;
            console.log(`[SimplePitchTempo] BPM+ button: ${shouldDisable ? 'DISABLED' : 'ENABLED'} (${this.currentBPM}/${maxSafeBPM})`);

            // Add visual feedback for limits
            if (this.currentBPM >= maxSafeBPM) {
                bpmUpBtn.title = `Maximum safe BPM (${maxSafeBPM}) reached to prevent artifacts`;
            } else if (this.currentBPM >= this.originalBPM * 1.5) {
                bpmUpBtn.title = 'Warning: High tempo ratios may cause artifacts';
            } else {
                bpmUpBtn.title = 'Increase BPM';
            }
        }

        if (bpmDownBtn) {
            const shouldDisable = this.currentBPM <= minSafeBPM;
            bpmDownBtn.disabled = shouldDisable;
            console.log(`[SimplePitchTempo] BPM- button: ${shouldDisable ? 'DISABLED' : 'ENABLED'} (${this.currentBPM}/${minSafeBPM})`);

            if (this.currentBPM <= minSafeBPM) {
                bpmDownBtn.title = `Minimum safe BPM (${minSafeBPM}) reached`;
            } else {
                bpmDownBtn.title = 'Decrease BPM';
            }
        }

        console.log('[SimplePitchTempo] Display update complete');
    }
    
    // Méthodes publiques pour intégration
    setBPM(bpm) {
        const numericBPM = parseFloat(bpm);
        if (!Number.isFinite(numericBPM)) {
            console.warn('[SimplePitchTempo] Ignoring invalid BPM input:', bpm);
            this.updateDisplay();
            return;
        }

        const clampedBPM = Math.max(50, Math.min(300, numericBPM));
        if (Math.abs(clampedBPM - this.currentBPM) < 0.001) {
            this.updateDisplay();
            return;
        }

        console.log(`[SimplePitchTempo] setBPM → ${this.currentBPM} to ${clampedBPM}`);
        this.currentBPM = clampedBPM;
        this.applyEffectsToStems();
        this.updateDisplay();
        this.updateChordDisplayBPM();
        this.updateLyricsDisplayTempo();
    }
    
    setKey(key) {
        if (this.noteNames.includes(key)) {
            this.currentKey = key;
            this.currentPitchShift = (this.noteNames.indexOf(key) - this.noteNames.indexOf(this.originalKey)) % 12;
            if (this.currentPitchShift > 6) this.currentPitchShift -= 12;
            if (this.currentPitchShift < -6) this.currentPitchShift += 12;

            this.applyEffectsToStems();
            this.updateDisplay();
        }
    }

    /**
     * Set pitch shift directly in semitones (-12 to +12)
     * @param {number} semitones - Number of semitones to shift
     */
    setPitchShift(semitones) {
        // Clamp to valid range
        const clampedShift = Math.max(-12, Math.min(12, semitones));

        if (clampedShift === this.currentPitchShift) return;

        console.log(`[SimplePitchTempo] setPitchShift → ${clampedShift} semitones`);

        this.currentPitchShift = clampedShift;

        // Update currentKey based on new pitch shift (for display purposes)
        const originalIdx = this.noteNames.indexOf(this.originalKey);
        let newIdx = (originalIdx + clampedShift) % 12;
        if (newIdx < 0) newIdx += 12;
        this.currentKey = this.noteNames[newIdx];

        this.applyEffectsToStems();
        this.updateDisplay();

        // Broadcast pitch change event
        this.updateChordDisplayPitch();
    }

    resetBPM() {
        console.log(`[SimplePitchTempo] Resetting BPM from ${this.currentBPM} to ${this.originalBPM}`);
        this.currentBPM = this.originalBPM;
        this.applyEffectsToStems();
        this.updateDisplay();

        // Update chord display with original BPM
        this.updateChordDisplayBPM();

        // Update lyrics display with original tempo ratio (1.0)
        this.updateLyricsDisplayTempo();
    }

    /**
     * Update chord display BPM when tempo changes
     */
    updateChordDisplayBPM() {
        if (window.chordDisplay) {
            window.chordDisplay.setBPM(this.currentBPM);
            console.log(`[SimplePitchTempo] Updated chord display BPM to ${this.currentBPM}`);
        }
    }
    
    /**
     * Update chord display pitch when key changes
     */
    updateChordDisplayPitch() {
        console.log(`[SimplePitchTempo] Broadcasting pitch shift change to ${this.currentPitchShift >= 0 ? '+' : ''}${this.currentPitchShift} semitones`);

        // Dispatch custom event for chord display and other components
        window.dispatchEvent(new CustomEvent('pitchShiftChanged', {
            detail: { pitchShift: this.currentPitchShift }
        }));
    }

    /**
     * Update lyrics display with tempo factor when tempo changes
     * IMPORTANT: Only emit event when using REAL timestretch (SoundTouch)
     * If SoundTouch is not available, BPM changes don't actually affect playback
     */
    updateLyricsDisplayTempo() {
        // Safety check: Only emit tempo change when SoundTouch is active
        if (!this.workletLoaded) {
            console.warn('[SimplePitchTempo] SoundTouch not loaded - tempo changes have no effect on playback, skipping lyrics sync');
            return;
        }

        const playbackRate = this.cachedPlaybackRate || (this.currentBPM / this.originalBPM);
        const soundTouchTempo = this.cachedTempoRatio || (this.currentBPM / this.originalBPM);
        const syncRatio = this.cachedSyncRatio || (this.currentBPM / this.originalBPM);
        const isAcceleration = playbackRate > 1.001;
        const lyricsRatio = syncRatio;

        console.log(`[SimplePitchTempo] Broadcasting tempo change → syncRatio=${lyricsRatio.toFixed(3)}x, playbackRate=${playbackRate.toFixed(3)}, soundTouchTempo=${soundTouchTempo.toFixed(3)}, mode=${isAcceleration ? 'hybrid-acceleration' : 'stretch'}`);

        // Dispatch custom event for karaoke display and other components
        window.dispatchEvent(new CustomEvent('tempoChanged', {
            detail: {
                tempoRatio: lyricsRatio,
                lyricsRatio: lyricsRatio,
                playbackRate: playbackRate,
                soundTouchTempo: soundTouchTempo,
                syncRatio: syncRatio,
                mode: isAcceleration ? 'hybrid-acceleration' : 'stretch',
                absoluteTime: true
            }
        }));
    }

    resetKey() {
        console.log(`[SimplePitchTempo] Resetting Key from ${this.currentKey} to ${this.originalKey}`);
        this.currentKey = this.originalKey;
        this.currentPitchShift = 0;
        this.applyEffectsToStems();
        this.updateDisplay();

        // Reset chord display pitch
        this.updateChordDisplayPitch();
    }
    
    reset() {
        console.log(`[SimplePitchTempo] Resetting both BPM and Key to original values`);
        this.currentBPM = this.originalBPM;
        this.currentKey = this.originalKey;
        this.currentPitchShift = 0;
        
        this.applyEffectsToStems();
        this.updateDisplay();
    }
}

// Initialize automatically when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('[SimplePitchTempo] DOM ready, initializing...');
    window.simplePitchTempo = new SimplePitchTempoController();
});

// Export for external use
window.SimplePitchTempoController = SimplePitchTempoController;
