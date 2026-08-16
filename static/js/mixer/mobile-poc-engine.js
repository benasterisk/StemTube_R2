/**
 * Mobile POC engine bridge — runs the POC AudioEngine (static/js/poc/audio.js)
 * inside the mobile PWA and exposes the primitives mobile-app.js expects.
 *
 * WHY: the mobile app carried its own inline audio engine (buffer sources +
 * SoundTouch per stem) and a CLIENT-SIDE synthesized metronome/precount
 * (JamMetronome), the pre-rewrite design judged unreliable. The POC engine is
 * the rewrite: metronome and count-in are sample-locked WAVs rendered by the
 * server (per-user cache, /poc-mixer/*), played as ordinary audio by the same
 * engine as the stems - one engine, one truth, for desktop, mobile and jam.
 *
 * WHAT: mobile-app.js keeps its UI/orchestration (track widgets, jam
 * broadcast, recording hooks, wake lock, lyrics scroll...). Only the audio
 * primitives are delegated here:
 *   loadAll(job, names, meta)         -> engine.setStems (metronome incl.)
 *   startAll(pos) / stopAll() / seek(t) / pos() / playing
 *   setVol/setPan/setMute/setSolo(name, v)
 *   applyTempoPitch(ratio, semi)
 *   precount: playFromStart() via poc/precount.js (baked WAV count-in)
 *   loop: setLoop(a, b, on)
 * The stems map (engine.stems) has the POC shape:
 *   { name, buffer, source, soundTouch, gain, panNode, muted, solo, vol, pan }.
 */
