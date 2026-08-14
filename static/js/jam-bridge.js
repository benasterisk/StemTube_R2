/**
 * Jam Bridge - Runs inside mixer.html (iframe) on the HOST side.
 *
 * POC-engine edition: the mixer page now runs the POC chassis (engine from
 * poc/audio.js, transport in poc/main.js, tempo in poc/tempo.js). This bridge
 * keeps the EXACT same socket protocol as before (sendPlayback / sendTempo /
 * sendPitch / loadTrack / jam_sync), so jam-client.js, the server events and
 * the guest pages (jam-guest.html, mobile) are untouched.
 *
 * What changed vs the legacy bridge:
 *  - transport hooks target the POC surface: engine.play/stop/seek (property
 *    reassignment; mixer-compat has already wrapped them once for recordings,
 *    we stack on top - script order guarantees we patch last), plus the
 *    global stopAll() for the full-stop path (engine.stop() alone is PAUSE
 *    in the POC engine: it remembers the position).
 *  - position is engine.pos() (a method; negative during a count-in lead-in,
 *    clamped to 0 for broadcasts) and playing state is engine.playing.
 *  - tempo/pitch have no DOM events in the POC chassis: we wrap
 *    TempoPitch.setBpm / setPitch / resetBpm / resetPitch instead.
 *  - precount: the POC count-in is a baked lead-in passed to
 *    engine.play(whenDelay, leadIn). When leadIn > 0 we convert it to beats
 *    at the current BPM and forward it as precount_beats so legacy guests
 *    run their own client-side count-in of the same length.
 */
