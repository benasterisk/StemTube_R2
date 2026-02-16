/**
 * StemTubes Mixer - SoundTouch Audio Engine
 * Advanced audio engine using SoundTouch for independent time-stretching and pitch-shifting
 */

class SoundTouchEngine {
    /**
     * Constructor for the SoundTouch audio engine
     * @param {StemMixer} mixer - Main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
        this.audioContext = null;
        this.masterGainNode = null;
        this.analyserNode = null;
        
        // AudioWorklet and SoundTouch management
        this.worklets = new Map(); // stem -> AudioWorkletNode
        this.workletRegistered = false;
        this.soundTouchLoaded = false;
        
        // Audio state
        this.isPlaying = false;
        this.startTime = 0;
        this.pausedAt = 0;
        this.animationFrameId = null;
        
        // Time-stretching and pitch-shifting parameters
        this.masterTempo = 1.0;       // Global tempo (0.5 - 2.0)
        this.stemPitches = new Map(); // stem -> pitch in semitones (-12 to +12)
        this.latencyCompensation = new Map(); // stem -> delay compensation
        
        // Buffer management
        this.stemBuffers = new Map(); // stem -> AudioBuffer
        this.bufferSources = new Map(); // stem -> current BufferSourceNode
        
        this.mixer.log('SoundTouch Engine initialized');
    }
    
    /**
     * Initialize the audio context and load SoundTouch
     */
    async initAudioContext() {
        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Create master gain node
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.connect(this.audioContext.destination);
            
            // Create analyser node for visualizations
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 2048;
            this.masterGainNode.connect(this.analyserNode);
            
            // Load SoundTouch library
            await this.loadSoundTouch();
            
            // Register AudioWorklet
            await this.registerWorklet();
            
            this.mixer.log('SoundTouch audio context initialized successfully');
            return true;
        } catch (error) {
            this.mixer.log(`Error initializing SoundTouch audio context: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Load SoundTouch library
     */
    async loadSoundTouch() {
        try {
            // Load main SoundTouch library
            if (!window.SoundTouch) {
                await this.loadScript('/static/wasm/soundtouch.js');
            }
            
            this.soundTouchLoaded = true;
            this.mixer.log('SoundTouch library loaded');
        } catch (error) {
            throw new Error(`Failed to load SoundTouch: ${error.message}`);
        }
    }
    
    /**
     * Load external script
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }
    
    /**
     * Register AudioWorklet for SoundTouch processing
     */
    async registerWorklet() {
        try {
            // Check if AudioWorklet is supported
            if (!this.audioContext.audioWorklet) {
                throw new Error('AudioWorklet not supported in this browser');
            }
            
            // Register our custom stem worklet first
            await this.audioContext.audioWorklet.addModule('/static/js/mixer/stem-worklet.js');
            
            // Then register the SoundTouch worklet
            await this.audioContext.audioWorklet.addModule('/static/wasm/soundtouch-worklet.js');
            
            this.workletRegistered = true;
            this.mixer.log('SoundTouch AudioWorklets registered');
        } catch (error) {
            throw new Error(`Failed to register AudioWorklet: ${error.message}`);
        }
    }
    
    /**
     * Load a stem audio file
     * @param {string} name - Stem name
     * @param {string} url - Audio file URL
     */
    async loadStem(name, url) {
        try {
            this.mixer.log(`Loading SoundTouch stem: ${name}`);
            
            // Create track element
            this.mixer.trackControls.createTrackElement(name);
            
            // Initialize stem in mixer
            this.mixer.stems[name] = {
                name,
                url,
                buffer: null,
                source: null,
                gainNode: null,
                panNode: null,
                volume: 1,
                pan: 0,
                muted: false,
                solo: false,
                active: true,
                waveformData: null
            };
            
            // Fetch and decode audio
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 404) {
                    this.mixer.log(`Stem ${name} not found (404)`);
                    return;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            // Store buffer
            this.stemBuffers.set(name, audioBuffer);
            this.mixer.stems[name].buffer = audioBuffer;
            
            // Initialize pitch for this stem
            this.stemPitches.set(name, 0); // 0 semitones = no pitch change
            
            // Extract waveform data
            await this.extractWaveformData(name);
            
            // Create AudioWorklet for this stem
            await this.createStemWorklet(name);
            
            this.mixer.log(`SoundTouch stem ${name} loaded successfully`);
        } catch (error) {
            this.mixer.log(`Error loading SoundTouch stem ${name}: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Create AudioWorklet for a specific stem
     * @param {string} name - Stem name
     */
    async createStemWorklet(name) {
        try {
            if (!this.workletRegistered) {
                throw new Error('AudioWorklet not registered');
            }
            
            const buffer = this.stemBuffers.get(name);
            if (!buffer) {
                throw new Error(`No buffer found for stem: ${name}`);
            }
            
            // Create AudioWorkletNode using our custom processor
            const workletNode = new AudioWorkletNode(this.audioContext, 'stem-worklet', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                channelCount: buffer.numberOfChannels,
                processorOptions: {
                    sampleRate: this.audioContext.sampleRate,
                    bufferSize: 4096
                }
            });
            
            // Configure worklet parameters
            workletNode.parameters.get('tempo').value = this.masterTempo;
            workletNode.parameters.get('pitch').value = this.stemPitches.get(name) || 0;
            
            // Create gain and pan nodes
            const gainNode = this.audioContext.createGain();
            const panNode = this.audioContext.createStereoPanner();
            
            // Connect: WorkletNode -> GainNode -> PanNode -> MasterGain
            workletNode.connect(gainNode);
            gainNode.connect(panNode);
            panNode.connect(this.masterGainNode);
            
            // Store references
            this.worklets.set(name, workletNode);
            this.mixer.stems[name].gainNode = gainNode;
            this.mixer.stems[name].panNode = panNode;
            
            // Set initial values
            const stem = this.mixer.stems[name];
            gainNode.gain.value = stem.muted ? 0 : stem.volume;
            panNode.pan.value = stem.pan;
            
            this.mixer.log(`AudioWorklet created for stem: ${name}`);
        } catch (error) {
            this.mixer.log(`Error creating worklet for ${name}: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Extract waveform data from audio buffer
     * @param {string} name - Stem name
     */
    async extractWaveformData(name) {
        const buffer = this.stemBuffers.get(name);
        const stem = this.mixer.stems[name];
        if (!buffer || !stem) return;
        
        try {
            // Get channel data
            const channelData = buffer.getChannelData(0);
            
            // Reduce resolution for performance
            const numberOfSamples = Math.min(buffer.length, 2000);
            const blockSize = Math.floor(channelData.length / numberOfSamples);
            const waveformData = [];
            
            for (let i = 0; i < numberOfSamples; i++) {
                const blockStart = i * blockSize;
                let blockSum = 0;
                
                for (let j = 0; j < blockSize && (blockStart + j) < channelData.length; j++) {
                    blockSum += Math.abs(channelData[blockStart + j]);
                }
                
                waveformData.push(blockSum / blockSize);
            }
            
            stem.waveformData = waveformData;
            
            // Draw waveform
            this.mixer.waveform.drawWaveform(name);
            
            this.mixer.log(`Waveform data extracted for ${name}`);
        } catch (error) {
            this.mixer.log(`Error extracting waveform for ${name}: ${error.message}`);
        }
    }
    
    /**
     * Set master tempo for all stems
     * @param {number} tempo - Tempo ratio (0.5 - 2.0)
     */
    setMasterTempo(tempo) {
        const clampedTempo = Math.max(0.5, Math.min(2.0, tempo));
        this.masterTempo = clampedTempo;
        
        // Update all worklets
        this.worklets.forEach((worklet, stemName) => {
            if (worklet.parameters.get('tempo')) {
                worklet.parameters.get('tempo').value = clampedTempo;
            }
        });
        
        this.mixer.log(`Master tempo set to: ${clampedTempo}`);
    }
    
    /**
     * Set pitch for a specific stem
     * @param {string} name - Stem name
     * @param {number} semitones - Pitch in semitones (-12 to +12)
     */
    setStemPitch(name, semitones) {
        const clampedPitch = Math.max(-12, Math.min(12, semitones));
        this.stemPitches.set(name, clampedPitch);
        
        const worklet = this.worklets.get(name);
        if (worklet && worklet.parameters.get('pitch')) {
            worklet.parameters.get('pitch').value = clampedPitch;
        }
        
        this.mixer.log(`Stem ${name} pitch set to: ${clampedPitch} semitones`);
    }
    
    /**
     * Start playback
     */
    play() {
        try {
            if (this.isPlaying) return;
            
            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            // Calculate start time
            this.startTime = this.audioContext.currentTime - this.mixer.currentTime;
            this.isPlaying = true;
            
            // Start all stem sources
            this.startAllStems();

            // Start recording track playback
            if (this.mixer.recordingEngine) {
                this.mixer.recordingEngine.playAll(this.mixer.currentTime);
            }

            // Start position update animation
            this.startPlaybackAnimation();

            this.mixer.log('SoundTouch playback started');
        } catch (error) {
            this.mixer.log(`Error starting SoundTouch playback: ${error.message}`);
        }
    }
    
    /**
     * Start audio sources for all stems
     */
    startAllStems() {
        this.stemBuffers.forEach((buffer, name) => {
            this.startStemSource(name, buffer);
        });
    }
    
    /**
     * Start audio source for a specific stem
     * @param {string} name - Stem name
     * @param {AudioBuffer} buffer - Audio buffer
     */
    startStemSource(name, buffer) {
        try {
            // Stop existing source if any
            this.stopStemSource(name);
            
            // Create new buffer source
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            
            // Connect to worklet
            const worklet = this.worklets.get(name);
            if (worklet) {
                source.connect(worklet);
            }
            
            // Store reference
            this.bufferSources.set(name, source);
            this.mixer.stems[name].source = source;
            
            // Start playback at current position
            const offset = Math.min(this.mixer.currentTime, buffer.duration);
            source.start(0, offset);
            
            this.mixer.log(`Started source for stem: ${name} at offset ${offset.toFixed(2)}s`);
        } catch (error) {
            this.mixer.log(`Error starting stem source ${name}: ${error.message}`);
        }
    }
    
    /**
     * Stop audio source for a specific stem
     * @param {string} name - Stem name
     */
    stopStemSource(name) {
        const source = this.bufferSources.get(name);
        if (source) {
            try {
                source.stop();
            } catch (e) {
                // Source already stopped
            }
            this.bufferSources.delete(name);
            if (this.mixer.stems[name]) {
                this.mixer.stems[name].source = null;
            }
        }
    }
    
    /**
     * Pause playback
     */
    pause() {
        try {
            if (!this.isPlaying) return;

            this.pausedAt = this.mixer.currentTime;
            this.isPlaying = false;

            // Stop recording track playback
            if (this.mixer.recordingEngine) {
                this.mixer.recordingEngine.stopAll();
            }

            // Stop all sources
            this.bufferSources.forEach((source, name) => {
                this.stopStemSource(name);
            });

            this.stopPlaybackAnimation();

            this.mixer.log('SoundTouch playback paused');
        } catch (error) {
            this.mixer.log(`Error pausing SoundTouch playback: ${error.message}`);
        }
    }
    
    /**
     * Stop playback
     */
    stop() {
        try {
            this.isPlaying = false;
            this.mixer.currentTime = 0;
            this.pausedAt = 0;

            // Stop recording track playback
            if (this.mixer.recordingEngine) {
                this.mixer.recordingEngine.stopAll();
            }

            // Stop all sources
            this.bufferSources.forEach((source, name) => {
                this.stopStemSource(name);
            });
            
            this.stopPlaybackAnimation();
            
            // Reset timeline
            this.mixer.timeline.updatePlayhead(0);
            this.mixer.updateTimeDisplay();
            
            this.mixer.log('SoundTouch playback stopped');
        } catch (error) {
            this.mixer.log(`Error stopping SoundTouch playback: ${error.message}`);
        }
    }
    
    /**
     * Seek to a specific position
     * @param {number} position - Position in seconds
     */
    seekToPosition(position) {
        try {
            const newPosition = Math.max(0, Math.min(position, this.mixer.maxDuration));
            this.mixer.currentTime = newPosition;

            if (this.isPlaying) {
                // Restart sources at new position
                this.startAllStems();
                this.startTime = this.audioContext.currentTime - newPosition;
            }

            // Update recording playback positions
            if (this.mixer.recordingEngine) {
                this.mixer.recordingEngine.seekUpdate(newPosition);
            }

            // Update timeline
            this.mixer.timeline.updatePlayhead(newPosition);
            this.mixer.updateTimeDisplay();
            
            this.mixer.log(`SoundTouch seek to: ${newPosition.toFixed(2)}s`);
        } catch (error) {
            this.mixer.log(`Error seeking in SoundTouch: ${error.message}`);
        }
    }
    
    /**
     * Start playback animation
     */
    startPlaybackAnimation() {
        this.stopPlaybackAnimation();
        
        const animate = () => {
            this.updatePlaybackPositions();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        
        this.animationFrameId = requestAnimationFrame(animate);
    }
    
    /**
     * Stop playback animation
     */
    stopPlaybackAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    
    /**
     * Update playback positions
     */
    updatePlaybackPositions() {
        if (!this.isPlaying) return;
        
        // Calculate current time based on master tempo
        const rawTime = this.audioContext.currentTime - this.startTime;
        this.mixer.currentTime = rawTime;
        
        // Check if we've reached the end
        if (this.mixer.currentTime >= this.mixer.maxDuration) {
            this.stop();
            return;
        }
        
        // Update UI
        this.mixer.timeline.updatePlayhead(this.mixer.currentTime);
        this.mixer.updateTimeDisplay();
    }
    
    /**
     * Update solo/mute states
     */
    updateSoloMuteStates() {
        const stemHasSolo = Object.values(this.mixer.stems).some(stem => stem.solo);
        const recHasSolo = this.mixer.recordingEngine ? this.mixer.recordingEngine.hasAnySolo() : false;
        const hasSolo = stemHasSolo || recHasSolo;

        Object.entries(this.mixer.stems).forEach(([name, stem]) => {
            if (!stem.gainNode) return;

            const shouldBeMuted = stem.muted || (hasSolo && !stem.solo);
            stem.gainNode.gain.value = shouldBeMuted ? 0 : stem.volume;

            this.mixer.trackControls.updateTrackStatus(name, !shouldBeMuted);
        });

        // Update recording tracks
        if (this.mixer.recordingEngine) {
            this.mixer.recordingEngine.updateSoloMuteStates(hasSolo);
        }
    }
    
    /**
     * Get current master tempo
     */
    getMasterTempo() {
        return this.masterTempo;
    }
    
    /**
     * Get pitch for a specific stem
     * @param {string} name - Stem name
     */
    getStemPitch(name) {
        return this.stemPitches.get(name) || 0;
    }
    
    /**
     * Check if SoundTouch is supported
     */
    static isSupported() {
        const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);
        const hasAudioWorklet = hasAudioContext && 'audioWorklet' in (new (window.AudioContext || window.webkitAudioContext)());
        return hasAudioContext && hasAudioWorklet;
    }
}