/**
 * Working Android code + Visible logs for iPhone debug
 */

console.log('[MobileDebugFix] Script loaded');

// Debug disabled - Kept for future reference if debugging needed
/*
let debugDiv = null;

function createDebugDisplay() {
    if (debugDiv) return;
    
    debugDiv = document.createElement('div');
    debugDiv.id = 'mobile-debug';
    debugDiv.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        width: 250px;
        max-height: 300px;
        background: rgba(0,0,0,0.9);
        color: white;
        font-size: 12px;
        padding: 10px;
        border-radius: 5px;
        z-index: 9999;
        overflow-y: auto;
        font-family: monospace;
        border: 1px solid #333;
    `;
    
    debugDiv.innerHTML = '<div style="color: #00ff00; font-weight: bold;">📱 Debug iPhone:</div>';
    document.body.appendChild(debugDiv);

    debugLog('Debug display created');
}
*/

function debugLog(message) {
    // Debug disabled - just console log if needed
    console.log('[MobileDebugFix] ' + message);
}

document.addEventListener('DOMContentLoaded', function() {
    debugLog('DOM ready');
    
    // Debug display disabled
    // createDebugDisplay();

    // Wait for mixer to be ready (SAME LOGIC AS ANDROID)
    const waitForMixer = () => {
        if (window.stemMixer && window.stemMixer.audioEngine) {
            debugLog('✅ Mixer found, setup controls');
            setupMobileControlsAndroid();

            // Observe new tracks (SAME LOGIC AS ANDROID)
            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.classList && node.classList.contains('track')) {
                            debugLog('🎵 New track detected');
                            setupTrackAndroidStyle(node);
                        }
                    });
                });
            });
            
            const tracksContainer = document.getElementById('tracks') || document.querySelector('.tracks-container');
            if (tracksContainer) {
                observer.observe(tracksContainer, { childList: true });
                debugLog('📋 Observer configured');
            } else {
                debugLog('❌ Tracks container not found');
            }
        } else {
            debugLog('⏳ Mixer not ready, retry...');
            setTimeout(waitForMixer, 500);
        }
    };
    
    waitForMixer();
});

function setupMobileControlsAndroid() {
    debugLog('Setup existing controls');

    // Setup all existing tracks (SAME LOGIC AS ANDROID)
    const tracks = document.querySelectorAll('.track');
    debugLog(`📊 ${tracks.length} tracks found`);
    
    tracks.forEach((track, index) => {
        debugLog(`🎵 Setup track ${index + 1}/${tracks.length}`);
        setupTrackAndroidStyle(track);
    });
}

