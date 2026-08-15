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
