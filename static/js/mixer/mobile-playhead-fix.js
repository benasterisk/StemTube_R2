/**
 * Mobile playhead correction - Add missing methods to MobileAudioEngine
 */

if (typeof MobileAudioEngine !== 'undefined') {

    // Add missing startTimeUpdate method
    MobileAudioEngine.prototype.startTimeUpdate = function() {
        console.log('[MobilePlayhead] Starting time update');
        
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
        
        this.timeUpdateInterval = setInterval(() => {
            if (!this.isPausing && Object.keys(this.audioElements).length > 0) {
                // Get playback time from first stem
                const firstStem = Object.values(this.audioElements)[0];
                if (firstStem && firstStem.audio && !firstStem.audio.paused) {
                    const currentTime = firstStem.audio.currentTime || 0;

                    // Update mixer time
                    this.mixer.currentTime = currentTime;

                    // Update time display
                    if (this.mixer.elements && this.mixer.elements.timeDisplay) {
                        const minutes = Math.floor(currentTime / 60);
                        const seconds = Math.floor(currentTime % 60);
                        this.mixer.elements.timeDisplay.textContent = 
                            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    }
                    
                    // Update timeline playhead
                    if (this.mixer.timeline && this.mixer.timeline.updatePlayhead) {
                        this.mixer.timeline.updatePlayhead();
                    }

                    // Update waveform playheads
                    this.updateWaveformPlayheads(currentTime);
                }
            }
        }, 50); // 20 FPS for smooth movement
    };

    // Add missing stopTimeUpdate method
    MobileAudioEngine.prototype.stopTimeUpdate = function() {
        console.log('[MobilePlayhead] Stopping time update');
        
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }
    };
    
    // Add updateWaveformPlayheads method
    MobileAudioEngine.prototype.updateWaveformPlayheads = function(currentTime) {
        if (!this.mixer.stems || !this.mixer.maxDuration || this.mixer.maxDuration <= 0) {
            return;
        }

        const progress = currentTime / this.mixer.maxDuration;
        const leftPercent = Math.min(100, Math.max(0, progress * 100));

        // Update each waveform playhead
        Object.keys(this.mixer.stems).forEach(name => {
            const track = document.querySelector(`.track[data-stem="${name}"]`);
            if (track) {
                let playhead = track.querySelector('.track-playhead');

                // Create playhead if it doesn't exist
                if (!playhead) {
                    const waveformContainer = track.querySelector('.waveform-container, .waveform');
                    if (waveformContainer) {
                        playhead = document.createElement('div');
                        playhead.className = 'track-playhead';
                        playhead.style.cssText = `
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 2px;
                            height: 100%;
                            background: #007AFF;
                            opacity: 0.8;
                            z-index: 2;
                            pointer-events: none;
                            transition: none;
                        `;
                        waveformContainer.appendChild(playhead);
                    }
                }
                
                if (playhead) {
                    playhead.style.left = `${leftPercent}%`;
                }
            }
        });
    };
    
    // Ensure pause properly calls stopTimeUpdate
    const originalPause = MobileAudioEngine.prototype.pause;
    MobileAudioEngine.prototype.pause = function() {
        const result = originalPause.call(this);
        this.stopTimeUpdate();
        return result;
    };

    console.log('[MobilePlayhead] Playhead methods added to MobileAudioEngine');
}