function setupTrackAndroidStyle(track) {
    const stemName = track.dataset.stem;
    if (!stemName) {
        debugLog('❌ No stemName');
        return;
    }

    debugLog(`🔧 Setup ${stemName}`);

    // SOLO BUTTON (EXACT ANDROID LOGIC)
    const stemElement = track.querySelector('[data-stem="' + stemName + '"]');
    const soloBtn = track.querySelector('.solo-btn') || (stemElement ? stemElement.closest('button') : null);
    if (soloBtn && soloBtn.textContent.includes('Solo')) {
        debugLog(`✅ Solo button found for ${stemName}`);

        // Clean up old listeners (SAME METHOD AS ANDROID)
        const newSoloBtn = soloBtn.cloneNode(true);
        soloBtn.parentNode.replaceChild(newSoloBtn, soloBtn);
        
        // Event handler EXACTEMENT comme Android
        const soloHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            debugLog(`🎧 SOLO CLICKED ${stemName}`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemSolo) {
                const currentSolo = mixer.audioEngine.audioElements[stemName]?.solo || false;
                const newSolo = !currentSolo;
                
                debugLog(`🎧 BEFORE setStemSolo: ${currentSolo}`);
                mixer.audioEngine.setStemSolo(stemName, newSolo);
                
                // Verify it worked
                const afterSolo = mixer.audioEngine.audioElements[stemName]?.solo || false;
                debugLog(`🎧 AFTER setStemSolo: ${afterSolo}`);

                // Visual feedback
                newSoloBtn.style.backgroundColor = newSolo ? '#007AFF' : '';
                newSoloBtn.style.color = newSolo ? 'white' : '';

                debugLog(`🎧 Solo ${stemName}: ${currentSolo} → ${newSolo}`);
            } else {
                debugLog(`❌ Mixer/audioEngine missing for solo`);
                debugLog(`mixer: ${!!mixer}, audioEngine: ${!!mixer?.audioEngine}, setStemSolo: ${!!mixer?.audioEngine?.setStemSolo}`);
            }
        };
        
        // SAME EVENTS AS ANDROID
        newSoloBtn.addEventListener('click', soloHandler);
        newSoloBtn.addEventListener('touchend', soloHandler);
    } else {
        debugLog(`❌ Solo button not found for ${stemName}`);
    }

    // MUTE BUTTON (EXACT ANDROID LOGIC)
    const muteBtn = track.querySelector('.mute-btn') ||
                   [...track.querySelectorAll('button')].find(btn => btn.textContent.includes('Mute'));
    if (muteBtn) {
        debugLog(`✅ Mute button found for ${stemName}`);

        // Clean up old listeners
        const newMuteBtn = muteBtn.cloneNode(true);
        muteBtn.parentNode.replaceChild(newMuteBtn, muteBtn);
        
        const muteHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            debugLog(`🔇 MUTE CLICKED ${stemName}`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemMuted) {
                const currentMute = mixer.audioEngine.audioElements[stemName]?.muted || false;
                const newMute = !currentMute;
                
                debugLog(`🔇 BEFORE setStemMuted: ${currentMute}`);
                mixer.audioEngine.setStemMuted(stemName, newMute);
                
                // Verify it worked
                const afterMute = mixer.audioEngine.audioElements[stemName]?.muted || false;
                debugLog(`🔇 AFTER setStemMuted: ${afterMute}`);

                // Visual feedback
                newMuteBtn.style.backgroundColor = newMute ? '#FF3B30' : '';
                newMuteBtn.style.color = newMute ? 'white' : '';

                debugLog(`🔇 Mute ${stemName}: ${currentMute} → ${newMute}`);
            } else {
                debugLog(`❌ Mixer/audioEngine missing for mute`);
                debugLog(`mixer: ${!!mixer}, audioEngine: ${!!mixer?.audioEngine}, setStemMuted: ${!!mixer?.audioEngine?.setStemMuted}`);
            }
        };
        
        // SAME EVENTS AS ANDROID
        newMuteBtn.addEventListener('click', muteHandler);
        newMuteBtn.addEventListener('touchend', muteHandler);
    } else {
        debugLog(`❌ Mute button not found for ${stemName}`);
    }

    // VOLUME SLIDER
    const volumeSlider = track.querySelector('.volume-slider') ||
                        track.querySelector('[data-stem="' + stemName + '"][type="range"]');
    if (volumeSlider) {
        debugLog(`✅ Volume slider found for ${stemName}`);

        const volumeHandler = function(e) {
            const volume = parseFloat(e.target.value);
            debugLog(`🔊 VOLUME CHANGE for ${stemName}: ${volume} (${e.type})`);

            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemVolume) {
                debugLog(`🔊 BEFORE setStemVolume: ${mixer.audioEngine.audioElements[stemName]?.volume}`);
                mixer.audioEngine.setStemVolume(stemName, volume);

                // Verify it worked
                debugLog(`🔊 AFTER setStemVolume: ${mixer.audioEngine.audioElements[stemName]?.volume}`);

                // Update display
                const volumeValue = track.querySelector('.volume-value');
                if (volumeValue) {
                    volumeValue.textContent = Math.round(volume * 100) + '%';
                }
                debugLog(`✅ Volume updated`);
            } else {
                debugLog(`❌ Mixer/audioEngine missing for volume`);
                debugLog(`mixer: ${!!mixer}, audioEngine: ${!!mixer?.audioEngine}, setStemVolume: ${!!mixer?.audioEngine?.setStemVolume}`);
            }
        };
        
        // Detect if iOS for special handling
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

        if (isIOS) {
            debugLog(`🍎 iOS Volume Setup for ${stemName}`);

            // iOS: specific touch events for sliders
            volumeSlider.addEventListener('touchstart', function(e) {
                debugLog(`🍎 Volume touchstart ${stemName}`);
                e.stopPropagation(); // Avoid conflicts
            }, { passive: false });
            
            volumeSlider.addEventListener('touchmove', function(e) {
                debugLog(`🍎 Volume touchmove ${stemName}: ${e.target.value}`);
                volumeHandler(e);
            }, { passive: false });
            
            volumeSlider.addEventListener('touchend', function(e) {
                debugLog(`🍎 Volume touchend ${stemName}: ${e.target.value}`);
                volumeHandler(e);
            }, { passive: false });
            
            // iOS: Force update on value change
            volumeSlider.addEventListener('change', function(e) {
                debugLog(`🍎 Volume change ${stemName}: ${e.target.value}`);
                volumeHandler(e);
            });
        }
        
        // Standard events (Android/PC)
        volumeSlider.addEventListener('input', volumeHandler);
        volumeSlider.addEventListener('change', volumeHandler);
    } else {
        debugLog(`❌ Volume slider not found for ${stemName}`);
    }

    // PAN SLIDER (limited on mobile)
    const panSlider = track.querySelector('.pan-knob') ||
                     [...track.querySelectorAll('input[type="range"]')].find(slider =>
                         slider !== volumeSlider);
    if (panSlider) {
        debugLog(`✅ Pan slider found for ${stemName} (limited mobile support)`);

        const panHandler = function(e) {
            const pan = parseFloat(e.target.value);
            debugLog(`🎛️ PAN CHANGE for ${stemName}: ${pan} (${e.type})`);
            debugLog(`⚠️ Pan not supported on mobile HTML5 Audio`);
            
            const mixer = window.stemMixer;
            if (mixer && mixer.audioEngine && mixer.audioEngine.setStemPan) {
                debugLog(`🎛️ BEFORE setStemPan: ${mixer.audioEngine.audioElements[stemName]?.pan}`);
                mixer.audioEngine.setStemPan(stemName, pan);

                // Verify it worked
                debugLog(`🎛️ AFTER setStemPan: ${mixer.audioEngine.audioElements[stemName]?.pan}`);
                
                // Update display
                const panValue = track.querySelector('.pan-value');
                if (panValue) {
                    panValue.textContent = pan.toFixed(2);
                }
                debugLog(`✅ Pan updated (visual only)`);
            } else {
                debugLog(`❌ Mixer/audioEngine missing for pan`);
                debugLog(`mixer: ${!!mixer}, audioEngine: ${!!mixer?.audioEngine}, setStemPan: ${!!mixer?.audioEngine?.setStemPan}`);
            }
        };
        
        // iOS: same touch events for Pan
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
            debugLog(`🍎 iOS Pan Setup for ${stemName}`);
            
            panSlider.addEventListener('touchstart', function(e) {
                debugLog(`🍎 Pan touchstart ${stemName}`);
                e.stopPropagation();
            }, { passive: false });
            
            panSlider.addEventListener('touchmove', function(e) {
                debugLog(`🍎 Pan touchmove ${stemName}: ${e.target.value}`);
                panHandler(e);
            }, { passive: false });
            
            panSlider.addEventListener('touchend', function(e) {
                debugLog(`🍎 Pan touchend ${stemName}: ${e.target.value}`);
                panHandler(e);
            }, { passive: false });
            
            panSlider.addEventListener('change', function(e) {
                debugLog(`🍎 Pan change ${stemName}: ${e.target.value}`);
                panHandler(e);
            });
        }
        
        // Standard events
        panSlider.addEventListener('input', panHandler);
        panSlider.addEventListener('change', panHandler);
    } else {
        debugLog(`❌ Pan slider not found for ${stemName}`);
    }

    // SAME STYLE AS ANDROID
    const buttons = track.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.style.cssText += `
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            min-height: 44px;
            min-width: 44px;
            cursor: pointer;
        `;
    });
    
    const sliders = track.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        slider.style.cssText += `
            touch-action: manipulation;
            height: 44px;
            cursor: pointer;
        `;
    });
    
    debugLog(`✅ Styles applied for ${stemName}`);
}

debugLog('Script ready');
