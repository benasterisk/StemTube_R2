/**
 * Mobile touch controls improvements
 * Fixes Android inactive controls issues
 */

// Touch controls improvement for TrackControls
if (typeof TrackControls !== 'undefined') {

    // Override addMobileTouchHandlers method
    TrackControls.prototype.addMobileTouchHandlers = function(trackElement, name) {
        console.log(`[MobileTouchFix] Adding touch handlers for ${name}`);

        // Improve all buttons with touch events
        const buttons = trackElement.querySelectorAll('button, .control-button');
        buttons.forEach(button => {
            // Remove old listeners if they exist
            button.removeEventListener('click', button._mobileClickHandler);
            button.removeEventListener('touchstart', button._mobileTouchStartHandler);
            button.removeEventListener('touchend', button._mobileTouchEndHandler);

            // Touch handler with visual feedback
            button._mobileTouchStartHandler = (e) => {
                e.preventDefault();
                button.classList.add('touched');
                button.style.transform = 'scale(0.95)';
            };
            
            button._mobileTouchEndHandler = (e) => {
                e.preventDefault();
                button.classList.remove('touched');
                button.style.transform = '';
                
                // Trigger button action
                setTimeout(() => {
                    button.click();
                }, 10);
            };

            button._mobileClickHandler = (e) => {
                e.stopPropagation();

                const action = button.dataset.action || button.className;
                console.log(`[MobileTouchFix] Button action: ${action} for ${name}`);

                // Handle specific actions
                if (action.includes('solo')) {
                    this.toggleSolo(name);
                } else if (action.includes('mute')) {
                    this.toggleMute(name);
                }
            };
            
            // Add new listeners
            button.addEventListener('touchstart', button._mobileTouchStartHandler, { passive: false });
            button.addEventListener('touchend', button._mobileTouchEndHandler, { passive: false });
            button.addEventListener('click', button._mobileClickHandler, { passive: false });

            // Improve touch accessibility
            button.style.cssText += `
                touch-action: manipulation;
                user-select: none;
                -webkit-user-select: none;
                -webkit-tap-highlight-color: transparent;
                min-height: 44px;
                min-width: 44px;
                cursor: pointer;
            `;
        });
        
        // Improve sliders/ranges
        const sliders = trackElement.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                const control = e.target.dataset.control;

                console.log(`[MobileTouchFix] Slider ${control}: ${value} for ${name}`);

                if (control === 'volume') {
                    this.setStemVolume(name, value);
                } else if (control === 'pan') {
                    this.setStemPan(name, value);
                }
            });

            // Improve touch style
            slider.style.cssText += `
                touch-action: manipulation;
                height: 44px;
                cursor: pointer;
            `;
        });
        
        // Improve waveform for touch responsiveness
        const waveform = trackElement.querySelector('.waveform-container, .waveform');
        if (waveform) {
            waveform.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const rect = waveform.getBoundingClientRect();
                const x = e.touches[0].clientX - rect.left;
                const progress = x / rect.width;
                
                if (progress >= 0 && progress <= 1 && this.mixer.maxDuration > 0) {
                    const newTime = progress * this.mixer.maxDuration;
                    this.mixer.seek(newTime);
                }
            }, { passive: false });
            
            waveform.style.cssText += `
                touch-action: manipulation;
                user-select: none;
                cursor: pointer;
            `;
        }
    };
    
    // Improve toggleSolo for mobile
    const originalToggleSolo = TrackControls.prototype.toggleSolo;
    TrackControls.prototype.toggleSolo = function(name) {
        console.log(`[MobileTouchFix] Toggle solo for ${name}`);

        const result = originalToggleSolo.call(this, name);

        // Force visual update
        setTimeout(() => {
            const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
            if (trackElement) {
                const soloBtn = trackElement.querySelector('.solo, [data-action*="solo"]');
                const isSolo = this.mixer.audioEngine.audioElements?.[name]?.solo || false;
                
                if (soloBtn) {
                    soloBtn.classList.toggle('active', isSolo);
                    soloBtn.style.backgroundColor = isSolo ? '#007AFF' : '';
                    soloBtn.style.color = isSolo ? 'white' : '';
                }
            }
        }, 50);
        
        return result;
    };
    
    // Improve toggleMute for mobile
    const originalToggleMute = TrackControls.prototype.toggleMute;
    TrackControls.prototype.toggleMute = function(name) {
        console.log(`[MobileTouchFix] Toggle mute for ${name}`);

        const result = originalToggleMute.call(this, name);

        // Force visual update
        setTimeout(() => {
            const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
            if (trackElement) {
                const muteBtn = trackElement.querySelector('.mute, [data-action*="mute"]');
                const isMuted = this.mixer.audioEngine.audioElements?.[name]?.muted || false;
                
                if (muteBtn) {
                    muteBtn.classList.toggle('active', isMuted);
                    muteBtn.style.backgroundColor = isMuted ? '#FF3B30' : '';
                    muteBtn.style.color = isMuted ? 'white' : '';
                }
            }
        }, 50);
        
        return result;
    };
    
    // Improve setStemVolume for mobile
    const originalSetStemVolume = TrackControls.prototype.setStemVolume;
    TrackControls.prototype.setStemVolume = function(name, volume) {
        console.log(`[MobileTouchFix] Set volume ${volume} for ${name}`);

        const result = originalSetStemVolume.call(this, name, volume);

        // Visual update of slider
        const trackElement = document.querySelector(`.track[data-stem="${name}"]`);
        if (trackElement) {
            const volumeSlider = trackElement.querySelector('input[type="range"][data-control="volume"]');
            if (volumeSlider && volumeSlider.value != volume) {
                volumeSlider.value = volume;
            }
            
            // Show value
            const volumeLabel = trackElement.querySelector('.control-label');
            if (volumeLabel) {
                volumeLabel.textContent = `Volume: ${Math.round(volume * 100)}%`;
            }
        }

        return result;
    };
}

// CSS to improve touch experience
const mobileTouchCSS = `
    .touched {
        background-color: rgba(0, 122, 255, 0.2) !important;
        transform: scale(0.95) !important;
    }
    
    .control-button:active {
        transform: scale(0.95) !important;
        background-color: #007AFF !important;
        color: white !important;
    }
    
    .control-button.active {
        background-color: #007AFF !important;
        color: white !important;
    }
    
    @media (max-width: 768px) {
        .track button, .control-button {
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
            min-height: 44px;
            min-width: 44px;
            padding: 12px 16px;
            font-size: 16px;
            font-weight: 600;
            border-radius: 8px;
            border: 2px solid transparent;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        input[type="range"] {
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
            height: 44px;
            cursor: pointer;
        }
        
        .waveform-container, .waveform {
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
            cursor: pointer;
        }
    }
`;

// Add CSS
const style = document.createElement('style');
style.textContent = mobileTouchCSS;
document.head.appendChild(style);

console.log('[MobileTouchFix] Mobile touch improvements loaded');
