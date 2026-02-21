/**
 * StemTubes Mixer - Waveform Renderer
 * Waveform rendering management for the mixer
 */

class WaveformRenderer {
    /**
     * Waveform renderer constructor
     * @param {StemMixer} mixer - Main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
        this.canvasCache = {}; // Canvas cache to avoid constant redrawing
    }

    /**
     * Draw waveform for a stem
     * @param {string} name - Stem name
     */
    drawWaveform(name) {
        const stem = this.mixer.stems[name];
        if (!stem || !stem.waveformData) return;

        // Get waveform container
        const waveformContainer = document.querySelector(`.track[data-stem="${name}"] .waveform`);
        if (!waveformContainer) {
            this.mixer.log(`Waveform container not found for ${name}`);
            return;
        }

        // Create canvas if it doesn't exist
        let canvas = waveformContainer.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            waveformContainer.appendChild(canvas);
        }

        // Adjust canvas size to match container
        canvas.width = waveformContainer.offsetWidth * window.devicePixelRatio;
        canvas.height = waveformContainer.offsetHeight * window.devicePixelRatio;
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        // Draw waveform
        this.renderWaveformToCanvas(canvas, stem.waveformData);

        // Store canvas in cache
        this.canvasCache[name] = {
            canvas,
            timestamp: Date.now()
        };
    }

    /**
     * Render waveform data to canvas
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {Array<number>} waveformData - Waveform data
     */
    renderWaveformToCanvas(canvas, waveformData) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const centerY = height / 2;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Calculate scale factors
        const horizontalScale = this.mixer.zoomLevels.horizontal;
        const verticalScale = this.mixer.zoomLevels.vertical;

        // Calculate waveform width with horizontal zoom
        const scaledWidth = width * horizontalScale;

        // Calculate step between each point
        const step = scaledWidth / waveformData.length;

        // Draw background grid
        this.drawGrid(ctx, width, height);

        // Draw waveform
        ctx.beginPath();
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1 * window.devicePixelRatio;

        // Draw mirrored waveform (upward and downward)
        for (let i = 0; i < waveformData.length; i++) {
            // Correction of x calculation - don't divide by horizontalScale here
            const x = i * step;
            if (x > width * horizontalScale) break; // Stop if exceeding canvas width with zoom

            const amplitude = waveformData[i] * verticalScale * height * 0.8; // Apply vertical zoom

            // Ensure point is visible in visible part of canvas
            if (x < width) {
                ctx.moveTo(x, centerY - amplitude / 2);
                ctx.lineTo(x, centerY + amplitude / 2);
            }
        }

        ctx.stroke();
    }

    /**
     * Draw background grid
     * @param {CanvasRenderingContext2D} ctx - Canvas drawing context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    drawGrid(ctx, width, height) {
        const gridSize = 40 * window.devicePixelRatio;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Vertical lines
        for (let x = 0; x < width; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }

        // Horizontal lines
        for (let y = 0; y < height; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }

        ctx.stroke();

        // More prominent center line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
    }

    /**
     * Draw beat grid visualization for metronome track.
     * Renders vertical lines at beat positions (thicker for downbeats).
     */
    drawMetronomeBeatGrid(name) {
        const metronome = this.mixer.metronome;
        if (!metronome) return;

        const waveformContainer = document.querySelector(`.track[data-stem="${name}"] .waveform`);
        if (!waveformContainer) return;

        let canvas = waveformContainer.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            waveformContainer.appendChild(canvas);
        }

        canvas.width = waveformContainer.offsetWidth * window.devicePixelRatio;
        canvas.height = waveformContainer.offsetHeight * window.devicePixelRatio;
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const maxDuration = this.mixer.maxDuration;
        if (maxDuration <= 0) return;

        ctx.clearRect(0, 0, width, height);
        this.drawGrid(ctx, width, height);

        const hz = this.mixer.zoomLevels?.horizontal || 1;
        const dpr = window.devicePixelRatio;

        // Use resolution-aware beat grid if available
        const effectiveBeats = (metronome._beatTimesReady && metronome.beatTimes?.length > 1)
            ? metronome._getEffectiveBeats()
            : null;
        const beatPositions = metronome.beatPositions;
        const bpb = metronome.beatsPerBar || 4;

        if (effectiveBeats && effectiveBeats.length > 0) {
            for (let i = 0; i < effectiveBeats.length; i++) {
                const beatTime = effectiveBeats[i];
                if (beatTime > maxDuration) break;
                const x = (beatTime / maxDuration) * width * hz;
                if (x > width) break;

                const isDownbeat = beatPositions && i < beatPositions.length
                    ? beatPositions[i] === 1
                    : (i % bpb) === 0;

                ctx.beginPath();
                ctx.strokeStyle = isDownbeat
                    ? 'rgba(76, 175, 80, 0.9)'
                    : 'rgba(76, 175, 80, 0.35)';
                ctx.lineWidth = isDownbeat ? 3 * dpr : 1 * dpr;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
        } else if (metronome.bpm > 0) {
            // Constant BPM fallback
            const beatDuration = 60 / metronome.bpm;
            const res = metronome.clickResolution || 1;
            const step = 1 / res;
            const clickDuration = beatDuration * step;
            const offset = metronome.beatOffset || 0;

            for (let t = offset; t <= maxDuration; t += clickDuration) {
                const x = (t / maxDuration) * width * hz;
                if (x > width) break;

                const beatIdx = Math.round((t - offset) / beatDuration);
                const isDownbeat = (beatIdx % bpb) === 0;

                ctx.beginPath();
                ctx.strokeStyle = isDownbeat
                    ? 'rgba(76, 175, 80, 0.9)'
                    : 'rgba(76, 175, 80, 0.35)';
                ctx.lineWidth = isDownbeat ? 3 * dpr : 1 * dpr;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
        }

        this.canvasCache[name] = { canvas, timestamp: Date.now() };
    }

    /**
     * Update all waveforms
     */
    updateAllWaveforms() {
        Object.keys(this.mixer.stems).forEach(stemName => {
            if (stemName === 'metronome') {
                this.drawMetronomeBeatGrid(stemName);
                return;
            }
            this.drawWaveform(stemName);
        });

        // Also update master waveform if in a practice tab
        if (this.mixer.tabManager && this.mixer.tabManager.isPracticeTab()) {
            this.drawMasterWaveform();
        }
    }
    
    /**
     * Render a recording waveform with startOffset spacer.
     * @param {Object} recording - Recording object with audioBuffer and startOffset
     * @param {HTMLElement} waveformContainer - Container element for the waveform
     */
    renderRecordingWaveform(recording, waveformContainer) {
        if (!recording.audioBuffer || !waveformContainer) return;

        let canvas = waveformContainer.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            waveformContainer.appendChild(canvas);
        }

        canvas.width = waveformContainer.offsetWidth * window.devicePixelRatio;
        canvas.height = waveformContainer.offsetHeight * window.devicePixelRatio;
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const centerY = height / 2;

        ctx.clearRect(0, 0, width, height);
        this.drawGrid(ctx, width, height);

        // Compute waveform data from AudioBuffer
        const buffer = recording.audioBuffer;
        const rawData = buffer.getChannelData(0);
        const totalDuration = this.mixer.maxDuration || buffer.duration;
        const offsetRatio = recording.startOffset / totalDuration;
        const durationRatio = buffer.duration / totalDuration;

        // Apply horizontal zoom
        const hz = this.mixer.zoomLevels.horizontal;
        const vz = this.mixer.zoomLevels.vertical;

        const startX = offsetRatio * width * hz;
        const waveWidth = durationRatio * width * hz;
        const samples = Math.max(1, Math.floor(waveWidth));

        // Color: green if saved to server, red otherwise
        const color = recording.saved ? '#2ecc71' : '#e74c3c';
        const colorRgba = recording.saved ? 'rgba(46, 204, 113, 0.05)' : 'rgba(231, 76, 60, 0.05)';

        // Draw offset spacer (dimmed area)
        if (startX > 0) {
            ctx.fillStyle = colorRgba;
            ctx.fillRect(0, 0, Math.min(startX, width), height);
        }

        // Draw waveform
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * window.devicePixelRatio;

        const samplesPerPixel = rawData.length / samples;
        for (let px = 0; px < samples; px++) {
            const x = startX + px;
            if (x > width) break;
            if (x < 0) continue;

            const sampleIdx = Math.floor(px * samplesPerPixel);
            const endIdx = Math.min(sampleIdx + Math.ceil(samplesPerPixel), rawData.length);

            let max = 0;
            for (let j = sampleIdx; j < endIdx; j++) {
                const abs = Math.abs(rawData[j]);
                if (abs > max) max = abs;
            }

            const amplitude = max * vz * height * 0.8;
            ctx.moveTo(x, centerY - amplitude / 2);
            ctx.lineTo(x, centerY + amplitude / 2);
        }
        ctx.stroke();
    }

    /**
     * Update playhead position on all waveforms
     * @param {number} position - Position in seconds
     */
    updateWaveformPlayheads(position) {
        const maxDur = this.mixer.maxDuration;
        const hz = this.mixer.zoomLevels.horizontal;

        // Helper: position a playhead element
        const setPlayhead = (playhead) => {
            const positionPercent = maxDur > 0 ? (position / maxDur) * 100 : 0;
            const adjustedPercent = positionPercent * hz;
            const clampedPercent = Math.max(0, Math.min(adjustedPercent, 100 * hz));
            playhead.style.left = `${clampedPercent}%`;
        };

        // Stem track playheads
        Object.keys(this.mixer.stems).forEach(stemName => {
            const playhead = document.querySelector(`.track[data-stem="${stemName}"] .track-playhead`);
            if (playhead) setPlayhead(playhead);
        });

        // Recording track playheads
        if (this.mixer.recordingEngine) {
            for (const rec of this.mixer.recordingEngine.recordings) {
                const playhead = document.querySelector(`#rec-track-${rec.id} .track-playhead`);
                if (playhead) setPlayhead(playhead);
            }
        }

        // Also update master playhead if in a practice tab
        if (this.mixer.tabManager && this.mixer.tabManager.isPracticeTab()) {
            this.updateMasterPlayhead(position);
        }
    }

    /**
     * Resize all waveforms
     */
    resizeAllWaveforms() {
        Object.keys(this.mixer.stems).forEach(stemName => {
            const waveformContainer = document.querySelector(`.track[data-stem="${stemName}"] .waveform`);
            if (!waveformContainer) return;

            const canvas = waveformContainer.querySelector('canvas');
            if (!canvas) return;

            // Adjust canvas size to container
            canvas.width = waveformContainer.offsetWidth * window.devicePixelRatio;
            canvas.height = waveformContainer.offsetHeight * window.devicePixelRatio;

            // Redraw waveform (or beat grid for metronome)
            if (stemName === 'metronome') {
                this.drawMetronomeBeatGrid(stemName);
            } else {
                this.drawWaveform(stemName);
            }
        });

        // Also resize master waveform if in a practice tab
        if (this.mixer.tabManager && this.mixer.tabManager.isPracticeTab()) {
            this.resizeMasterWaveform();
        }
    }

    /**
     * Create master waveform data by mixing all stems together
     * @returns {Array<number>} Mixed waveform data
     */
    createMasterWaveformData() {
        const stemNames = Object.keys(this.mixer.stems);
        if (stemNames.length === 0) return [];

        // Find the longest waveform data length
        let maxLength = 0;
        stemNames.forEach(name => {
            const stem = this.mixer.stems[name];
            if (stem && stem.waveformData && stem.waveformData.length > maxLength) {
                maxLength = stem.waveformData.length;
            }
        });

        if (maxLength === 0) return [];

        // Initialize master waveform data
        const masterData = new Array(maxLength).fill(0);

        // Mix all stem waveform data together
        stemNames.forEach(name => {
            const stem = this.mixer.stems[name];
            if (!stem || !stem.waveformData) return;

            for (let i = 0; i < stem.waveformData.length; i++) {
                masterData[i] += stem.waveformData[i];
            }
        });

        // Normalize the mixed data to prevent clipping
        const maxValue = Math.max(...masterData.map(Math.abs));
        if (maxValue > 0) {
            for (let i = 0; i < masterData.length; i++) {
                masterData[i] = masterData[i] / maxValue;
            }
        }

        return masterData;
    }

    /**
     * Draw the master waveform (mixed-down version)
     */
    drawMasterWaveform() {
        // Get master waveform container
        const waveformContainer = document.getElementById('master-waveform-container');
        if (!waveformContainer) {
            this.mixer.log('Master waveform container not found');
            return;
        }

        // Create master waveform data
        const masterWaveformData = this.createMasterWaveformData();
        if (masterWaveformData.length === 0) {
            this.mixer.log('No waveform data available for master track');
            return;
        }

        // Get or create canvas
        let canvas = document.getElementById('master-waveform');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'master-waveform';
            canvas.className = 'waveform';
            waveformContainer.appendChild(canvas);
        }

        // Adjust canvas size to container
        canvas.width = waveformContainer.offsetWidth * window.devicePixelRatio;
        canvas.height = waveformContainer.offsetHeight * window.devicePixelRatio;
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        // Render waveform to canvas
        this.renderWaveformToCanvas(canvas, masterWaveformData);

        // Store in cache
        this.canvasCache['master'] = {
            canvas,
            timestamp: Date.now()
        };

        this.mixer.log('Master waveform rendered');
    }

    /**
     * Resize master waveform canvas
     */
    resizeMasterWaveform() {
        const waveformContainer = document.getElementById('master-waveform-container');
        if (!waveformContainer) return;

        const canvas = document.getElementById('master-waveform');
        if (!canvas) return;

        // Adjust canvas size to container
        canvas.width = waveformContainer.offsetWidth * window.devicePixelRatio;
        canvas.height = waveformContainer.offsetHeight * window.devicePixelRatio;

        // Redraw master waveform
        this.drawMasterWaveform();
    }

    /**
     * Update master track playhead position
     * @param {number} position - Position in seconds
     */
    updateMasterPlayhead(position) {
        const playhead = document.getElementById('master-playhead');
        if (!playhead) return;

        const waveformContainer = document.getElementById('master-waveform-container');
        if (!waveformContainer) return;

        // Calculate relative position
        const positionPercent = (this.mixer.maxDuration > 0)
            ? (position / this.mixer.maxDuration) * 100
            : 0;

        // Apply horizontal zoom
        const adjustedPercent = positionPercent * this.mixer.zoomLevels.horizontal;

        // Clamp position between 0% and 100%
        const clampedPercent = Math.max(0, Math.min(adjustedPercent, 100 * this.mixer.zoomLevels.horizontal));

        // Update playhead position
        playhead.style.left = `${clampedPercent}%`;
    }
}
