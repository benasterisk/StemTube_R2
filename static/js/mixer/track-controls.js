/**
 * StemTubes Mixer - Track Controls
 * Track controls management (volume, pan, solo, mute)
 */

class TrackControls {
    /**
     * Track controls constructor
     * @param {StemMixer} mixer - Main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
    }
    
    /**
     * Create track element for a stem
     * @param {string} name - Stem name
     */
    createTrackElement(name) {
        // Ensure tracks container exists
        if (!this.mixer.elements.tracks) {
            this.mixer.log('Tracks container not found');
            return;
        }

        // Create track element
        const trackElement = document.createElement('div');
        trackElement.className = 'track';
        trackElement.dataset.stem = name;
        
        // Add mobile class if needed
        if (this.mixer.isMobile) {
            trackElement.classList.add('mobile-track');
        }

        // Format stem name for display
        const displayName = name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

        // Structure adapted for mobile and desktop
        const mobileLayout = this.mixer.isMobile ? `
            <div class="track-header mobile-header">
                <div class="track-title">
                    ${displayName} 
                    <span class="track-status active"></span>
                </div>
            </div>
            <div class="track-controls mobile-controls">
                <div class="button-group">
                    <button class="control-button solo-btn" data-stem="${name}" title="Solo">
                        <i class="fas fa-headphones"></i> Solo
                    </button>
                    <button class="control-button mute-btn" data-stem="${name}" title="Mute">
                        <i class="fas fa-volume-mute"></i> Mute
                    </button>
                </div>
                <div class="control-group">
                    <label class="control-label">
                        Volume: <span class="volume-value">100%</span>
                    </label>
                    <input type="range" class="volume-slider" data-stem="${name}" 
                           min="0" max="1" step="0.01" value="1" 
                           style="width: 100%; height: 35px;">
                </div>
                <div class="control-group">
                    <label class="control-label">
                        Pan: <span class="pan-value">0</span>
                    </label>
                    <input type="range" class="pan-knob" data-stem="${name}" 
                           min="-1" max="1" step="0.01" value="0"
                           style="width: 100%; height: 35px;">
                </div>
            </div>
            <div class="waveform-container">
                <div class="waveform"></div>
                <div class="track-playhead"></div>
            </div>
        ` : `
            <div class="track-header">
                <div class="track-title">
                    ${displayName} 
                    <span class="track-status active"></span>
                </div>
                <div class="track-buttons">
                    <button class="track-btn solo" title="Solo">S</button>
                    <button class="track-btn mute" title="Mute">M</button>
                </div>
                <div class="track-control">
                    <div class="track-control-label">
                        <span>Volume</span>
                        <span class="track-control-value volume-value">100%</span>
                    </div>
                    <input type="range" class="track-slider volume-slider" min="0" max="1" step="0.01" value="1">
                </div>
                <div class="track-control">
                    <div class="track-control-label">
                        <span>Pan</span>
                        <span class="track-control-value pan-value">0</span>
                    </div>
                    <input type="range" class="track-slider pan-knob" min="-1" max="1" step="0.01" value="0">
                </div>
            </div>
            <div class="waveform-container">
                <div class="waveform"></div>
                <div class="track-playhead"></div>
            </div>
        `;

        // Track element structure
        trackElement.innerHTML = mobileLayout;

        // Add track to container
        this.mixer.elements.tracks.appendChild(trackElement);

        // Setup event listeners for controls
        this.setupTrackEventListeners(name, trackElement);

        // Add mobile-specific event handlers
        if (this.mixer.isMobile) {
            this.addMobileTouchHandlers(trackElement, name);
        }

        this.mixer.log(`Track element created for ${name}`);
    }
    
