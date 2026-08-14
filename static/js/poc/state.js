// state.js — persist UI session (per-track controls, zoom, playhead) across
// normal + hard refresh, keyed by job so settings don't leak between songs.
const SessionState = {
  KEY: "poc_state",

  _all(){ try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch(e){ return {}; } },
  _write(obj){ try { localStorage.setItem(this.KEY, JSON.stringify(obj)); } catch(e){} },

  // Snapshot the current view + engine state for a job.
  save(job, view, engine){
    if(!job) return;
    const tracks = {};
    Object.values(engine.stems).forEach(s=>{
      tracks[s.name] = { muted:s.muted, solo:s.solo, vol:s.vol, pan:s.pan||0 };
    });
    const all = this._all();
    const prev = all[job] || {};
    all[job] = {
      label: prev.label || (window.Loader && Loader._label) || job,
      pxPerSec: view.pxPerSec,
      zoomV: view.zoomV,
      scrollMode: view.scrollMode || "page",
      pos: engine.pos(),            // playhead position (seconds)
      // tempo/pitch (BPM time-stretch + Key pitch-shift)
      bpmTarget: window.TempoPitch ? TempoPitch.bpmTarget : undefined,
      pitchSemitones: window.TempoPitch ? TempoPitch.pitchSemitones : undefined,
      metroRes: engine.metroRes || "1",      // metronome click resolution
      // count-in: Start marker + number of precount beats + baked-precount active
      startTime: window.PreCount ? PreCount.startTime : undefined,
      precountBeats: window.PreCount ? PreCount.beats : undefined,
      precountActive: window.PreCount ? PreCount.active : undefined,
      // metronome-stop marker (null = click runs to the end)
      stopTime: window.PreCount ? PreCount.stopTime : undefined,
      // A/B loop region + enabled state
      loopA: window.LoopSel ? LoopSel.a : undefined,
      loopB: window.LoopSel ? LoopSel.b : undefined,
      loopEnabled: window.LoopSel ? LoopSel.enabled : undefined,
      tracks,
    };
    all._lastJob = job;
    this._write(all);
  },

  get(job){ return this._all()[job] || null; },
  lastJob(){ return this._all()._lastJob || null; },

  // Apply a saved state to the freshly-loaded view/engine + sync the DOM controls.
  apply(job, view, engine){
    const st = this.get(job);
    if(!st) return false;
    if(typeof st.pxPerSec === "number") view.pxPerSec = st.pxPerSec;
    if(typeof st.zoomV === "number") view.zoomV = st.zoomV;
    view.scrollMode = st.scrollMode || "page";
    // per-track controls
    if(st.tracks){
      Object.entries(st.tracks).forEach(([name, t])=>{
        const s = engine.stems[name]; if(!s) return;
        s.muted = !!t.muted; s.solo = !!t.solo;
        if(typeof t.vol === "number") s.vol = t.vol;
        if(typeof t.pan === "number") s.pan = t.pan;
      });
      engine.applyGains();
    }
    // playhead position (engine is stopped, so set staticPos)
    if(typeof st.pos === "number") engine.staticPos = Math.max(0, Math.min(st.pos, engine.duration||st.pos));
    // tempo/pitch — stash as pending; TempoPitch.load() consumes these after base BPM is known
    if(window.TempoPitch){
      if(typeof st.bpmTarget === "number") TempoPitch._pendingTarget = st.bpmTarget;
      if(typeof st.pitchSemitones === "number") TempoPitch._pendingPitch = st.pitchSemitones;
    }
    // metronome resolution (buffers already loaded by setStems → switch live-safe)
    if(st.metroRes && engine.setMetroResolution) engine.setMetroResolution(st.metroRes);
    // count-in — stash as pending; PreCount.load() consumes after meta is known
    if(window.PreCount){
      if(typeof st.startTime === "number") PreCount._pendingStart = st.startTime;
      if(typeof st.precountBeats === "number") PreCount._pendingBeats = st.precountBeats;
      if(typeof st.precountActive === "boolean") PreCount._pendingActive = st.precountActive;
      // stopTime may be a number OR null (explicitly no cutoff); both override meta.
      if("stopTime" in st && (typeof st.stopTime === "number" || st.stopTime === null)) PreCount._pendingStop = st.stopTime;
    }
    // A/B loop — stash as pending; LoopSel.load() consumes after meta is known
    if(window.LoopSel){
      if(typeof st.loopA === "number") LoopSel._pendingA = st.loopA;
      if(typeof st.loopB === "number") LoopSel._pendingB = st.loopB;
      if(typeof st.loopEnabled === "boolean") LoopSel._pendingEnabled = st.loopEnabled;
    }
    return true;
  },

  // Reflect restored state onto the on-screen widgets (sliders, buttons).
  syncControls(view, engine){
    // (zoom is now stepped −/+ buttons; nothing to sync — value lives in view.*)
    // scroll-mode button label + highlight
    const sb = document.getElementById("scrollModeBtn");
    if(sb){ const L={manual:"✕ Manual",page:"⏭ Page",center:"⊕ Center"};
      sb.textContent=L[view.scrollMode]||L.page; sb.classList.toggle("on", view.scrollMode!=="manual"); }
    // track buttons + volume sliders
    document.querySelectorAll("#left-tracks .lctrl").forEach(lc=>{
      const volEl = lc.querySelector("input.vol"); const n = volEl && volEl.dataset.n; if(!n) return;
      const s = engine.stems[n]; if(!s) return;
      volEl.value = s.vol;
      const panEl = lc.querySelector("input.panrange"); if(panEl) panEl.value = s.pan||0;
      lc.querySelectorAll("button[data-act='mute'],button[data-act='solo']").forEach(b=>{
        b.classList.toggle("on", b.dataset.act==="mute" ? s.muted : s.solo);
      });
    });
    // metronome resolution selector
    const cur = engine.metroRes || "1";
    document.querySelectorAll("#left-tracks .metrores button[data-res]").forEach(b=>{
      b.classList.toggle("on", b.dataset.res===cur);
    });
  },
};
