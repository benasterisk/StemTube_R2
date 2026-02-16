/**
 * RecordingEngine — Multi-track recording with per-track input devices,
 * latency compensation and speaker bleed removal.
 *
 * Each recording track has its own input device selector. Multiple armed tracks
 * record simultaneously. The global Record button starts/stops recording on all
 * armed tracks without creating new tracks.
 */

class RecordingEngine {
    constructor(mixer) {
        this.mixer = mixer;

        // Recording tracks
        this.recordings = [];
        this.nextRecordingNumber = 1;
        this.isRecording = false;
        this.recordingStartOffset = 0;

        // Per-device stream pool: deviceId → { stream, micSource, monitorGain, analyser }
        this.deviceStreams = new Map();

        // Active recorders during recording: deviceId → { recorder, chunks, refRecorder, refChunks, refDestination }
        this.activeRecorders = new Map();

        // Track IDs being recorded into (snapshot at recording start)
        this.recordingTrackIds = [];

        // Live waveform state
        this.liveWaveformData = new Map(); // trackId → array of peak values
        this.liveWaveformAnimId = null;

        // Latency compensation (seconds)
        this.calibratedLatency = this._loadCalibratedLatency();
        this.isCalibrating = false;

        // Bleed removal
        this.bleedRemovalEnabled = true;
    }

    // ── Device Stream Management ─────────────────────────────────

