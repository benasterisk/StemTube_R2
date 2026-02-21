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
    
    // ── Metronome Track ──────────────────────────────────────────

    /**
     * Create the metronome track element and insert it above drums.
     */
    createMetronomeTrackElement() {
        if (!this.mixer.elements.tracks) return;

        // Don't create if already exists
        if (document.querySelector('.track[data-stem="metronome"]')) return;

        const trackElement = document.createElement('div');
        trackElement.className = 'track metronome-track';
        trackElement.dataset.stem = 'metronome';

        const stem = this.mixer.stems['metronome'];
        const initVol = stem ? stem.volume : 0.5;
        const initMuted = stem ? stem.muted : false;
        const res = this.mixer.metronome ? this.mixer.metronome.clickResolution : 1;

        trackElement.innerHTML = `
            <div class="track-header">
                <div class="track-title">
                    Metronome
                    <span class="track-status active"></span>
                </div>
                <div class="track-buttons">
                    <button class="track-btn solo" title="Solo">S</button>
                    <button class="track-btn mute${initMuted ? ' active' : ''}" title="Mute">M</button>
                </div>
                <div class="track-control">
                    <div class="track-control-label">
                        <span>Volume</span>
                        <span class="track-control-value volume-value">${Math.round(initVol * 100)}%</span>
                    </div>
                    <input type="range" class="track-slider volume-slider" min="0" max="1" step="0.01" value="${initVol}">
                </div>
                <div class="track-control">
                    <div class="track-control-label">
                        <span>Pan</span>
                        <span class="track-control-value pan-value">C</span>
                    </div>
                    <input type="range" class="track-slider pan-knob" min="-1" max="1" step="0.01" value="0">
                </div>
                <div class="track-control metronome-resolution">
                    <div class="track-control-label"><span>Res</span></div>
                    <div class="resolution-buttons">
                        <button class="res-btn${res === 0.5 ? ' active' : ''}" data-res="0.5" title="Half time">½</button>
                        <button class="res-btn${res === 1 ? ' active' : ''}" data-res="1" title="On time">1x</button>
                        <button class="res-btn${res === 2 ? ' active' : ''}" data-res="2" title="Double time">2x</button>
                    </div>
                </div>
            </div>
            <div class="waveform-container">
                <div class="waveform"></div>
                <div class="track-playhead"></div>
            </div>
        `;

        // Insert above drums track, or prepend if no drums
        const drumsTrack = this.mixer.elements.tracks.querySelector('[data-stem="drums"]');
        if (drumsTrack) {
            this.mixer.elements.tracks.insertBefore(trackElement, drumsTrack);
        } else {
            this.mixer.elements.tracks.prepend(trackElement);
        }

        this.setupMetronomeTrackListeners(trackElement);
        this.mixer.log('Metronome track created');
    }

    /**
     * Wire up metronome track control listeners with bidirectional sync.
     */
    setupMetronomeTrackListeners(trackElement) {
        const metronome = this.mixer.metronome;

        // Solo — standard
        trackElement.querySelector('.solo')?.addEventListener('click', () => {
            this.toggleSolo('metronome');
        });

        // Mute — sync with transport bar speaker icon
        trackElement.querySelector('.mute')?.addEventListener('click', () => {
            this.toggleMute('metronome');
            if (metronome) {
                const stem = this.mixer.stems['metronome'];
                metronome.clickMode = stem.muted ? 'off' : 'all';
                localStorage.setItem('jam_click_mode', metronome.clickMode);
                metronome._updateToggleIcons();
            }
        });

        // Volume — maps 0-1 slider to metronome gain (with 3x boost)
        trackElement.querySelector('.volume-slider')?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            const stem = this.mixer.stems['metronome'];
            if (stem) {
                stem.volume = val;
                if (stem.gainNode && !stem.muted) {
                    stem.gainNode.gain.value = val * 3;
                }
            }
            if (metronome) {
                metronome.clickVolume = val * 3;
                localStorage.setItem('jam_click_volume', metronome.clickVolume.toString());
            }
            const display = trackElement.querySelector('.volume-value');
            if (display) display.textContent = `${Math.round(val * 100)}%`;
        });

        // Pan — standard
        trackElement.querySelector('.pan-knob')?.addEventListener('input', (e) => {
            this.updatePan('metronome', parseFloat(e.target.value));
        });

        // Resolution buttons
        trackElement.querySelectorAll('.res-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                trackElement.querySelectorAll('.res-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (metronome) {
                    metronome.setClickResolution(parseFloat(btn.dataset.res));
                }
                // Redraw beat grid
                if (this.mixer.waveform) {
                    this.mixer.waveform.drawMetronomeBeatGrid('metronome');
                }
            });
        });
    }

    // ── Recording Track Creation ──────────────────────────────────

    /**
     * Create a recording track element
     * @param {Object} recording - Recording object from RecordingEngine
     */
    createRecordingTrackElement(recording) {
        const container = document.getElementById('recording-tracks-container');
        if (!container) return;

        const isEmptyTrack = !recording.audioBuffer;

        const trackEl = document.createElement('div');
        trackEl.className = `track recording-track${isEmptyTrack ? ' empty-track' : ''}`;
        trackEl.id = `rec-track-${recording.id}`;

        trackEl.innerHTML = `
            <div class="track-header">
                <div class="track-title recording-title">
                    <span class="track-name" contenteditable="false" title="Double-click to rename">${recording.name}</span>
                    <span class="track-status${isEmptyTrack ? '' : ' active'}"></span>
                </div>
                <div class="track-buttons">
                    <button class="track-btn rec-arm-btn${recording.armed ? ' active' : ''}" title="Arm for recording">R</button>
                    <button class="track-btn solo" title="Solo">S</button>
                    <button class="track-btn mute" title="Mute">M</button>
                </div>
                <div class="track-control">
                    <div class="track-control-label">
                        <span>Volume</span>
                        <span class="track-control-value volume-value">100%</span>
                    </div>
                    <input type="range" class="track-slider volume-slider" min="0" max="1" step="0.01" value="${recording.volume}">
                </div>
                <div class="track-control">
                    <div class="track-control-label">
                        <span>Pan</span>
                        <span class="track-control-value pan-value">C</span>
                    </div>
                    <input type="range" class="track-slider pan-knob" min="-1" max="1" step="0.01" value="${recording.pan}">
                </div>
                <button class="rec-expand-btn" title="Show recording controls">
                    <i class="fas fa-chevron-down"></i>
                </button>
                <div class="rec-expanded-controls">
                    <select class="rec-device-select" title="Input device">
                        <option value="">Select mic...</option>
                    </select>
                    <div class="rec-input-row">
                        <div class="input-level-meter" title="Input level">
                            <div class="input-level-fill"></div>
                        </div>
                        <div class="monitor-control" title="Monitor volume">
                            <i class="fas fa-headphones"></i>
                            <input type="range" class="monitor-slider" min="0" max="1" step="0.01" value="0">
                        </div>
                    </div>
                    <div class="rec-action-buttons">
                        <button class="track-btn rec-save-btn${recording.saved ? ' saved' : ''}" title="${recording.saved ? 'Saved' : 'Save to server'}">
                            <i class="fas fa-save"></i> Save
                        </button>
                        <button class="track-btn rec-delete-btn" title="Delete recording">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
            <div class="waveform-container">
                <div class="waveform"></div>
                <div class="track-playhead"></div>
            </div>
        `;

        container.appendChild(trackEl);

        const recEngine = this.mixer.recordingEngine;
        if (!recEngine) return;

        // ── Expand / collapse toggle ──
        const expandBtn = trackEl.querySelector('.rec-expand-btn');
        const expandedPanel = trackEl.querySelector('.rec-expanded-controls');
        expandBtn.addEventListener('click', () => {
            const isOpen = expandedPanel.classList.toggle('open');
            expandBtn.classList.toggle('open', isOpen);
        });

        // ── Per-track input device selector ──
        const deviceSelect = trackEl.querySelector('.rec-device-select');
        const levelFill = trackEl.querySelector('.input-level-fill');
        const monitorSlider = trackEl.querySelector('.monitor-slider');

        // Populate device list
        this._populateRecDeviceSelect(deviceSelect, recEngine);

        // Level meter animation (runs while track has a device stream)
        let levelAnimId = null;
        const updateLevel = () => {
            const level = recEngine.getTrackInputLevel(recording.id);
            if (levelFill) levelFill.style.width = `${Math.round(level * 100)}%`;
            levelAnimId = requestAnimationFrame(updateLevel);
        };

        deviceSelect.addEventListener('change', async (e) => {
            try {
                await recEngine.setTrackDevice(recording.id, e.target.value);
                // Populate other tracks' selectors too (permission may reveal labels)
                document.querySelectorAll('.rec-device-select').forEach(sel => {
                    if (sel !== deviceSelect) this._populateRecDeviceSelect(sel, recEngine);
                });
                // Start level meter
                if (levelAnimId) cancelAnimationFrame(levelAnimId);
                if (e.target.value) updateLevel();
            } catch (err) {
                console.warn('[TrackControls] Device init failed:', err);
            }
        });

        // Monitor volume
        monitorSlider.addEventListener('input', (e) => {
            recEngine.setTrackMonitorVolume(recording.id, parseFloat(e.target.value));
        });

        // ── Arm button ──
        const armBtn = trackEl.querySelector('.rec-arm-btn');
        armBtn.addEventListener('click', () => {
            if (recording.armed) {
                recEngine.disarmTrack(recording.id);
            } else {
                recEngine.armTrack(recording.id);
            }
            armBtn.classList.toggle('active', recording.armed);
        });

        // Solo
        trackEl.querySelector('.solo').addEventListener('click', () => {
            recEngine.toggleSolo(recording.id);
            trackEl.querySelector('.solo').classList.toggle('active', recording.solo);
        });

        // Mute
        trackEl.querySelector('.mute').addEventListener('click', () => {
            recEngine.toggleMute(recording.id);
            trackEl.querySelector('.mute').classList.toggle('active', recording.muted);
        });

        // Volume
        trackEl.querySelector('.volume-slider').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            recEngine.setVolume(recording.id, val);
            trackEl.querySelector('.volume-value').textContent = `${Math.round(val * 100)}%`;
        });

        // Pan
        trackEl.querySelector('.pan-knob').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            recEngine.setPan(recording.id, val);
            let panText = 'C';
            if (val < -0.05) panText = `${Math.round(Math.abs(val) * 100)}%L`;
            else if (val > 0.05) panText = `${Math.round(val * 100)}%R`;
            trackEl.querySelector('.pan-value').textContent = panText;
        });

        // Save
        trackEl.querySelector('.rec-save-btn').addEventListener('click', async () => {
            if (!recording.audioBuffer) {
                this.mixer.showToast('Nothing to save — record something first', 'warning');
                return;
            }
            try {
                const downloadId = this.mixer.extractionId;
                if (!downloadId) {
                    this.mixer.showToast('Cannot save — no extraction ID', 'error');
                    return;
                }
                await recEngine.saveToServer(recording.id, downloadId);
                // Re-render waveform in green to indicate saved state
                if (this.mixer.waveform) {
                    this.mixer.waveform.renderRecordingWaveform(
                        recording, trackEl.querySelector('.waveform')
                    );
                }
                this.mixer.showToast('Recording saved', 'success');
            } catch (err) {
                console.error('[TrackControls] Save recording failed:', err);
                this.mixer.showToast('Save failed: ' + err.message, 'error');
            }
        });

        // Delete (also cancel level meter)
        trackEl.querySelector('.rec-delete-btn').addEventListener('click', async () => {
            if (levelAnimId) cancelAnimationFrame(levelAnimId);
            if (recording.serverId) {
                try {
                    await recEngine.deleteFromServer(recording.serverId);
                } catch (err) {
                    console.warn('[TrackControls] Server delete failed:', err);
                }
            }
            recEngine.deleteRecording(recording.id);
        });

        // Inline rename (double-click)
        const nameEl = trackEl.querySelector('.track-name');
        nameEl.addEventListener('dblclick', () => {
            nameEl.contentEditable = 'true';
            nameEl.focus();
            const range = document.createRange();
            range.selectNodeContents(nameEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
        nameEl.addEventListener('blur', () => {
            nameEl.contentEditable = 'false';
            const newName = nameEl.textContent.trim();
            if (newName && newName !== recording.name) {
                recEngine.renameRecording(recording.id, newName);
            }
        });
        nameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameEl.blur();
            }
        });

        // Render waveform if audio is available
        if (this.mixer.waveform && recording.audioBuffer) {
            this.mixer.waveform.renderRecordingWaveform(recording, trackEl.querySelector('.waveform'));
        }

        this.mixer.log(`Recording track created: ${recording.name}${isEmptyTrack ? ' (empty)' : ''}`);
    }

    /**
     * Populate a per-track device selector
     * @private
     */
    async _populateRecDeviceSelect(selectEl, recEngine) {
        if (!selectEl) return;
        try {
            const devices = await recEngine.getInputDevices();
            const currentVal = selectEl.value;
            selectEl.innerHTML = '<option value="">Select mic...</option>';
            for (const device of devices) {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.textContent = device.label || `Microphone ${selectEl.options.length}`;
                selectEl.appendChild(opt);
            }
            // Restore previous selection if still available
            if (currentVal) selectEl.value = currentVal;
        } catch (err) {
            // Permission not yet granted — will be populated after first device selection
        }
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