(function() {
    'use strict';

    let parentJamState = null;
    let parentJamClient = null;
    let transportPatched = false;
    let syncInterval = null;
    let lastBroadcastedExtractionId = null;
    let suppressPauseBroadcast = false;

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

    // ── POC surface accessors ────────────────────────────────────────

    function pocEngine() {
        // `engine` is a top-level const in poc/audio.js: not a window property,
        // but visible to this plain script through the global lexical scope.
        try { return engine; } catch (e) { return null; }
    }

    function engineReady() {
        const e = pocEngine();
        return !!(e && e.duration > 0);
    }

    function currentPos() {
        const e = pocEngine();
        if (!e) return 0;
        try { return Math.max(0, e.pos() || 0); } catch (err) { return 0; }
    }

    function currentBpm() {
        try { return TempoPitch.bpmTarget || TempoPitch.bpmBase || 120; } catch (e) { return 120; }
    }

    function originalBpm() {
        try { return TempoPitch.bpmBase || 120; } catch (e) { return 120; }
    }

    // ── Transport hooks ──────────────────────────────────────────────

    function patchTransport() {
        if (transportPatched) return;
        const e = pocEngine();
        if (!e) return;

        // play: broadcast the position playback will start from. A count-in
        // arrives as play(whenDelay, leadIn); convert leadIn to beats so
        // legacy guests can mirror it with their own client-side precount.
        const origPlay = e.play.bind(e);
        e.play = function(whenDelay, leadIn) {
            const startPos = currentPos();
            const ret = origPlay(whenDelay, leadIn);
            if (isJamActive()) {
                const opts = {};
                if (leadIn && leadIn > 0) {
                    const beatDur = 60 / currentBpm();
                    opts.precount_beats = Math.max(1, Math.round(leadIn / beatDur));
                }
                parentJamClient.sendPlayback('play', startPos, opts);
                startSyncHeartbeat();
            }
            return ret;
        };

        // engine.stop() is PAUSE in the POC engine (position preserved).
        // stopAll() (full stop) calls it too: suppress the pause broadcast
        // there and send the real 'stop' after.
        const origStop = e.stop.bind(e);
        e.stop = function() {
            const pos = currentPos();
            const ret = origStop();
            if (isJamActive() && !suppressPauseBroadcast) {
                parentJamClient.sendPlayback('pause', pos);
                stopSyncHeartbeat();
            }
            return ret;
        };

        // Full stop: the global stopAll from poc/main.js (function declaration
        // => reassignable window property; the UI closures resolve to it).
        if (typeof window.stopAll === 'function') {
            const origStopAll = window.stopAll;
            window.stopAll = function() {
                suppressPauseBroadcast = true;
                try { origStopAll.apply(this, arguments); }
                finally { suppressPauseBroadcast = false; }
                if (isJamActive()) {
                    parentJamClient.sendPlayback('stop', 0);
                    stopSyncHeartbeat();
                }
            };
        }

        // seek (mixer-compat aliases seekToPosition to the same method)
        const origSeek = e.seek.bind(e);
        e.seek = function(t) {
            const ret = origSeek(t);
            if (isJamActive()) {
                parentJamClient.sendPlayback('seek', Math.max(0, t || 0));
            }
            return ret;
        };
        if (typeof e.seekToPosition === 'function') {
            e.seekToPosition = function(t) { return e.seek(t); };
        }

        transportPatched = true;
        console.log('[JamBridge] POC transport patched for jam broadcasting');
    }

    // ── Tempo / pitch hooks (no DOM events in the POC chassis) ───────

    function patchTempoPitch() {
        let TP;
        try { TP = TempoPitch; } catch (e) { return; }
        if (!TP || TP._jamPatched) return;

        function broadcastTempo() {
            if (!isJamActive()) return;
            const bpm = currentBpm();
            const base = originalBpm();
            parentJamClient.sendTempo(bpm, base, bpm / base);
        }

        function broadcastPitch() {
            if (!isJamActive()) return;
            const semi = TP.pitchSemitones || 0;
            const keyEl = document.getElementById('keyName') || document.getElementById('current-key');
            parentJamClient.sendPitch(semi, keyEl ? keyEl.textContent : 'C');
        }

        ['setBpm', 'resetBpm'].forEach((m) => {
            if (typeof TP[m] !== 'function') return;
            const orig = TP[m].bind(TP);
            TP[m] = function() { const r = orig.apply(TP, arguments); broadcastTempo(); return r; };
        });
        ['setPitch', 'resetPitch'].forEach((m) => {
            if (typeof TP[m] !== 'function') return;
            const orig = TP[m].bind(TP);
            TP[m] = function() { const r = orig.apply(TP, arguments); broadcastPitch(); return r; };
        });

        TP._jamPatched = true;
    }

    // ── Track + state broadcast (protocol unchanged) ─────────────────

    function broadcastCurrentTrack() {
        if (!isJamActive()) return;
        const extractionId = window.EXTRACTION_ID || '';
        if (!extractionId) return;
        const extractionData = window.EXTRACTION_INFO || {};
        parentJamClient.loadTrack(extractionId, extractionData);
        lastBroadcastedExtractionId = extractionId;
        console.log('[JamBridge] Broadcasted track:', extractionData.title);
        broadcastCurrentState();
    }

    function broadcastCurrentState() {
        if (!isJamActive() || !engineReady()) return;
        parentJamClient.socket.emit('jam_sync', {
            code: parentJamClient.getCode(),
            position: currentPos(),
            bpm: currentBpm(),
            is_playing: !!pocEngine().playing,
            timestamp: Date.now()
        });
    }

    function checkExtractionChange() {
        if (!isJamActive()) return;
        const extractionId = window.EXTRACTION_ID || '';
        if (extractionId && extractionId !== lastBroadcastedExtractionId) {
            broadcastCurrentTrack();
        }
    }

    // ── Sync heartbeat ───────────────────────────────────────────────

    function startSyncHeartbeat() {
        stopSyncHeartbeat();
        syncInterval = setInterval(() => {
            if (!isJamActive()) { stopSyncHeartbeat(); return; }
            const e = pocEngine();
            if (!e || !e.playing) { stopSyncHeartbeat(); return; }
            parentJamClient.socket.emit('jam_sync', {
                code: parentJamClient.getCode(),
                position: currentPos(),
                bpm: currentBpm(),
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

    // ── Lifecycle ────────────────────────────────────────────────────

    function setupParentMessageListener() {
        window.addEventListener('message', (event) => {
            if (!event.data || typeof event.data !== 'object') return;

            if (event.data.type === 'jam_session_created') {
                console.log('[JamBridge] jam_session_created, engineReady=', engineReady());
                if (engineReady()) {
                    patchTransport();
                    patchTempoPitch();
                    broadcastCurrentTrack();
                } else {
                    console.warn('[JamBridge] POC engine not ready, cannot broadcast yet');
                }
            } else if (event.data.type === 'jam_session_ended') {
                console.log('[JamBridge] jam_session_ended');
                stopSyncHeartbeat();
                lastBroadcastedExtractionId = null;
            }
        });
    }

    function startJamStateMonitor() {
        let wasActive = false;
        setInterval(() => {
            const active = isJamActive();
            if (active && !wasActive) {
                console.log('[JamBridge] Jam session detected as active');
                if (engineReady()) {
                    patchTransport();
                    patchTempoPitch();
                    broadcastCurrentTrack();
                }
            }
            wasActive = active;
            if (active) checkExtractionChange();
        }, 2000);
    }

    function init() {
        setupParentMessageListener();
        startJamStateMonitor();

        // Patch as soon as the POC engine has loaded the song.
        const checkReady = setInterval(() => {
            if (engineReady()) {
                clearInterval(checkReady);
                patchTransport();
                patchTempoPitch();
                if (isJamActive()) broadcastCurrentTrack();
                console.log('[JamBridge] Initialized (POC engine ready)');
            }
        }, 500);
        setTimeout(() => clearInterval(checkReady), 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
