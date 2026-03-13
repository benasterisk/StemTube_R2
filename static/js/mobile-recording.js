/**
 * Mobile Recording Engine
 *
 * Handles recording, playback, and track management on mobile.
 * Uses RecordingUtils for shared logic (WAV encoding, server I/O, etc.).
 * Follows the mixer module pattern: class receives the app instance.
 */
class MobileRecordingEngine {

    constructor(app) {
        this.app = app;
        this.tracks = [];
        this.phase = 'setup';       // 'setup' | 'recording'
        this.instrument = 'off';    // 'off' | 'vocals' | 'bass' | 'drums' | 'other'
        this.fxPreset = 'off';
        this.overlayOpen = false;

        // Mic state
        this.stream = null;
        this.micSource = null;
        this.analyser = null;
        this.monitorGain = null;
        this.mediaRecorder = null;
        this.chunks = [];
        this.startTime = 0;
        this.timerInterval = null;
        this.levelAnimId = null;
        this.liveWaveformData = [];
        this.calibratedLatency = null;
    }

    // ── Setup ────────────────────────────────────────────────────

    setup() {
        // Transport bar record button
        const recBtn = document.getElementById('mobileRecordBtn');
        if (recBtn) {
            recBtn.addEventListener('click', () => {
                console.log('[Recording] Record button tapped, phase:', this.phase);
                if (this.phase === 'recording') {
                    this.stop();
                } else {
                    this.openOverlay();
                }
            });
        }

        // Close button
        const closeBtn = document.getElementById('mobileRecClose');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeOverlay());

