/**
 * StemTubes Mixer - Advanced Audio Controls
 * Independent time-stretching and pitch-shifting controls using SoundTouch
 */

class AdvancedAudioControls {
    /**
     * Constructor for advanced audio controls
     * @param {StemMixer} mixer - Main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
        
        // Current states
        this.masterTempo = 1.0;      // Global tempo (0.5 - 2.0)
        this.stemPitches = new Map(); // Per-stem pitch adjustments (-12 to +12 semitones)
        
        // Control limits
        this.minTempo = 0.5;
        this.maxTempo = 2.0;
        this.tempoStep = 0.05;       // 5% steps
        this.minPitch = -12;
        this.maxPitch = 12;
        this.pitchStep = 1;          // 1 semitone steps
        
        // UI Elements
        this.elements = {
            // Global tempo controls
            tempoValue: document.getElementById('tempo-value'),
            tempoSlider: document.getElementById('tempo-slider'),
            tempoDown: document.getElementById('tempo-down'),
            tempoUp: document.getElementById('tempo-up'),
            tempoReset: document.getElementById('tempo-reset'),
            
            // Global pitch controls (removed - now per-stem only)
            // Individual stem pitch controls will be added dynamically
            
            // Quality settings
            qualitySelect: document.getElementById('quality-select'),
            
            // Status display
            statusDisplay: document.getElementById('processing-status')
        };
        
        this.initializeControls();
        this.mixer.log('Advanced audio controls initialized');
    }
    
    /**
     * Initialize controls and event listeners
     */
    initializeControls() {
        // Initialize tempo controls
        this.initializeTempoControls();
        
        // Update displays
        this.updateAllDisplays();
        
        // Initialize quality settings
        this.initializeQualityControls();
        
        this.mixer.log('Advanced controls initialized');
    }
    
    /**
     * Initialize tempo controls
     */
    initializeTempoControls() {
        // Tempo slider
        if (this.elements.tempoSlider) {
            this.elements.tempoSlider.min = this.minTempo;
            this.elements.tempoSlider.max = this.maxTempo;
            this.elements.tempoSlider.step = this.tempoStep;
            this.elements.tempoSlider.value = this.masterTempo;
            
            this.elements.tempoSlider.addEventListener('input', (e) => {
                this.setMasterTempo(parseFloat(e.target.value));
            });
        }
        
        // Tempo buttons
        if (this.elements.tempoUp) {
            this.elements.tempoUp.addEventListener('click', () => {
                this.adjustMasterTempo(this.tempoStep);
            });
        }
        
        if (this.elements.tempoDown) {
            this.elements.tempoDown.addEventListener('click', () => {
                this.adjustMasterTempo(-this.tempoStep);
            });
        }
        
        if (this.elements.tempoReset) {
            this.elements.tempoReset.addEventListener('click', () => {
                this.resetMasterTempo();
            });
        }
    }
    
    /**
     * Initialize quality controls
     */
    initializeQualityControls() {
        if (this.elements.qualitySelect) {
            this.elements.qualitySelect.addEventListener('change', (e) => {
                this.setProcessingQuality(e.target.value);
            });
        }
    }
    
    /**
     * Create pitch controls for a specific stem
     * @param {string} stemName - Name of the stem
     */
    createStemPitchControls(stemName) {
        // Initialize pitch for this stem
        this.stemPitches.set(stemName, 0);
        
        // Find the track element
        const trackElement = document.querySelector(`.track[data-stem="${stemName}"]`);
        if (!trackElement) {
            this.mixer.log(`Track element not found for stem: ${stemName}`);
            return;
        }
        
        // Create pitch control section
        const pitchControlDiv = document.createElement('div');
        pitchControlDiv.className = 'stem-pitch-control';
        pitchControlDiv.innerHTML = `
            <div class="control-label">
                <span>Pitch:</span>
                <span class="control-value pitch-value" id="pitch-value-${stemName}">0</span>
            </div>
            <div class="pitch-control-buttons">
                <button class="control-btn pitch-down" data-stem="${stemName}" title="Pitch -1 semitone">
                    <i class="fas fa-minus"></i>
                </button>
                <button class="control-btn pitch-reset" data-stem="${stemName}" title="Reset pitch">
                    <i class="fas fa-undo"></i>
                </button>
                <button class="control-btn pitch-up" data-stem="${stemName}" title="Pitch +1 semitone">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
            <input type="range" class="stem-pitch-slider" 
                   id="pitch-slider-${stemName}"
                   min="${this.minPitch}" 
                   max="${this.maxPitch}" 
                   step="${this.pitchStep}" 
                   value="0"
                   data-stem="${stemName}">
        `;
        
        // Insert pitch controls into track header
        const trackHeader = trackElement.querySelector('.track-header');
        if (trackHeader) {
            trackHeader.appendChild(pitchControlDiv);
        }
        
        // Add event listeners
        this.addStemPitchEventListeners(stemName);
        
        this.mixer.log(`Pitch controls created for stem: ${stemName}`);
    }
    