    /**
     * Initialize (or reuse) a microphone stream for a given device.
     * @param {string} [deviceId] — input device ID (falsy = default)
     * @returns {Promise<Object>} { stream, micSource, monitorGain, analyser }
     */
    async initDeviceStream(deviceId) {
        const key = deviceId || 'default';

        // Reuse existing stream if active
        if (this.deviceStreams.has(key)) {
            const existing = this.deviceStreams.get(key);
            if (existing.stream.active) return existing;
            this._cleanupDeviceStream(key);
        }

        const ctx = this._getAudioContext();
        if (!ctx) throw new Error('AudioContext not available');

        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false,
            },
        };
        if (deviceId) {
            constraints.audio.deviceId = { exact: deviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const micSource = ctx.createMediaStreamSource(stream);

        const monitorGain = ctx.createGain();
        monitorGain.gain.value = 0; // monitoring off by default

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;

        micSource.connect(analyser);
        micSource.connect(monitorGain);
        monitorGain.connect(this.mixer.audioEngine.masterGainNode);

        const entry = { stream, micSource, monitorGain, analyser };
        this.deviceStreams.set(key, entry);
        console.log('[RecordingEngine] Device stream initialized:', key);
        return entry;
    }

    /**
     * Clean up a single device stream.
     * @private
     */
    _cleanupDeviceStream(key) {
        const entry = this.deviceStreams.get(key);
        if (!entry) return;
        entry.stream.getTracks().forEach(t => t.stop());
        if (entry.micSource) entry.micSource.disconnect();
        if (entry.monitorGain) entry.monitorGain.disconnect();
        if (entry.analyser) entry.analyser.disconnect();
        this.deviceStreams.delete(key);
    }

    /**
     * Enumerate audio input devices.
     * @returns {Promise<MediaDeviceInfo[]>}
     */
    async getInputDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d => d.kind === 'audioinput');
    }

    // ── Per-Track Device Controls ────────────────────────────────

    /**
     * Set the input device for a track and open its stream.
     * @param {string} trackId
     * @param {string} deviceId
     */
    async setTrackDevice(trackId, deviceId) {
        const rec = this._findRecording(trackId);
        if (!rec) return;
        rec.deviceId = deviceId;
        if (deviceId) {
            await this.initDeviceStream(deviceId);
        }
    }

    /**
     * Get the input level for a track (reads from its device analyser).
     * @param {string} trackId
     * @returns {number} 0–1
     */
    getTrackInputLevel(trackId) {
        const rec = this._findRecording(trackId);
        if (!rec) return 0;
        const key = rec.deviceId || 'default';
        const entry = this.deviceStreams.get(key);
        if (!entry || !entry.analyser) return 0;

        const data = new Uint8Array(entry.analyser.frequencyBinCount);
        entry.analyser.getByteTimeDomainData(data);
        let max = 0;
        for (let i = 0; i < data.length; i++) {
            const amplitude = Math.abs(data[i] - 128) / 128;
            if (amplitude > max) max = amplitude;
        }
        return max;
    }

    /**
     * Set monitor volume for a track's input device.
     * @param {string} trackId
     * @param {number} value — 0 to 1
     */
    setTrackMonitorVolume(trackId, value) {
        const rec = this._findRecording(trackId);
        if (!rec) return;
        const key = rec.deviceId || 'default';
        const entry = this.deviceStreams.get(key);
        if (entry && entry.monitorGain) {
            entry.monitorGain.gain.value = value;
        }
    }

    // ── Latency Compensation ─────────────────────────────────────

    /**
     * Get the effective latency for compensation (seconds).
     * Uses calibrated value if available, falls back to Web Audio API estimate.
     */
    getEffectiveLatency() {
        if (this.calibratedLatency > 0) return this.calibratedLatency;
        const ctx = this._getAudioContext();
        if (!ctx) return 0;
        return (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    }

    /**
     * Automatic loopback calibration: plays a short click through speakers,
     * records it via the mic, and measures the round-trip delay via cross-correlation.
     * Result is stored in localStorage so the user only calibrates once per device.
     * @returns {Promise<number>} calibrated latency in seconds
     */
    async calibrateLatency() {
        if (this.isCalibrating) return this.calibratedLatency;
        this.isCalibrating = true;

        try {
            const ctx = this._getAudioContext();
            if (!ctx) throw new Error('No AudioContext available');

            // Ensure at least one mic stream is active
            if (this.deviceStreams.size === 0) {
                await this.initDeviceStream();
            }
            const entry = this.deviceStreams.values().next().value;
            if (!entry) throw new Error('No microphone available');
            const sampleRate = ctx.sampleRate;
            const stabilizeMs = 150; // ms to wait before playing click

            // 1. Create a short click signal (1ms impulse)
            const clickSamples = Math.ceil(sampleRate * 0.001);
            const clickBuffer = ctx.createBuffer(1, clickSamples, sampleRate);
            const clickData = clickBuffer.getChannelData(0);
            for (let i = 0; i < clickSamples; i++) {
                clickData[i] = 1.0;
            }

            // 2. Capture mic input via MediaRecorder (additive connect — doesn't affect existing graph)
            const captureStream = ctx.createMediaStreamDestination();
            entry.micSource.connect(captureStream);

            const chunks = [];
            const recorder = new MediaRecorder(captureStream.stream);
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.start();

            // Wait for recorder to stabilize
            await new Promise(r => setTimeout(r, stabilizeMs));

            // 3. Play the click through speakers
            const clickSource = ctx.createBufferSource();
            clickSource.buffer = clickBuffer;
            clickSource.connect(ctx.destination);
            clickSource.start();

            // 4. Capture for 400ms (enough for room echo)
            await new Promise(r => setTimeout(r, 400));

            // 5. Stop and decode
            const recordedBlob = await this._stopMediaRecorder(recorder, chunks);
            entry.micSource.disconnect(captureStream); // remove only the calibration tap

            const arrayBuf = await recordedBlob.arrayBuffer();
            const recordedBuffer = await ctx.decodeAudioData(arrayBuf);
            const recorded = recordedBuffer.getChannelData(0);

            // 6. Find the click peak in the recording
            // Skip initial noise from recorder start (~50ms)
            const skipSamples = Math.ceil(sampleRate * 0.05);
            let clickPositionSample = -1;

            // Use adaptive threshold: 4x the RMS of the quiet zone
            let sumSq = 0;
            const noiseEnd = Math.min(skipSamples, recorded.length);
            for (let i = 0; i < noiseEnd; i++) sumSq += recorded[i] * recorded[i];
            const rms = Math.sqrt(sumSq / Math.max(1, noiseEnd));
            const threshold = Math.max(0.05, rms * 4);

            for (let i = skipSamples; i < recorded.length; i++) {
                if (Math.abs(recorded[i]) > threshold) {
                    clickPositionSample = i;
                    break;
                }
            }

            if (clickPositionSample < 0) {
                console.warn('[RecordingEngine] Calibration: click not detected — using API estimate');
                this.calibratedLatency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
            } else {
                // Round-trip = time from recorder start to click detection, minus stabilization wait
                const roundTrip = (clickPositionSample / sampleRate) - (stabilizeMs / 1000);
                // Recording latency ≈ half the round-trip
                this.calibratedLatency = Math.max(0, roundTrip / 2);
            }

            this._saveCalibratedLatency(this.calibratedLatency);
            console.log(`[RecordingEngine] Calibrated latency: ${(this.calibratedLatency * 1000).toFixed(1)}ms (sample pos: ${clickPositionSample})`);
            return this.calibratedLatency;
        } finally {
            this.isCalibrating = false;
        }
    }

    /** Load calibrated latency from localStorage (seconds). */
    _loadCalibratedLatency() {
        const val = localStorage.getItem('stemtube_calibrated_latency');
        return val ? parseFloat(val) : 0;
    }

    /** Save calibrated latency to localStorage (seconds). */
    _saveCalibratedLatency(seconds) {
        localStorage.setItem('stemtube_calibrated_latency', seconds.toString());
    }

    /** Clear calibration and revert to auto-detect. */
    resetCalibration() {
        this.calibratedLatency = 0;
        localStorage.removeItem('stemtube_calibrated_latency');
    }

    /**
     * Trim the start of an AudioBuffer to compensate for latency.
     * @param {AudioBuffer} buffer
     * @returns {AudioBuffer}
     */
    applyLatencyCompensation(buffer) {
        const latency = this.getEffectiveLatency();
        const samplesToTrim = Math.max(0, Math.round(latency * buffer.sampleRate));
        if (samplesToTrim <= 0 || samplesToTrim >= buffer.length) return buffer;

        const ctx = this._getAudioContext();
        const newLength = buffer.length - samplesToTrim;
        const trimmed = ctx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const src = buffer.getChannelData(ch);
            trimmed.getChannelData(ch).set(src.subarray(samplesToTrim));
        }
        return trimmed;
    }

    // ── Track Management (DAW-style) ─────────────────────────────

    /**
     * Add an empty recording track (no audio yet).
     * @returns {Object} the new empty recording object
     */
    addEmptyTrack() {
        const ctx = this._getAudioContext();
        if (!ctx) return null;

        const id = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const gainNode = ctx.createGain();
        const panNode = ctx.createStereoPanner();
        gainNode.connect(panNode);
        panNode.connect(this.mixer.audioEngine.masterGainNode);

        const recording = {
            id,
            name: `Recording ${this.nextRecordingNumber++}`,
            audioBuffer: null,
            startOffset: 0,
            gainNode,
            panNode,
            sourceNode: null,
            volume: 1.0,
            pan: 0,
            muted: false,
            solo: false,
            saved: false,
            serverId: null,
            armed: false,
            deviceId: null,
        };

        this.recordings.push(recording);
        console.log('[RecordingEngine] Empty track added:', recording.name);
        return recording;
    }

    /**
     * Arm a recording track. Multiple tracks can be armed simultaneously.
     * During an active recording session this acts as "punch in".
     * @param {string} id
     */
    armTrack(id) {
        const rec = this._findRecording(id);
        if (!rec) return;
        rec.armed = true;

        const armBtn = document.querySelector(`#rec-track-${id} .rec-arm-btn`);
        if (armBtn) armBtn.classList.add('active');

        // Punch in: join the active recording session
        if (this.isRecording) {
            if (!this.recordingTrackIds.includes(id)) {
                this.recordingTrackIds.push(id);
            }
            const trackEl = document.getElementById(`rec-track-${id}`);
            if (trackEl) trackEl.classList.add('is-recording');

            // Ensure this track's device has an active recorder
            const key = rec.deviceId || 'default';
            if (!this.activeRecorders.has(key)) {
                this._startDeviceRecorder(key);
            }
        }
    }

    /**
     * Disarm a recording track.
     * During an active recording session this acts as "punch out" for this track.
     * The global session continues — only Stop or global REC stops it.
     * @param {string} id
     */
    disarmTrack(id) {
        const rec = this._findRecording(id);
        if (!rec) return;
        rec.armed = false;

        const armBtn = document.querySelector(`#rec-track-${id} .rec-arm-btn`);
        if (armBtn) armBtn.classList.remove('active');

        // Punch out: leave the session but don't stop it
        if (this.isRecording) {
            const idx = this.recordingTrackIds.indexOf(id);
            if (idx !== -1) this.recordingTrackIds.splice(idx, 1);

            const trackEl = document.getElementById(`rec-track-${id}`);
            if (trackEl) trackEl.classList.remove('is-recording');
            // Session keeps running — global REC or Stop will end it
        }
    }

    /**
     * Get all currently armed tracks.
     * @returns {Object[]}
     */
    getArmedTracks() {
        return this.recordings.filter(r => r.armed);
    }

    // ── Recording ─────────────────────────────────────────────────

    /**
     * Start recording on all armed tracks.
     * Groups armed tracks by deviceId and creates one MediaRecorder per device.
     * @param {number} timelinePosition — current playback position in seconds
     * @returns {boolean} true if recording started
     */
    async startRecording(timelinePosition) {
        if (this.isRecording) return false;

        const armedTracks = this.getArmedTracks();
        if (armedTracks.length === 0) return false;

        this.recordingStartOffset = timelinePosition;
        this.recordingTrackIds = armedTracks.map(r => r.id);
        this.activeRecorders.clear();

        // Collect unique device keys from armed tracks
        const deviceKeys = new Set();
        for (const track of armedTracks) {
            deviceKeys.add(track.deviceId || 'default');
        }

        // Start a MediaRecorder for each unique device
        for (const key of deviceKeys) {
            await this._startDeviceRecorder(key);
        }

        this.isRecording = true;
        console.log('[RecordingEngine] Recording started at offset:', timelinePosition.toFixed(2),
            's — armed tracks:', armedTracks.length);

        // Start live waveform visualization
        this._startLiveWaveform();

        return true;
    }

    /**
     * Start a MediaRecorder for a given device key.
     * Used by startRecording() and by armTrack() for punch-in on a new device.
     * @param {string} key — device key ('default' or deviceId)
     * @private
     */
    async _startDeviceRecorder(key) {
        if (this.activeRecorders.has(key)) return; // already recording on this device

        // Ensure stream is open
        if (!this.deviceStreams.has(key) || !this.deviceStreams.get(key).stream.active) {
            await this.initDeviceStream(key === 'default' ? '' : key);
        }

        const deviceEntry = this.deviceStreams.get(key);
        if (!deviceEntry) return;

        const chunks = [];
        const recorder = new MediaRecorder(deviceEntry.stream, {
            mimeType: this._getSupportedMimeType(),
        });
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.start(100);

        const info = { recorder, chunks, refRecorder: null, refChunks: [], refDestination: null };

        // Reference recorder for bleed removal
        if (this.bleedRemovalEnabled) {
            try {
                const ctx = this._getAudioContext();
                const refDest = ctx.createMediaStreamDestination();
                this.mixer.audioEngine.masterGainNode.connect(refDest);
                const refChunks = [];
                const refRecorder = new MediaRecorder(refDest.stream, {
                    mimeType: this._getSupportedMimeType(),
                });
                refRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) refChunks.push(e.data);
                };
                refRecorder.start(100);
                info.refRecorder = refRecorder;
                info.refChunks = refChunks;
                info.refDestination = refDest;
            } catch (err) {
                console.warn('[RecordingEngine] Reference recorder failed:', err);
            }
        }

        this.activeRecorders.set(key, info);
        console.log('[RecordingEngine] Device recorder started:', key);
    }

    /**
     * Stop recording and fill all armed tracks with captured audio.
     * Tracks remain armed for easy re-recording.
     * @returns {Promise<Object[]>} array of recording objects that received audio
     */
    async stopRecording() {
        if (!this.isRecording) return [];
        this.isRecording = false;

        // Stop live waveform before processing
        this._stopLiveWaveform();

        const ctx = this._getAudioContext();
        const decodedAudio = new Map(); // deviceKey → processed AudioBuffer

        // Stop all recorders and decode
        for (const [key, info] of this.activeRecorders) {
            const micBlob = await this._stopMediaRecorder(info.recorder, info.chunks);
            let refBlob = null;
            if (info.refRecorder && info.refRecorder.state !== 'inactive') {
                refBlob = await this._stopMediaRecorder(info.refRecorder, info.refChunks);
            }
            if (info.refDestination) {
                info.refDestination.disconnect();
            }

            const arrayBuffer = await micBlob.arrayBuffer();
            let audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            audioBuffer = this.applyLatencyCompensation(audioBuffer);

            // Bleed removal
            if (this.bleedRemovalEnabled && refBlob) {
                try {
                    const refArr = await refBlob.arrayBuffer();
                    const refBuf = await ctx.decodeAudioData(refArr);
                    audioBuffer = this.removeBleed(audioBuffer, refBuf);
                    console.log('[RecordingEngine] Bleed removal applied for device:', key);
                } catch (err) {
                    console.warn('[RecordingEngine] Bleed removal failed for device:', key, err);
                }
            }

            decodedAudio.set(key, audioBuffer);
        }
        this.activeRecorders.clear();

        // Fill each armed track with its device's audio
        const results = [];
        for (const trackId of this.recordingTrackIds) {
            const rec = this._findRecording(trackId);
            if (!rec) continue;

            const key = rec.deviceId || 'default';
            const audioBuffer = decodedAudio.get(key);
            if (!audioBuffer) continue;

            rec.audioBuffer = audioBuffer;
            rec.startOffset = this.recordingStartOffset;
            rec.saved = false;
            // Keep armed for easy re-record

            // Update track UI
            const trackEl = document.getElementById(`rec-track-${rec.id}`);
            if (trackEl) {
                trackEl.classList.remove('empty-track', 'is-recording');
                if (this.mixer.waveform) {
                    this.mixer.waveform.renderRecordingWaveform(rec, trackEl.querySelector('.waveform'));
                }
            }

            results.push(rec);
        }

        this.recordingTrackIds = [];
        console.log('[RecordingEngine] Recording stopped, filled', results.length, 'tracks');
        return results;
    }

    // ── Live Waveform During Recording ──────────────────────────────

    /**
     * Start live waveform drawing for all armed tracks.
     * Samples the input analyser each frame and progressively draws to canvas.
     * @private
     */
    _startLiveWaveform() {
        // Initialize per-track peak data accumulators
        this.liveWaveformData.clear();
        for (const trackId of this.recordingTrackIds) {
            this.liveWaveformData.set(trackId, []);
            // Ensure canvas exists on each track
            const trackEl = document.getElementById(`rec-track-${trackId}`);
            if (trackEl) {
                const waveContainer = trackEl.querySelector('.waveform');
                if (waveContainer && !waveContainer.querySelector('canvas')) {
                    const canvas = document.createElement('canvas');
                    waveContainer.appendChild(canvas);
                }
            }
        }

        const animate = () => {
            if (!this.isRecording) return;

            // Sample current peak from each armed track's device analyser
            for (const trackId of this.recordingTrackIds) {
                const level = this.getTrackInputLevel(trackId);
                const data = this.liveWaveformData.get(trackId);
                if (data) data.push(level);
            }

            // Render live waveforms
            this._renderLiveWaveforms();

            this.liveWaveformAnimId = requestAnimationFrame(animate);
        };

        this.liveWaveformAnimId = requestAnimationFrame(animate);
    }

    /**
     * Stop live waveform animation loop.
     * @private
     */
    _stopLiveWaveform() {
        if (this.liveWaveformAnimId) {
            cancelAnimationFrame(this.liveWaveformAnimId);
            this.liveWaveformAnimId = null;
        }
        this.liveWaveformData.clear();
    }

    /**
     * Render live waveform data onto each recording track's canvas.
     * The waveform starts at startOffset and grows rightward.
     * @private
     */
    _renderLiveWaveforms() {
        const totalDuration = this.mixer.maxDuration || 300; // fallback 5 min
        const hz = this.mixer.zoomLevels.horizontal;
        const vz = this.mixer.zoomLevels.vertical;
        const currentTime = this.mixer.currentTime || 0;
        const elapsed = Math.max(0, currentTime - this.recordingStartOffset);
        const elapsedRatio = elapsed / totalDuration;
        const offsetRatio = this.recordingStartOffset / totalDuration;

        for (const trackId of this.recordingTrackIds) {
            const data = this.liveWaveformData.get(trackId);
            if (!data || data.length === 0) continue;

            const trackEl = document.getElementById(`rec-track-${trackId}`);
            if (!trackEl) continue;

            const waveContainer = trackEl.querySelector('.waveform');
            if (!waveContainer) continue;

            const canvas = waveContainer.querySelector('canvas');
            if (!canvas) continue;

            // Size canvas to container (only when dimensions change)
            const w = waveContainer.offsetWidth * window.devicePixelRatio;
            const h = waveContainer.offsetHeight * window.devicePixelRatio;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                canvas.style.width = '100%';
                canvas.style.height = '100%';
            }

            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const centerY = height / 2;

            ctx.clearRect(0, 0, width, height);

            // Draw grid
            if (this.mixer.waveform) {
                this.mixer.waveform.drawGrid(ctx, width, height);
            }

            // Start X position (where recording begins on timeline)
            const startX = offsetRatio * width * hz;

            // Available canvas width for the waveform so far
            const waveWidth = Math.max(1, elapsedRatio * width * hz);

            // Draw offset spacer (dimmed area before recording start)
            if (startX > 0) {
                ctx.fillStyle = 'rgba(231, 76, 60, 0.05)';
                ctx.fillRect(0, 0, Math.min(startX, width), height);
            }

            // Draw waveform from accumulated peak data
            ctx.beginPath();
            ctx.strokeStyle = '#e74c3c';
            ctx.lineWidth = 1 * window.devicePixelRatio;

            const step = data.length > 0 ? waveWidth / data.length : 1;

            for (let i = 0; i < data.length; i++) {
                const x = startX + i * step;
                if (x > width) break;
                if (x < 0) continue;

                const amplitude = data[i] * vz * height * 0.8;
                ctx.moveTo(x, centerY - amplitude / 2);
                ctx.lineTo(x, centerY + amplitude / 2);
            }

            ctx.stroke();
        }
    }

    // ── Bleed Removal ─────────────────────────────────────────────

    /**
     * Remove speaker bleed from a recording using phase cancellation.
     * @param {AudioBuffer} recording — mic recording
     * @param {AudioBuffer} reference — master output captured during recording
     * @returns {AudioBuffer} cleaned recording
     */
    removeBleed(recording, reference) {
        const ctx = this._getAudioContext();
        const sampleRate = recording.sampleRate;
        const maxLagSamples = Math.round(0.1 * sampleRate);

        const recData = recording.getChannelData(0);
        const refData = reference.getChannelData(0);
        const len = Math.min(recData.length, refData.length);
        if (len < maxLagSamples * 2) return recording;

        const bestLag = this._findDelay(recData, refData, len, maxLagSamples);
        const alpha = this._computeAlpha(recData, refData, len, bestLag);
        const clampedAlpha = Math.max(0, Math.min(alpha, 2));

        if (clampedAlpha < 0.01) {
            console.log('[RecordingEngine] Bleed negligible (alpha:', clampedAlpha.toFixed(4), ')');
            return recording;
        }

        const numChannels = recording.numberOfChannels;
        const cleaned = ctx.createBuffer(numChannels, recording.length, sampleRate);

        for (let ch = 0; ch < numChannels; ch++) {
            const recCh = recording.getChannelData(ch);
            const refCh = ch < reference.numberOfChannels ? reference.getChannelData(ch) : reference.getChannelData(0);
            const outCh = cleaned.getChannelData(ch);

            for (let i = 0; i < recording.length; i++) {
                const refIdx = i - bestLag;
                const refSample = (refIdx >= 0 && refIdx < refCh.length) ? refCh[refIdx] : 0;
                outCh[i] = recCh[i] - clampedAlpha * refSample;
            }
        }

        console.log('[RecordingEngine] Bleed removed, delay:', bestLag, 'samples (',
            (bestLag / sampleRate * 1000).toFixed(1), 'ms), alpha:', clampedAlpha.toFixed(3));
        return cleaned;
    }

    /** @private */
    _findDelay(recData, refData, len, maxLag) {
        const segLen = Math.min(len, 48000);
        const segStart = Math.floor((len - segLen) / 2);
        let bestLag = 0;
        let bestCorr = -Infinity;

        for (let lag = 0; lag < maxLag; lag++) {
            let corr = 0;
            for (let i = 0; i < segLen; i++) {
                const ri = segStart + i;
                const fi = ri - lag;
                if (fi >= 0 && fi < refData.length) {
                    corr += recData[ri] * refData[fi];
                }
            }
            if (corr > bestCorr) {
                bestCorr = corr;
                bestLag = lag;
            }
        }
        return bestLag;
    }

    /** @private */
    _computeAlpha(recData, refData, len, lag) {
        let dotRR = 0;
        let dotFF = 0;
        const count = Math.min(len, recData.length);

        for (let i = 0; i < count; i++) {
            const fi = i - lag;
            if (fi >= 0 && fi < refData.length) {
                const refSample = refData[fi];
                dotRR += recData[i] * refSample;
                dotFF += refSample * refSample;
            }
        }

        return dotFF > 0 ? dotRR / dotFF : 0;
    }

    // ── Playback ──────────────────────────────────────────────────

    /**
     * Start playback of all recording tracks, aligned to the timeline.
     * @param {number} currentTime — current playback position in seconds
     */
    playAll(currentTime) {
        const ctx = this._getAudioContext();
        if (!ctx) return;

        let started = 0;
        for (const rec of this.recordings) {
            if (!rec.audioBuffer) continue;
            // Skip tracks currently being recorded into (avoid hearing the old take)
            if (this.isRecording && this.recordingTrackIds.includes(rec.id)) continue;

            this._stopRecordingSource(rec);

            const source = ctx.createBufferSource();
            source.buffer = rec.audioBuffer;
            source.connect(rec.gainNode);
            rec.sourceNode = source;

            this._applyRecordingGain(rec);

            if (currentTime >= rec.startOffset) {
                const bufferOffset = currentTime - rec.startOffset;
                if (bufferOffset < rec.audioBuffer.duration) {
                    source.start(0, bufferOffset);
                    started++;
                }
            } else {
                const delay = rec.startOffset - currentTime;
                source.start(ctx.currentTime + delay, 0);
                started++;
            }
        }

        if (started > 0) {
            console.log(`[RecordingEngine] playAll: started ${started} recording(s) at t=${currentTime.toFixed(2)}s`);
        }
    }

    stopAll() {
        for (const rec of this.recordings) {
            this._stopRecordingSource(rec);
        }
    }

    seekUpdate(newTime) {
        if (this.mixer.isPlaying) {
            this.stopAll();
            this.playAll(newTime);
        }
    }

    // ── Solo / Mute ───────────────────────────────────────────────

    updateSoloMuteStates(stemHasSolo) {
        const recHasSolo = this.recordings.some(r => r.solo);
        const hasSolo = stemHasSolo || recHasSolo;

        for (const rec of this.recordings) {
            const shouldBeMuted = rec.muted || (hasSolo && !rec.solo);
            rec.gainNode.gain.value = shouldBeMuted ? 0 : rec.volume;

            const trackEl = document.getElementById(`rec-track-${rec.id}`);
            if (trackEl) {
                trackEl.classList.toggle('track-muted', shouldBeMuted);
            }
        }
    }

    hasAnySolo() {
        return this.recordings.some(r => r.solo);
    }

    // ── Per-Track Controls ────────────────────────────────────────

    setVolume(id, value) {
        const rec = this._findRecording(id);
        if (rec) {
            rec.volume = value;
            this._applyRecordingGain(rec);
        }
    }

    setPan(id, value) {
        const rec = this._findRecording(id);
        if (rec) {
            rec.pan = value;
            rec.panNode.pan.value = value;
        }
    }

    toggleMute(id) {
        const rec = this._findRecording(id);
        if (rec) {
            rec.muted = !rec.muted;
            this.mixer.audioEngine.updateSoloMuteStates();
        }
    }

    toggleSolo(id) {
        const rec = this._findRecording(id);
        if (rec) {
            rec.solo = !rec.solo;
            this.mixer.audioEngine.updateSoloMuteStates();
        }
    }

    // ── Recording Management ──────────────────────────────────────

    deleteRecording(id) {
        const idx = this.recordings.findIndex(r => r.id === id);
        if (idx === -1) return;

        const rec = this.recordings[idx];
        this._stopRecordingSource(rec);
        if (rec.gainNode) rec.gainNode.disconnect();
        if (rec.panNode) rec.panNode.disconnect();
        this.recordings.splice(idx, 1);

        const el = document.getElementById(`rec-track-${id}`);
        if (el) el.remove();

        this.mixer.audioEngine.updateSoloMuteStates();
    }

    renameRecording(id, newName) {
        const rec = this._findRecording(id);
        if (rec) {
            rec.name = newName;
            const nameEl = document.querySelector(`#rec-track-${id} .track-name`);
            if (nameEl) nameEl.textContent = newName;
        }
    }

    // ── Server Persistence ────────────────────────────────────────

    async saveToServer(id, downloadId) {
        const rec = this._findRecording(id);
        if (!rec || !rec.audioBuffer) throw new Error('Recording not found or empty');

        const wavBlob = this.audioBufferToWav(rec.audioBuffer);

        const formData = new FormData();
        formData.append('file', wavBlob, `${rec.name}.wav`);
        formData.append('download_id', downloadId);
        formData.append('name', rec.name);
        formData.append('start_offset', rec.startOffset.toString());

        const resp = await fetch('/api/recordings', {
            method: 'POST',
            body: formData,
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save recording');
        }

        const result = await resp.json();
        rec.serverId = result.id;
        rec.saved = true;

        const saveBtn = document.querySelector(`#rec-track-${id} .rec-save-btn`);
        if (saveBtn) {
            saveBtn.classList.add('saved');
            saveBtn.title = 'Saved';
        }

        console.log('[RecordingEngine] Saved to server:', result.id);
        return result;
    }

    async loadFromServer(downloadId) {
        const resp = await fetch(`/api/recordings/${downloadId}`);
        if (!resp.ok) return;

        const data = await resp.json();
        if (!data.success || !data.recordings) return;

        const ctx = this._getAudioContext();

        for (const recData of data.recordings) {
            const fileResp = await fetch(recData.url);
            if (!fileResp.ok) continue;

            const arrayBuffer = await fileResp.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            const recording = this._createRecordingObject(audioBuffer, recData.start_offset, recData.name);
            recording.serverId = recData.id;
            recording.saved = true;
            this.recordings.push(recording);

            if (this.mixer.trackControls && this.mixer.trackControls.createRecordingTrackElement) {
                this.mixer.trackControls.createRecordingTrackElement(recording);
            }
        }

        console.log(`[RecordingEngine] Loaded ${data.recordings.length} recordings from server`);
    }

    async deleteFromServer(serverId) {
        const resp = await fetch(`/api/recordings/${serverId}`, { method: 'DELETE' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to delete recording');
        }
    }

    // ── WAV Encoding ──────────────────────────────────────────────

    audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitsPerSample = 16;

        const length = buffer.length;
        const interleaved = new Float32Array(length * numChannels);
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                interleaved[i * numChannels + ch] = channelData[i];
            }
        }

        const dataLength = interleaved.length * 2;
        const headerLength = 44;
        const wavBuffer = new ArrayBuffer(headerLength + dataLength);
        const view = new DataView(wavBuffer);

        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this._writeString(view, 8, 'WAVE');

        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
        view.setUint16(32, numChannels * bitsPerSample / 8, true);
        view.setUint16(34, bitsPerSample, true);

        this._writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        let offset = 44;
        for (let i = 0; i < interleaved.length; i++) {
            const sample = Math.max(-1, Math.min(1, interleaved[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    // ── Cleanup ───────────────────────────────────────────────────

    dispose() {
        this.stopAll();
        this._stopLiveWaveform();

        // Stop active recorders
        for (const [, info] of this.activeRecorders) {
            if (info.recorder && info.recorder.state !== 'inactive') info.recorder.stop();
            if (info.refRecorder && info.refRecorder.state !== 'inactive') info.refRecorder.stop();
            if (info.refDestination) info.refDestination.disconnect();
        }
        this.activeRecorders.clear();

        // Close all device streams
        for (const key of [...this.deviceStreams.keys()]) {
            this._cleanupDeviceStream(key);
        }

        // Disconnect recording nodes
        for (const rec of this.recordings) {
            this._stopRecordingSource(rec);
            if (rec.gainNode) rec.gainNode.disconnect();
            if (rec.panNode) rec.panNode.disconnect();
        }
        this.recordings = [];
        this.isRecording = false;
        this.recordingTrackIds = [];

        console.log('[RecordingEngine] Disposed');
    }

    // ── Private Helpers ───────────────────────────────────────────

    _getAudioContext() {
        return this.mixer.audioEngine ? this.mixer.audioEngine.audioContext : null;
    }

    _getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return '';
    }

    _stopMediaRecorder(recorder, chunks) {
        return new Promise((resolve) => {
            if (!recorder || recorder.state === 'inactive') {
                resolve(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
                return;
            }
            recorder.onstop = () => {
                resolve(new Blob(chunks, { type: recorder.mimeType }));
            };
            recorder.stop();
        });
    }

    _createRecordingObject(audioBuffer, startOffset, name) {
        const ctx = this._getAudioContext();
        const id = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        const gainNode = ctx.createGain();
        const panNode = ctx.createStereoPanner();
        gainNode.connect(panNode);
        panNode.connect(this.mixer.audioEngine.masterGainNode);

        return {
            id,
            name: name || `Recording ${this.nextRecordingNumber++}`,
            audioBuffer,
            startOffset,
            gainNode,
            panNode,
            sourceNode: null,
            volume: 1.0,
            pan: 0,
            muted: false,
            solo: false,
            saved: false,
            serverId: null,
            armed: false,
            deviceId: null,
        };
    }

    _findRecording(id) {
        return this.recordings.find(r => r.id === id);
    }

    _stopRecordingSource(rec) {
        if (rec.sourceNode) {
            try {
                rec.sourceNode.onended = null;
                rec.sourceNode.stop();
            } catch (e) {
                // Already stopped
            }
            rec.sourceNode = null;
        }
    }

    _applyRecordingGain(rec) {
        if (!rec.gainNode) return;
        const stemHasSolo = Object.values(this.mixer.stems).some(s => s.solo);
        const recHasSolo = this.recordings.some(r => r.solo);
        const hasSolo = stemHasSolo || recHasSolo;
        const shouldBeMuted = rec.muted || (hasSolo && !rec.solo);
        rec.gainNode.gain.value = shouldBeMuted ? 0 : rec.volume;
    }

    _writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}
