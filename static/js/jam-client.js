/**
 * JamClient - Shared WebSocket client for Jam Sessions
 * Used by both host (desktop/mobile) and guest interfaces.
 */
class JamClient {
    constructor(socket) {
        this.socket = socket;
        this.role = null;       // 'host' | 'guest' | null
        this.jamCode = null;
        this.active = false;
        this.participants = [];
        this.rtt = 0;
        this.rttSamples = [];
        this.maxRttSamples = 5;
        this.resyncInterval = null;
        this.trackAccepted = false;

        // Callbacks (set by jam-tab.js or mobile-app.js)
        this._onCreated = null;
        this._onJoined = null;
        this._onParticipants = null;
        this._onEnded = null;
        this._onTrackLoaded = null;
        this._onPlayback = null;
        this._onTempo = null;
        this._onPitch = null;
        this._onSync = null;
        this._onHostStatus = null;

        this._setupListeners();
    }

    _setupListeners() {
        this.socket.on('jam_created', (data) => {
            this.role = 'host';
            this.jamCode = data.code;
            this.active = true;
            console.log(`[Jam] Session created: ${data.code}`);
            this._showOnStageIndicator(data.code);
            if (this._onCreated) this._onCreated(data);
        });

        this.socket.on('jam_create_error', (data) => {
            console.error(`[Jam] Create error: ${data.error}`);
            if (this._onCreated) this._onCreated({ error: data.error });
        });

        this.socket.on('jam_joined', (data) => {
            this.role = data.role;
            this.jamCode = data.code;
            this.active = true;
            console.log(`[Jam] Joined session ${data.code} as ${data.role}`);
            this._showOnStageIndicator(data.code);
            if (this._onJoined) this._onJoined(data);
        });

        this.socket.on('jam_join_error', (data) => {
            console.error(`[Jam] Join error: ${data.error}`);
            if (this._onJoined) this._onJoined({ error: data.error });
        });

        this.socket.on('jam_participants', (data) => {
            this.participants = data.participants || [];
            if (this._onParticipants) this._onParticipants(data);
        });

        this.socket.on('jam_ended', (data) => {
            console.log(`[Jam] Session ended: ${data.reason}`);
            this._cleanup();
            if (this._onEnded) this._onEnded(data);
        });

        this.socket.on('jam_track_loaded', (data) => {
            if (this._onTrackLoaded) this._onTrackLoaded(data);
        });

        this.socket.on('jam_playback', (data) => {
            if (this._onPlayback) this._onPlayback(data);
        });

        this.socket.on('jam_tempo', (data) => {
            if (this._onTempo) this._onTempo(data);
        });

        this.socket.on('jam_pitch', (data) => {
            if (this._onPitch) this._onPitch(data);
        });

        this.socket.on('jam_sync', (data) => {
            if (this._onSync) this._onSync(data);
        });

        this.socket.on('jam_host_status', (data) => {
            console.log(`[Jam] Host status: ${data.status}`);
            if (this._onHostStatus) this._onHostStatus(data);
        });

        // RTT measurement
        this.socket.on('jam_ping', (data) => {
            this.socket.emit('jam_pong', {
                code: this.jamCode,
                server_time: data.server_time
            });
        });

        this.socket.on('jam_rtt', (data) => {
            this.rttSamples.push(data.rtt);
            if (this.rttSamples.length > this.maxRttSamples) {
                this.rttSamples.shift();
            }
            this.rtt = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
        });
    }

    // --- Host actions ---

    createSession() {
        this.socket.emit('jam_create', {});
    }

    endSession() {
        if (this.role !== 'host' || !this.jamCode) return;
        this.socket.emit('jam_end', { code: this.jamCode });
        this._cleanup();
    }

    loadTrack(extractionId, extractionData) {
        if (this.role !== 'host' || !this.active) return;
        this.socket.emit('jam_track_load', {
            code: this.jamCode,
            extraction_id: extractionId,
            extraction_data: extractionData
        });
    }

    sendPlayback(command, position, extra = {}) {
        if (this.role !== 'host' || !this.active) return;
        this.socket.emit('jam_playback', {
            code: this.jamCode,
            command: command,
            position: position || 0,
            timestamp: Date.now(),
            ...extra
        });
    }

    sendTempo(bpm, originalBpm, syncRatio) {
        if (this.role !== 'host' || !this.active) return;
        this.socket.emit('jam_tempo', {
            code: this.jamCode,
            bpm: bpm,
            original_bpm: originalBpm,
            sync_ratio: syncRatio
        });
    }

    sendPitch(pitchShift, currentKey) {
        if (this.role !== 'host' || !this.active) return;
        this.socket.emit('jam_pitch', {
            code: this.jamCode,
            pitch_shift: pitchShift,
            current_key: currentKey
        });
    }

    // --- Guest actions ---

    joinSession(code) {
        const guestName = window.JAM_GUEST_NAME || `Guest-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        this.socket.emit('jam_join', { code: code, guest_name: guestName });
    }

    leaveSession() {
        if (!this.jamCode) return;
        this.socket.emit('jam_leave', { code: this.jamCode });
        this._cleanup();
    }

    // --- Callback setters ---

    onCreated(cb)          { this._onCreated = cb; }
    onJoined(cb)           { this._onJoined = cb; }
    onParticipantUpdate(cb){ this._onParticipants = cb; }
    onSessionEnded(cb)     { this._onEnded = cb; }
    onTrackLoaded(cb)      { this._onTrackLoaded = cb; }
    onPlayback(cb)         { this._onPlayback = cb; }
    onTempo(cb)            { this._onTempo = cb; }
    onPitch(cb)            { this._onPitch = cb; }
    onSync(cb)             { this._onSync = cb; }
    onHostStatus(cb)       { this._onHostStatus = cb; }

    // --- Queries ---

    getRole()   { return this.role; }
    isActive()  { return this.active; }
    getCode()   { return this.jamCode; }

    // --- On Stage indicator ---

    _showOnStageIndicator(code) {
        const indicator = document.getElementById('onStageIndicator') ||
                          document.getElementById('onStageBanner');
        if (indicator) {
            indicator.style.display = 'flex';
            const textEl = indicator.querySelector('.on-stage-text');
            if (textEl) textEl.textContent = `ON STAGE - ${code}`;
        }
    }

    _hideOnStageIndicator() {
        const indicator = document.getElementById('onStageIndicator') ||
                          document.getElementById('onStageBanner');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    // --- Internal ---

    _cleanup() {
        this.role = null;
        this.jamCode = null;
        this.active = false;
        this.participants = [];
        this.trackAccepted = false;
        this.rtt = 0;
        this.rttSamples = [];
        if (this.resyncInterval) {
            clearInterval(this.resyncInterval);
            this.resyncInterval = null;
        }
        this._hideOnStageIndicator();

        // Update parent window jam state (for iframe communication)
        try {
            if (window.parent && window.parent.jamState) {
                window.parent.jamState.active = false;
                window.parent.jamState.code = null;
            }
        } catch (e) { /* cross-origin */ }
    }

    destroy() {
        this._cleanup();
        // Remove socket listeners
        const events = [
            'jam_created', 'jam_joined', 'jam_join_error', 'jam_participants',
            'jam_ended', 'jam_track_loaded', 'jam_playback', 'jam_tempo',
            'jam_pitch', 'jam_sync', 'jam_ping', 'jam_rtt', 'jam_host_status'
        ];
        events.forEach(e => this.socket.off(e));
    }
}

// Export for use in different contexts
if (typeof window !== 'undefined') {
    window.JamClient = JamClient;
}
