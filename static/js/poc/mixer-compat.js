// mixer-compat.js — compatibility shim so friend's Chords / Lyrics / Structure
// display components (kept verbatim) can drive off the clean POC engine.
//
// Those components were written against friend's StemMixer "god object" reached
// via window.mixer (currentTime, maxDuration, isPlaying, audioEngine.seek(),
// pause(), extractionId, metronome, pitchTempo, showToast). The POC engine exposes
// a different surface (engine.pos()/seek()/playing/duration). This file bridges the
// two with a thin window.mixer object — no change to the ~4500 lines of render code.
//
// Loaded AFTER the POC engine scripts (engine/View/TempoPitch are globals) and
// BEFORE the display components are instantiated.
(function () {
  if (typeof engine === "undefined") {
    console.error("[mixer-compat] POC engine not found — load order wrong");
    return;
  }

  // The display code calls mixer.audioEngine.seek(t). The POC engine already has
  // seek(t); also alias seekToPosition for structure/lyrics (they use that name).
  if (typeof engine.seekToPosition !== "function") {
    engine.seekToPosition = function (t) { return engine.seek(t); };
  }

  // ── Recording integration needs a few engine handles under friend's names ──
  // The recording engine reads mixer.audioEngine.masterGainNode / audioContext and
  // mixer.audioEngine.updateSoloMuteStates(). Map them onto the POC engine.
  engine.ensureCtx && engine.ensureCtx();            // make sure ctx + master exist
  Object.defineProperty(engine, "masterGainNode", { configurable: true, get() { return engine.master; } });
  Object.defineProperty(engine, "audioContext",  { configurable: true, get() { return engine.ctx; } });

  // Cross solo/mute: a recording track's Solo must mute non-soloed STEMS too (and
  // vice-versa). Make the engine's anySolo() also consider recording tracks, so
  // engine.gainFor()/applyGains() naturally respect a recording solo. Then
  // updateSoloMuteStates() re-applies stem gains AND lets the recording engine
  // refresh its own track gains.
  const _stemAnySolo = engine.anySolo.bind(engine);
  engine.anySolo = function () {
    if (_stemAnySolo()) return true;
    const re = window.mixer && window.mixer.recordingEngine;
    return !!(re && re.recordings && re.recordings.some(function (r) { return r.solo; }));
  };
  engine.updateSoloMuteStates = function () {
    engine.applyGains();                              // re-apply stem gains (now solo-aware across recordings)
    const re = window.mixer && window.mixer.recordingEngine;
    if (re && re.recordings && typeof re._applyRecordingGain === "function") {
      re.recordings.forEach(function (r) { re._applyRecordingGain(r); });
    }
  };

  // ── Drive recording-track playback from the engine's transport ──
  // Wrap play/stop/seek ONCE so recorded takes start/stop/seek alongside the stems
  // through every entry point (togglePlayPause, From-Start, seek, lane-click).
  function recEng() { return window.mixer && window.mixer.recordingEngine; }
  // No isRecording guard here: playAll() itself skips the tracks being recorded
  // into, so during an overdub the PREVIOUS takes still play along (friend parity).
  const _play = engine.play.bind(engine);
  // Forward ALL args (whenDelay, leadIn, …) — the count-in passes play(whenDelay,
  // leadIn) and dropping leadIn made the metronome start past the count-in clicks
  // (only the last ~2 were heard regardless of the 2/4/8 setting).
  engine.play = function (...args) {
    const r = _play(...args);
    const re = recEng(); if (re && typeof re.playAll === "function") re.playAll(engine.pos());
    return r;
  };
  const _stop = engine.stop.bind(engine);
  engine.stop = function () {
    const re = recEng(); if (re && typeof re.stopAll === "function") re.stopAll();
    return _stop();
  };
  const _seek = engine.seek.bind(engine);
  engine.seek = function (t) {
    const r = _seek(t);
    const re = recEng();
    if (re && typeof re.seekUpdate === "function") re.seekUpdate(engine.pos());
    return r;
  };

  // Pitch/tempo proxy over the POC TempoPitch controller. The kept components read
  // these for chord transposition AND drive the Focus-popup Tempo/Pitch sliders, so
  // we expose the full surface they use: originalBPM/currentBPM, setBPM, pitch.
  if (typeof window.simplePitchTempo === "undefined") {
    window.simplePitchTempo = {
      get originalBPM() { return (window.TempoPitch && TempoPitch.bpmBase) || (window.View && View.meta && View.meta.median_bpm) || 120; },
      get currentBPM() { return (window.TempoPitch && TempoPitch.bpmTarget) || this.originalBPM; },
      setBPM(bpm) { if (window.TempoPitch && TempoPitch.setBpm) TempoPitch.setBpm(bpm); },
      get currentPitchShift() { return (window.TempoPitch && TempoPitch.pitchSemitones) || 0; },
      setPitchShift(semi) { if (window.TempoPitch && TempoPitch.setPitch) TempoPitch.setPitch(semi); },
    };
  }

  // The shim object the kept components see as `window.mixer`.
  const mixer = {
    // identity
    get extractionId() { return window.EXTRACTION_ID || ""; },

    // engine handle (components call mixer.audioEngine.seek / setLoopSection / …)
    audioEngine: engine,

    // playback state (read every frame by the display .sync())
    get currentTime() { return engine.pos(); },
    get maxDuration() { return engine.duration || (window.View && View.meta && View.meta.duration) || 0; },
    get isPlaying() { return !!engine.playing; },

    // transport controls some components call directly (e.g. Focus-popup buttons).
    // Delegate to the main transport functions (main.js) when available so the
    // render loop / beat pulse stay in sync; fall back to the engine directly.
    pause() { if (typeof togglePlayPause === "function") { if (engine.playing) togglePlayPause(); } else if (engine.playing) engine.stop(); },
    play() { if (typeof togglePlayPause === "function") { if (!engine.playing) togglePlayPause(); } else if (!engine.playing) engine.play(); },
    stop() { if (typeof stopAll === "function") stopAll(); else { engine.stop(); engine.staticPos = 0; } },

    // beat/tempo info
    get currentBPM() { return (window.TempoPitch && TempoPitch.bpmTarget) || (window.View && View.meta && View.meta.median_bpm) || 120; },
    get originalBPM() { return (window.TempoPitch && TempoPitch.bpmBase) || (window.View && View.meta && View.meta.median_bpm) || 120; },
    beatsPerBar: 4,

    // pitch/tempo handle (karaoke reads mixer.pitchTempo?.currentPitchShift)
    pitchTempo: window.simplePitchTempo,

    // light toast → status bar + console (components call mixer.showToast)
    showToast(msg, type) {
      if (window.UI && UI.status) UI.status(msg);
      console.log("[toast:" + (type || "info") + "] " + msg);
    },

    // ── Recording-engine surface ──
    // Engine node handles (also exposed on mixer directly, not just audioEngine).
    get masterGainNode() { return engine.master; },
    get audioContext() { return engine.ctx; },
    // Per-stem state the recording engine reads for cross solo/mute.
    get stems() { return engine.stems; },
    // Zoom levels as friend's recording code understands them: FACTORS multiplying
    // positions relative to the .waveform container's full width. In the POC port
    // the container itself is already sized to duration×pxPerSec (zooming changes
    // the container width), so the factor relative to the container is ALWAYS 1.
    // (Returning pxPerSec here blew every live-waveform x position ~80× off-canvas
    // — the "no live waveform during recording" bug.)
    zoomLevels: {
      get horizontal() { return 1; },
      set horizontal(v) { /* zoom is driven by the POC View, not the recording code */ },
      get vertical() { return (window.View && View.zoomV) || 1; },
      set vertical(v) { if (window.View) View.zoomV = v; },
    },
    // Recording engine calls mixer.audioEngine.updateSoloMuteStates(); also expose
    // it on the mixer itself for safety.
    updateSoloMuteStates() { engine.updateSoloMuteStates(); },
    // friend code reads these.
    isMobile: false,
    log() { /* console.log.apply(console, arguments) */ },

    // mixer.waveform / mixer.trackControls / mixer.recordingEngine are attached
    // by recording-ui.js and the wiring script. display instances (chordDisplay…)
    // are attached below.
  };

  window.mixer = mixer;
})();
