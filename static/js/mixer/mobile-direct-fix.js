/**
 * DIRECT and SIMPLE fix for mobile - Android and iOS
 */

console.log('[MobileDirectFix] Script loaded');

document.addEventListener('DOMContentLoaded', function() {
    console.log('[MobileDirectFix] DOM ready');

    // Wait for mixer to be ready
    const waitForMixer = () => {
        if (window.stemMixer && window.stemMixer.audioEngine) {
            console.log('[MobileDirectFix] Mixer found, setup controls');
            setupDirectMobileControls();

            // Observe new tracks
            const observer = new MutationObserve(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.classList && node.classList.contains('track')) {
                            console.log('[MobileDirectFix] New track detected');
                            setupTrackDirectControls(node);
                        }
                    });
                });
            });
            
            const tracksContainer = document.getElementById('tracks') || document.querySelector('.tracks-container');
            if (tracksContainer) {
                observer.observe(tracksContainer, { childList: true });
            }
        } else {
            console.log('[MobileDirectFix] Mixer not ready, retry...');
            setTimeout(waitForMixer, 500);
        }
    };
    
    waitForMixer();
});

function setupDirectMobileControls() {
    console.log('[MobileDirectFix] Setup existing controls');

    // Setup all existing tracks
    const tracks = document.querySelectorAll('.track');
    tracks.forEach(track => {
        setupTrackDirectControls(track);
    });
}

