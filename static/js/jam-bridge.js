/**
 * Jam Bridge - Runs inside mixer.html (iframe) on the HOST side.
 * Detects active jam session via window.parent.jamState, then:
 *  - Wraps play/pause/stop/seek to broadcast commands to guests
 *  - Listens for tempo/pitch change events and broadcasts them
 *  - Sends periodic sync heartbeats during playback
 *  - Broadcasts track load when extraction changes
 *  - Listens for postMessage from parent to detect new jam sessions
 */
(function() {
    'use strict';

    let parentJamState = null;
    let parentJamClient = null;
    let mixerPatched = false;
    let syncInterval = null;
    let lastBroadcastedExtractionId = null;
    let jamCheckInterval = null;

    function getParentJamState() {
        try {
            if (window.parent && window.parent !== window && window.parent.jamState) {
                return window.parent.jamState;
            }
        } catch (e) { /* cross-origin */ }
        return null;
    }

    function getParentJamClient() {
        try {
            if (window.parent && window.parent !== window && window.parent.jamClient) {
                return window.parent.jamClient;
            }
        } catch (e) { /* cross-origin */ }
        return null;
    }

    function isJamActive() {
        parentJamState = getParentJamState();
        parentJamClient = getParentJamClient();
        return !!(parentJamState && parentJamState.active && parentJamClient && parentJamClient.isActive());
    }

    // Patch the mixer's transport methods to broadcast jam commands
    function patchMixer() {
        if (mixerPatched) return;
        const mixer = window.stemMixer;
        if (!mixer || !mixer.audioEngine) return;

        const engine = mixer.audioEngine;

        // Wrap play (with precount support for jam sessions)
        const originalPlay = engine.play.bind(engine);
        engine.play = function() {
            const metronome = window.stemMixer?.metronome;

            if (isJamActive() && metronome && metronome.getPrecountBars() > 0) {
                const precountBeats = metronome.getPrecountBars() * metronome.beatsPerBar;
                const pos = engine.playbackPosition || engine.mixer?.currentTime || 0;
                // Broadcast BEFORE starting local precount so guests precount simultaneously
                parentJamClient.sendPlayback('play', pos, { precount_beats: precountBeats });
                console.log(`[JamBridge] Starting precount: ${precountBeats} beats (broadcast sent)`);
                metronome.startPrecount(precountBeats, () => {
                    originalPlay();
                    metronome.start();
                    startSyncHeartbeat();
                });
            } else if (isJamActive()) {
                originalPlay();
                const pos = engine.playbackPosition || engine.mixer?.currentTime || 0;
                parentJamClient.sendPlayback('play', pos);
                startSyncHeartbeat();
            } else if (metronome && metronome.getPrecountBars() > 0) {
                // Solo mode with precount
                const precountBeats = metronome.getPrecountBars() * metronome.beatsPerBar;
                metronome.startPrecount(precountBeats, () => {
                    originalPlay();
                    metronome.start();
                });
            } else {
                originalPlay();
            }
        };

        // Wrap pause
        const originalPause = engine.pause.bind(engine);
        engine.pause = function() {
            // Cancel any active precount
            const metronome = window.stemMixer?.metronome;
            if (metronome) metronome.cancelPrecount();

            originalPause();
            if (isJamActive()) {
                parentJamClient.sendPlayback('pause', engine.playbackPosition || engine.mixer?.currentTime || 0);
                stopSyncHeartbeat();
            }
        };

        // Wrap stop
        const originalStop = engine.stop.bind(engine);
        engine.stop = function() {
            // Cancel any active precount
            const metronome = window.stemMixer?.metronome;
            if (metronome) metronome.cancelPrecount();

            originalStop();
            if (isJamActive()) {
                parentJamClient.sendPlayback('stop', 0);
                stopSyncHeartbeat();
            }
        };

        // Wrap seekToPosition
        const originalSeek = engine.seekToPosition.bind(engine);
        engine.seekToPosition = function(position) {
            originalSeek(position);
            if (isJamActive()) {
                parentJamClient.sendPlayback('seek', position);
            }
        };

        mixerPatched = true;
        console.log('[JamBridge] Mixer transport patched for jam broadcasting');
    }

    // Listen for tempo and pitch change events
    function setupTempoAndPitchListeners() {
        window.addEventListener('tempoChanged', (e) => {
            if (!isJamActive()) return;
            const detail = e.detail || {};
            const bpm = window.simplePitchTempo?.currentBPM || 120;
            const originalBpm = window.simplePitchTempo?.originalBPM || 120;
            const syncRatio = detail.syncRatio || (bpm / originalBpm);
            parentJamClient.sendTempo(bpm, originalBpm, syncRatio);
        });

        window.addEventListener('pitchShiftChanged', (e) => {
            if (!isJamActive()) return;
            const detail = e.detail || {};
            const pitchShift = detail.pitchShift || 0;
            const currentKey = document.getElementById('current-key')?.textContent || 'C';
            parentJamClient.sendPitch(pitchShift, currentKey);
        });
    }

    // Broadcast current track to jam session
    function broadcastCurrentTrack() {
        if (!isJamActive()) return;
        const extractionId = window.EXTRACTION_ID || '';
        if (!extractionId) return;
        const extractionData = window.EXTRACTION_INFO || {};
        parentJamClient.loadTrack(extractionId, extractionData);
        lastBroadcastedExtractionId = extractionId;
        console.log('[JamBridge] Broadcasted track:', extractionData.title);

        // Send initial state sync so guests know host is stopped
        broadcastCurrentState();
    }

    // Broadcast current playback state (used after reconnect)
    function broadcastCurrentState() {
        if (!isJamActive()) return;
        const engine = window.stemMixer?.audioEngine;
        if (!engine) return;
        const bpm = window.simplePitchTempo?.currentBPM || 120;
        parentJamClient.socket.emit('jam_sync', {
            code: parentJamClient.getCode(),
            position: engine.playbackPosition || engine.mixer?.currentTime || 0,
            bpm: bpm,
            is_playing: !!engine.mixer?.isPlaying,
            timestamp: Date.now()
        });
    }

    // Check if the extraction has changed and broadcast
    function checkExtractionChange() {
        if (!isJamActive()) return;
        const extractionId = window.EXTRACTION_ID || '';
        if (extractionId && extractionId !== lastBroadcastedExtractionId) {
            broadcastCurrentTrack();
        }
    }

    // Periodic sync heartbeat during playback
    function startSyncHeartbeat() {
        stopSyncHeartbeat();
        syncInterval = setInterval(() => {
            if (!isJamActive()) {
                stopSyncHeartbeat();
                return;
            }
            const engine = window.stemMixer?.audioEngine;
            if (!engine || !engine.mixer?.isPlaying) {
                stopSyncHeartbeat();
                return;
            }
            const bpm = window.simplePitchTempo?.currentBPM || 120;
            parentJamClient.socket.emit('jam_sync', {
                code: parentJamClient.getCode(),
                position: engine.playbackPosition || engine.mixer?.currentTime || 0,
                bpm: bpm,
                is_playing: true,
                timestamp: Date.now()
            });
        }, 5000);
    }

    function stopSyncHeartbeat() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }

    // Listen for messages from parent window (jam session created/ended)
    function setupParentMessageListener() {
        window.addEventListener('message', (event) => {
            if (!event.data || typeof event.data !== 'object') return;

            if (event.data.type === 'jam_session_created') {
                console.log('[JamBridge] Received jam_session_created from parent, stemMixer=', !!window.stemMixer, 'isInitialized=', window.stemMixer?.isInitialized);
                // Patch mixer if not done yet, then broadcast current track
                if (window.stemMixer && window.stemMixer.isInitialized) {
                    patchMixer();
                    broadcastCurrentTrack();
                } else {
                    console.warn('[JamBridge] stemMixer not ready, cannot broadcast yet');
                }
            } else if (event.data.type === 'jam_session_ended') {
                console.log('[JamBridge] Received jam_session_ended from parent');
                stopSyncHeartbeat();
                lastBroadcastedExtractionId = null;
            }
        });
    }

    // Periodically check if jam became active (fallback)
    function startJamStateMonitor() {
        let wasActive = false;
        jamCheckInterval = setInterval(() => {
            const active = isJamActive();
            if (active && !wasActive) {
                // Jam just became active
                console.log('[JamBridge] Jam session detected as active');
                if (window.stemMixer && window.stemMixer.isInitialized) {
                    patchMixer();
                    broadcastCurrentTrack();
                }
            }
            wasActive = active;

            // Also check for extraction changes while jam is active
            if (active) {
                checkExtractionChange();
            }
        }, 2000);
    }

    // Initialize
    function init() {
        setupParentMessageListener();
        setupTempoAndPitchListeners();
        startJamStateMonitor();

        // Wait for StemMixer to be initialized, then patch
        const checkReady = setInterval(() => {
            if (window.stemMixer && window.stemMixer.isInitialized && window.stemMixer.audioEngine) {
                clearInterval(checkReady);
                patchMixer();
                // Broadcast current track if jam is already active
                if (isJamActive()) {
                    broadcastCurrentTrack();
                }
                console.log('[JamBridge] Initialized (mixer ready)');
            }
        }, 500);

        // Timeout after 30 seconds for the mixer-ready check
        setTimeout(() => clearInterval(checkReady), 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