    /**
     * Setup event listeners for track controls
     * @param {string} name - Stem name
     * @param {HTMLElement} trackElement - Track DOM element
     */
    setupTrackEventListeners(name, trackElement) {
        // Solo button
        const soloBtn = trackElement.querySelector('.solo');
        if (soloBtn) {
            soloBtn.addEventListener('click', () => {
                this.toggleSolo(name);
            });
        }
        
        // Mute button
        const muteBtn = trackElement.querySelector('.mute');
        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                this.toggleMute(name);
            });
        }

        // Volume slider
        const volumeSlider = trackElement.querySelector('.volume-slider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                this.updateVolume(name, parseFloat(e.target.value));
            });
        }

        // Pan slider
        const panSlider = trackElement.querySelector('.pan-knob');
        if (panSlider) {
            panSlider.addEventListener('input', (e) => {
                this.updatePan(name, parseFloat(e.target.value));
            });
        }
    }
    
    /**
     * Add touch handlers for mobile
     * @param {HTMLElement} trackElement - Track element
     * @param {string} name - Stem name
     */
    addMobileTouchHandlers(trackElement, name) {
        // Handlers for Solo/Mute buttons with touch feedback
        const soloBtn = trackElement.querySelector('.solo-btn');
        const muteBtn = trackElement.querySelector('.mute-btn');
        
        if (soloBtn) {
            // Touch feedback for Solo
            soloBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                soloBtn.style.transform = 'scale(0.95)';
                soloBtn.style.opacity = '0.8';
            }, { passive: false });
            
            soloBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                soloBtn.style.transform = '';
                soloBtn.style.opacity = '';
                this.toggleSolo(name);
            }, { passive: false });
        }
        
        if (muteBtn) {
            // Touch feedback for Mute
            muteBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                muteBtn.style.transform = 'scale(0.95)';
                muteBtn.style.opacity = '0.8';
            }, { passive: false });
            
            muteBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                muteBtn.style.transform = '';
                muteBtn.style.opacity = '';
                this.toggleMute(name);
            }, { passive: false });
        }
        
        // Improved handlers for sliders on mobile
        const volumeSlider = trackElement.querySelector('.volume-slider');
        const panSlider = trackElement.querySelector('.pan-knob');

        if (volumeSlider) {
            // Better touch precision for volume
            volumeSlider.addEventListener('touchstart', () => {
                volumeSlider.style.height = '40px'; // Temporarily increase size
            });
            
            volumeSlider.addEventListener('touchend', () => {
                setTimeout(() => {
                    volumeSlider.style.height = '35px';
                }, 200);
            });
        }
        
        if (panSlider) {
            // Better touch precision for pan
            panSlider.addEventListener('touchstart', () => {
                panSlider.style.height = '40px';
            });
            
            panSlider.addEventListener('touchend', () => {
                setTimeout(() => {
                    panSlider.style.height = '35px';
                }, 200);
            });
        }
    }
    
    /**
     * Toggle solo mode for a track
     * @param {string} name - Stem name
     */
    toggleSolo(name) {
        const stem = this.mixer.stems[name];
        if (!stem) return;

        // Toggle solo state
        stem.solo = !stem.solo;

        // Update button appearance
        const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
        if (trackElement) {
            const soloBtn = trackElement.querySelector('.solo');
            if (soloBtn) {
                if (stem.solo) {
                    soloBtn.classList.add('active');
                } else {
                    soloBtn.classList.remove('active');
                }
            }
        }
        
        // Update solo/mute states
        this.mixer.audioEngine.updateSoloMuteStates();

        this.mixer.log(`Solo ${stem.solo ? 'enabled' : 'disabled'} for ${name}`);
    }
    
    /**
     * Toggle mute mode for a track
     * @param {string} name - Stem name
     */
    toggleMute(name) {
        const stem = this.mixer.stems[name];
        if (!stem) return;

        // Toggle mute state
        stem.muted = !stem.muted;

        // Update button appearance
        const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
        if (trackElement) {
            const muteBtn = trackElement.querySelector('.mute');
            if (muteBtn) {
                if (stem.muted) {
                    muteBtn.classList.add('active');
                } else {
                    muteBtn.classList.remove('active');
                }
            }
        }
        
        // Update solo/mute states
        this.mixer.audioEngine.updateSoloMuteStates();

        this.mixer.log(`Mute ${stem.muted ? 'enabled' : 'disabled'} for ${name}`);
    }
    
    /**
     * Update track volume
     * @param {string} name - Stem name
     * @param {number} value - New volume value (0-1)
     */
    updateVolume(name, value) {
        const stem = this.mixer.stems[name];
        if (!stem) return;

        // Update volume value
        stem.volume = value;

        // Update gain if source is active
        if (stem.gainNode) {
            // Don't modify gain if muted
            if (!stem.muted) {
                stem.gainNode.gain.value = value;
            }
        }
        
        // Update value display
        const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
        if (trackElement) {
            const volumeValue = trackElement.querySelector('.volume-value');
            if (volumeValue) {
                volumeValue.textContent = `${Math.round(value * 100)}%`;
            }
        }

        this.mixer.log(`Volume updated for ${name}: ${Math.round(value * 100)}%`);
    }
    
    /**
     * Update track pan
     * @param {string} name - Stem name
     * @param {number} value - New pan value (-1 to 1)
     */
    updatePan(name, value) {
        const stem = this.mixer.stems[name];
        if (!stem) return;

        // Update pan value
        stem.pan = value;

        // Update pan if source is active
        if (stem.panNode) {
            stem.panNode.pan.value = value;
        }
        
        // Update value display
        const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
        if (trackElement) {
            const panValue = trackElement.querySelector('.pan-value');
            if (panValue) {
                // Format pan value
                let panText = 'C'; // Center by default
                
                if (value < -0.05) {
                    const leftPercent = Math.round(Math.abs(value) * 100);
                    panText = `${leftPercent}%L`;
                } else if (value > 0.05) {
                    const rightPercent = Math.round(value * 100);
                    panText = `${rightPercent}%R`;
                }
                
                panValue.textContent = panText;
            }
        }
        
        this.mixer.log(`Pan updated for ${name}: ${value}`);
    }
    
    /**
     * Update track status indicator
     * @param {string} name - Stem name
     * @param {boolean} active - Track active state
     */
    updateTrackStatus(name, active) {
        const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
        if (!trackElement) return;

        const statusIndicator = trackElement.querySelector('.track-status');
        if (statusIndicator) {
            if (active) {
                statusIndicator.classList.add('active');
                statusIndicator.classList.remove('inactive');
            } else {
                statusIndicator.classList.add('inactive');
                statusIndicator.classList.remove('active');
            }
        }

        // Update stem activity property
        if (this.mixer.stems[name]) {
            this.mixer.stems[name].active = active;
        }
    }
}
