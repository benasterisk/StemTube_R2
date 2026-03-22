/**
 * RecordingEngine — Multi-track recording with per-track input devices,
 * latency compensation and server-side de-bleed via Demucs.
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

        // Active recorders during recording: deviceId → { recorder, chunks }
        this.activeRecorders = new Map();

        // Track IDs being recorded into (snapshot at recording start)
        this.recordingTrackIds = [];

        // Segment tracking for pause/seek sync
        // Each segment: { recOffset, songPosition, duration }
        // recOffset = cumulative seconds into the recorder output (excludes pauses)
        // songPosition = timeline position at segment start
        this._recSegments = [];
        this._recCumulativeTime = 0; // total seconds of actual recording (excludes pauses)
        this._segWallStart = 0;      // audioContext.currentTime when current segment started
        this._recPaused = false;

        // Live waveform state — each entry: { songTime, peak }
        this.liveWaveformData = new Map();
        this.liveWaveformAnimId = null;

        // Latency compensation (seconds)
        this.calibratedLatency = this._loadCalibratedLatency();
        this.isCalibrating = false;

        // Pending de-bleed operations (serverId → { resolve, reject })
        this.pendingDebleeds = new Map();

        // Shared effects manager (lazy-init on first AudioContext use)
        this.effects = null;
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

        // Disable all browser DSP — these destroy musical audio quality
        // (pumping, muffled sound, wah-wah effect)
        const constraints = {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                sampleRate: { ideal: ctx ? ctx.sampleRate : 44100 },
            },
        };
        if (deviceId) {
            constraints.audio.deviceId = { exact: deviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Log actual track settings for debugging
        const track = stream.getAudioTracks()[0];
        if (track) {
            const settings = track.getSettings();
            console.log(`[Audio] Mic stream settings:`, {
                sampleRate: settings.sampleRate,
                channelCount: settings.channelCount,
                echoCancellation: settings.echoCancellation,
                noiseSuppression: settings.noiseSuppression,
                autoGainControl: settings.autoGainControl,
                deviceId: settings.deviceId,
            });
            if (ctx && settings.sampleRate && settings.sampleRate !== ctx.sampleRate) {
                console.warn(`[Audio] Sample rate mismatch: mic at ${settings.sampleRate} Hz, AudioContext at ${ctx.sampleRate} Hz`);
            }
        }
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
     * When FX is active, routes mic through the effects chain.
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
            this._updateMonitorFxRouting(rec, entry);
        }
    }

    /**
     * Route mic monitoring through the FX chain (or bypass it).
     * Called when monitor volume or FX preset changes.
     * @private
     */
    _updateMonitorFxRouting(rec, entry) {
        if (!entry || !rec.fxChain) return;
        const fxActive = rec.fxPreset && rec.fxPreset !== 'off';
        const monitorOn = entry.monitorGain.gain.value > 0;

        if (fxActive && monitorOn && !rec._monitorFxActive) {
            // Route mic through effects for monitoring
            try { entry.micSource.disconnect(entry.monitorGain); } catch (e) {}
            entry.micSource.connect(rec.fxChain.input);
            rec.fxChain.dryOutput.connect(entry.monitorGain);
            rec.fxChain.wetOutput.connect(entry.monitorGain);
            rec._monitorFxActive = true;
        } else if ((!fxActive || !monitorOn) && rec._monitorFxActive) {
            // Revert to direct monitoring
            try { entry.micSource.disconnect(rec.fxChain.input); } catch (e) {}
            try { rec.fxChain.dryOutput.disconnect(entry.monitorGain); } catch (e) {}
            try { rec.fxChain.wetOutput.disconnect(entry.monitorGain); } catch (e) {}
            entry.micSource.connect(entry.monitorGain);
            rec._monitorFxActive = false;
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
     * Automatic latency calibration with two strategies:
     * 1. Acoustic loopback — plays a click through speakers, records via mic (best accuracy)
     * 2. Digital loopback fallback — if mic doesn't capture the click (headphones),
     *    measures software pipeline latency + browser-reported hardware latency
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

            // Try acoustic loopback first
            const acousticResult = await this._calibrateAcousticLoopback(ctx, entry, sampleRate);
            if (acousticResult !== null) {
                this.calibratedLatency = acousticResult;
                this.calibrationMethod = 'acoustic';
                this._saveCalibratedLatency(this.calibratedLatency);
                console.log(`[RecordingEngine] Acoustic calibration: ${(this.calibratedLatency * 1000).toFixed(1)}ms`);
                return this.calibratedLatency;
            }

            // Acoustic loopback failed (headphones?) — use digital loopback + API
            console.log('[RecordingEngine] Acoustic loopback failed, falling back to digital pipeline measurement');
            this.calibratedLatency = await this._calibrateDigitalLoopback(ctx, entry, sampleRate);
            this.calibrationMethod = 'digital';
            this._saveCalibratedLatency(this.calibratedLatency);
            console.log(`[RecordingEngine] Digital calibration: ${(this.calibratedLatency * 1000).toFixed(1)}ms`);
            return this.calibratedLatency;
        } finally {
            this.isCalibrating = false;
        }
    }

    /**
     * Acoustic loopback: play click through speakers, capture via mic.
     * @returns {Promise<number|null>} latency in seconds, or null if click not detected
     * @private
     */
    async _calibrateAcousticLoopback(ctx, entry, sampleRate) {
        const stabilizeMs = 150;

        // Create a short click signal (1ms impulse)
        const clickSamples = Math.ceil(sampleRate * 0.001);
        const clickBuffer = ctx.createBuffer(1, clickSamples, sampleRate);
        const clickData = clickBuffer.getChannelData(0);
        for (let i = 0; i < clickSamples; i++) clickData[i] = 1.0;

        // Capture mic input via MediaRecorder
        const captureStream = ctx.createMediaStreamDestination();
        entry.micSource.connect(captureStream);

        const chunks = [];
        const recorder = new MediaRecorder(captureStream.stream);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start();

        await new Promise(r => setTimeout(r, stabilizeMs));

        // Play the click through speakers
        const clickSource = ctx.createBufferSource();
        clickSource.buffer = clickBuffer;
        clickSource.connect(ctx.destination);
        clickSource.start();

        await new Promise(r => setTimeout(r, 400));

        const recordedBlob = await this._stopMediaRecorder(recorder, chunks);
        entry.micSource.disconnect(captureStream);

        const arrayBuf = await recordedBlob.arrayBuffer();
        const recordedBuffer = await ctx.decodeAudioData(arrayBuf);
        const recorded = recordedBuffer.getChannelData(0);

        // Find the click peak
        const skipSamples = Math.ceil(sampleRate * 0.05);
        let sumSq = 0;
        const noiseEnd = Math.min(skipSamples, recorded.length);
        for (let i = 0; i < noiseEnd; i++) sumSq += recorded[i] * recorded[i];
        const rms = Math.sqrt(sumSq / Math.max(1, noiseEnd));
        const threshold = Math.max(0.05, rms * 4);

        let clickPositionSample = -1;
        for (let i = skipSamples; i < recorded.length; i++) {
            if (Math.abs(recorded[i]) > threshold) {
                clickPositionSample = i;
                break;
            }
        }

        if (clickPositionSample < 0) return null; // click not detected

        // Full round-trip: outputLatency + airDelay + inputLatency + pipelineOverhead.
        // All of these contribute to the recording being late, so use the full value
        // (not /2 — that's for network one-way estimation, not audio recording).
        const roundTrip = (clickPositionSample / sampleRate) - (stabilizeMs / 1000);
        return Math.max(0, roundTrip);
    }

    /**
     * Digital loopback: measures the software pipeline latency by routing a click
     * through the mic input → MediaRecorder path (without acoustic propagation),
     * then adds browser-reported hardware latency.
     * Works with headphones since it doesn't rely on speakers → mic pickup.
     * @returns {Promise<number>} estimated latency in seconds
     * @private
     */
    async _calibrateDigitalLoopback(ctx, entry, sampleRate) {
        const stabilizeMs = 100;

        // Create a click signal
        const clickSamples = Math.ceil(sampleRate * 0.001);
        const clickBuffer = ctx.createBuffer(1, clickSamples, sampleRate);
        const clickData = clickBuffer.getChannelData(0);
        for (let i = 0; i < clickSamples; i++) clickData[i] = 1.0;

        // Create a digital loopback path:
        // clickSource → loopbackDest (MediaStream) → loopbackSource → captureDest → MediaRecorder
        // This measures the full MediaRecorder encode/decode pipeline delay
        const loopbackDest = ctx.createMediaStreamDestination();
        const loopbackSource = ctx.createMediaStreamSource(loopbackDest.stream);
        const captureDest = ctx.createMediaStreamDestination();
        loopbackSource.connect(captureDest);

        const chunks = [];
        const recorder = new MediaRecorder(captureDest.stream);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start();

        await new Promise(r => setTimeout(r, stabilizeMs));

        // Inject click into the loopback path and record timestamp
        const clickSource = ctx.createBufferSource();
        clickSource.buffer = clickBuffer;
        clickSource.connect(loopbackDest);
        const sendTime = ctx.currentTime;
        clickSource.start();

        await new Promise(r => setTimeout(r, 400));

        const recordedBlob = await this._stopMediaRecorder(recorder, chunks);
        loopbackSource.disconnect();

        const arrayBuf = await recordedBlob.arrayBuffer();
        const recordedBuffer = await ctx.decodeAudioData(arrayBuf);
        const recorded = recordedBuffer.getChannelData(0);

        // Find click in the digital recording
        const skipSamples = Math.ceil(sampleRate * 0.02);
        let clickPositionSample = -1;
        for (let i = skipSamples; i < recorded.length; i++) {
            if (Math.abs(recorded[i]) > 0.05) {
                clickPositionSample = i;
                break;
            }
        }

        // Software pipeline latency (MediaRecorder encode/decode overhead)
        let pipelineLatency = 0;
        if (clickPositionSample >= 0) {
            pipelineLatency = Math.max(0, (clickPositionSample / sampleRate) - (stabilizeMs / 1000));
            console.log(`[RecordingEngine] Digital pipeline latency: ${(pipelineLatency * 1000).toFixed(1)}ms`);
        }

        // Hardware latency from Web Audio API
        const outputLatency = ctx.outputLatency || 0;
        const baseLatency = ctx.baseLatency || 0;
        console.log(`[RecordingEngine] API latencies — base: ${(baseLatency * 1000).toFixed(1)}ms, output: ${(outputLatency * 1000).toFixed(1)}ms`);

        // Total compensation = pipeline + output latency + estimated input latency.
        // outputLatency: delay from AudioContext output to speakers/headphones.
        // Input latency (mic ADC + OS capture) has no Web API — estimate as baseLatency
        // (one audio render quantum, ~2.7ms at 48kHz) plus a conservative fixed estimate
        // for the OS audio capture pipeline (~10ms typical for modern systems).
        const estimatedInputLatency = baseLatency + 0.010;
        const totalLatency = pipelineLatency + outputLatency + estimatedInputLatency;
        console.log(`[RecordingEngine] Estimated input latency: ${(estimatedInputLatency * 1000).toFixed(1)}ms, total: ${(totalLatency * 1000).toFixed(1)}ms`);

        return Math.max(0, totalLatency);
    }

    /** Load calibrated latency from localStorage (seconds). */
    _loadCalibratedLatency() {
        // v2: invalidate old values computed with the /2 bug
        const version = localStorage.getItem('stemtube_latency_version');
        if (version !== '2') {
            localStorage.removeItem('stemtube_calibrated_latency');
            return 0;
        }
        const val = localStorage.getItem('stemtube_calibrated_latency');
        return val ? parseFloat(val) : 0;
    }

    /** Save calibrated latency to localStorage (seconds). */
    _saveCalibratedLatency(seconds) {
        localStorage.setItem('stemtube_calibrated_latency', seconds.toString());
        localStorage.setItem('stemtube_latency_version', '2');
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

    /**
     * Assemble recorded audio from segments onto the song timeline.
     *
     * The decoded buffer contains ONLY audio from active periods (MediaRecorder
     * was paused during playback pauses, so silence is excluded).
     * Each segment has: recOffset (where in the buffer), songPosition (where on
     * the timeline), duration. Later segments overwrite earlier ones if they
     * overlap (seek-before-pause-point = punch-in).
     *
     * @param {AudioBuffer} rawBuffer — decoded recording (active periods only)
     * @param {AudioContext} ctx
     * @returns {AudioBuffer} timeline-aligned buffer
     */
    _assembleSegments(rawBuffer, ctx) {
        const sampleRate = rawBuffer.sampleRate;
        const channels = rawBuffer.numberOfChannels;
        const segments = this._recSegments.filter(s => s.duration > 0);

        if (segments.length === 0) return rawBuffer;
        if (segments.length === 1 && segments[0].recOffset === 0) {
            // Single continuous segment — no assembly needed
            return rawBuffer;
        }

        // Determine output span on the song timeline
        let minSongPos = Infinity;
        let maxSongEnd = 0;
        for (const seg of segments) {
            minSongPos = Math.min(minSongPos, seg.songPosition);
            maxSongEnd = Math.max(maxSongEnd, seg.songPosition + seg.duration);
        }

        const totalDuration = maxSongEnd - minSongPos;
        const totalSamples = Math.ceil(totalDuration * sampleRate);
        if (totalSamples <= 0) return rawBuffer;

        // Output buffer initialized to silence
        const output = ctx.createBuffer(channels, totalSamples, sampleRate);

        // Place segments in order — later segments overwrite (punch-in behavior)
        for (const seg of segments) {
            const srcStart = Math.round(seg.recOffset * sampleRate);
            const srcLen = Math.round(seg.duration * sampleRate);
            const srcEnd = Math.min(srcStart + srcLen, rawBuffer.length);
            if (srcStart >= rawBuffer.length) continue;

            const dstStart = Math.round((seg.songPosition - minSongPos) * sampleRate);

            for (let ch = 0; ch < channels; ch++) {
                const src = rawBuffer.getChannelData(ch);
                const dst = output.getChannelData(ch);
                const copyLen = Math.min(srcEnd - srcStart, totalSamples - dstStart);
                for (let i = 0; i < copyLen; i++) {
                    dst[dstStart + i] = src[srcStart + i];
                }
            }
        }

        console.log(`[RecordingEngine] Assembled ${segments.length} segments, ` +
            `${totalDuration.toFixed(2)}s on timeline (from ${minSongPos.toFixed(2)}s)`);
        return output;
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

        // Create effects chain
        const fxChain = this._createFxChain(ctx, gainNode);

        const recording = {
            id,
            name: `Recording ${this.nextRecordingNumber++}`,
            audioBuffer: null,
            startOffset: 0,
            gainNode,
            panNode,
            fxChain,
            sourceNode: null,
            volume: 1.0,
            pan: 0,
            muted: false,
            solo: false,
            saved: false,
            serverId: null,
            armed: false,
            deviceId: null,
            fxPreset: 'off',
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

        // Stop playback of old audio on tracks we're about to re-record
        for (const track of armedTracks) {
            this._stopRecordingSource(track);
        }

        this.recordingStartOffset = timelinePosition;
        this.recordingTrackIds = armedTracks.map(r => r.id);
        this.activeRecorders.clear();

        // Initialize segment tracking
        const ctx = this._getAudioContext();
        this._recCumulativeTime = 0;
        this._segWallStart = ctx ? ctx.currentTime : 0;
        this._recPaused = false;
        this._recSegments = [{
            recOffset: 0,
            songPosition: timelinePosition,
            duration: null, // open — will be set on pause/stop
        }];

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
     * Notify the recording engine that playback was paused.
     * Pauses all MediaRecorders so no silence is captured.
     */
    notifyPause() {
        if (!this.isRecording || this._recPaused) return;
        const ctx = this._getAudioContext();
        if (!ctx) return;

        // Close current segment
        const seg = this._recSegments[this._recSegments.length - 1];
        if (seg && seg.duration === null) {
            seg.duration = ctx.currentTime - this._segWallStart;
            this._recCumulativeTime += seg.duration;
        }

        // Pause all MediaRecorders (stops capturing, keeps session alive)
        for (const [, info] of this.activeRecorders) {
            if (info.recorder.state === 'recording') {
                info.recorder.pause();
            }
        }

        this._recPaused = true;
        console.log('[RecordingEngine] Paused — segment closed at cumulative', this._recCumulativeTime.toFixed(2), 's');
    }

    /**
     * Notify the recording engine that playback resumed.
     * Resumes MediaRecorders and opens a new segment.
     * @param {number} songPosition — current timeline position
     */
    notifyResume(songPosition) {
        if (!this.isRecording || !this._recPaused) return;
        const ctx = this._getAudioContext();
        if (!ctx) return;

        // Use pending seek position if user seeked while paused
        const effectivePos = this._pendingSeekPosition ?? songPosition;
        this._pendingSeekPosition = undefined;

        // Remove waveform peaks at or past the resume point (they will be overwritten)
        // Keep all peaks before effectivePos — only cut what the new recording replaces
        for (const trackId of this.recordingTrackIds) {
            const data = this.liveWaveformData.get(trackId);
            if (data) {
                const cutIdx = data.findIndex(d => d.songTime >= effectivePos);
                if (cutIdx > 0) {
                    data.splice(cutIdx);
                } else if (cutIdx === 0) {
                    // Resume point is before all existing data — clear everything
                    // (all existing audio will be overwritten by the new take)
                    data.length = 0;
                }
                // cutIdx === -1: resume point is after all data, nothing to remove
            }
        }

        // Resume all MediaRecorders
        for (const [, info] of this.activeRecorders) {
            if (info.recorder.state === 'paused') {
                info.recorder.resume();
            }
        }

        // Open new segment
        this._segWallStart = ctx.currentTime;
        this._recSegments.push({
            recOffset: this._recCumulativeTime,
            songPosition: effectivePos,
            duration: null,
        });
        this._recPaused = false;
        console.log('[RecordingEngine] Resumed at song', effectivePos.toFixed(2), 's');
    }

    /**
     * Notify the recording engine that the user seeked during recording.
     * If paused: just updates where the next segment will start.
     * If playing: closes current segment and opens new one.
     * @param {number} newPosition — new timeline position
     */
    notifySeek(newPosition) {
        if (!this.isRecording) return;

        if (this._recPaused) {
            // Not capturing — just remember where next resume will go
            // Remove last segment if it had no duration (seek while paused)
            const last = this._recSegments[this._recSegments.length - 1];
            if (last && last.duration !== null) {
                // Normal case: add a placeholder that notifyResume will replace
            }
            // notifyResume will create the segment at the right position
            this._pendingSeekPosition = newPosition;
            console.log('[RecordingEngine] Seek while paused — next resume at', newPosition.toFixed(2), 's');
            return;
        }

        // Currently recording — close segment and open new one
        const ctx = this._getAudioContext();
        if (!ctx) return;

        const seg = this._recSegments[this._recSegments.length - 1];
        if (seg && seg.duration === null) {
            seg.duration = ctx.currentTime - this._segWallStart;
            this._recCumulativeTime += seg.duration;
        }

        // Remove waveform peaks that will be overwritten by the new position
        for (const trackId of this.recordingTrackIds) {
            const data = this.liveWaveformData.get(trackId);
            if (data) {
                const cutIdx = data.findIndex(d => d.songTime >= newPosition);
                if (cutIdx > 0) data.splice(cutIdx);
                else if (cutIdx === 0) data.length = 0;
            }
        }

        this._segWallStart = ctx.currentTime;
        this._recSegments.push({
            recOffset: this._recCumulativeTime,
            songPosition: newPosition,
            duration: null,
        });
        console.log('[RecordingEngine] Seeked to', newPosition.toFixed(2), 's — new segment');
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
            audioBitsPerSecond: 128000, // minimum 128kbps for musical audio
        });
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.start(100);

        const info = { recorder, chunks };

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

        // Close the last open segment
        const lastSeg = this._recSegments[this._recSegments.length - 1];
        if (lastSeg && lastSeg.duration === null) {
            lastSeg.duration = ctx.currentTime - this._segWallStart;
            this._recCumulativeTime += lastSeg.duration;
        }

        console.log('[RecordingEngine] Segments:', this._recSegments.map(s =>
            `song:${s.songPosition.toFixed(1)}s rec:${s.recOffset.toFixed(1)}s dur:${(s.duration||0).toFixed(1)}s`
        ));

        const decodedAudio = new Map();

        // Stop all recorders and decode
        for (const [key, info] of this.activeRecorders) {
            const micBlob = await this._stopMediaRecorder(info.recorder, info.chunks);

            const arrayBuffer = await micBlob.arrayBuffer();
            let audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            audioBuffer = this.applyLatencyCompensation(audioBuffer);

            // Assemble segments into a timeline-aligned buffer
            audioBuffer = this._assembleSegments(audioBuffer, ctx);

            decodedAudio.set(key, audioBuffer);
        }
        this.activeRecorders.clear();

        // Effective start = earliest song position across all segments
        const effectiveStartOffset = this._recSegments.length > 0
            ? Math.min(...this._recSegments.map(s => s.songPosition))
            : this.recordingStartOffset;

        // Fill each armed track with its device's audio
        const results = [];
        for (const trackId of this.recordingTrackIds) {
            const rec = this._findRecording(trackId);
            if (!rec) continue;

            const key = rec.deviceId || 'default';
            const audioBuffer = decodedAudio.get(key);
            if (!audioBuffer) continue;

            rec.audioBuffer = audioBuffer;
            rec.startOffset = effectiveStartOffset;
            rec.saved = false;

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
        this._recSegments = [];
        this._pendingSeekPosition = undefined;
        console.log('[RecordingEngine] Recording stopped, filled', results.length, 'tracks');

        // Auto-save all recorded tracks to server
        this._autoSaveRecordings(results);

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

            // Only accumulate data when not paused (mic is actually capturing)
            if (!this._recPaused) {
                const actx = this._getAudioContext();
                const lastSeg = this._recSegments[this._recSegments.length - 1];
                if (actx && lastSeg) {
                    const elapsed = actx.currentTime - this._segWallStart;
                    const songTime = lastSeg.songPosition + elapsed;

                    for (const trackId of this.recordingTrackIds) {
                        const level = this.getTrackInputLevel(trackId);
                        const data = this.liveWaveformData.get(trackId);
                        if (data) {
                            data.push({ songTime, peak: level });
                            // Debug: log every 60 frames (~1s)
                            if (data.length % 60 === 0) {
                                console.log(`[LiveWaveform] trackId=${trackId} points=${data.length} songTime=${songTime.toFixed(2)}s peak=${level.toFixed(3)}`);
                            }
                        }
                    }
                }
            }

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
        const totalDuration = this.mixer.maxDuration || 300;
        const hz = this.mixer.zoomLevels.horizontal;
        const vz = this.mixer.zoomLevels.vertical;

        for (const trackId of this.recordingTrackIds) {
            const data = this.liveWaveformData.get(trackId);
            if (!data || data.length === 0) continue;

            const trackEl = document.getElementById(`rec-track-${trackId}`);
            if (!trackEl) continue;

            const waveContainer = trackEl.querySelector('.waveform');
            if (!waveContainer) continue;

            const canvas = waveContainer.querySelector('canvas');
            if (!canvas) continue;

            const w = waveContainer.offsetWidth * window.devicePixelRatio;
            const h = waveContainer.offsetHeight * window.devicePixelRatio;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                canvas.style.width = '100%';
                canvas.style.height = '100%';
            }

            const canvasCtx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const centerY = height / 2;

            canvasCtx.clearRect(0, 0, width, height);

            if (this.mixer.waveform) {
                this.mixer.waveform.drawGrid(canvasCtx, width, height);
            }

            // Dimmed area before first recorded point
            const startX = (data[0].songTime / totalDuration) * width * hz;
            if (startX > 0) {
                canvasCtx.fillStyle = 'rgba(231, 76, 60, 0.05)';
                canvasCtx.fillRect(0, 0, Math.min(startX, width), height);
            }

            // Each peak is plotted at its absolute timeline position
            // No stretching possible — position is baked into the data
            canvasCtx.beginPath();
            canvasCtx.strokeStyle = '#e74c3c';
            canvasCtx.lineWidth = 1 * window.devicePixelRatio;

            const minStep = 0.5; // skip sub-pixel draws for performance
            let lastX = -minStep;

            for (let i = 0; i < data.length; i++) {
                const x = (data[i].songTime / totalDuration) * width * hz;
                if (x < 0) continue;
                if (x > width) continue;
                if (x - lastX < minStep) continue;
                lastX = x;

                const amplitude = data[i].peak * vz * height * 0.8;
                canvasCtx.moveTo(x, centerY - amplitude / 2);
                canvasCtx.lineTo(x, centerY + amplitude / 2);
            }

            canvasCtx.stroke();
        }
    }

    // ── Effects Chain ──────────────────────────────────────────────

    /**
     * Create and wire an effects chain for a recording track.
     * @private
     */
    _createFxChain(ctx, gainNode) {
        if (!this.effects) {
            this.effects = new RecordingEffects(ctx);
        }
        const chain = this.effects.createChain();
        // Wire: chain dry + wet → track's gainNode
        chain.dryOutput.connect(gainNode);
        chain.wetOutput.connect(gainNode);
        return chain;
    }

    /**
     * Set the FX preset for a recording track.
     */
    async setTrackFxPreset(trackId, presetName) {
        const rec = this._findRecording(trackId);
        if (!rec || !rec.fxChain) return;
        rec.fxPreset = presetName;
        await rec.fxChain.applyPreset('vocals', presetName);

        // Update monitoring routing (FX on/off affects monitor path)
        const key = rec.deviceId || 'default';
        const entry = this.deviceStreams.get(key);
        if (entry) this._updateMonitorFxRouting(rec, entry);
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
            // Route through effects chain if available, otherwise direct to gain
            if (rec.fxChain) {
                source.connect(rec.fxChain.input);
            } else {
                source.connect(rec.gainNode);
            }
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
        if (rec.fxChain) rec.fxChain.dispose();
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

        console.log('[RecordingEngine] Saved to server:', result.id);
        return result;
    }

    /**
     * Auto-save recordings to server after recording stops.
     * @param {Object[]} recordings
     * @private
     */
    async _autoSaveRecordings(recordings) {
        const downloadId = this.mixer.extractionId;
        if (!downloadId) return;

        for (const rec of recordings) {
            if (!rec.audioBuffer) continue;
            try {
                // If re-recording over a previously saved track, delete old server copy first
                if (rec.serverId) {
                    await this.deleteFromServer(rec.serverId).catch(() => {});
                    rec.serverId = null;
                }
                await this.saveToServer(rec.id, downloadId);
                // Re-render waveform in green to confirm save
                const trackEl = document.getElementById(`rec-track-${rec.id}`);
                if (trackEl && this.mixer.waveform) {
                    this.mixer.waveform.renderRecordingWaveform(rec, trackEl.querySelector('.waveform'));
                }
                console.log('[RecordingEngine] Auto-saved:', rec.name);
            } catch (err) {
                console.warn('[RecordingEngine] Auto-save failed for', rec.name, err);
            }
        }
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
        this._updateNextRecordingNumber();
    }

    /**
     * Scan recording names and update nextRecordingNumber to avoid duplicates.
     * @private
     */
    _updateNextRecordingNumber() {
        let maxNum = this.recordings.length;
        for (const rec of this.recordings) {
            const match = rec.name.match(/^Recording (\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
        if (maxNum >= this.nextRecordingNumber) {
            this.nextRecordingNumber = maxNum + 1;
        }
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

        const fxChain = this._createFxChain(ctx, gainNode);

        return {
            id,
            name: name || `Recording ${this.nextRecordingNumber++}`,
            audioBuffer,
            startOffset,
            gainNode,
            panNode,
            fxChain,
            sourceNode: null,
            volume: 1.0,
            pan: 0,
            muted: false,
            solo: false,
            saved: false,
            serverId: null,
            armed: false,
            deviceId: null,
            fxPreset: 'off',
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
