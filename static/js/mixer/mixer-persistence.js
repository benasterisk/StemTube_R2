/**
 * StemTubes Mixer - State Persistence
 * State save and restore management for the mixer
 */

class MixerPersistence {
    constructor(mixer) {
        this.mixer = mixer;
        this.storageKey = 'stemtube_mixer_detailed_state';
        this.autoSaveInterval = 2000; // Auto-save every 2 seconds
        this.autoSaveTimer = null;

        // Bind methods
        this.saveState = this.saveState.bind(this);
        this.restoreState = this.restoreState.bind(this);
        this.autoSave = this.autoSave.bind(this);

        // Start auto-save
        this.startAutoSave();
    }

    /**
     * Save complete mixer state
     */
    saveState() {
        try {
            const state = {
                extractionId: this.mixer.extractionId,
                timestamp: Date.now(),
                playback: {
                    currentTime: this.mixer.currentTime,
                    isPlaying: this.mixer.isPlaying,
                    maxDuration: this.mixer.maxDuration
                },
                zoom: {
                    horizontal: this.mixer.zoomLevels.horizontal,
                    vertical: this.mixer.zoomLevels.vertical
                },
                pitchTempo: this.mixer.pitchTempoControl ? this.mixer.pitchTempoControl.getState() : {
                    pitch: 0,
                    tempo: 100
                },
                tracks: {}
            };

            // Save state of each track
            Object.keys(this.mixer.stems).forEach(stemName => {
                const stem = this.mixer.stems[stemName];
                const trackElement = document.querySelector(`[data-stem="${stemName}"]`);
                
                if (stem && trackElement) {
                    state.tracks[stemName] = {
                        volume: this.getTrackVolume(stemName),
                        pan: this.getTrackPan(stemName),
                        muted: this.getTrackMuted(stemName),
                        soloed: this.getTrackSoloed(stemName)
                    };
                }
            });
            
            localStorage.setItem(this.storageKey, JSON.stringify(state));
            console.log('[MixerPersistence] State saved:', state);
            
        } catch (error) {
            console.warn('[MixerPersistence] Could not save mixer state:', error);
        }
    }
    
    /**
     * Restore mixer state
     */
    restoreState() {
        try {
            const stateStr = localStorage.getItem(this.storageKey);
            if (!stateStr) return false;

            const state = JSON.parse(stateStr);

            // Verify it's the same extraction
            if (state.extractionId !== this.mixer.extractionId) {
                console.log('[MixerPersistence] Different extraction, not restoring state');
                return false;
            }

            console.log('[MixerPersistence] Restoring state:', state);

            // Restore track controls
            if (state.tracks) {
                Object.keys(state.tracks).forEach(stemName => {
                    const trackState = state.tracks[stemName];
                    this.restoreTrackState(stemName, trackState);
                });
            }

            // Restore zoom (but not playback position to avoid jumps)
            if (state.zoom) {
                this.mixer.zoomLevels.horizontal = state.zoom.horizontal || 1.0;
                this.mixer.zoomLevels.vertical = state.zoom.vertical || 1.0;

                // Apply zoom if methods exist
                if (this.mixer.waveform && this.mixer.waveform.updateZoom) {
                    this.mixer.waveform.updateZoom();
                }
            }
            
            // Restore pitch/tempo settings
            if (state.pitchTempo && this.mixer.pitchTempoControl) {
                this.mixer.pitchTempoControl.restoreState(state.pitchTempo);
            }

            return true;

        } catch (error) {
            console.warn('[MixerPersistence] Could not restore mixer state:', error);
            return false;
        }
    }

    /**
     * Restore specific track state
     */
    restoreTrackState(stemName, trackState) {
        try {
            const trackElement = document.querySelector(`[data-stem="${stemName}"]`);
            if (!trackElement) {
                console.warn(`[MixerPersistence] Track element not found for ${stemName}`);
                return;
            }

            console.log(`[MixerPersistence] Restoring track ${stemName}:`, trackState);

            // Use setTimeout to ensure all events are attached
            setTimeout(() => {
                // Restore volume
                if (typeof trackState.volume === 'number') {
                    this.setTrackVolume(stemName, trackState.volume);
                    console.log(`[MixerPersistence] Volume restored for ${stemName}: ${trackState.volume}`);
                }

                // Restore pan
                if (typeof trackState.pan === 'number') {
                    this.setTrackPan(stemName, trackState.pan);
                    console.log(`[MixerPersistence] Pan restored for ${stemName}: ${trackState.pan}`);
                }

                // Restore mute
                if (typeof trackState.muted === 'boolean') {
                    this.setTrackMuted(stemName, trackState.muted);
                    console.log(`[MixerPersistence] Mute restored for ${stemName}: ${trackState.muted}`);
                }

                // Restore solo
                if (typeof trackState.soloed === 'boolean') {
                    this.setTrackSoloed(stemName, trackState.soloed);
                    console.log(`[MixerPersistence] Solo restored for ${stemName}: ${trackState.soloed}`);
                }
            }, 100);
            
        } catch (error) {
            console.warn(`[MixerPersistence] Could not restore track ${stemName}:`, error);
        }
    }
    
    /**
     * Obtenir le volume d'une track
     */
    getTrackVolume(stemName) {
        const slider = document.querySelector(`[data-stem="${stemName}"] .volume-slider`);
        return slider ? parseFloat(slider.value) : 0.8;
    }
    
