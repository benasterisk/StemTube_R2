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
  // Two ways to disable snapping: the global Snap toggle (Snap.enabled, shared
  // with the timeline so both surfaces obey one setting) and the per-drag
  // modifier key (`noSnap`), which stays available for a one-off override.
  _snap(t, noSnap){
    if(noSnap || (window.Snap && !Snap.enabled)) return Math.max(0, t);
    return Snap.toBeat(t, this.view);
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
    if(!el){
      el=document.createElement("div"); el.id="loop-region";
      document.getElementById("rightpane").appendChild(el);
      // Two edge handles so both bounds can be dragged. The band stays
      // pointer-events:none (it must not swallow waveform clicks); only these
      // capture the pointer.
      const mk=(cls,which)=>{
        const h=document.createElement("div");
        h.className="loop-handle "+cls;
        h.dataset.which=which;
        el.appendChild(h);
        this._wireHandle(h, which);
        return h;
      };
      mk("loop-handle-a","a");
      mk("loop-handle-b","b");
    }
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
  // ── manual entry of the loop bounds ──────────────────────────────────────
  // Dragging is fine for rough work, but a rehearsal loop often needs an exact
  // bar. Two inputs accept either a timecode (m:ss.cc, ss.cc) or a bar number
  // (prefix "b", e.g. b17 or b17.3 for bar 17 beat 3). Bars are derived from the
  // madmom beat grid (positions[i] === 1 marks a downbeat), so they follow the
  // real performance, tempo drift included, rather than a fixed ruler.

  // seconds → "m:ss.cc"
  fmtTime(t){
    if(t===null || t===undefined || !isFinite(t)) return "";
    const s=Math.max(0,t), m=Math.floor(s/60), r=s-m*60;
    return m + ":" + (r<10?"0":"") + r.toFixed(2);
  },

  // seconds → "bar.beat" using the detected downbeats, or "" without a grid
  fmtBar(t){
    const meta=this.view && this.view.meta;
    if(!meta || !meta.beats || !meta.beats.length || !meta.positions) return "";
    let bar=0, beatInBar=1;
    for(let i=0;i<meta.beats.length;i++){
      if(meta.beats[i] > t + 1e-6) break;
      if(meta.positions[i]===1){ bar++; beatInBar=1; } else { beatInBar++; }
    }
    if(bar<1) return "";
    return bar + "." + beatInBar;
  },

  /**
   * Parse user input into song-time seconds. Returns null if unparseable.
   *   "b17"     → start of bar 17        "b17.3" → bar 17, beat 3
   *   "1:23.45" → 83.45 s                "12.5"  → 12.5 s
   */
  parseTime(str){
    if(typeof str !== "string") return null;
    const s=str.trim().toLowerCase();
    if(!s) return null;

    if(s[0]==="b"){
      const meta=this.view && this.view.meta;
      if(!meta || !meta.beats || !meta.positions) return null;
      const parts=s.slice(1).split(".");
      const wantBar=parseInt(parts[0],10);
      const wantBeat=parts.length>1 ? parseInt(parts[1],10) : 1;
      if(!isFinite(wantBar) || wantBar<1) return null;
      let bar=0, beatInBar=0;
      for(let i=0;i<meta.beats.length;i++){
        if(meta.positions[i]===1){ bar++; beatInBar=1; } else { beatInBar++; }
        if(bar===wantBar && beatInBar===(isFinite(wantBeat)?wantBeat:1)) return meta.beats[i];
      }
      return null;   // asked for a bar past the end of the song
    }

    if(s.includes(":")){
      const [m,rest]=s.split(":");
      const mm=parseFloat(m), ss=parseFloat(rest);
      if(!isFinite(mm) || !isFinite(ss)) return null;
      return mm*60 + ss;
    }
    const v=parseFloat(s);
    return isFinite(v) ? v : null;
  },

  /** Apply a manually typed bound. which = "a" | "b". */
  setBoundFromText(which, str){
    const t=this.parseTime(str);
    if(t===null){ this.updateUI(); return false; }   // reject: repaint old value
    const dur=this.view && this.view.meta ? this.view.meta.duration : t;
    const clamped=Math.max(0, Math.min(t, dur));
    // Typed values are exact by intent — do not snap them to the grid.
    const a = which==="a" ? clamped : this.a;
    const b = which==="b" ? clamped : this.b;
    if(a===null || b===null){ if(which==="a") this.a=clamped; else this.b=clamped; this.draw(); this.updateUI(); this._persist(); return true; }
    this.a=Math.min(a,b); this.b=Math.max(a,b);
    this._applyToEngine(); this.draw(); this.updateUI(); this._persist();
    return true;
  },

  /**
   * Make one edge handle draggable. Moving it re-defines that bound only, so
   * the loop can be trimmed from either side without redrawing the whole
   * region. Honours the shared Snap toggle, with Alt as the usual per-drag
   * override.
   */
  _wireHandle(el, which){
    if(el._wired) return;
    el._wired = true;
    const self=this;
    let dragging=false;

    const timeAt=(clientX)=>{
      const pane=document.getElementById("rightpane");
      const rect=pane.getBoundingClientRect();
      return self.view.xToTime(pane.scrollLeft + (clientX - rect.left));
    };

    el.addEventListener("mousedown", e=>{
      if(e.button!==0) return;
      dragging=true;
      el.classList.add("dragging");
      // stop the lane handlers underneath from also reacting
      e.preventDefault(); e.stopPropagation();
    });

    const move=e=>{
      if(!dragging) return;
      const t=self._snap(timeAt(e.clientX), e.altKey);
      // Keep a and b ordered: dragging one past the other swaps roles rather
      // than producing an inverted region.
      const other = which==="a" ? self.b : self.a;
      if(other===null) return;
      self.a=Math.min(t,other); self.b=Math.max(t,other);
      self._applyToEngine(); self.draw(); self.updateUI();
    };

    const up=()=>{
      if(!dragging) return;
      dragging=false;
      el.classList.remove("dragging");
      self._persist();
      if(window.Loader) Loader.persist();
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  },

  _wireInputs(){
    const bind=(id, which)=>{
      const el=document.getElementById(id);
      if(!el || el._wired) return;
      el._wired=true;
      const commit=()=> this.setBoundFromText(which, el.value);
      el.addEventListener("change", commit);
      el.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(); el.blur(); } });
    };
    bind("loopAInput","a");
    bind("loopBInput","b");
  },

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
    // Keep the manual fields in step with the region, but never fight the user
    // while they are typing in one of them.
    const ai=document.getElementById("loopAInput");
    const bi=document.getElementById("loopBInput");
    const active=document.activeElement;
    if(ai && active!==ai) ai.value = this.a!==null ? this.fmtTime(this.a) : "";
    if(bi && active!==bi) bi.value = this.b!==null ? this.fmtTime(this.b) : "";
    // Show the bar position as a hint, when a beat grid exists.
    if(ai){ const bar=this.a!==null?this.fmtBar(this.a):""; ai.title = bar ? ("Loop start — bar " + bar + " (type a timecode like 1:23.45, or b17 for bar 17)") : "Loop start — timecode (1:23.45) or bar (b17)"; }
    if(bi){ const bar=this.b!==null?this.fmtBar(this.b):""; bi.title = bar ? ("Loop end — bar " + bar + " (type a timecode like 1:23.45, or b17 for bar 17)") : "Loop end — timecode (1:23.45) or bar (b17)"; }
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
    // onclick, not addEventListener: _wire may run again and must not stack.
    const clr=document.getElementById("loopClearBtn");
    if(clr) clr.onclick=()=>this.clear();
    this._wireInputs();
  },
};
window.LoopSel = LoopSel;
