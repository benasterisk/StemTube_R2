/**
 * Mobile audio improvements - iOS unlock and Android playhead
 */

// MobileAudioEngine extension for iOS unlock
if (typeof MobileAudioEngine !== 'undefined') {
    // Add iOS unlock to prototype
    MobileAudioEngine.prototype.initIOSAudioUnlock = function() {
        if (!this.isIOS) return;

        this.mixer.log('Initializing iOS audio unlock');

        // Create unified unlock handler
        const unlockHandler = async (event) => {
            if (this.audioUnlocked || this.unlockInProgress) return;

            this.unlockInProgress = true;
            this.mixer.log('Attempting iOS audio unlock...');

            try {
                // Create short test audio for unlock
                const testAudio = new Audio();
                testAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==';
                testAudio.load();
                
                // Attempt to play test audio
                await testAudio.play();
                testAudio.pause();
                testAudio.remove();

                this.audioUnlocked = true;
                this.unlockInProgress = false;

                // Remove unlock listeners
                document.removeEventListener('touchstart', unlockHandler);
                document.removeEventListener('touchend', unlockHandler);
                document.removeEventListener('click', unlockHandler);

                this.mixer.log('iOS audio unlocked successfully');

                // Hide unlock toast if it exists
                const toast = document.querySelector('.ios-unlock-toast');
                if (toast) {
                    toast.style.display = 'none';
                }
                
                return true;
            } catch (error) {
                this.unlockInProgress = false;
                this.mixer.log(`Failed unlock iOS: ${error.message}`);
                return false;
            }
        };
        
        // Add event listeners
        document.addEventListener('touchstart', unlockHandler, { passive: true });
        document.addEventListener('touchend', unlockHandler, { passive: true });
        document.addEventListener('click', unlockHandler, { passive: true });

        // Show toast to inform user
        this.showIOSUnlockToast();
    };

    // Show iOS instruction toast
    MobileAudioEngine.prototype.showIOSUnlockToast = function() {
        // Avoid creating multiple toasts
        if (document.querySelector('.ios-unlock-toast')) return;
        
        const toast = document.createElement('div');
        toast.className = 'ios-unlock-toast';
        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-icon">🔊</div>
                <div class="toast-text">
                    <strong>Activation Audio iOS</strong>
                    <br>Touchez l'écran pour activer l'audio
                </div>
                <button class="toast-close" onclick="this.parentElement.parentElement.style.display='none'">×</button>
            </div>
        `;
        
        // Inline styles for toast
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #007AFF;
            color: white;
            padding: 0;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 90vw;
            animation: slideDown 0.3s ease;
        `;
        
        // Style for content
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            .toast-content {
                display: flex;
                align-items: center;
                padding: 15px 20px;
                gap: 12px;
            }
            .toast-icon {
                font-size: 24px;
            }
            .toast-text {
                flex: 1;
                font-size: 14px;
                line-height: 1.3;
            }
            .toast-close {
                background: none;
                border: none;
                color: white;
                font-size: 20px;
                width: 30px;
                height: 30px;
                border-radius: 15px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                opacity: 0.8;
            }
            .toast-close:hover {
                background: rgba(255,255,255,0.2);
                opacity: 1;
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(toast);

        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.display = 'none';
            }
        }, 10000);
    };

    // Override play method for iOS
    const originalPlay = MobileAudioEngine.prototype.play;
    MobileAudioEngine.prototype.play = function() {
        // On iOS, verify audio is unlocked
        if (this.isIOS && !this.audioUnlocked) {
            this.mixer.log('iOS audio not unlocked - showing toast');
            this.showIOSUnlockToast();
            return false;
        }
        
        return originalPlay.call(this);
    };
    
    // Improve time update for Android and iOS
    MobileAudioEngine.prototype.startTimeUpdate = function() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }

        this.timeUpdateInterval = setInterval(() => {
            if (!this.isPausing && Object.keys(this.audioElements).length > 0) {
                // Get playback time from first stem
                const firstStem = Object.values(this.audioElements)[0];
                if (firstStem && firstStem.audio) {
                    const currentTime = firstStem.audio.currentTime || 0;

                    // Update mixer time
                    this.mixer.currentTime = currentTime;

                    // Update time display
                    if (this.mixer.elements.timeDisplay) {
                        const minutes = Math.floor(currentTime / 60);
                        const seconds = Math.floor(currentTime % 60);
                        this.mixer.elements.timeDisplay.textContent = 
                            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    }
                    
                    // Update playhead
                    if (this.mixer.timeline) {
                        this.mixer.timeline.updatePlayhead();
                    }

                    // Update waveform playheads
                    this.updateWaveformPlayheads(currentTime);
                }
            }
        }, 50); // 20 FPS for smooth movement
    };

    // New method to update waveform playheads
    MobileAudioEngine.prototype.updateWaveformPlayheads = function(currentTime) {
        Object.keys(this.mixer.stems).forEach(name => {
            const track = document.querySelector(`.track[data-stem="${name}"]`);
            if (track) {
                const waveformContainer = track.querySelector('.waveform-container, .waveform');
                const playhead = track.querySelector('.track-playhead');
                
                if (waveformContainer && playhead && this.mixer.maxDuration > 0) {
                    const progress = currentTime / this.mixer.maxDuration;
                    const leftPercent = Math.min(100, Math.max(0, progress * 100));
                    playhead.style.left = `${leftPercent}%`;
                }
            }
        });
    };
    
    // Stop time update
    MobileAudioEngine.prototype.stopTimeUpdate = function() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }
    };

    // Improve updateStemAudio method to be more reactive
    const originalUpdateStemAudio = MobileAudioEngine.prototype.updateStemAudio;
    MobileAudioEngine.prototype.updateStemAudio = function(name) {
        const result = originalUpdateStemAudio.call(this, name);

        // Trigger visual update of controls
        const track = document.querySelector(`.track[data-stem="${name}"]`);
        if (track) {
            const stem = this.audioElements[name];
            if (stem) {
                // Update buttons visually
                const muteBtn = track.querySelector('[data-action="toggle-mute"]');
                const soloBtn = track.querySelector('[data-action="toggle-solo"]');

                if (muteBtn) {
                    muteBtn.classList.toggle('active', stem.muted);
                }
                if (soloBtn) {
                    soloBtn.classList.toggle('active', stem.solo);
                }

                // Update volume slider
                const volumeSlider = track.querySelector('input[type="range"]');
                if (volumeSlider && volumeSlider.dataset.control === 'volume') {
                    volumeSlider.value = stem.volume;
                }
            }
        }

        return result;
    };
}

// Automatic initialization on load
document.addEventListener('DOMContentLoaded', function() {
    console.log('[MobileAudioFixes] Mobile improvements loaded');
});
