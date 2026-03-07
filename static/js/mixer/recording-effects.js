/**
 * RecordingEffects — Per-track effects chain for recording tracks.
 * Chain: HPF → EQ Mid → EQ Presence → Compressor → dry output
 *                                                 ↘ reverb send → convolver → wet output
 *
 * Both dry and wet outputs connect to the track's gainNode so the fader
 * controls the overall level of the effected signal.
 */

const REVERB_TYPES = {
    room:   { decay: 0.4, density: 0.9, damping: 5000 },
    plate:  { decay: 1.8, density: 1.0, damping: 6000 },
    hall:   { decay: 2.8, density: 0.6, damping: 3000 },
    spring: { decay: 1.0, density: 0.5, damping: 5500 },
};

const FX_PRESETS = {
    vocals: {
        off:    null,
        subtle: { hpFreq: 80,  eqMidFreq: 3000, eqMidGain: 2,  eqPresFreq: 8000, eqPresGain: 1,  threshold: -18, ratio: 3, attack: 0.010, release: 0.25, reverbMix: 0.15, reverbType: 'plate' },
        warm:   { hpFreq: 100, eqMidFreq: 2500, eqMidGain: 3,  eqPresFreq: 6000, eqPresGain: 2,  threshold: -20, ratio: 4, attack: 0.015, release: 0.30, reverbMix: 0.25, reverbType: 'hall' },
        heavy:  { hpFreq: 120, eqMidFreq: 3500, eqMidGain: 4,  eqPresFreq: 8000, eqPresGain: 3,  threshold: -24, ratio: 6, attack: 0.005, release: 0.20, reverbMix: 0.40, reverbType: 'plate' },
    },
    bass: {
        off:    null,
        subtle: { hpFreq: 40,  eqMidFreq: 100,  eqMidGain: 2,  eqPresFreq: 2000, eqPresGain: -1, threshold: -20, ratio: 4, attack: 0.005, release: 0.20, reverbMix: 0.05, reverbType: 'room' },
        warm:   { hpFreq: 35,  eqMidFreq: 120,  eqMidGain: 4,  eqPresFreq: 1500, eqPresGain: 1,  threshold: -22, ratio: 5, attack: 0.003, release: 0.15, reverbMix: 0.08, reverbType: 'room' },
        heavy:  { hpFreq: 30,  eqMidFreq: 80,   eqMidGain: 5,  eqPresFreq: 2500, eqPresGain: 2,  threshold: -25, ratio: 8, attack: 0.002, release: 0.10, reverbMix: 0.12, reverbType: 'room' },
    },
    drums: {
        off:    null,
        subtle: { hpFreq: 60,  eqMidFreq: 1000, eqMidGain: 1,  eqPresFreq: 5000, eqPresGain: 2,  threshold: -15, ratio: 4, attack: 0.003, release: 0.15, reverbMix: 0.12, reverbType: 'room' },
        warm:   { hpFreq: 50,  eqMidFreq: 800,  eqMidGain: 2,  eqPresFreq: 4000, eqPresGain: 3,  threshold: -18, ratio: 6, attack: 0.001, release: 0.10, reverbMix: 0.20, reverbType: 'room' },
        heavy:  { hpFreq: 40,  eqMidFreq: 1200, eqMidGain: 3,  eqPresFreq: 6000, eqPresGain: 4,  threshold: -20, ratio: 8, attack: 0.001, release: 0.08, reverbMix: 0.30, reverbType: 'hall' },
    },
    other: {
        off:    null,
        subtle: { hpFreq: 80,  eqMidFreq: 1500, eqMidGain: 2,  eqPresFreq: 5000, eqPresGain: 1,  threshold: -15, ratio: 2, attack: 0.010, release: 0.25, reverbMix: 0.15, reverbType: 'plate' },
        warm:   { hpFreq: 100, eqMidFreq: 2000, eqMidGain: 3,  eqPresFreq: 4000, eqPresGain: 2,  threshold: -18, ratio: 3, attack: 0.015, release: 0.30, reverbMix: 0.25, reverbType: 'spring' },
        heavy:  { hpFreq: 80,  eqMidFreq: 2500, eqMidGain: 4,  eqPresFreq: 6000, eqPresGain: 3,  threshold: -22, ratio: 5, attack: 0.005, release: 0.20, reverbMix: 0.40, reverbType: 'hall' },
    },
};

