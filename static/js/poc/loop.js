// loop.js — A/B loop selection.
//
// The user drags across the waveform of ANY track to define a loop region [a, b]
// (in song-time seconds). Because every lane shares one time→px mapping, the same
// region spans all tracks. A Loop button in the transport toggles looping: while
// enabled, the render loop (main.js tick()) seeks back to `a` when playback reaches
// `b`. A and B snap to the nearest beat (like the Start/Stop markers) unless the
// user holds a modifier.
//
// State lives here; the visual band is a single <div id="loop-region"> in #rightpane
// (same approach as start-line/stop-line). Persisted via state.js.
const LoopSel = {
  engine:null, view:null,
  a:null, b:null,        // loop bounds in song-time seconds (null = unset)
  enabled:false,         // is looping active?
  _dragging:false, _dragFrom:null, _moved:false,

  init(engine, view){ this.engine=engine; this.view=view; this._wire(); },

  hasRegion(){ return this.a!==null && this.b!==null && this.b>this.a; },

  // ── snap helper (nearest beat), shared behaviour with PreCount markers ──
  _snap(t, noSnap){
    if(noSnap) return Math.max(0, t);
    const b=this.view.meta && this.view.meta.beats;
    let best=t, d=Infinity;
    if(b && b.length){ for(const bt of b){ const dd=Math.abs(bt-t); if(dd<d){ d=dd; best=bt; } } }
    return Math.max(0, best);
  },

  // Push the current region + enabled flag down to the engine's native loop.
  _applyToEngine(){
    if(this.engine && this.engine.setLoop) this.engine.setLoop(this.a, this.b, this.enabled && this.hasRegion());
  },

  // ── define the region from a drag (t0,t1 in song-time) ──
  setRegion(t0, t1, noSnap){
    let a=this._snap(Math.min(t0,t1), noSnap), b=this._snap(Math.max(t0,t1), noSnap);
    const dur=this.view.meta?this.view.meta.duration:b;
    a=Math.max(0, Math.min(a, dur)); b=Math.max(0, Math.min(b, dur));
    // ignore a degenerate (too-short) region — treat as a plain seek instead
    if(b - a < 0.05){ this.a=null; this.b=null; this.enabled=false; this._applyToEngine(); this.draw(); this.updateUI(); this._persist(); return false; }
    this.a=a; this.b=b;
    this._applyToEngine();        // live: update loop points on the playing sources
    this.draw(); this.updateUI(); this._persist();
    return true;
  },
  clear(){ this.a=null; this.b=null; this.enabled=false; this._applyToEngine(); this.draw(); this.updateUI(); this._persist(); },

  setEnabled(on){
    this.enabled = !!on && this.hasRegion();
    // if turning on while playing and PAST the region end, jump back to A once so the
    // loop catches immediately (native loop only wraps within [a,b]).
    if(this.enabled && this.engine.playing && this.engine.pos() >= this.b){
      this.engine.seek(this.a);
    }
    this._applyToEngine();        // engine does the seamless native looping
    this.updateUI(); this._persist();
    if(this.view.drawPlayheads) this.view.drawPlayheads();
  },
  toggle(){ this.setEnabled(!this.enabled); },

  // ── drawing: a translucent band from A to B across timeline + all lanes ──
  draw(){
    if(!this.view.meta) return;
    let el=document.getElementById("loop-region");
    if(!this.hasRegion()){ if(el) el.style.display="none"; return; }
    if(!el){ el=document.createElement("div"); el.id="loop-region"; document.getElementById("rightpane").appendChild(el); }
    el.style.display="block";
    const x0=this.view.timeToX(this.a), x1=this.view.timeToX(this.b);
    el.style.left=x0+"px";
    el.style.width=Math.max(1,(x1-x0))+"px";
    const h = 26 + (this.view.lanesTotalH ? this.view.lanesTotalH()
      : document.querySelectorAll("#lanes .lane").length*this.view.trackH());
    el.style.height=h+"px";
    el.classList.toggle("on", this.enabled);
  },

  // ── transport button reflect ──
  updateUI(){
    const btn=document.getElementById("loopBtn");
    if(btn){
      btn.classList.toggle("on", this.enabled);
      btn.disabled = !this.hasRegion();
      btn.title = this.hasRegion()
        ? (this.enabled ? `Loop ON: ${this.a.toFixed(2)}s → ${this.b.toFixed(2)}s (clic pour désactiver)`
                        : `Loop défini: ${this.a.toFixed(2)}s → ${this.b.toFixed(2)}s (clic pour activer)`)
        : "Loop — glisse sur une piste pour définir une zone à boucler";
    }
  },

  // restore from a saved session (called by Loader/PreCount.load timing)
  load(meta){
    // pending values stashed by state.js take precedence
    if(typeof this._pendingA==="number") this.a=this._pendingA;
    if(typeof this._pendingB==="number") this.b=this._pendingB;
    if(typeof this._pendingEnabled==="boolean") this.enabled=this._pendingEnabled && this.hasRegion();
    this._pendingA=this._pendingB=this._pendingEnabled=undefined;
    this._applyToEngine();   // restore the engine's loop state for this song
    this.draw(); this.updateUI();
  },

  _persist(){ if(window.Loader) Loader.persist(); },
  _wire(){
    const btn=document.getElementById("loopBtn");
    if(btn) btn.onclick=()=>this.toggle();
  },
};
window.LoopSel = LoopSel;
