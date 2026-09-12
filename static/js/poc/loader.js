// loader.js — friend-v2 load flow.
// The mixer lives in an iframe and is told which song to load via window.EXTRACTION_ID
// (injected by templates/mixer.html from the /mixer?extraction_id=... route). Instead
// of the POC's upload/drag-drop/browse flow, we ask the /poc-mixer bridge to PREPARE
// the extraction's POC artifacts, poll progress, then run the (unchanged) finish().
const Loader = {
  engine: null, view: null, onLoaded: null,
  _pollTimer: null,
  _label: null,

  init(engine, view, onLoaded){
    this.engine = engine; this.view = view; this.onLoaded = onLoaded;
    // No upload UI in friend-v2: songs are chosen in the parent library panel.
  },

  // Load the extraction the page was opened with.
  async loadExtraction(extractionId, label){
    if(!extractionId){ this.fail("No extraction selected"); return; }
    this.engine.unload();
    if(window.UI) UI.clearTracks();
    this.progress("Preparing…", 2);
    let d;
    try { d = await API.prepare(extractionId); }
    catch(e){ this.fail("Network error: " + e.message); return; }
    if(d && d.error){ this.fail(d.error); return; }
    const job = extractionId;
    if(this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      let p;
      try { p = await API.progress(job); }
      catch(e){ return; }   // transient — keep polling
      this.progress(p.stage, p.pct);
      if(p.done){
        clearInterval(this._pollTimer); this._pollTimer = null;
        if(p.error) this.fail(p.error); else await this.finish(job, label);
      }
    }, 500);
  },

  async finish(job, label){
    this._loading = true;      // block state saves until tempo/precount/loop are loaded
    try {
    const meta = await API.meta(job);
    if(meta.error){ this.fail(meta.error); return; }
    // Make sure the SoundTouch worklet is ready before stems can play.
    if(this.engine.loadWorklet) await this.engine.loadWorklet();
    const names = Mixer.orderedNames(meta.stems);
    this.engine.duration = meta.duration;
    this.view.meta = meta; this.view.engine = this.engine;
    // Show the tracks and the server-side waveforms right away, then fill them in as each
    // stem finishes downloading (17 stems over a tunnel take minutes).
    await this.engine.setStems(job, names, meta.metronome_resolutions,
      (loaded, total) => {
        this.progress(`Loading stems ${loaded}/${total}…`, Math.round(100 * loaded / total));
        this.view.redrawVisible();
      },
      () => { Mixer.build(this.engine, this.view); this.view.redrawAll(); });
    Mixer.build(this.engine, this.view);
    this._label = label || (window.EXTRACTION_INFO && window.EXTRACTION_INFO.title) || job;
    // Re-apply any saved per-track controls / zoom / playhead for THIS job (keyed by
    // extraction_id), then sync the DOM widgets so the UI reflects the restored state.
    SessionState.apply(job, this.view, this.engine);
    SessionState.syncControls(this.view, this.engine);
    if(window.TempoPitch) TempoPitch.load(meta);
    if(window.PreCount) PreCount.load(meta);
    if(window.LoopSel) LoopSel.load(meta);
    this.view.redrawAll();
    this.hide();
    this._loading = false;
    SessionState.save(job, this.view, this.engine);
    if(this.onLoaded) this.onLoaded(meta, this._label);
    } finally { this._loading = false; }
  },

  // Persist current state (called on any control/zoom/playhead change).
  // Never while a song is loading: the tracks exist before TempoPitch.load() has read the
  // song's BPM, so a save at that moment would store the module's default tempo (120).
  persist(){ if(!this._loading && this.view && this.view.meta) SessionState.save(this.view.meta.job, this.view, this.engine); },

  progress(stage, pct){
    const box = document.getElementById("progress"); if(box) box.style.display = "flex";
    const f = document.getElementById("pfill"); if(f) f.style.width = (pct || 0) + "%";
    const s = document.getElementById("pstage"); if(s) s.textContent = stage || "";
  },
  hide(){
    const box = document.getElementById("progress"); if(box) box.style.display = "none";
    const f = document.getElementById("pfill"); if(f) f.style.background = "var(--accent)";
  },
  fail(msg){
    this.progress("Error: " + msg, 0);
    const f = document.getElementById("pfill"); if(f) f.style.background = "#ff5d5d";
    if(window.UI) UI.status("Error: " + msg);
  },
};
window.Loader = Loader;   // referenced by mixer.js / main.js for state persistence
