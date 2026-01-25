/**
 * Patch to add iOS variables to MobileAudioEngine
 * To be loaded before mobile-audio-fixes.js
 */

// Patch MobileAudioEngine constructor
if (typeof MobileAudioEngine !== 'undefined') {
    const originalConstructor = MobileAudioEngine;
    
    window.MobileAudioEngine = function(mixer) {
        // Call original constructor
        originalConstructor.call(this, mixer);

        // Add iOS variables
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        this.audioUnlocked = false;
        this.unlockInProgress = false;
        this.timeUpdateInterval = null;

        // Initialize iOS unlock if needed
        if (this.isIOS) {
            // Wait for fixes to be loaded
            setTimeout(() => {
                if (this.initIOSAudioUnlock) {
                    this.initIOSAudioUnlock();
                }
            }, 100);
        }
    };

    // Copy the prototype
    window.MobileAudioEngine.prototype = originalConstructor.prototype;
    window.MobileAudioEngine.prototype.constructor = window.MobileAudioEngine;
    
    console.log('[MobileAudioPatch] iOS patch applied to MobileAudioEngine');
}