(function () {
    'use strict';

    if (typeof AudioEngine === 'undefined') {
        console.error('[MobilePOC] poc/audio.js must be loaded before mobile-poc-engine.js');
        return;
    }

    const engine = new AudioEngine();
    // Expose under the POC's global name too: poc/precount.js, loop.js and
    // tempo.js reference a top-level `engine` and `view` (script-scope globals).
    window.engine = engine;
    // Ghost `view` for the POC singletons. PreCount/LoopSel draw desktop-only
    // markers (start-line, stop-line, loop-region) into #rightpane using
    // timeToX/lanesTotalH: the mobile mixer has its own timeline, so we give
    // them an off-screen sink and no-op geometry - the AUDIO logic (baked
    // count-in, stop metronome, A/B loop) is what mobile uses.
    if (!document.getElementById('rightpane')) {
        const sink = document.createElement('div');
        sink.id = 'rightpane';
        sink.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
        (document.body || document.documentElement).appendChild(sink);
    }
    window.view = window.view || {
        meta: null, engine: engine, leadPad: 0,
        redrawAll() {}, drawPlayheads() {}, drawWave() {},
        timeToX() { return 0; }, lanesTotalH() { return 0; }, trackH() { return 0; },
    };
    view.engine = engine;
    // Loader.persist() is called by PreCount/LoopSel/TempoPitch on changes; the
    // mobile app persists its own state - a no-op stand-in keeps them happy.
    if (!window.Loader) window.Loader = { persist() {} };
    if (!window.UI) window.UI = { status(msg) { console.log('[POC]', msg); } };

    const STEM_ORDER = ['metronome', 'drums', 'bass', 'vocals', 'other', 'guitar', 'piano'];

    // PreCount / LoopSel are POC singletons that bind to `engine`+`view` and,
    // in _wire(), to desktop button ids that do not exist on mobile (no-op).
    // The mobile popover drives them through this bridge instead.
    if (window.PreCount && PreCount.init) PreCount.init(engine, view);
    if (window.LoopSel && LoopSel.init) LoopSel.init(engine, view);

    const Bridge = {
        engine,
        meta: null,
        job: null,

        /** AudioContext (created lazily by the engine; mobile must resume it in a gesture). */
        get audioContext() { engine.ensureCtx(); return engine.ctx; },

        /**
         * Prepare (server) + load every stem incl. the metronome resolutions.
         * onProgress(stage, pct) mirrors the POC loader for the mobile progress UI.
         * Resolves with the POC meta (beats, positions, duration, stems, chords, ...).
         */
        async loadAll(job, onProgress) {
            this.job = job;
            const prep = await API.prepare(job);
            if (prep && prep.error) throw new Error(prep.error);
            // poll until the per-user cache is ready (instant when already prepared)
            for (;;) {
                const p = await API.progress(job);
                if (onProgress) onProgress(p.stage, p.pct);
                if (p.done) { if (p.error) throw new Error(p.error); break; }
                await new Promise(r => setTimeout(r, 400));
            }
            const meta = await API.meta(job);
            if (meta.error) throw new Error(meta.error);
            this.meta = meta;
            view.meta = meta;
            if (engine.loadWorklet) await engine.loadWorklet();
            const names = STEM_ORDER.filter(n => meta.stems && meta.stems[n]);
            await engine.setStems(job, names, meta.metronome_resolutions);
            engine.duration = meta.duration;
            if (window.PreCount && PreCount.load) { PreCount._job = job; PreCount.load(meta); }
            if (window.LoopSel && LoopSel.load) LoopSel.load(meta);
            return meta;
        },

        /**
         * Jam GUEST loading: same pipeline as loadAll but through the jam
         * routes (no login, validated by session code), which mirror
         * /poc-mixer/meta and /audio against the HOST's POC cache. The guest
         * gets the host's real stems + metronome (all resolutions) + baked
         * count-in plan, so everyone hears the same click and lead-in.
         * `job` is a synthetic id used for engine bookkeeping ("jam:<code>").
         */
        async loadAllFromJam(code, onProgress) {
            const c = String(code).replace(/^JAM-/, '');
            const job = 'jam:' + c;
            this.job = job;
            // Route the POC API to the jam endpoints for this session.
            API.audioUrl = (j, stem) => '/api/jam/poc/audio/' + encodeURIComponent(c) + '/' + stem;
            API.audioBuffer = async (j, stem) => (await fetch(API.audioUrl(j, stem), { credentials: 'same-origin' })).arrayBuffer();
            if (onProgress) onProgress('Loading host mix…', 10);
            const meta = await (await fetch('/api/jam/poc/meta/' + encodeURIComponent(c), { credentials: 'same-origin' })).json();
            if (!meta || meta.error) throw new Error((meta && meta.error) || 'host mix not ready');
            meta.job = job;
            this.meta = meta;
            view.meta = meta;
            if (engine.loadWorklet) await engine.loadWorklet();
            const names = STEM_ORDER.filter(n => meta.stems && meta.stems[n]);
            await engine.setStems(job, names, meta.metronome_resolutions);
            engine.duration = meta.duration;
            // Guests never bake: PreCount only LOADS the host's plan (files served
            // by the jam audio route through the redirected API above).
            if (window.PreCount && PreCount.load) { PreCount._job = job; PreCount.load(meta); }
            if (window.LoopSel && LoopSel.load) LoopSel.load(meta);
            if (onProgress) onProgress('Ready', 100);
            return meta;
        },

        /**
         * Output latency of this device's audio stack, in seconds: the delay
         * between "the engine schedules a sample" and "the speaker emits it"
         * (buffer + OS + Bluetooth). Phones and Bluetooth headsets add tens to
         * hundreds of ms and it differs per device - which is exactly the
         * constant offset that remains between two machines once the clocks
         * and the anchors agree. Web Audio exposes it; fall back to the base
         * (buffer) latency, then to 0.
         */
        outputLatency() {
            const ctx = engine.ctx;
            if (!ctx) return 0;
            const o = (typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0) ? ctx.outputLatency : 0;
            if (o) return o;
            const b = (typeof ctx.baseLatency === 'number' && ctx.baseLatency > 0) ? ctx.baseLatency : 0;
            // SAFARI/iOS: outputLatency is not implemented and baseLatency is
            // ~0, so the real output delay (CoreAudio buffer + route; far more
            // over Bluetooth) would be counted as ZERO and every anchor would
            // land early - the "chaotic" iOS sync. Use the measured value when
            // available (see measureOutputLatency), else a conservative
            // platform estimate.
            if (this._measuredOutLat != null) return this._measuredOutLat;
            const ua = navigator.userAgent || '';
            const isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            if (isIOS) return b || 0.12;     // ~120 ms: typical iOS wired/speaker route
            return b || 0;
        },

        /**
         * Measure this device's true output latency ONCE, by comparing the
         * AudioContext clock with the wall clock across a short silent
         * playback: ctx.currentTime advances only as audio is actually
         * rendered, so (wallElapsed - ctxElapsed) exposes the pipeline delay
         * Safari refuses to report. Cheap (200 ms, silent) and far better than
         * a hardcoded guess. Result is cached and used by outputLatency().
         */
        async measureOutputLatency() {
            const ctx = this.audioContext;
            if (!ctx || ctx.state !== 'running') return null;
            try {
                const c0 = ctx.currentTime, w0 = performance.now();
                // A silent source keeps the graph rendering during the window.
                const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.25), ctx.sampleRate);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const g = ctx.createGain(); g.gain.value = 0;
                src.connect(g); g.connect(ctx.destination);
                src.start();
                await new Promise(r => setTimeout(r, 200));
                src.stop(); src.disconnect(); g.disconnect();
                const ctxElapsed = ctx.currentTime - c0;
                const wallElapsed = (performance.now() - w0) / 1000;
                const lat = wallElapsed - ctxElapsed;          // pipeline delay
                if (Number.isFinite(lat) && lat >= 0 && lat < 0.5) {
                    this._measuredOutLat = lat;
                    console.log('[MobilePOC] measured output latency:', Math.round(lat * 1000), 'ms');
                    return lat;
                }
            } catch (e) { /* measurement is best-effort */ }
            return null;
        },
        _measuredOutLat: null,

        get stems() { return engine.stems; },
        get duration() { return engine.duration || 0; },
        get playing() { return !!engine.playing; },
        pos() { try { return engine.pos(); } catch (e) { return 0; } },

        /** Start playback from `pos` (seconds). Returns the ctx time playback starts. */
        startAll(pos) {
            if (typeof pos === 'number') engine.staticPos = Math.max(0, pos);
            return engine.play();
        },
        /** Pause (position kept). */
        stopAll() { engine.stop(); },
        seek(t) { engine.seek(Math.max(0, t || 0)); },

        setVol(name, v) { if (engine.stems[name]) engine.setVol(name, v); },
        setPan(name, v) { if (engine.stems[name]) engine.setPan(name, v); },
        setMute(name, v) { if (engine.stems[name]) engine.setMute(name, !!v); },
        setSolo(name, v) { if (engine.stems[name]) engine.setSolo(name, !!v); },

        /** Tempo ratio (1 = original) + pitch in semitones, applied to every stem (SoundTouch). */
        applyTempoPitch(ratio, semi) { engine.applyTempoPitch(ratio || 1, semi || 0); },

        /** Metronome resolution: "0.5" | "1" | "2" */
        setMetroResolution(res) { engine.setMetroResolution(String(res)); },

        /** Loop A/B */
        setLoop(a, b, on) { engine.setLoop(a, b, !!on); },

        /**
         * Count-in play: the baked precount WAV plays in front of the song
         * (sample-locked). Requires poc/precount.js. Returns a promise resolved
         * when playback has started.
         */
        async playWithPrecount() {
            if (window.PreCount && PreCount.playFromStart) return PreCount.playFromStart();
            return this.startAll(engine.staticPos);
        },
        get precountBeats() { return (window.PreCount && PreCount.beats) || 0; },
        setPrecountBeats(n) { if (window.PreCount && PreCount.setBeats) PreCount.setBeats(n); },

        unload() { engine.unload(); this.meta = null; view.meta = null; },
    };

    window.MobilePOC = Bridge;
})();