class RecordingEffects {
    constructor(ctx) {
        this.ctx = ctx;
        this.irCache = new Map();
    }

    /**
     * Create an effects chain for a recording track.
     * Starts in bypass mode (all effects neutral).
     * @returns {Object} chain object with input/dryOutput/wetOutput nodes and control methods
     */
    createChain() {
        const ctx = this.ctx;

        const hpFilter = ctx.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = 20;
        hpFilter.Q.value = 0.7;

        const eqMid = ctx.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = 1500;
        eqMid.gain.value = 0;
        eqMid.Q.value = 1.0;

        const eqPresence = ctx.createBiquadFilter();
        eqPresence.type = 'highshelf';
        eqPresence.frequency.value = 5000;
        eqPresence.gain.value = 0;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = 0;
        compressor.ratio.value = 1;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        compressor.knee.value = 6;

        const reverbSend = ctx.createGain();
        reverbSend.gain.value = 0;

        const reverbReturn = ctx.createGain();
        reverbReturn.gain.value = 1;

        const convolver = ctx.createConvolver();

        // Wire: hpf → eqMid → eqPresence → compressor
        hpFilter.connect(eqMid);
        eqMid.connect(eqPresence);
        eqPresence.connect(compressor);

        // Reverb send from compressor output
        compressor.connect(reverbSend);
        reverbSend.connect(convolver);
        convolver.connect(reverbReturn);

        // Initialize convolver with a minimal silent buffer to avoid errors
        const silentIR = ctx.createBuffer(2, ctx.sampleRate * 0.01, ctx.sampleRate);
        convolver.buffer = silentIR;

        let presetName = 'off';
        let category = 'vocals';

        const chain = {
            input: hpFilter,
            dryOutput: compressor,
            wetOutput: reverbReturn,
            nodes: { hpFilter, eqMid, eqPresence, compressor, reverbSend, reverbReturn, convolver },

            getPreset: () => presetName,
            getCategory: () => category,

            applyPreset: async (cat, name) => {
                category = cat || 'vocals';
                presetName = name;

                const presets = FX_PRESETS[category] || FX_PRESETS.other;
                const p = presets[name];

                if (!p) {
                    // Bypass
                    hpFilter.frequency.value = 20;
                    eqMid.gain.value = 0;
                    eqPresence.gain.value = 0;
                    compressor.threshold.value = 0;
                    compressor.ratio.value = 1;
                    reverbSend.gain.value = 0;
                    return;
                }

                hpFilter.frequency.value = p.hpFreq;
                eqMid.frequency.value = p.eqMidFreq;
                eqMid.gain.value = p.eqMidGain;
                eqPresence.frequency.value = p.eqPresFreq;
                eqPresence.gain.value = p.eqPresGain;
                compressor.threshold.value = p.threshold;
                compressor.ratio.value = p.ratio;
                compressor.attack.value = p.attack;
                compressor.release.value = p.release;
                reverbSend.gain.value = p.reverbMix;

                const ir = await this._loadIR(p.reverbType);
                if (ir) {
                    try { convolver.buffer = ir; } catch (e) { /* ignore if playing */ }
                }
            },

            dispose: () => {
                hpFilter.disconnect();
                eqMid.disconnect();
                eqPresence.disconnect();
                compressor.disconnect();
                reverbSend.disconnect();
                reverbReturn.disconnect();
                try { convolver.disconnect(); } catch (e) {}
            },
        };

        chain._loadIR = (type) => this._loadIR(type);
        return chain;
    }

    /**
     * Get or generate a synthetic impulse response.
     * @param {string} type — room, plate, hall, spring
     * @returns {Promise<AudioBuffer>}
     */
    async _loadIR(type) {
        if (this.irCache.has(type)) return this.irCache.get(type);

        const config = REVERB_TYPES[type];
        if (!config) return null;

        const sr = this.ctx.sampleRate;
        const totalLength = Math.ceil(config.decay * sr * 1.3);
        const buffer = this.ctx.createBuffer(2, totalLength, sr);

        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);

