/**
 * Stage Window — the Chords Grid View / Lyrics Focus dialog in a REAL browser
 * window (window.open): resizable without limit, maximizable, F11 full screen
 * on whatever monitor it sits on. Replaces the Document-PiP approach, whose
 * windows Chrome caps at ~80% of the screen and where full screen is refused.
 *
 * Architecture: the stage window loads the SAME mixer page with
 * ?stage=lyrics|chords. In that mode the page becomes a DISPLAY MIRROR: it
 * fetches meta/chords/lyrics like the main mixer but loads NO audio; its
 * engine clock (engine.pos()/playing) is driven by state broadcast from the
 * main mixer over a BroadcastChannel (same origin), and its transport controls
 * send commands back to the main mixer instead of playing locally. Both
 * windows keep their own DOM - nothing is moved between documents, so every
 * control (including the lyrics Size slider) works natively.
 *
 * Roles:
 *   MAIN (normal mixer): broadcasts {pos, playing, rate, bpm, semi} at ~10 Hz
 *     and on every transport change; executes commands from stage windows.
 *   STAGE (?stage=...): applies the state to a ghost engine, opens the popup
 *     dialog full-window at load, forwards transport actions as commands.
 */
(function () {
    'use strict';

    const params = new URLSearchParams(location.search);
    const stageMode = params.get('stage');            // 'lyrics' | 'chords' | null
    const extractionId = params.get('extraction_id') || '';
    const CH_NAME = 'stemtube-stage:' + extractionId;
    window.STAGE_MODE = stageMode;

    let channel = null;
    try { channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CH_NAME) : null; } catch (e) { channel = null; }
    if (!channel) return;   // very old browser: no stage window feature

    // ── helpers shared ───────────────────────────────────────────────

    function readState() {
        // Main mixer's live transport state (POC engine + TempoPitch)
        let pos = 0, playing = false, rate = 1, bpm = null, semi = 0;
        try { pos = engine.pos(); playing = !!engine.playing; } catch (e) { /* engine not ready */ }
        try { rate = engine.playbackRate || 1; } catch (e) { /* ignore */ }
        try { bpm = TempoPitch.bpmTarget || TempoPitch.bpmBase || null; semi = TempoPitch.pitchSemitones || 0; } catch (e) { /* ignore */ }
        return { pos, playing, rate, bpm, semi, t: performance.now() };
    }

    // ── MAIN role ────────────────────────────────────────────────────

    if (!stageMode) {
        let lastSent = null;
        function broadcast(force) {
            const s = readState();
            if (!force && lastSent && !s.playing && !lastSent.playing &&
                Math.abs(s.pos - lastSent.pos) < 0.005 && s.bpm === lastSent.bpm && s.semi === lastSent.semi) return;
            channel.postMessage({ type: 'state', ...s });
            lastSent = s;
        }
        setInterval(() => broadcast(false), 100);

        channel.onmessage = (ev) => {
            const m = ev.data; if (!m || typeof m !== 'object') return;
            if (m.type === 'hello') { broadcast(true); return; }
            if (m.type !== 'cmd') return;
            try {
                switch (m.cmd) {
                    case 'toggle': { const b = document.getElementById('playBtn'); if (b) b.click(); break; }
                    case 'stop':   { const b = document.getElementById('stopBtn'); if (b) b.click(); break; }
                    case 'fromStart': { const b = document.getElementById('fromStartBtn'); if (b) b.click(); break; }
                    case 'seek':   if (typeof m.pos === 'number') engine.seek(Math.max(0, m.pos)); break;
                    case 'bpm':    if (window.TempoPitch && typeof m.bpm === 'number') TempoPitch.setBpm(m.bpm); break;
                    case 'bpmDelta': if (window.TempoPitch) TempoPitch.adjustBpm(m.delta || 0); break;
                    case 'bpmReset': if (window.TempoPitch) TempoPitch.resetBpm(); break;
                    case 'pitchDelta': if (window.TempoPitch) TempoPitch.adjustPitch(m.delta || 0); break;
                    case 'pitchReset': if (window.TempoPitch) TempoPitch.resetPitch(); break;
                }
            } catch (e) { console.warn('[StageWindow] command failed:', m.cmd, e); }
            setTimeout(() => broadcast(true), 30);
        };

        // Public: open a stage window for the current song
        window.StageWindow = {
            open(kind) {
                const url = '/mixer?extraction_id=' + encodeURIComponent(extractionId) + '&stage=' + encodeURIComponent(kind);
                const name = 'stemtube-stage-' + kind + '-' + extractionId;
                const feats = 'popup=yes,width=' + Math.round(screen.availWidth * 0.9) + ',height=' + Math.round(screen.availHeight * 0.9) + ',left=40,top=40';
                const w = window.open(url, name, feats);
                if (w) { try { w.focus(); } catch (e) { /* ignore */ } }
                return !!w;
            }
        };
        return;
    }

    // ── STAGE role ───────────────────────────────────────────────────

    // 1) Ghost clock: the engine reports the master's position/state.
    //    engine.pos() returns staticPos when not playing; we override pos()
    //    and expose `playing` so every consumer (chord/karaoke sync loop,
    //    time display, play-button glyph) follows the master transparently.
    let master = { pos: 0, playing: false, rate: 1, bpm: null, semi: 0, at: performance.now() };
    function installGhostClock() {
        if (typeof engine === 'undefined') { setTimeout(installGhostClock, 100); return; }
        engine.pos = function () {
            if (!master.playing) return master.pos;
            return master.pos + (performance.now() - master.at) / 1000 * (master.rate || 1);
        };
        Object.defineProperty(engine, 'playing', { get() { return !!master.playing; }, set() {}, configurable: true });
        // Neutralize local audio actions (nothing loaded, and we never want to play here)
        engine.play = function () { channel.postMessage({ type: 'cmd', cmd: 'toggle' }); };
        engine.stop = function () { channel.postMessage({ type: 'cmd', cmd: 'toggle' }); };
        engine.seek = function (t) { channel.postMessage({ type: 'cmd', cmd: 'seek', pos: t }); };
        engine.setStems = async function () { /* display mirror: no audio */ };
        engine.loadWorklet = async function () { /* no audio */ };
        if (typeof engine.seekToPosition === 'function') engine.seekToPosition = engine.seek;
    }
    installGhostClock();

    channel.onmessage = (ev) => {
        const m = ev.data; if (!m || m.type !== 'state') return;
        master = { pos: m.pos, playing: m.playing, rate: m.rate || 1, bpm: m.bpm, semi: m.semi, at: performance.now() };
        // reflect BPM / pitch read-outs
        try {
            if (window.TempoPitch && typeof m.bpm === 'number' && TempoPitch.bpmTarget !== m.bpm) {
                TempoPitch.bpmTarget = m.bpm; if (TempoPitch.updateDisplay) TempoPitch.updateDisplay(true);
            }
        } catch (e) { /* ignore */ }
    };
    channel.postMessage({ type: 'hello' });

    // 2) Transport buttons -> commands (they exist in the shared transport bar).
    //    Override AFTER the mixer's own handlers are attached (they'd call the
    //    neutralized engine anyway; we short-circuit for a clean single message).
    function wireTransport() {
        const bind = (id, cmd, extra) => {
            const el = document.getElementById(id); if (!el) return;
            el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); channel.postMessage({ type: 'cmd', cmd, ...(extra || {}) }); };
        };
        bind('playBtn', 'toggle'); bind('stopBtn', 'stop'); bind('fromStartBtn', 'fromStart');
        bind('bpmReset', 'bpmReset'); bind('pitchReset', 'pitchReset');
        // TempoPitch: route setBpm/adjust*/reset* through commands
        if (window.TempoPitch && !TempoPitch._stageWired) {
            TempoPitch.setBpm = (bpm) => channel.postMessage({ type: 'cmd', cmd: 'bpm', bpm });
            TempoPitch.adjustBpm = (d) => channel.postMessage({ type: 'cmd', cmd: 'bpmDelta', delta: d });
            TempoPitch.resetBpm = () => channel.postMessage({ type: 'cmd', cmd: 'bpmReset' });
            TempoPitch.adjustPitch = (d) => channel.postMessage({ type: 'cmd', cmd: 'pitchDelta', delta: d });
            TempoPitch.resetPitch = () => channel.postMessage({ type: 'cmd', cmd: 'pitchReset' });
            TempoPitch._stageWired = true;
        }
    }

    // 3) Permanent render loop. In the main mixer, main.js's tick() (which
    //    pushes engine.pos() into chordDisplay/karaokeDisplay .sync() so the
    //    grid highlight, karaoke word wipe and auto-scroll follow the music)
    //    only runs while a LOCAL play is active. Here play is delegated to
    //    the master, so tick() never starts: drive the same syncs ourselves,
    //    from the ghost clock, at a fixed rate that survives background tabs
    //    (setInterval; rAF is frozen when the window is not focused/visible).
    let lastPlayGlyph = null;
    function renderTick() {
        let p = 0;
        try { p = engine.pos(); } catch (e) { return; }
        try { if (window.mixer && window.mixer.chordDisplay) window.mixer.chordDisplay.sync(p); } catch (e) { /* ignore */ }
        try { if (window.mixer && window.mixer.karaokeDisplay) window.mixer.karaokeDisplay.sync(p); } catch (e) { /* ignore */ }
        try { if (window.mixer && window.mixer.structureDisplay) window.mixer.structureDisplay.sync(p); } catch (e) { /* ignore */ }
        try { if (window.UI && window.UI.updateTime) window.UI.updateTime(); } catch (e) { /* ignore */ }
        // play/pause glyph mirrors the master's state
        const playing = !!master.playing;
        if (playing !== lastPlayGlyph) {
            lastPlayGlyph = playing;
            const b = document.getElementById('playBtn');
            if (b) b.innerHTML = playing ? '<span class="ico">⏸</span>' : '<span class="ico">▶</span>';
        }
    }
    setInterval(renderTick, 50);   // 20 Hz: smooth enough for a word wipe, cheap

    // When the song is loaded, open the requested dialog full-window.
    function openStageDialog() {
        document.body.classList.add('stage-window');
        try {
            if (stageMode === 'lyrics' && window.lyricsPopupInstance) window.lyricsPopupInstance.open();
            if (stageMode === 'chords' && window.mixer && window.mixer.chordDisplay) window.mixer.chordDisplay.openGridPopup();
        } catch (e) { console.warn('[StageWindow] open dialog failed:', e); }
        wireTransport();
        document.title = (stageMode === 'lyrics' ? 'Lyrics' : 'Chords') + ' — StemTube Stage';
        // Closing the dialog in a stage window = closing the window
        const closeIds = ['lyrics-popup-close', 'chords-grid-popup-close'];
        closeIds.forEach((id) => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => window.close()); });
    }
    // Poll for readiness (loader finish -> mixer.maxDuration > 0 and displays present)
    const readyPoll = setInterval(() => {
        const ready = window.mixer && window.mixer.maxDuration > 0 &&
            (stageMode === 'lyrics' ? window.lyricsPopupInstance : (window.mixer.chordDisplay && window.mixer.chordDisplay.chords && window.mixer.chordDisplay.chords.length));
        if (ready) { clearInterval(readyPoll); setTimeout(openStageDialog, 300); }
    }, 300);
    setTimeout(() => clearInterval(readyPoll), 60000);
})();
