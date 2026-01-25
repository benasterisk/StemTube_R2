/**
 * MixExporter - Export current mixer state to MP3
 *
 * Handles:
 * - Collecting mixer state (volumes, pans, mutes)
 * - Processing stems with SoundTouch for tempo/pitch changes
 * - Mixing stems to stereo
 * - Encoding to MP3 with lamejs
 */

class MixExporter {
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || 44100;
        this.bitRate = options.bitRate || 192; // kbps
        this.onProgress = options.onProgress || (() => {});
    }

    /**
     * Export the current mix to MP3
     * @param {Object} mixerState - Current state of the mixer
     * @param {Object} mixerState.stems - Map of stem name to {buffer, volume, pan, muted}
     * @param {number} mixerState.tempo - Tempo ratio (1.0 = normal)
     * @param {number} mixerState.pitch - Pitch shift in semitones
     * @param {string} mixerState.title - Track title for filename
     * @returns {Promise<Blob>} MP3 blob
     */
    async exportMix(mixerState) {
        const { stems, tempo = 1.0, pitch = 0, title = 'mix' } = mixerState;

        this.onProgress(0, 'Preparing export...');

        // Get active (non-muted) stems
        const activeStems = Object.entries(stems)
            .filter(([name, stem]) => !stem.muted && stem.buffer)
            .map(([name, stem]) => ({ name, ...stem }));

        if (activeStems.length === 0) {
            throw new Error('No active stems to export');
        }

        // Check if we need pitch/tempo processing
        const needsProcessing = tempo !== 1.0 || pitch !== 0;

        // Calculate output duration (adjusted for tempo)
        const originalDuration = Math.max(...activeStems.map(s => s.buffer.duration));
        const outputDuration = originalDuration / tempo;
        const outputSamples = Math.ceil(outputDuration * this.sampleRate);

        this.onProgress(5, 'Processing stems...');

        // Process each stem
        const processedStems = [];
        for (let i = 0; i < activeStems.length; i++) {
            const stem = activeStems[i];
            this.onProgress(
                5 + (i / activeStems.length) * 40,
                `Processing ${stem.name}...`
            );

            let processedBuffer;
            if (needsProcessing) {
                processedBuffer = await this.processWithSoundTouch(
                    stem.buffer,
                    tempo,
                    pitch
                );
            } else {
                processedBuffer = stem.buffer;
            }

            processedStems.push({
                name: stem.name,
                buffer: processedBuffer,
                volume: stem.volume,
                pan: stem.pan
            });
        }

        this.onProgress(50, 'Mixing stems...');

        // Mix all stems to stereo
        const mixedBuffer = this.mixStems(processedStems, outputSamples);

        this.onProgress(70, 'Encoding MP3...');

        // Encode to MP3
        const mp3Blob = await this.encodeMP3(mixedBuffer);

        this.onProgress(100, 'Complete!');

        return mp3Blob;
    }

    /**
     * Process an AudioBuffer with SoundTouch for tempo/pitch changes
     */
    async processWithSoundTouch(buffer, tempo, pitchSemitones) {
        return new Promise((resolve) => {
            // Create SoundTouch instance
            const soundTouch = new SoundTouch();
            soundTouch.tempo = tempo;
            soundTouch.pitchSemitones = pitchSemitones;

            // Create source from buffer
            const source = new WebAudioBufferSource(buffer);

            // Create filter
            const filter = new SimpleFilter(source, soundTouch);

            // Calculate output length
            const inputFrames = buffer.length;
            const outputFrames = Math.ceil(inputFrames / tempo);

            // Process in chunks
            const chunkSize = 8192;
            const outputLeft = new Float32Array(outputFrames);
            const outputRight = new Float32Array(outputFrames);
            const samples = new Float32Array(chunkSize * 2);

            let outputPosition = 0;
            let framesExtracted;

            do {
                framesExtracted = filter.extract(samples, chunkSize);
                for (let i = 0; i < framesExtracted && outputPosition < outputFrames; i++) {
                    outputLeft[outputPosition] = samples[i * 2];
                    outputRight[outputPosition] = samples[i * 2 + 1];
                    outputPosition++;
                }
            } while (framesExtracted > 0 && outputPosition < outputFrames);

            // Create new AudioBuffer with processed data
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const processedBuffer = audioContext.createBuffer(2, outputPosition, buffer.sampleRate);
            processedBuffer.copyToChannel(outputLeft.subarray(0, outputPosition), 0);
            processedBuffer.copyToChannel(outputRight.subarray(0, outputPosition), 1);
            audioContext.close();

            resolve(processedBuffer);
        });
    }

    /**
     * Mix multiple stems into a stereo buffer
     */
    mixStems(stems, outputSamples) {
        const left = new Float32Array(outputSamples);
        const right = new Float32Array(outputSamples);

        for (const stem of stems) {
            const buffer = stem.buffer;
            const volume = stem.volume;
            const pan = stem.pan; // -1 (left) to 1 (right)

            // Calculate pan gains (constant power panning)
            const panAngle = (pan + 1) * Math.PI / 4; // 0 to PI/2
            const leftGain = Math.cos(panAngle) * volume;
            const rightGain = Math.sin(panAngle) * volume;

            // Get channel data
            const srcLeft = buffer.getChannelData(0);
            const srcRight = buffer.numberOfChannels > 1
                ? buffer.getChannelData(1)
                : buffer.getChannelData(0);

            // Mix into output
            const samplesToMix = Math.min(buffer.length, outputSamples);
            for (let i = 0; i < samplesToMix; i++) {
                left[i] += srcLeft[i] * leftGain;
                right[i] += srcRight[i] * rightGain;
            }
        }

        // Normalize to prevent clipping
        let maxSample = 0;
        for (let i = 0; i < outputSamples; i++) {
            maxSample = Math.max(maxSample, Math.abs(left[i]), Math.abs(right[i]));
        }

        if (maxSample > 1.0) {
            const normalizeGain = 0.95 / maxSample;
            for (let i = 0; i < outputSamples; i++) {
                left[i] *= normalizeGain;
                right[i] *= normalizeGain;
            }
        }

        return { left, right, sampleRate: this.sampleRate };
    }

    /**
     * Encode stereo PCM to MP3 using lamejs
     */
    async encodeMP3(mixedBuffer) {
        return new Promise((resolve, reject) => {
            try {
                const { left, right, sampleRate } = mixedBuffer;

                // Initialize LAME encoder
                const mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, this.bitRate);

                const mp3Data = [];
                const blockSize = 1152; // LAME's frame size

                // Convert Float32 to Int16
                const leftInt = this.floatTo16Bit(left);
                const rightInt = this.floatTo16Bit(right);

                // Encode in blocks
                for (let i = 0; i < leftInt.length; i += blockSize) {
                    const leftChunk = leftInt.subarray(i, i + blockSize);
                    const rightChunk = rightInt.subarray(i, i + blockSize);

                    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
                    if (mp3buf.length > 0) {
                        mp3Data.push(mp3buf);
                    }
                }

                // Flush remaining data
                const mp3buf = mp3encoder.flush();
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }

                // Create blob
                const blob = new Blob(mp3Data, { type: 'audio/mp3' });
                resolve(blob);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Convert Float32Array to Int16Array for MP3 encoding
     */
    floatTo16Bit(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    /**
     * Trigger download of the MP3 blob
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MixExporter;
}