    /**
     * Définir le volume d'une track
     */
    setTrackVolume(stemName, volume) {
        const slider = document.querySelector(`[data-stem="${stemName}"] .volume-slider`);
        const valueDisplay = document.querySelector(`[data-stem="${stemName}"] .volume-value`);
        
        if (slider) {
            slider.value = volume;
            
            // Trigger plusieurs événements pour s'assurer que ça marche
            const inputEvent = new Event('input', { bubbles: true });
            const changeEvent = new Event('change', { bubbles: true });
            slider.dispatchEvent(inputEvent);
            slider.dispatchEvent(changeEvent);
        }
        
        if (valueDisplay) {
            valueDisplay.textContent = Math.round(volume * 100) + '%';
        }
    }
    
    /**
     * Obtenir le pan d'une track
     */
    getTrackPan(stemName) {
        const slider = document.querySelector(`[data-stem="${stemName}"] .pan-knob`);
        return slider ? parseFloat(slider.value) : 0;
    }
    
    /**
     * Définir le pan d'une track
     */
    setTrackPan(stemName, pan) {
        const slider = document.querySelector(`[data-stem="${stemName}"] .pan-knob`);
        const valueDisplay = document.querySelector(`[data-stem="${stemName}"] .pan-value`);
        
        if (slider) {
            slider.value = pan;
            
            // Trigger plusieurs événements pour s'assurer que ça marche
            const inputEvent = new Event('input', { bubbles: true });
            const changeEvent = new Event('change', { bubbles: true });
            slider.dispatchEvent(inputEvent);
            slider.dispatchEvent(changeEvent);
        }
        
        if (valueDisplay) {
            if (Math.abs(pan) < 0.01) {
                valueDisplay.textContent = 'C';
            } else if (pan < 0) {
                valueDisplay.textContent = 'L' + Math.abs(Math.round(pan * 100));
            } else {
                valueDisplay.textContent = 'R' + Math.round(pan * 100);
            }
        }
    }
    
    /**
     * Obtenir l'state mute d'une track
     */
    getTrackMuted(stemName) {
        // Essayer mobile d'abord, puis desktop
        let button = document.querySelector(`[data-stem="${stemName}"] .mute-btn`);
        if (!button) {
            button = document.querySelector(`[data-stem="${stemName}"] .mute`);
        }
        return button ? button.classList.contains('active') : false;
    }
    
    /**
     * Définir l'state mute d'une track
     */
    setTrackMuted(stemName, muted) {
        // Essayer mobile d'abord, puis desktop
        let button = document.querySelector(`[data-stem="${stemName}"] .mute-btn`);
        if (!button) {
            button = document.querySelector(`[data-stem="${stemName}"] .mute`);
        }
        
        if (button) {
            const currentlyMuted = button.classList.contains('active');
            
            if (currentlyMuted !== muted) {
                // Trigger le clic pour basculer l'state
                button.click();
            }
        }
    }
    
    /**
     * Obtenir l'state solo d'une track
     */
    getTrackSoloed(stemName) {
        // Essayer mobile d'abord, puis desktop
        let button = document.querySelector(`[data-stem="${stemName}"] .solo-btn`);
        if (!button) {
            button = document.querySelector(`[data-stem="${stemName}"] .solo`);
        }
        return button ? button.classList.contains('active') : false;
    }
    
    /**
     * Définir l'state solo d'une track
     */
    setTrackSoloed(stemName, soloed) {
        // Essayer mobile d'abord, puis desktop
        let button = document.querySelector(`[data-stem="${stemName}"] .solo-btn`);
        if (!button) {
            button = document.querySelector(`[data-stem="${stemName}"] .solo`);
        }
        
        if (button) {
            const currentlySoloed = button.classList.contains('active');
            
            if (currentlySoloed !== soloed) {
                // Trigger le clic pour basculer l'state
                button.click();
            }
        }
    }
    
    /**
     * Start automatic save
     */
    startAutoSave() {
        this.stopAutoSave(); // Ensure there's no existing timer

        this.autoSaveTimer = setInterval(() => {
            if (this.mixer.isInitialized && this.mixer.extractionId) {
                this.autoSave();
            }
        }, this.autoSaveInterval);
    }

    /**
     * Stop automatic save
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    /**
     * Automatic save (less verbose)
     */
    autoSave() {
        try {
            const state = {
                extractionId: this.mixer.extractionId,
                timestamp: Date.now(),
                playback: {
                    currentTime: this.mixer.currentTime,
                    isPlaying: this.mixer.isPlaying
                },
                tracks: {}
            };

            // Save only track controls
            Object.keys(this.mixer.stems).forEach(stemName => {
                const trackElement = document.querySelector(`[data-stem="${stemName}"]`);
                if (trackElement) {
                    state.tracks[stemName] = {
                        volume: this.getTrackVolume(stemName),
                        pan: this.getTrackPan(stemName),
                        muted: this.getTrackMuted(stemName),
                        soloed: this.getTrackSoloed(stemName)
                    };
                }
            });
            
            localStorage.setItem(this.storageKey, JSON.stringify(state));
            
        } catch (error) {
            console.warn('[MixerPersistence] Auto-save failed:', error);
        }
    }
    
    /**
     * Effacer l'state sauvegardé
     */
    clearState() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('[MixerPersistence] State cleared');
        } catch (error) {
            console.warn('[MixerPersistence] Could not clear state:', error);
        }
    }
    
    /**
     * Clean up les ressources
     */
    destroy() {
        this.stopAutoSave();
    }
}