    /**
     * Add event listeners for stem pitch controls
     * @param {string} stemName - Name of the stem
     */
    addStemPitchEventListeners(stemName) {
        // Pitch slider
        const slider = document.getElementById(`pitch-slider-${stemName}`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                this.setStemPitch(stemName, parseInt(e.target.value));
            });
        }
        
        // Pitch buttons
        const pitchUp = document.querySelector(`.pitch-up[data-stem="${stemName}"]`);
        const pitchDown = document.querySelector(`.pitch-down[data-stem="${stemName}"]`);
        const pitchReset = document.querySelector(`.pitch-reset[data-stem="${stemName}"]`);
        
        if (pitchUp) {
            pitchUp.addEventListener('click', () => {
                this.adjustStemPitch(stemName, this.pitchStep);
            });
        }
        
        if (pitchDown) {
            pitchDown.addEventListener('click', () => {
                this.adjustStemPitch(stemName, -this.pitchStep);
            });
        }
        
        if (pitchReset) {
            pitchReset.addEventListener('click', () => {
                this.resetStemPitch(stemName);
            });
        }
    }
    
    /**
     * Set master tempo for all stems
     * @param {number} tempo - Tempo ratio (0.5 - 2.0)
     */
    setMasterTempo(tempo) {
        const clampedTempo = Math.max(this.minTempo, Math.min(this.maxTempo, tempo));
        
        if (Math.abs(clampedTempo - this.masterTempo) < 0.001) return;
        
        this.masterTempo = clampedTempo;
        
        // Update audio engine
        if (this.mixer.audioEngine && this.mixer.audioEngine.setMasterTempo) {
            this.mixer.audioEngine.setMasterTempo(clampedTempo);
        }
        
        // Update UI
        this.updateTempoDisplay();
        
        // Save state
        this.saveState();
        
        this.mixer.log(`Master tempo set to: ${clampedTempo.toFixed(2)}`);
    }
    
    /**
     * Adjust master tempo by a delta
     * @param {number} delta - Tempo adjustment
     */
    adjustMasterTempo(delta) {
        this.setMasterTempo(this.masterTempo + delta);
    }
    
    /**
     * Reset master tempo to 1.0
     */
    resetMasterTempo() {
        this.setMasterTempo(1.0);
    }
    
    /**
     * Set pitch for a specific stem
     * @param {string} stemName - Name of the stem
     * @param {number} semitones - Pitch in semitones (-12 to +12)
     */
    setStemPitch(stemName, semitones) {
        const clampedPitch = Math.max(this.minPitch, Math.min(this.maxPitch, semitones));
        
        const currentPitch = this.stemPitches.get(stemName) || 0;
        if (clampedPitch === currentPitch) return;
        
        this.stemPitches.set(stemName, clampedPitch);
        
        // Update audio engine
        if (this.mixer.audioEngine && this.mixer.audioEngine.setStemPitch) {
            this.mixer.audioEngine.setStemPitch(stemName, clampedPitch);
        }
        
        // Update UI
        this.updateStemPitchDisplay(stemName);
        
        // Save state
        this.saveState();
        
        this.mixer.log(`Stem ${stemName} pitch set to: ${clampedPitch} semitones`);
    }
    
    /**
     * Adjust pitch for a specific stem
     * @param {string} stemName - Name of the stem
     * @param {number} delta - Pitch adjustment in semitones
     */
    adjustStemPitch(stemName, delta) {
        const currentPitch = this.stemPitches.get(stemName) || 0;
        this.setStemPitch(stemName, currentPitch + delta);
    }
    
    /**
     * Reset pitch for a specific stem
     * @param {string} stemName - Name of the stem
     */
    resetStemPitch(stemName) {
        this.setStemPitch(stemName, 0);
    }
    
    /**
     * Set processing quality
     * @param {string} quality - Quality setting ('normal', 'high', 'ultra')
     */
    setProcessingQuality(quality) {
        // Quality settings would affect SoundTouch parameters
        const qualitySettings = {
            'normal': { overlap: 8, seekWindow: 28, sequence: 82 },
            'high': { overlap: 12, seekWindow: 32, sequence: 92 },
            'ultra': { overlap: 16, seekWindow: 36, sequence: 102 }
        };
        
        const settings = qualitySettings[quality] || qualitySettings['normal'];
        
        // Apply settings to audio engine
        if (this.mixer.audioEngine && this.mixer.audioEngine.setQuality) {
            this.mixer.audioEngine.setQuality(settings);
        }
        
        this.mixer.log(`Processing quality set to: ${quality}`);
    }
    
    /**
     * Update tempo display
     */
    updateTempoDisplay() {
        if (this.elements.tempoValue) {
            this.elements.tempoValue.textContent = `${(this.masterTempo * 100).toFixed(0)}%`;
        }
        
        if (this.elements.tempoSlider) {
            this.elements.tempoSlider.value = this.masterTempo;
        }
    }
    
    /**
     * Update pitch display for a specific stem
     * @param {string} stemName - Name of the stem
     */
    updateStemPitchDisplay(stemName) {
        const pitch = this.stemPitches.get(stemName) || 0;
        
        // Update value display
        const valueElement = document.getElementById(`pitch-value-${stemName}`);
        if (valueElement) {
            const sign = pitch > 0 ? '+' : '';
            valueElement.textContent = `${sign}${pitch}`;
        }
        
        // Update slider
        const sliderElement = document.getElementById(`pitch-slider-${stemName}`);
        if (sliderElement) {
            sliderElement.value = pitch;
        }
    }
    
    /**
     * Update all displays
     */
    updateAllDisplays() {
        this.updateTempoDisplay();
        
        // Update all stem pitch displays
        this.stemPitches.forEach((pitch, stemName) => {
            this.updateStemPitchDisplay(stemName);
        });
    }
    
    /**
     * Get current state for persistence
     */
    getState() {
        return {
            masterTempo: this.masterTempo,
            stemPitches: Object.fromEntries(this.stemPitches)
        };
    }
    
    /**
     * Restore state from persistence
     * @param {Object} state - Saved state
     */
    restoreState(state) {
        if (!state) return;
        
        // Restore master tempo
        if (typeof state.masterTempo === 'number') {
            this.setMasterTempo(state.masterTempo);
        }
        
        // Restore stem pitches
        if (state.stemPitches && typeof state.stemPitches === 'object') {
            Object.entries(state.stemPitches).forEach(([stemName, pitch]) => {
                if (typeof pitch === 'number') {
                    this.setStemPitch(stemName, pitch);
                }
            });
        }
        
        this.updateAllDisplays();
        this.mixer.log('Advanced controls state restored');
    }
    
    /**
     * Save current state
     */
    saveState() {
        if (this.mixer.persistence) {
            this.mixer.persistence.saveState();
        }
    }
    
    /**
     * Initialize controls for a new stem
     * @param {string} stemName - Name of the stem
     */
    initializeStem(stemName) {
        this.createStemPitchControls(stemName);
        this.updateStemPitchDisplay(stemName);
    }
    
    /**
     * Remove controls for a stem
     * @param {string} stemName - Name of the stem
     */
    removeStem(stemName) {
        this.stemPitches.delete(stemName);
        
        // Remove UI elements
        const pitchControl = document.querySelector(`.stem-pitch-control[data-stem="${stemName}"]`);
        if (pitchControl) {
            pitchControl.remove();
        }
    }
    
    /**
     * Reset all controls to default values
     */
    resetAll() {
        this.resetMasterTempo();
        
        // Reset all stem pitches
        this.stemPitches.forEach((pitch, stemName) => {
            this.resetStemPitch(stemName);
        });
        
        this.mixer.log('All advanced controls reset');
    }
    
    /**
     * Check if advanced controls are supported
     */
    static isSupported() {
        return SoundTouchEngine.isSupported();
    }
}