        // Instrument selector
        document.querySelectorAll('.mobile-rec-instrument').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mobile-rec-instrument').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.instrument = btn.dataset.instrument;
                this._updateFxDesc();
            });
        });

        // FX preset selector
        const fxSelect = document.getElementById('mobileRecFxSelect');
        if (fxSelect) {
            fxSelect.addEventListener('change', () => {
                this.fxPreset = fxSelect.value;
                this._updateFxDesc();
            });
        }

        // Monitor slider
        const monitorSlider = document.getElementById('mobileRecMonitorSlider');
        if (monitorSlider) {
            monitorSlider.addEventListener('input', () => {
                const val = parseFloat(monitorSlider.value);
                const display = document.getElementById('mobileRecMonitorVal');
                if (display) display.textContent = `${Math.round(val * 100)}%`;
                if (this.monitorGain) this.monitorGain.gain.value = val;
            });
        }

        // Start recording
        const startBtn = document.getElementById('mobileRecStartBtn');
        if (startBtn) startBtn.addEventListener('click', () => this.start());

        // Stop recording
        const stopBtn = document.getElementById('mobileRecStopBtn');
        if (stopBtn) stopBtn.addEventListener('click', () => this.stop());

        // Minimize during recording
        const minimizeBtn = document.getElementById('mobileRecMinimizeBtn');
        if (minimizeBtn) minimizeBtn.addEventListener('click', () => this._minimize());

        // Floating minibar controls
        const minibarStop = document.getElementById('mobileRecMinibarStop');
        if (minibarStop) minibarStop.addEventListener('click', () => this.stop());

        const minibarExpand = document.getElementById('mobileRecMinibarExpand');
        if (minibarExpand) minibarExpand.addEventListener('click', () => this._expand());

        // De-bleed socket listeners
        if (this.app.socket) {
            this.app.socket.on('debleed_complete', (data) => {
                const rec = this.tracks.find(r => r.serverId === data.recording_id);
                if (rec && data.url) {
                    this._reloadTrackAudio(rec, data.url);
                    this.app.showToast('De-bleed complete', 'success');
                }
            });
            this.app.socket.on('debleed_error', (data) => {
                const rec = this.tracks.find(r => r.serverId === data.recording_id);
                if (rec) {
                    console.warn('[Recording] De-bleed failed for', rec.name);
                    this.app.showToast('De-bleed failed', 'error');
                }
            });
        }
    }

    // ── Overlay Management ───────────────────────────────────────

    openOverlay() {
        if (!this.app.currentExtractionId) {
            this.app.showToast('Load a track first', 'warning');
            return;
        }
        const overlay = document.getElementById('mobileRecordingOverlay');
        if (!overlay) return;

        this.overlayOpen = true;
        this.phase = 'setup';
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this._showPhase('setup');
        this._initMic();
    }

    closeOverlay() {
        if (this.phase === 'recording') {
            this._minimize();
            return;
        }
        const overlay = document.getElementById('mobileRecordingOverlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
        this.overlayOpen = false;

        const minibar = document.getElementById('mobileRecMinibar');
        if (minibar) minibar.style.display = 'none';
        this._cleanupMic();
    }

    _minimize() {
        const overlay = document.getElementById('mobileRecordingOverlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';

        const minibar = document.getElementById('mobileRecMinibar');
        if (minibar) minibar.style.display = 'flex';
        this.overlayOpen = false;
    }

    _expand() {
        const overlay = document.getElementById('mobileRecordingOverlay');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        const minibar = document.getElementById('mobileRecMinibar');
        if (minibar) minibar.style.display = 'none';
        this.overlayOpen = true;
    }

    _showPhase(phase) {
        this.phase = phase;
        document.querySelectorAll('.mobile-rec-phase').forEach(p => p.classList.remove('active'));
        const target = document.getElementById(
            phase === 'setup' ? 'mobileRecSetup' : 'mobileRecRecording'
        );
        if (target) target.classList.add('active');
    }

    // ── Microphone Management ────────────────────────────────────

    async _initMic() {
        try {
            if (!this.app.audioContext) await this.app.initAudioContext();

            const deviceId = document.getElementById('mobileRecDeviceSelect')?.value || undefined;
            const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);

            this.micSource = this.app.audioContext.createMediaStreamSource(this.stream);
            this.analyser = this.app.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.micSource.connect(this.analyser);

            this.monitorGain = this.app.audioContext.createGain();
            this.monitorGain.gain.value = parseFloat(
                document.getElementById('mobileRecMonitorSlider')?.value || 0
            );
            this.micSource.connect(this.monitorGain);
            this.monitorGain.connect(this.app.audioContext.destination);

            this._startLevelMeter();
            this._populateDevices();

            const recBtn = document.getElementById('mobileRecordBtn');
            if (recBtn) recBtn.style.display = '';
        } catch (err) {
            console.warn('[Recording] Mic init failed:', err);
        }
    }

    async _populateDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const select = document.getElementById('mobileRecDeviceSelect');
            if (!select) return;
            select.innerHTML = '';
            audioInputs.forEach((d, i) => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Microphone ${i + 1}`;
                select.appendChild(opt);
            });
        } catch (e) { /* ignore */ }
    }

    _cleanupMic() {
        this._stopLevelMeter();
        if (this.monitorGain) {
            try { this.monitorGain.disconnect(); } catch (e) {}
            this.monitorGain = null;
        }
        if (this.micSource) {
            try { this.micSource.disconnect(); } catch (e) {}
            this.micSource = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.analyser = null;
    }

    // ── Level Meter & Waveform ───────────────────────────────────

    _startLevelMeter() {
        if (this.levelAnimId) return;
        if (!this.analyser) return;
        const data = new Uint8Array(this.analyser.frequencyBinCount);

        const update = () => {
            this.analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const level = sum / (data.length * 255);

            const fillId = this.phase === 'recording' ? 'mobileRecLiveLevelFill' : 'mobileRecLevelFill';
            const fill = document.getElementById(fillId);
            if (fill) fill.style.width = `${Math.min(100, level * 100 * 3)}%`;

            if (this.phase === 'recording') {
                this.liveWaveformData.push(level);
                this._drawLiveWaveform();
            }
            this.levelAnimId = requestAnimationFrame(update);
        };
        this.levelAnimId = requestAnimationFrame(update);
    }

    _stopLevelMeter() {
        if (this.levelAnimId) {
            cancelAnimationFrame(this.levelAnimId);
            this.levelAnimId = null;
        }
    }

    _drawLiveWaveform() {
        const canvas = document.getElementById('mobileRecLiveCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const container = canvas.parentElement;
        canvas.width = container.offsetWidth * dpr;
        canvas.height = container.offsetHeight * dpr;
        const w = canvas.width, h = canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#e53935';

        const maxBars = Math.floor(w / 3);
        const start = Math.max(0, this.liveWaveformData.length - maxBars);
        const visible = this.liveWaveformData.slice(start);

        for (let i = 0; i < visible.length; i++) {
            const barH = Math.max(1, visible[i] * h * 0.9);
            const x = i * 3;
            ctx.fillRect(x, (h - barH) / 2, 2, barH);
        }
    }

    _updateFxDesc() {
        const desc = document.getElementById('mobileRecFxDesc');
        if (!desc) return;
        if (typeof RecordingEffects !== 'undefined') {
            desc.textContent = RecordingEffects.describePreset(this.instrument, this.fxPreset);
        } else {
            desc.textContent = '';
        }
    }

    // ── Recording Start / Stop ───────────────────────────────────

    async start() {
        const ctx = this.app.audioContext;
        if (!ctx) await this.app.initAudioContext();
        if (ctx && ctx.state === 'suspended') await ctx.resume();

        if (!this.stream) await this._initMic();
        if (!this.stream) return;

        // Estimate latency (instant, cached in localStorage)
        this.calibratedLatency = RecordingUtils.estimateLatency(this.app.audioContext);

        const mimeType = RecordingUtils.getSupportedMimeType();

        // Start MediaRecorder
        this.chunks = [];
        this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.chunks.push(e.data);
        };
        this.mediaRecorder.start(100);

        this.startTime = this.app.playbackPosition || this.app.currentTime || 0;
        this.liveWaveformData = [];
        this._showPhase('recording');

        // Timer (updates both overlay and minibar)
        const timerEl = document.getElementById('mobileRecTimer');
        const minibarTimerEl = document.getElementById('mobileRecMinibarTimer');
        const startWall = Date.now();
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startWall) / 1000);
            const min = Math.floor(elapsed / 60);
            const sec = elapsed % 60;
            const text = `${min}:${sec.toString().padStart(2, '0')}`;
            if (timerEl) timerEl.textContent = text;
            if (minibarTimerEl) minibarTimerEl.textContent = text;
        }, 250);

        const transportBtn = document.getElementById('mobileRecordBtn');
        if (transportBtn) transportBtn.classList.add('recording');

        // Start playback if not already playing
        if (!this.app.isPlaying) {
            this.app.togglePlayback();
        }

        console.log('[Recording] Started at position:', this.startTime.toFixed(2));
    }

    async stop() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        const minibar = document.getElementById('mobileRecMinibar');
        if (minibar) minibar.style.display = 'none';
        const transportBtn = document.getElementById('mobileRecordBtn');
        if (transportBtn) transportBtn.classList.remove('recording');

        // Stop MediaRecorder and collect blob
        const blob = await new Promise(resolve => {
            this.mediaRecorder.onstop = () => {
                resolve(new Blob(this.chunks, { type: this.chunks[0]?.type || 'audio/webm' }));
            };
            this.mediaRecorder.stop();
        });

        // Decode with iOS fallback
        let audioBuffer;
        try {
            audioBuffer = await RecordingUtils.decodeAudioBlob(this.app.audioContext, blob);
        } catch (err) {
            console.error('[Recording] All decode methods failed:', err);
            this.app.showToast('Recording failed', 'error');
            this._showPhase('setup');
            return;
        }

        // Apply latency compensation
        try {
            audioBuffer = RecordingUtils.applyLatencyCompensation(
                this.app.audioContext, audioBuffer, this.calibratedLatency || 0
            );
        } catch (e) {
            console.warn('[Recording] Latency comp failed, using raw buffer');
        }

        // Create track object
        const recNum = this.tracks.length + 1;
        const name = (this.instrument === 'off')
            ? `Recording ${recNum}`
            : `${this.instrument.charAt(0).toUpperCase() + this.instrument.slice(1)} Take`;

        const track = {
            id: `rec_${Date.now()}`,
            name,
            audioBuffer,
            startOffset: this.startTime,
            serverId: null,
            gainNode: null,
            sourceNode: null,
            volume: 1,
            muted: false,
            solo: false,
        };

        if (this.app.audioContext) {
            track.gainNode = this.app.audioContext.createGain();
            track.gainNode.connect(this.app.masterGainNode || this.app.audioContext.destination);
        }

        this.tracks.push(track);
        console.log('[Recording] Auto-kept:', name, 'duration:', audioBuffer.duration.toFixed(2));

        // Close overlay and switch to Mix tab
        this.phase = 'setup';
        this.closeOverlay();
        this.app.switchMixerTab('controls');

        this.createTrackControl(track);
        this.app.showToast(`${name} saved`, 'success');

        // Save to server in background
        this._saveTrackToServer(track);
    }

    // ── Server Persistence ───────────────────────────────────────

    async _saveTrackToServer(track) {
        if (!track.audioBuffer || !this.app.currentExtractionId) return;

        const wavBlob = RecordingUtils.audioBufferToWav(track.audioBuffer);
        try {
            const data = await RecordingUtils.saveToServer(
                wavBlob, track.name, track.startOffset, this.app.currentExtractionId
            );
            track.serverId = data.id;
            console.log('[Recording] Saved to server:', data.id);

            if (this.instrument && this.instrument !== 'off') {
                await RecordingUtils.requestDebleed(data.id, this.instrument);
                this.app.showToast(`De-bleed (${this.instrument}) started`, 'info');
            }
        } catch (err) {
            console.error('[Recording] Save failed:', err);
            this.app.showToast('Recording save failed', 'error');
        }
    }

    async _reloadTrackAudio(track, url) {
        if (!url || !this.app.audioContext) return;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return;
            const buf = await resp.arrayBuffer();
            track.audioBuffer = await this.app.audioContext.decodeAudioData(buf);
            console.log('[Recording] Reloaded de-bleeded audio for', track.name);
        } catch (e) {
            console.warn('[Recording] Reload failed:', e);
        }
    }

    async loadFromServer(downloadId) {
        try {
            const recordings = await RecordingUtils.fetchRecordings(downloadId);
            if (!recordings.length) return;

            const ctx = this.app.audioContext;
            for (const recData of recordings) {
                const fileResp = await fetch(recData.url);
                if (!fileResp.ok) continue;
                const arrayBuffer = await fileResp.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

                const track = {
                    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: recData.name,
                    audioBuffer,
                    startOffset: recData.start_offset || 0,
                    serverId: recData.id,
                    gainNode: null,
                    sourceNode: null,
                    volume: 1,
                    muted: false,
                    solo: false,
                };
                track.gainNode = ctx.createGain();
                track.gainNode.connect(this.app.masterGainNode || ctx.destination);
                this.tracks.push(track);
                this.createTrackControl(track);
            }
            console.log(`[Recording] Loaded ${recordings.length} recordings from server`);
        } catch (err) {
            console.warn('[Recording] Could not load recordings:', err);
        }
    }

    // ── Track Playback ───────────────────────────────────────────

    playAllTracks(currentTime) {
        const ctx = this.app.audioContext;
        if (!ctx) return;

        for (const rec of this.tracks) {
            if (!rec.audioBuffer) continue;
            if (rec.sourceNode) {
                try { rec.sourceNode.stop(); } catch (e) {}
                rec.sourceNode = null;
            }

            const source = ctx.createBufferSource();
            source.buffer = rec.audioBuffer;
            source.connect(rec.gainNode || ctx.destination);
            rec.sourceNode = source;

            if (currentTime >= rec.startOffset) {
                const bufferOffset = currentTime - rec.startOffset;
                if (bufferOffset < rec.audioBuffer.duration) {
                    source.start(0, bufferOffset);
                }
            } else {
                const delay = rec.startOffset - currentTime;
                source.start(ctx.currentTime + delay, 0);
            }
        }
    }

    stopAllTracks() {
        for (const rec of this.tracks) {
            if (rec.sourceNode) {
                try { rec.sourceNode.stop(); } catch (e) {}
                rec.sourceNode = null;
            }
        }
    }

    clearTracks() {
        this.stopAllTracks();
        for (const rec of this.tracks) {
            if (rec.gainNode) { try { rec.gainNode.disconnect(); } catch (e) {} }
        }
        this.tracks = [];
        document.querySelectorAll('.mobile-track.recording-track').forEach(el => el.remove());
    }

    // ── Solo / Gain Integration ──────────────────────────────────

    /**
     * Check if any track (stem or recording) has solo active.
     */
    hasAnySolo() {
        const stemSolo = Object.values(this.app.stems).some(x => x.solo);
        const recSolo = this.tracks.some(t => t.solo);
        return stemSolo || recSolo;
    }

    /**
     * Update gain for a single recording track (respects solo/mute).
     */
    updateTrackGain(track) {
        if (!track.gainNode) return;
        const hasSolo = this.hasAnySolo();
        let gain = track.volume;
        if (track.muted || (hasSolo && !track.solo)) gain = 0;
        track.gainNode.gain.value = gain;
    }

    /**
     * Update all recording track gains.
     */
    updateAllTrackGains() {
        for (const track of this.tracks) {
            this.updateTrackGain(track);
        }
    }

    // ── Track UI ─────────────────────────────────────────────────

    createTrackControl(track) {
        const container = document.getElementById('mobileTracksContainer');
        if (!container) {
            console.error('[Recording] mobileTracksContainer not found!');
            return;
        }
        console.log('[Recording] Creating track control:', track.name);

        const div = document.createElement('div');
        div.className = 'mobile-track recording-track';
        div.id = `mobile-rec-track-${track.id}`;
        div.innerHTML = '<div class="mobile-track-header">'
            + '<span class="mobile-track-name"><i class="fas fa-microphone-alt" style="color:#e53935;margin-right:6px;font-size:12px;"></i>' + track.name + '</span>'
            + '<div class="mobile-track-buttons">'
            + '<button class="mobile-track-btn mute-btn">MUTE</button>'
            + '<button class="mobile-track-btn solo-btn">SOLO</button>'
            + '<button class="mobile-track-btn delete-btn" style="color:#e53935;">DEL</button>'
            + '</div></div>'
            + '<div class="mobile-track-controls">'
            + '<div class="mobile-track-control"><span class="mobile-track-label">Volume</span>'
            + '<input type="range" class="mobile-track-slider volume-slider" min="0" max="100" value="100">'
            + '<span class="mobile-track-value">100%</span></div></div>';

        const engine = this;

        // Volume slider
        div.querySelector('.volume-slider').addEventListener('input', (e) => {
            const v = parseInt(e.target.value);
            e.target.nextElementSibling.textContent = v + '%';
            track.volume = v / 100;
            engine.updateTrackGain(track);
        });

        // Mute button
        const muteBtn = div.querySelector('.mute-btn');
        muteBtn.addEventListener('click', () => {
            track.muted = !track.muted;
            muteBtn.classList.toggle('active');
            engine.updateTrackGain(track);
        });

        // Solo button
        const soloBtn = div.querySelector('.solo-btn');
        soloBtn.addEventListener('click', () => {
            track.solo = !track.solo;
            soloBtn.classList.toggle('active');
            engine.app.updateAllGains();
        });

        // Delete button
        div.querySelector('.delete-btn').addEventListener('click', () => {
            if (track.sourceNode) { try { track.sourceNode.stop(); } catch (e) {} }
            if (track.gainNode) { try { track.gainNode.disconnect(); } catch (e) {} }
            if (track.serverId) {
                RecordingUtils.deleteFromServer(track.serverId).catch(() => {});
            }
            const idx = engine.tracks.indexOf(track);
            if (idx >= 0) engine.tracks.splice(idx, 1);
            div.remove();
            engine.app.showToast(`${track.name} deleted`, 'success');
            engine.app.updateAllGains();
        });

        container.appendChild(div);
    }
}
