/**
 * Simple and effective mobile fixes
 * Without unnecessary iOS toast, with functional Android controls
 */

// 1. SIMPLIFY iOS - No toast, just natural unlock
if (typeof MobileAudioEngine !== 'undefined') {

    // Simple override for iOS - no toast
    const originalPlay = MobileAudioEngine.prototype.play;
    MobileAudioEngine.prototype.play = function() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

        if (isIOS) {
            // On iOS, we try to play directly
            // Unlock will happen automatically on first user click
            console.log('[iOS] Attempting direct playback');
        }

        return originalPlay.call(this);
    };

    // Remove existing iOS toasts
    document.addEventListener('DOMContentLoaded', () => {
        const existingToasts = document.querySelectorAll('.ios-unlock-toast');
        existingToasts.forEach(toast => toast.remove());
    });
}

// 2. FIX Android - Simple and direct events
document.addEventListener('DOMContentLoaded', function() {
    console.log('[MobileSimpleFixes] Initializing mobile fixes');

    // Wait for mixer to initialize
    setTimeout(() => {
        setupMobileControls();
    }, 1000);
});

function setupMobileControls() {
    console.log('[MobileSimpleFixes] Setting up mobile controls');

    // Get global mixer
    const mixer = window.stemMixer;
    if (!mixer) {
        console.log('[MobileSimpleFixes] Mixer not found, retrying...');
        setTimeout(setupMobileControls, 500);
        return;
    }

    // Observe new tracks added
    const tracksContainer = document.getElementById('tracks');
    if (!tracksContainer) return;

    // Setup existing tracks
    const tracks = tracksContainer.querySelectorAll('.track');
    tracks.forEach(track => {
        const stemName = track.dataset.stem;
        if (stemName) {
            setupTrackControls(track, stemName, mixer);
        }
    });

    // Observe new tracks
    const observer = new MutationObserve(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.classList && node.classList.contains('track')) {
                    const stemName = node.dataset.stem;
                    if (stemName) {
                        setupTrackControls(node, stemName, mixer);
                    }
                }
            });
        });
    });

    observer.observe(tracksContainer, { childList: true });
}

function setupTrackControls(trackElement, stemName, mixer) {
    console.log(`[MobileSimpleFixes] Setting up controls for ${stemName}`);

    // Clean up old listeners
    const buttons = trackElement.querySelectorAll('button, input');
    buttons.forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });

    // Get new elements (after cloning)
    const soloBtn = trackElement.querySelector('button:nth-of-type(1)') || 
                   trackElement.querySelector('.solo') ||
                   trackElement.querySelector('[data-action*="solo"]');
    
    const muteBtn = trackElement.querySelector('button:nth-of-type(2)') || 
                   trackElement.querySelector('.mute') ||
                   trackElement.querySelector('[data-action*="mute"]');
    
    const volumeSlider = trackElement.querySelector('input[type="range"]:nth-of-type(1)') ||
                        trackElement.querySelector('.volume-slider') ||
                        trackElement.querySelector('[data-control="volume"]');
    
    const panSlider = trackElement.querySelector('input[type="range"]:nth-of-type(2)') ||
                     trackElement.querySelector('.pan-slider') ||
                     trackElement.querySelector('[data-control="pan"]');
    
    // SOLO BUTTON
    if (soloBtn) {
        console.log(`[MobileSimpleFixes] Solo button found for ${stemName}`);

        const soloHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            console.log(`[MobileSimpleFixes] Solo clicked for ${stemName}`);

            if (mixer.audioEngine && mixer.audioEngine.audioElements && mixer.audioEngine.audioElements[stemName]) {
                const currentSolo = mixer.audioEngine.audioElements[stemName].solo || false;
                const newSolo = !currentSolo;

                // Update state
                mixer.audioEngine.setStemSolo(stemName, newSolo);

                // Update visually
                soloBtn.classList.toggle('active', newSolo);
                soloBtn.style.backgroundColor = newSolo ? '#007AFF' : '';
                soloBtn.style.color = newSolo ? 'white' : '';

                console.log(`[MobileSimpleFixes] Solo ${stemName}: ${newSolo}`);
            }
        };

        soloBtn.addEventListener('click', soloHandler);
        soloBtn.addEventListener('touchend', soloHandler);
    }

    // MUTE BUTTON
    if (muteBtn) {
        console.log(`[MobileSimpleFixes] Mute button found for ${stemName}`);

        const muteHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            console.log(`[MobileSimpleFixes] Mute clicked for ${stemName}`);

            if (mixer.audioEngine && mixer.audioEngine.audioElements && mixer.audioEngine.audioElements[stemName]) {
                const currentMute = mixer.audioEngine.audioElements[stemName].muted || false;
                const newMute = !currentMute;

                // Update state
                mixer.audioEngine.setStemMuted(stemName, newMute);

                // Update visually
                muteBtn.classList.toggle('active', newMute);
                muteBtn.style.backgroundColor = newMute ? '#FF3B30' : '';
                muteBtn.style.color = newMute ? 'white' : '';

                console.log(`[MobileSimpleFixes] Mute ${stemName}: ${newMute}`);
            }
        };

        muteBtn.addEventListener('click', muteHandler);
        muteBtn.addEventListener('touchend', muteHandler);
    }

    // VOLUME SLIDER
    if (volumeSlider) {
        console.log(`[MobileSimpleFixes] Volume slider found for ${stemName}`);

        const volumeHandler = (e) => {
            const volume = parseFloat(e.target.value);
            console.log(`[MobileSimpleFixes] Volume ${stemName}: ${volume}`);

            if (mixer.audioEngine && mixer.audioEngine.audioElements && mixer.audioEngine.audioElements[stemName]) {
                mixer.audioEngine.setStemVolume(stemName, volume);
            }
        };

        volumeSlider.addEventListener('input', volumeHandler);
        volumeSlider.addEventListener('change', volumeHandler);
    }

    // PAN SLIDER
    if (panSlider) {
        console.log(`[MobileSimpleFixes] Pan slider found for ${stemName}`);

        const panHandler = (e) => {
            const pan = parseFloat(e.target.value);
            console.log(`[MobileSimpleFixes] Pan ${stemName}: ${pan}`);

            if (mixer.audioEngine && mixer.audioEngine.audioElements && mixer.audioEngine.audioElements[stemName]) {
                mixer.audioEngine.setStemPan(stemName, pan);
            }
        };

        panSlider.addEventListener('input', panHandler);
        panSlider.addEventListener('change', panHandler);
    }

    // Improve touch styling
    buttons.forEach(element => {
        element.style.cssText += `
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            user-select: none;
            cursor: pointer;
        `;
        
        if (element.tagName === 'BUTTON') {
            element.style.cssText += `
                min-height: 44px;
                min-width: 44px;
                padding: 12px;
                font-size: 16px;
            `;
        }
        
        if (element.type === 'range') {
            element.style.cssText += `
                height: 44px;
                width: 100%;
            `;
        }
    });
}

console.log('[MobileSimpleFixes] Script loaded');
