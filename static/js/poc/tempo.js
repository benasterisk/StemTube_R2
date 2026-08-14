// tempo.js — BPM (time-stretch) + Pitch (semitones) controller for the POC.
// Method ported from StemTube R2 (SoundTouch hybrid). The metronome is never
// pitch-shifted (handled in audio.js _stPitchFor) but DOES follow the tempo.
//
// BPM is a READ-OUT of our beat-snapped metronome, not a math grid:
//   - bpmBase  = median of all inter-beat intervals (the song's real tempo).
//   - During playback we show a SLIDING-WINDOW local BPM (median over ~8 beats
//     around the playhead) × the tempo ratio, updated only when it changes by
//     more than a threshold (no flicker on micro-variations).
//   - Changing tempo scales every local value by the same ratio.
const TempoPitch = {
  engine: null, view: null,

  WINDOW_BEATS: 8,        // sliding window size for local BPM
  DISPLAY_THRESHOLD: 2,   // only refresh the BPM display if it moves > this (BPM)
  MIN_RATIO: 0.5, MAX_RATIO: 2.0,

  bpmBase: 120,           // median BPM of the whole song (from beats)
  bpmTarget: 120,         // user-chosen BPM
  pitchSemitones: 0,
  _intervals: [],         // inter-beat intervals (seconds)
  _beats: [],             // beat times (seconds)
  _shownBpm: null,        // last value written to the display (for thresholding)

  // Detected key (from chords). The pitch-shift is expressed relative to it:
  // changing pitch transposes this tonic, exactly like R2/Friend.
  NOTES: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
  originalTonic: "",      // e.g. "B" (empty if undetected)
  keyMode: "",            // "major" | "minor"

  get ratio(){ return this.bpmTarget / this.bpmBase; },

  // Initialise from a freshly-loaded meta (beats already snapped to drum onsets).
  init(engine, view){ this.engine=engine; this.view=view; this._wireControls(); },

  load(meta){
    this._beats = (meta && meta.beats) ? meta.beats.slice() : [];
    this._intervals = [];
    for(let i=1;i<this._beats.length;i++){
      const d=this._beats[i]-this._beats[i-1];
      if(d>0.05 && d<3) this._intervals.push(d);   // ignore absurd gaps
    }
    // Round base to an integer so the displayed/edited BPM is clean and
    // target===base gives ratio exactly 1.0 (no parasitic stretch).
    this.bpmBase = this._intervals.length ? Math.round(this._bpmFromInterval(this._median(this._intervals))) : 120;
    this.bpmTarget = this.bpmBase;
    this.pitchSemitones = 0;
    this._shownBpm = null;
    // detected key from chords (drives the pitch-shift base / display)
    this.originalTonic = (meta && meta.key_tonic) ? meta.key_tonic : "";
    this.keyMode = (meta && meta.key_mode) ? meta.key_mode : "";
    // restored state may override (applied by SessionState before this)
    if(typeof this._pendingTarget==="number"){ this.bpmTarget=this._pendingTarget; this._pendingTarget=undefined; }
    if(typeof this._pendingPitch==="number"){ this.pitchSemitones=this._pendingPitch; this._pendingPitch=undefined; }
    this.apply();           // push to engine
    this.updateDisplay(true);
  },

  // Current tonic name after applying the pitch shift (transposed from original).
  currentTonic(){
    if(!this.originalTonic) return "";
    const i = this.NOTES.indexOf(this.originalTonic);
    if(i<0) return this.originalTonic;
    let j = (i + this.pitchSemitones) % 12; if(j<0) j+=12;
    return this.NOTES[j];
  },
  // "B maj" / "F# min" / "" when undetected
  currentKeyLabel(){
    const t=this.currentTonic(); if(!t) return "";
    const m = this.keyMode==="minor" ? "min" : this.keyMode==="major" ? "maj" : "";
    return m ? `${t} ${m}` : t;
  },

  _bpmFromInterval(sec){ return 60 / sec; },
  _median(arr){ if(!arr.length) return 0; const a=arr.slice().sort((x,y)=>x-y); const m=a.length>>1;
    return a.length%2 ? a[m] : (a[m-1]+a[m])/2; },

  // Local (sliding-window) base BPM around a song-time t, before the ratio.
  localBaseBpm(t){
    if(this._beats.length<2) return this.bpmBase;
    // find the beat index nearest to t
    let idx=0, best=Infinity;
    for(let i=0;i<this._beats.length;i++){ const d=Math.abs(this._beats[i]-t); if(d<best){best=d;idx=i;} }
    const half=Math.floor(this.WINDOW_BEATS/2);
    const lo=Math.max(1, idx-half), hi=Math.min(this._beats.length-1, idx+half);
    const win=[];
    for(let i=lo;i<=hi;i++){ const d=this._beats[i]-this._beats[i-1]; if(d>0.05&&d<3) win.push(d); }
    if(!win.length) return this.bpmBase;
    return this._bpmFromInterval(this._median(win));
  },

  // The BPM to display right now (local during playback, global otherwise) × ratio.
  currentDisplayBpm(){
    const base = this.engine && this.engine.playing
      ? this.localBaseBpm(this.engine.pos())
      : this.bpmBase;
    return base * this.ratio;
  },

  // ── Apply to the audio engine ──
  apply(){
    if(!this.engine) return;
    const r = Math.max(this.MIN_RATIO, Math.min(this.MAX_RATIO, this.ratio));
    this.engine.applyTempoPitch(r, this.pitchSemitones);
  },

  // ── BPM controls ──
  setBpm(bpm){
    const v = Math.round(Math.max(this.bpmBase*this.MIN_RATIO, Math.min(this.bpmBase*this.MAX_RATIO, bpm)));
    if(v===this.bpmTarget){ this.updateDisplay(true); return; }
    this.bpmTarget=v; this.apply(); this.updateDisplay(true); this._persist();
  },
  adjustBpm(delta){ this.setBpm(this.bpmTarget+delta); },
  resetBpm(){ this.bpmTarget=this.bpmBase; this.apply(); this.updateDisplay(true); this._persist(); },

  // ── Pitch controls ──
  setPitch(semi){
    const v=Math.max(-12, Math.min(12, Math.round(semi)));
    if(v===this.pitchSemitones){ this.updateDisplay(true); return; }
    this.pitchSemitones=v; this.apply(); this.updateDisplay(true); this._persist();
  },
  adjustPitch(delta){ this.setPitch(this.pitchSemitones+delta); },
  resetPitch(){ this.pitchSemitones=0; this.apply(); this.updateDisplay(true); this._persist(); },

  resetAll(){ this.bpmTarget=this.bpmBase; this.pitchSemitones=0; this.apply(); this.updateDisplay(true); this._persist(); },

  // ── Display ──
  // force=true writes regardless of threshold (user action / reset).
  updateDisplay(force){
    const bpmEl=document.getElementById("bpmVal");
    const pitchEl=document.getElementById("pitchVal");
    const ratioEl=document.getElementById("tempoRatio");
    if(bpmEl){
      const v=Math.round(this.currentDisplayBpm());
      // don't fight the user while they're editing the input
      const editing = (bpmEl.tagName==="INPUT" && document.activeElement===bpmEl);
      if(!editing && (force || this._shownBpm===null || Math.abs(v-this._shownBpm)>=this.DISPLAY_THRESHOLD)){
        if(bpmEl.tagName==="INPUT") bpmEl.value = v; else bpmEl.textContent = v;
        this._shownBpm = v;
      }
    }
    // Key = transposed tonality (falls back to semitone number if undetected)
    if(pitchEl){
      const label=this.currentKeyLabel();
      pitchEl.textContent = label || ((this.pitchSemitones>0?"+":"")+this.pitchSemitones);
    }
    const semiEl=document.getElementById("pitchSemi");
    if(semiEl) semiEl.textContent = (this.pitchSemitones>0?"+":"") + this.pitchSemitones + " st";
    if(ratioEl) ratioEl.textContent = "×" + this.ratio.toFixed(2);
    // highlight reset buttons when not at default
    const rb=document.getElementById("bpmReset"); if(rb) rb.classList.toggle("active", Math.round(this.bpmTarget)!==Math.round(this.bpmBase));
    const pb=document.getElementById("pitchReset"); if(pb) pb.classList.toggle("active", this.pitchSemitones!==0);
  },

  // Called every animation frame while playing (sliding-window refresh).
  tick(){ if(this.engine && this.engine.playing) this.updateDisplay(false); },

  _persist(){ if(window.Loader) Loader.persist(); },

  _wireControls(){
    const on=(id,fn)=>{ const el=document.getElementById(id); if(el) el.onclick=fn; };
    on("bpmUp",   ()=>this.adjustBpm(+1));
    on("bpmDown", ()=>this.adjustBpm(-1));
    on("bpmReset",()=>this.resetBpm());
    on("pitchUp",   ()=>this.adjustPitch(+1));
    on("pitchDown", ()=>this.adjustPitch(-1));
    on("pitchReset",()=>this.resetPitch());
    const bpmInput=document.getElementById("bpmVal");
    if(bpmInput && bpmInput.tagName==="INPUT"){
      const commit=()=>{ const v=parseFloat(bpmInput.value); if(Number.isFinite(v)) this.setBpm(v); else this.updateDisplay(true); };
      bpmInput.addEventListener("change", commit);
      bpmInput.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(); bpmInput.blur(); } });
      bpmInput.addEventListener("focus", ()=>bpmInput.select && bpmInput.select());
    }
  },
};
window.TempoPitch = TempoPitch;