function setupTrackDirectControls(track) {
    const stemName = track.dataset.stem;
    if (!stemName) return;

    console.log(`[MobileDirectFix] Setup controls for ${stemName}`);

    // Detect iOS for special handling
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    console.log(`[MobileDirectFix] iOS detected: ${isIOS}`);
    
    // SOLO BUTTON
    const soloBtn = track.querySelector('.solo-btn') || track.querySelector('[data-stem="' + stemName + '"]').closest('button');
    if (soloBtn && soloBtn.textContent.includes('Solo')) {
        console.log(`[MobileDirectFix] Solo button found for ${stemName}`);

        // Clean up old listeners
        const newSoloBtn = soloBtn.cloneNode(true);
        soloBtn.parentNode.replaceChild(newSoloBtn, soloBtn);

        // Unified handler for iOS and Android
        const soloHandler = function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log(`[MobileDirectFix] SOLO CLICKED for ${stemName} (${e.type})`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemSolo) {
                const currentSolo = mixer.audioEngine.audioElements[stemName]?.solo || false;
                const newSolo = !currentSolo;

                mixer.audioEngine.setStemSolo(stemName, newSolo);

                // Visual feedback
                newSoloBtn.style.backgroundColor = newSolo ? '#007AFF' : '';
                newSoloBtn.style.color = newSolo ? 'white' : '';
                newSoloBtn.classList.toggle('active', newSolo);
                
                console.log(`[MobileDirectFix] Solo ${stemName}: ${currentSolo} -> ${newSolo}`);
            }
        };

        // iOS-specific events
        if (isIOS) {
            newSoloBtn.addEventListener('touchstart', function(e) {
                e.preventDefault();
                console.log(`[MobileDirectFix] iOS touchstart solo ${stemName}`);
            }, { passive: false });
            
            newSoloBtn.addEventListener('touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log(`[MobileDirectFix] iOS touchend solo ${stemName}`);
                soloHandler(e);
            }, { passive: false });
        }

        // Click fallback for all
        newSoloBtn.addEventListener('click', soloHandler, { passive: false });

        // iOS style
        newSoloBtn.style.cssText += `
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            touch-action: manipulation;
        `;
    }
    
    // MUTE BUTTON
    const muteBtn = track.querySelector('.mute-btn') || 
                   [...track.querySelectorAll('button')].find(btn => btn.textContent.includes('Mute'));
    if (muteBtn) {
        console.log(`[MobileDirectFix] Mute button found for ${stemName}`);

        // Clean up old listeners
        const newMuteBtn = muteBtn.cloneNode(true);
        muteBtn.parentNode.replaceChild(newMuteBtn, muteBtn);

        // Unified handler
        const muteHandler = function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log(`[MobileDirectFix] MUTE CLICKED for ${stemName} (${e.type})`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemMuted) {
                const currentMute = mixer.audioEngine.audioElements[stemName]?.muted || false;
                const newMute = !currentMute;

                mixer.audioEngine.setStemMuted(stemName, newMute);

                // Visual feedback
                newMuteBtn.style.backgroundColor = newMute ? '#FF3B30' : '';
                newMuteBtn.style.color = newMute ? 'white' : '';
                newMuteBtn.classList.toggle('active', newMute);
                
                console.log(`[MobileDirectFix] Mute ${stemName}: ${currentMute} -> ${newMute}`);
            }
        };

        // iOS-specific events
        if (isIOS) {
            newMuteBtn.addEventListener('touchstart', function(e) {
                e.preventDefault();
                console.log(`[MobileDirectFix] iOS touchstart mute ${stemName}`);
            }, { passive: false });
            
            newMuteBtn.addEventListener('touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log(`[MobileDirectFix] iOS touchend mute ${stemName}`);
                muteHandler(e);
            }, { passive: false });
        }


        // Click fallback
        newMuteBtn.addEventListener('click', muteHandler, { passive: false });

        // iOS style
        newMuteBtn.style.cssText += `
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            touch-action: manipulation;
        `;
    }
    
    // VOLUME SLIDER
    const volumeSlider = track.querySelector('.volume-slider') || 
                        track.querySelector('[data-stem="' + stemName + '"][type="range"]');
    if (volumeSlider) {
        console.log(`[MobileDirectFix] Volume slider found for ${stemName}`);
        
        const volumeHandler = function(e) {
            const volume = parseFloat(e.target.value);
            console.log(`[MobileDirectFix] VOLUME CHANGE for ${stemName}: ${volume} (${e.type})`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemVolume) {
                mixer.audioEngine.setStemVolume(stemName, volume);

                // Update display
                const volumeValue = track.querySelector('.volume-value');
                if (volumeValue) {
                    volumeValue.textContent = Math.round(volume * 100) + '%';
                }
            }
        };

        // iOS requires specific events for sliders
        if (isIOS) {
            volumeSlider.addEventListener('touchstart', function(e) {
                console.log(`[MobileDirectFix] iOS volume touchstart ${stemName}`);
            }, { passive: true });
            
            volumeSlider.addEventListener('touchmove', volumeHandler, { passive: true });
            volumeSlider.addEventListener('touchend', volumeHandler, { passive: true });
        }
        
        volumeSlider.addEventListener('input', volumeHandler);
        volumeSlider.addEventListener('change', volumeHandler);

        // iOS style for slider
        volumeSlider.style.cssText += `
            -webkit-appearance: none;
            touch-action: manipulation;
        `;
    }
    
    // PAN SLIDER
    const panSlider = track.querySelector('.pan-knob') || 
                     [...track.querySelectorAll('input[type="range"]')].find(slider => 
                         slider !== volumeSlider);
    if (panSlider) {
        console.log(`[MobileDirectFix] Pan slider found for ${stemName}`);
        
        const panHandler = function(e) {
            const pan = parseFloat(e.target.value);
            console.log(`[MobileDirectFix] PAN CHANGE for ${stemName}: ${pan} (${e.type})`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemPan) {
                mixer.audioEngine.setStemPan(stemName, pan);

                // Update display
                const panValue = track.querySelector('.pan-value');
                if (panValue) {
                    panValue.textContent = pan.toFixed(2);
                }
            }
        };

        // iOS sliders
        if (isIOS) {
            panSlider.addEventListener('touchstart', function(e) {
                console.log(`[MobileDirectFix] iOS pan touchstart ${stemName}`);
            }, { passive: true });
            
            panSlider.addEventListener('touchmove', panHandler, { passive: true });
            panSlider.addEventListener('touchend', panHandler, { passive: true });
        }
        
        panSlider.addEventListener('input', panHandler);
        panSlider.addEventListener('change', panHandler);

        // iOS style for slider
        panSlider.style.cssText += `
            -webkit-appearance: none;
            touch-action: manipulation;
        `;
    }

    // General mobile style improved for iOS
    const buttons = track.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.style.cssText += `
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            min-height: 44px;
            min-width: 44px;
            cursor: pointer;
        `;
    });
    
    const sliders = track.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        slider.style.cssText += `
            touch-action: manipulation;
            -webkit-appearance: none;
            height: 44px;
            cursor: pointer;
        `;
    });
}

console.log('[MobileDirectFix] Script ready');
