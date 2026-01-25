/**
 * StemTubes Mixer - Custom SoundTouch AudioWorklet Processor
 * AudioWorklet processor for real-time time-stretching and pitch-shifting
 */

class StemWorkletProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'tempo',
                defaultValue: 1.0,
                minValue: 0.5,
                maxValue: 2.0,
                automationRate: 'k-rate'
            },
            {
                name: 'pitch',
                defaultValue: 0.0,
                minValue: -12.0,
                maxValue: 12.0,
                automationRate: 'k-rate'
            },
            {
                name: 'enabled',
                defaultValue: 1.0,
                minValue: 0.0,
                maxValue: 1.0,
                automationRate: 'k-rate'
            }
        ];
    }
    
    constructor(options) {
        super();
        
        // Audio processing parameters
        this.sampleRate = options.processorOptions?.sampleRate || 44100;
        this.bufferSize = options.processorOptions?.bufferSize || 4096;
        
        // SoundTouch parameters
        this.currentTempo = 1.0;
        this.currentPitch = 0.0;
        this.enabled = true;
        
        // Ring buffer for audio processing
        this.inputBuffer = new Float32Array(this.bufferSize * 4); // Larger buffer for processing
        this.outputBuffer = new Float32Array(this.bufferSize * 4);
        this.inputWriteIndex = 0;
        this.outputReadIndex = 0;
        this.outputWriteIndex = 0;
        
        // Processing state
        this.isProcessing = false;
        this.processingFrame = 0;
        
        // Simple parameters for basic time-stretching algorithm
        // (This is a simplified implementation - real SoundTouch would be more complex)
        this.frameSize = 1024;
        this.hopSize = 256;
        this.overlapBuffer = new Float32Array(this.frameSize);
        this.previousFrame = new Float32Array(this.frameSize);
        this.window = this.createHannWindow(this.frameSize);
        
        // Phase vocoder state
        this.analysisFreqs = new Float32Array(this.frameSize);
        this.synthesisFreqs = new Float32Array(this.frameSize);
        this.lastPhase = new Float32Array(this.frameSize / 2 + 1);
        this.sumPhase = new Float32Array(this.frameSize / 2 + 1);
        
        // Initialize FFT (simplified - real implementation would use proper FFT)
        this.fftSize = this.frameSize;
        this.fftReal = new Float32Array(this.fftSize);
        this.fftImag = new Float32Array(this.fftSize);
        
        console.log('[StemWorklet] Initialized with sample rate:', this.sampleRate);
    }
    
    /**
     * Create Hann window for audio processing
     */
    createHannWindow(size) {
        const window = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
        }
        return window;
    }
    
    /**
     * Process audio block
     */
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (!input || !output || input.length === 0 || output.length === 0) {
            return true;
        }
        
        // Get parameter values
        const tempo = parameters.tempo[0] || this.currentTempo;
        const pitch = parameters.pitch[0] || this.currentPitch;
        const enabled = parameters.enabled[0] || 1.0;
        
        // Update parameters if changed
        if (Math.abs(tempo - this.currentTempo) > 0.001) {
            this.currentTempo = tempo;
        }
        if (Math.abs(pitch - this.currentPitch) > 0.1) {
            this.currentPitch = pitch;
        }
        this.enabled = enabled > 0.5;
        
        const inputChannel = input[0];
        const outputChannel = output[0];
        
        if (!inputChannel || !outputChannel) {
            return true;
        }
        
        // If processing is disabled, pass through audio
        if (!this.enabled || (Math.abs(tempo - 1.0) < 0.001 && Math.abs(pitch) < 0.1)) {
            outputChannel.set(inputChannel);
            return true;
        }
        
        // Process audio with time-stretching and pitch-shifting
        this.processAudioBlock(inputChannel, outputChannel, tempo, pitch);
        
        return true;
    }
    
    /**
     * Process audio block with time-stretching and pitch-shifting
     */
    processAudioBlock(input, output, tempo, pitch) {
        const blockSize = input.length;
        
        // Simple implementation: combine time-stretching and pitch-shifting
        // Real SoundTouch would use more sophisticated algorithms
        
        if (Math.abs(tempo - 1.0) > 0.001) {
            // Apply time-stretching
            this.applyTimeStretching(input, output, tempo);
        } else {
            // No time-stretching, copy input to output
            output.set(input);
        }
        
        if (Math.abs(pitch) > 0.1) {
            // Apply pitch-shifting (simplified)
            this.applyPitchShifting(output, output, pitch);
        }
    }
    
    /**
     * Apply time-stretching using simplified PSOLA-like approach
     */
    applyTimeStretching(input, output, tempo) {
        const blockSize = input.length;
        
        // Simplified time-stretching: resample with overlap-add
        for (let i = 0; i < blockSize; i++) {
            // Calculate source position with tempo adjustment
            const sourcePos = i / tempo;
            const sourceIndex = Math.floor(sourcePos);
            const fraction = sourcePos - sourceIndex;
            
            // Linear interpolation between samples
            let sample = 0;
            if (sourceIndex < input.length - 1) {
                sample = input[sourceIndex] * (1 - fraction) + input[sourceIndex + 1] * fraction;
            } else if (sourceIndex < input.length) {
                sample = input[sourceIndex];
            }
            
            output[i] = sample;
        }
    }
    
    /**
     * Apply pitch-shifting using frequency domain manipulation
     */
    applyPitchShifting(input, output, pitchSemitones) {
        const blockSize = input.length;
        
        // Convert semitones to ratio
        const pitchRatio = Math.pow(2, pitchSemitones / 12);
        
        // Simple pitch shifting: time-domain pitch shifting
        // Real implementation would use phase vocoder in frequency domain
        for (let i = 0; i < blockSize; i++) {
            const sourcePos = i / pitchRatio;
            const sourceIndex = Math.floor(sourcePos);
            const fraction = sourcePos - sourceIndex;
            
            let sample = 0;
            if (sourceIndex < input.length - 1) {
                sample = input[sourceIndex] * (1 - fraction) + input[sourceIndex + 1] * fraction;
            } else if (sourceIndex < input.length) {
                sample = input[sourceIndex];
            }
            
            output[i] = sample * 0.8; // Slight attenuation to prevent clipping
        }
    }
    
    /**
     * Simplified FFT (for educational purposes - real implementation would be optimized)
     */
    simpleFFT(real, imag) {
        const N = real.length;
        
        // Bit-reversal
        for (let i = 1, j = 0; i < N; i++) {
            let bit = N >> 1;
            for (; j & bit; bit >>= 1) {
                j ^= bit;
            }
            j ^= bit;
            
            if (i < j) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }
        
        // Cooley-Tukey FFT
        for (let len = 2; len <= N; len <<= 1) {
            const halfLen = len >> 1;
            const w = -2 * Math.PI / len;
            
            for (let i = 0; i < N; i += len) {
                for (let j = 0; j < halfLen; j++) {
                    const u = real[i + j];
                    const v = imag[i + j];
                    const s = Math.cos(w * j);
                    const t = Math.sin(w * j);
                    const x = real[i + j + halfLen];
                    const y = imag[i + j + halfLen];
                    
                    real[i + j] = u + s * x - t * y;
                    imag[i + j] = v + t * x + s * y;
                    real[i + j + halfLen] = u - s * x + t * y;
                    imag[i + j + halfLen] = v - t * x - s * y;
                }
            }
        }
    }
    
    /**
     * Handle messages from main thread
     */
    handleMessage(event) {
        const { type, data } = event.data;
        
        switch (type) {
            case 'configure':
                this.configure(data);
                break;
            case 'reset':
                this.reset();
                break;
            default:
                console.warn('[StemWorklet] Unknown message type:', type);
        }
    }
    
    /**
     * Configure worklet parameters
     */
    configure(config) {
        if (config.tempo !== undefined) {
            this.currentTempo = Math.max(0.5, Math.min(2.0, config.tempo));
        }
        if (config.pitch !== undefined) {
            this.currentPitch = Math.max(-12, Math.min(12, config.pitch));
        }
        if (config.enabled !== undefined) {
            this.enabled = config.enabled;
        }
    }
    
    /**
     * Reset processing state
     */
    reset() {
        this.inputBuffer.fill(0);
        this.outputBuffer.fill(0);
        this.overlapBuffer.fill(0);
        this.previousFrame.fill(0);
        this.lastPhase.fill(0);
        this.sumPhase.fill(0);
        this.inputWriteIndex = 0;
        this.outputReadIndex = 0;
        this.outputWriteIndex = 0;
        this.processingFrame = 0;
    }
}

// Register the processor
registerProcessor('stem-worklet', StemWorkletProcessor);