            // Early reflections (5–80ms)
            const numRef = 6 + Math.floor(config.density * 12);
            for (let r = 0; r < numRef; r++) {
                const t = 0.005 + (r / numRef) * 0.075;
                const pos = Math.floor(t * sr) + Math.floor(Math.random() * sr * 0.005);
                if (pos < totalLength) {
                    const amp = 0.6 * Math.pow(1 - r / numRef, 1.5);
                    data[pos] += (Math.random() * 2 - 1) * amp;
                }
            }

            // Spring reverb: add metallic resonance taps
            if (type === 'spring') {
                const freqs = [147, 233, 389];
                for (let i = 0; i < totalLength; i++) {
                    const t = i / sr;
                    const env = Math.exp(-5 * t / config.decay);
                    let sum = 0;
                    for (const f of freqs) sum += Math.sin(2 * Math.PI * f * t + ch * 0.7);
                    data[i] += sum * env * 0.04;
                }
            }

            // Late diffuse tail (from 30ms onward)
            const lateStart = Math.floor(0.03 * sr);
            for (let i = lateStart; i < totalLength; i++) {
                const t = (i - lateStart) / sr;
                const envelope = Math.pow(10, -3 * t / config.decay); // RT60 decay
                data[i] += (Math.random() * 2 - 1) * envelope * 0.4;
            }

            // Frequency-dependent damping (HF decays faster)
            let lpState = 0;
            for (let i = 0; i < totalLength; i++) {
                const progress = i / totalLength;
                const cutoff = config.damping * Math.pow(1 - progress, 0.5);
                const rc = 1 / (2 * Math.PI * Math.max(cutoff, 100));
                const alpha = (1 / sr) / (rc + 1 / sr);
                lpState += alpha * (data[i] - lpState);
                data[i] = lpState;
            }
        }

        // Normalize
        let peak = 0;
        for (let ch = 0; ch < 2; ch++) {
            const d = buffer.getChannelData(ch);
            for (let i = 0; i < totalLength; i++) peak = Math.max(peak, Math.abs(d[i]));
        }
        if (peak > 0) {
            const scale = 0.8 / peak;
            for (let ch = 0; ch < 2; ch++) {
                const d = buffer.getChannelData(ch);
                for (let i = 0; i < totalLength; i++) d[i] *= scale;
            }
        }

        this.irCache.set(type, buffer);
        return buffer;
    }

    static getPresetNames(category) {
        const presets = FX_PRESETS[category] || FX_PRESETS.other;
        return Object.keys(presets);
    }

    /**
     * Get a human-readable description of a preset's settings.
     * @param {string} category — vocals, bass, drums, other
     * @param {string} presetName — off, subtle, warm, heavy
     * @returns {string}
     */
    static describePreset(category, presetName) {
        const presets = FX_PRESETS[category] || FX_PRESETS.other;
        const p = presets[presetName];
        if (!p) return '';

        const compDesc = `Comp ${p.ratio}:1 @ ${p.threshold}dB`;
        const eqParts = [];
        if (p.eqMidGain !== 0) eqParts.push(`${p.eqMidGain > 0 ? '+' : ''}${p.eqMidGain}dB@${p.eqMidFreq >= 1000 ? (p.eqMidFreq / 1000) + 'k' : p.eqMidFreq}Hz`);
        if (p.eqPresGain !== 0) eqParts.push(`${p.eqPresGain > 0 ? '+' : ''}${p.eqPresGain}dB@${p.eqPresFreq >= 1000 ? (p.eqPresFreq / 1000) + 'k' : p.eqPresFreq}Hz`);
        const eqDesc = eqParts.length > 0 ? `EQ ${eqParts.join(', ')}` : '';
        const revDesc = p.reverbMix > 0 ? `${p.reverbType} ${Math.round(p.reverbMix * 100)}%` : '';
        const hpDesc = p.hpFreq > 30 ? `HPF ${p.hpFreq}Hz` : '';

        return [hpDesc, compDesc, eqDesc, revDesc].filter(Boolean).join(' · ');
    }
}
