// audio.js — sample-accurate multi-stem playback engine (Web Audio) with
// SoundTouch time-stretch + pitch-shift (ported from StemTube R2's method).
//
// Effect chain per stem:   source(playbackRate) -> soundTouchNode(tempo,pitch) -> gain -> destination
//
// Hybrid tempo (exactly like R2):
//   - acceleration (ratio>1): playbackRate = ratio (native), SoundTouch tempo = 1.0
//   - slowdown    (ratio<1): playbackRate = 1.0, SoundTouch tempo = ratio
// Pitch is compensated so the musical pitch follows the chosen semitones.
//
// METRONOME is special: it must FOLLOW the tempo but NEVER be pitch-shifted.
// We give it soundTouch pitch = 1.0/playbackRate, which cancels the native
// playbackRate's pitch rise (and applies no musical pitch) → same click pitch
// at any tempo. See _stPitchFor().
class AudioEngine {
  constructor(){
    this.ctx = null;
    this.stems = {};        // name -> { buffer, source, soundTouch, gain, muted, solo, vol }
    this.playing = false;
    this.duration = 0;
    this.staticPos = 0;     // remembered position when stopped (song seconds)

    // SoundTouch worklet
    this.workletLoaded = false;

    // Tempo/pitch state (defaults = no effect)
    this.playbackRate    = 1.0;  // native source rate (used when accelerating)
    this.soundTouchTempo = 1.0;  // SoundTouch tempo (used when slowing down)
    this.soundTouchPitch = 1.0;  // SoundTouch pitch for MUSICAL stems
    this.syncRatio       = 1.0;  // effective song-time progression vs real time

    // Drift-free position anchor (song pos advances at syncRatio × real time)
    this._anchorPos  = 0;     // song position at the anchor
    this._anchorTime = null;  // ctx.currentTime at the anchor
    this._anchorRatio = 1.0;  // syncRatio in effect since the anchor

    // A/B seamless loop (native source looping)
    this.loopOn = false; this.loopA = null; this.loopB = null;
  }
  ensureCtx(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      // Master bus: all stems → masterGain → limiter → destination.
      // The limiter (a compressor configured as a brick-wall limiter) lets the
      // metronome be pushed loud (up to 3×) WITHOUT clipping/distortion: peaks
      // above ~ -1 dBFS are caught with a near-instant attack instead of wrapping.
      this.master = this.ctx.createGain(); this.master.gain.value = 1.0;
      this.limiter = this.ctx.createDynamicsCompressor();
      // Tuned (measured) so a ×3 metronome gets LOUDER (RMS ~+60%) without clipping:
      // a short release avoids "ducking" the brief click, a 1 ms attack still walls
      // the peak near 0 dBFS. (release 100 ms was too slow → it crushed the click.)
      this.limiter.threshold.value = 0.0;     // wall right at 0 dBFS
      this.limiter.knee.value      = 0.0;     // hard knee = true limiter
      this.limiter.ratio.value     = 20.0;    // ≥20:1 → brick wall
      this.limiter.attack.value    = 0.001;   // 1 ms — fast enough for clicks
      this.limiter.release.value   = 0.02;    // 20 ms — don't duck the transient
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    }
    return this.ctx;
  }
  // Where stems connect (master bus). Falls back to destination if not built yet.
  _out(){ return this.master || this.ctx.destination; }
  sampleRate(){ return this.ctx ? this.ctx.sampleRate : 0; }

  // Load the SoundTouch AudioWorklet once (needs a secure context: localhost/HTTPS).
  async loadWorklet(){
    this.ensureCtx();
    if(this.workletLoaded) return true;
    if(!this.ctx.audioWorklet){
      console.warn("[audio] AudioWorklet unavailable (insecure context?) — tempo/pitch disabled");
      return false;
    }
    try{
      await this.ctx.audioWorklet.addModule("/static/wasm/soundtouch-worklet.js");
      this.workletLoaded = true;
      console.log("[audio] SoundTouch worklet loaded");
      return true;
    }catch(e){
      console.warn("[audio] Failed to load SoundTouch worklet:", e);
      this.workletLoaded = false;
      return false;
    }
  }

  // names: stem names to load. metroResolutions: optional {"0.5":path,"1":path,"2":path}
  // — when present, the metronome stem holds all 3 buffers and can switch live.
  async setStems(job, names, metroResolutions){
    this.unload();
    this.ensureCtx();
    await Promise.all(names.map(async name=>{
      const buf = await API.audioBuffer(job, name);
      const audio = await this.ctx.decodeAudioData(buf);
      this.stems[name] = { name, buffer:audio, source:null, soundTouch:null, gain:null, panNode:null, muted:false, solo:false, vol:1, pan:0 };
    }));
    // Load the metronome's other resolution buffers (0.5 / 2); "1" == metronome.wav already loaded.
    if(metroResolutions && this.stems["metronome"]){
      const m=this.stems["metronome"]; m.buffers={ "1": m.buffer };
      await Promise.all(Object.entries(metroResolutions).map(async ([res, _path])=>{
        if(res==="1") return;
        const stemId = "metronome_"+res;            // served as /api/audio/<job>/metronome_0.5
        try{
          const buf=await API.audioBuffer(job, stemId);
          m.buffers[res]=await this.ctx.decodeAudioData(buf);
        }catch(e){ console.warn("[audio] metronome res", res, "load failed", e); }
      }));
      // apply the selected resolution (default "1")
      const sel = (this.metroRes && m.buffers[this.metroRes]) ? this.metroRes : "1";
      this.metroRes = sel; m.buffer = m.buffers[sel];
    }
  }

  // pick the right metronome buffer for a resolution, honoring precount/stop mode.
  // precount (count-in + cutoff) wins; else the stop-only track (full song, cut at
  // the End marker) when armed; else the plain original metronome.
  _metroBufFor(res){
    const m=this.stems["metronome"]; if(!m) return null;
    if(this.precountActive && m.precountBuffers && m.precountBuffers[res]) return m.precountBuffers[res];
    if(this.stopActive && m.stopBuffers && m.stopBuffers[res]) return m.stopBuffers[res];
    return m.buffers ? m.buffers[res] : m.buffer;
  }

  // Switch the active metronome resolution buffer (live-safe). res in {"0.5","1","2"}.
  setMetroResolution(res){
    const m=this.stems["metronome"];
    const buf=this._metroBufFor(res);
    if(!m || !buf){ this.metroRes=res; return; }
    this.metroRes=res; m.buffer=buf;
    if(this.playing) this._restartMetro();
  }

  // Reload the BASE metronome buffers (the 3 resolutions) after the timbre changed
  // server-side. Refetches metronome / metronome_0.5 / metronome_2 (the audio route
  // sends them no-store, and we add a cache-buster), re-decodes into m.buffers, and
  // refreshes the active buffer live. Precount/stop buffers are reloaded separately
  // by PreCount (they're re-baked with the new timbre too). `tag` busts any cache.
  async reloadMetroBuffers(job, metroResolutions, tag){
    const m=this.stems["metronome"]; if(!m) return;
    const resList = metroResolutions ? Object.keys(metroResolutions) : ["0.5","1","2"];
    const bust = tag ? ("?v="+encodeURIComponent(tag)) : "";
    const next = {};
    await Promise.all(resList.map(async res=>{
      const stemId = (res==="1") ? "metronome" : ("metronome_"+res);
      try{
        const buf=await API.audioBuffer(job, stemId + bust);
        next[res]=await this.ctx.decodeAudioData(buf);
      }catch(e){ console.warn("[audio] reload metro res", res, "failed", e); }
    }));
    if(!Object.keys(next).length) return;
    m.buffers = next;
    const sel = (this.metroRes && next[this.metroRes]) ? this.metroRes : "1";
    this.metroRes = sel;
    // refresh the active buffer respecting precount/stop mode, then restart live
    const active = this._metroBufFor(sel) || next[sel];
    if(active) m.buffer = active;
    if(this.playing) this._restartMetro();
  }

  // ── Precount (baked count-in) metronome ──
  // Load the 3 precount WAVs (intro erased + count-in baked) for this job.
  // leadSilence>0 means those WAVs are prepended with silence and are longer than
  // the stems; the metronome then reads at (offset + leadSilence) so the song body
  // still lines up with the stems.
  async loadPrecountMetro(job, files, leadSilence, tag){
    const m=this.stems["metronome"]; if(!m) return;
    m.precountBuffers={};
    this.metroLeadSilence = leadSilence || 0;
    const bust = tag ? ("?v="+encodeURIComponent(tag)) : "";
    await Promise.all(Object.entries(files).map(async ([res, _path])=>{
      const stemId = "metronome_precount_"+res;   // /api/audio/<job>/metronome_precount_0.5 etc.
      try{
        const buf=await API.audioBuffer(job, stemId + bust);
        m.precountBuffers[res]=await this.ctx.decodeAudioData(buf);
      }catch(e){ console.warn("[audio] precount metro", res, "load failed", e); }
    }));
  }
  // Set both metronome-mode flags then refresh the buffer ONCE. Setting the flags
  // before restarting avoids a momentary wrong-buffer restart when switching modes
  // (e.g. precount→stop) — _metroBufFor() then already sees the final state.
  setMetroMode(precountOn, stopOn){
    this.precountActive=!!precountOn;
    this.stopActive=!!stopOn;
    const m=this.stems["metronome"]; if(!m) return;
    const buf=this._metroBufFor(this.metroRes||"1"); if(buf) m.buffer=buf;
    if(this.playing) this._restartMetro();
  }
  // Switch metronome between baked-precount buffers and the originals (keeps the
  // current stop flag). Kept for callers that only toggle precount.
  usePrecountMetro(on){ this.setMetroMode(!!on, this.stopActive); }

  // ── Stop-cutoff metronome (full song, click silenced after the End marker) ──
  // Used when there is NO audible count-in but an End marker is set. Unlike the
  // precount WAVs these are sample-locked to the song from t=0 (no lead silence),
  // so they need no read offset.
  async loadStopMetro(job, files, tag){
    const m=this.stems["metronome"]; if(!m || !files) return;
    m.stopBuffers={};
    const bust = tag ? ("?v="+encodeURIComponent(tag)) : "";
    await Promise.all(Object.entries(files).map(async ([res, _path])=>{
      const stemId = "metronome_stop_"+res;   // /api/audio/<job>/metronome_stop_0.5 etc.
      try{
        const buf=await API.audioBuffer(job, stemId + bust);
        m.stopBuffers[res]=await this.ctx.decodeAudioData(buf);
      }catch(e){ console.warn("[audio] stop metro", res, "load failed", e); }
    }));
  }
  useStopMetro(on){ this.setMetroMode(this.precountActive, !!on); }
  // restart ONLY the metronome source from the current position (live-safe)
  _restartMetro(){
    const m=this.stems["metronome"]; if(!m) return;
    const pos=this.pos();
    try{ m.source&&m.source.stop(); }catch(e){}
    try{ m.soundTouch&&m.soundTouch.disconnect(); }catch(e){}
    m.source=null; m.soundTouch=null;
    this._startOneSource(m, this.ctx.currentTime+0.03, pos);
  }
  // extra read offset for a stem (precount metro is shifted by leadSilence)
  _offsetExtraFor(name){
    if(name==="metronome" && this.precountActive) return this.metroLeadSilence||0;
    return 0;
  }
  unload(){
    this.stop();
    this.stems = {}; this.staticPos = 0; this.duration = 0;
    this.loopOn = false; this.loopA = null; this.loopB = null;   // reset loop across songs
    // keep tempo/pitch state so it persists across songs (R2 caches it too)
  }

  anySolo(){ return Object.values(this.stems).some(s=>s.solo); }
  // DAW-standard routing:
  //  - Solo is "listen to ONLY soloed tracks" (cumulative across tracks).
  //  - A manual Mute ALWAYS wins (a muted track stays silent even if soloed).
  gainFor(s){
    if(s.muted) return 0;                 // manual mute beats everything
    const solo=this.anySolo();
    const audible = solo ? s.solo : true; // with a solo active, only soloed tracks pass
    return audible ? s.vol : 0;
  }
  applyGains(){ Object.values(this.stems).forEach(s=>{ if(s.gain) s.gain.gain.value=this.gainFor(s); }); }

  // Mute and Solo are independent toggles (a track may be both; mute wins).
  setMute(name,v){ this.stems[name].muted=v; this.applyGains(); }
  setSolo(name,v){ this.stems[name].solo=v; this.applyGains(); }
  setVol(name,v){ const s=this.stems[name]; s.vol=v; if(s.gain) s.gain.gain.value=this.gainFor(s); }
  // pan: -1 = full left, 0 = center, +1 = full right (StereoPannerNode)
  setPan(name,v){ const s=this.stems[name]; s.pan=Math.max(-1,Math.min(1,v)); if(s.panNode) s.panNode.pan.value=s.pan; }

  // ── Tempo/pitch math (R2's hybrid method) ─────────────────────────────────
  // Given a tempo ratio (target/base) and pitch in semitones, compute the
  // native playbackRate, the SoundTouch tempo, the musical SoundTouch pitch,
  // and the effective sync ratio (song-time progression vs real time).
  static computeParams(tempoRatio, pitchSemitones){
    const minR=0.5, maxR=2.0;                          // R2 safe limits
    const tempo = Math.max(minR, Math.min(maxR, tempoRatio));
    const pitchRatio = Math.pow(2, (pitchSemitones||0)/12);
    const isAccel = tempo > 1.0 + 0.001;
    const playbackRate = isAccel ? tempo : 1.0;
    const soundTouchTempo = isAccel ? 1.0 : tempo;
    let soundTouchPitch = pitchRatio / playbackRate;   // musical stems
    soundTouchPitch = Math.max(0.25, Math.min(4.0, soundTouchPitch));
    const syncRatio = isAccel ? playbackRate : soundTouchTempo;
    return { playbackRate, soundTouchTempo, soundTouchPitch, syncRatio };
  }

  // SoundTouch pitch to use for a given stem.
  // Musical stems → soundTouchPitch. Metronome → 1.0/playbackRate so its pitch
  // stays at the original click frequency regardless of tempo (never pitched).
  _stPitchFor(name){
    if(name === "metronome") return 1.0 / this.playbackRate;
    return this.soundTouchPitch;
  }

  // Apply tempo (ratio = target/base) + pitch (semitones) live and to future sources.
  applyTempoPitch(tempoRatio, pitchSemitones){
    const p = AudioEngine.computeParams(tempoRatio, pitchSemitones);

    // Re-anchor position under the OLD ratio before switching, so the playhead
    // doesn't jump when the progression speed changes mid-playback.
    if(this.playing) this._reanchor();

    this.playbackRate    = p.playbackRate;
    this.soundTouchTempo = p.soundTouchTempo;
    this.soundTouchPitch = p.soundTouchPitch;
    this.syncRatio       = p.syncRatio;

    // Adopt the new ratio for subsequent position reads.
    if(this.playing) this._anchorRatio = this.syncRatio;

    // Update any live nodes immediately.
    Object.values(this.stems).forEach(s=>{
      if(s.source){ try{ s.source.playbackRate.setValueAtTime(this.playbackRate, this.ctx.currentTime); }catch(e){} }
      if(s.soundTouch){
        try{
          s.soundTouch.parameters.get("tempo").value = this.soundTouchTempo;
          s.soundTouch.parameters.get("pitch").value = this._stPitchFor(s.name);
          s.soundTouch.parameters.get("rate").value  = 1.0;
        }catch(e){}
      }
    });
  }

  // ── Seamless A/B loop (native AudioBufferSourceNode looping) ──────────────
  // Looping is done IN the audio engine (source.loop + loopStart/loopEnd), not by
  // re-seeking, so it wraps sample-accurately with ZERO gap. loopA/loopB are in
  // SONG time (seconds); each source's loop points add its own read offset (the
  // precount metro's lead silence), exactly like srcOffset in _startOneSource.
  // pos() folds the (linearly advancing) anchor position back into [a,b] so the
  // playhead/chords/lyrics stay in sync with what the buffers actually play.
  setLoop(a, b, on){
    this.loopOn = !!on && (a!=null) && (b!=null) && (b>a);
    this.loopA = a; this.loopB = b;
    // apply to every live source
    Object.values(this.stems).forEach(s=> this._applyLoopToSource(s));
    // re-anchor so pos() is consistent with the (possibly just-enabled) loop window
    if(this.playing) this._reanchor();
  }
  _applyLoopToSource(s){
    if(!s || !s.source) return;
    const extra = this._offsetExtraFor(s.name);   // metroLeadSilence for precount metro, else 0
    try{
      if(this.loopOn){
        s.source.loopStart = Math.max(0, this.loopA + extra);
        s.source.loopEnd   = Math.max(s.source.loopStart + 0.01, this.loopB + extra);
        s.source.loop = true;
      } else {
        s.source.loop = false;
      }
    }catch(e){}
  }

  // ── Position (anchor-based, drift-free, tempo-aware) ──────────────────────
  pos(){
    if(!this.playing) return this.staticPos;
    if(this._anchorTime === null) return this._anchorPos;
    let p = this._anchorPos + (this.ctx.currentTime - this._anchorTime) * this._anchorRatio;
    // When looping, the buffer wraps b→a natively; fold the linear anchor reading
    // back into the [a,b] window so reported position matches the audio.
    if(this.loopOn && this.loopB > this.loopA && p >= this.loopA){
      const span = this.loopB - this.loopA;
      if(p >= this.loopB) p = this.loopA + ((p - this.loopA) % span);
    }
    return p;
  }
  _reanchor(position=null){
    const now = this.ctx ? this.ctx.currentTime : 0;
    this._anchorPos  = (position !== null) ? position : this.pos();
    this._anchorTime = now;
    this._anchorRatio = this.syncRatio;
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  _startSources(when, offset){
    Object.values(this.stems).forEach(s=> this._startOneSource(s, when, offset));
  }
  // Build + start the audio graph for ONE stem (used by play() and live metro switch).
  // Chain: source(playbackRate) -> [soundTouch] -> gain -> panner -> master.
  //
  // `offset` is the SONG position to start reading from. When it's NEGATIVE (a lead-in
  // count-in: the song hasn't started yet, the metronome is counting in over silence),
  // each source is delayed so it enters exactly when the playhead reaches its own start:
  //   - real stems start at song time 0 → delayed by |offset| (silence before then).
  //   - the precount metronome WAV is prefixed by metroLeadSilence and its first
  //     count-in click sits at WAV time (metroLeadSilence + offset); reading from there
  //     makes the count-in begin immediately at `when`.
  _startOneSource(s, when, offset){
    const src=this.ctx.createBufferSource(); src.buffer=s.buffer;
    src.playbackRate.value = this.playbackRate;
    const g=this.ctx.createGain(); g.gain.value=this.gainFor(s);
    const pan=this.ctx.createStereoPanner(); pan.pan.value = s.pan||0;
    pan.connect(this._out());

    if(this.workletLoaded){
      try{
        const st=new AudioWorkletNode(this.ctx, "soundtouch-processor");
        st.parameters.get("tempo").value = this.soundTouchTempo;
        st.parameters.get("pitch").value = this._stPitchFor(s.name);
        st.parameters.get("rate").value  = 1.0;
        src.connect(st); st.connect(g); g.connect(pan);
        s.soundTouch=st;
      }catch(e){
        console.warn("[audio] SoundTouch node failed for", s.name, e);
        src.connect(g); g.connect(pan); s.soundTouch=null;
      }
    } else {
      src.connect(g); g.connect(pan); s.soundTouch=null;
    }
    s.source=src; s.gain=g; s.panNode=pan;

    // If an A/B loop is armed, set the source's native loop points (seamless wrap).
    this._applyLoopToSource(s);

    // Where this source's audio sits, in SONG time, including the precount metro's
    // baked lead silence (metro reads `extra` deeper so its body lines up with stems).
    const extra = this._offsetExtraFor(s.name);          // metroLeadSilence for the precount metro, else 0
    const srcOffset = offset + extra;                    // read position in this source's buffer
    if(srcOffset >= 0){
      // normal case (offset>=0, or metro whose lead silence already covers the lead-in)
      src.start(when, srcOffset);
    } else {
      // lead-in: this source's audio starts |srcOffset| seconds AFTER `when`; until
      // then there is silence (the metronome's count-in plays over it). Delay the
      // start and read from 0. Divide by syncRatio so the wall-clock delay matches
      // the song-time gap under time-stretch.
      const delay = (-srcOffset) / (this.syncRatio || 1);
      src.start(when + delay, 0);
    }
  }
  // whenDelay: seconds from now before audio starts (default 60ms). `leadIn` (>=0)
  // starts playback at song position -leadIn (a count-in over silence before t=0);
  // pos() then climbs from -leadIn through 0 as the count-in plays. Returns the
  // absolute ctx time playback begins, so a precount can align clicks to it.
  play(whenDelay=0.06, leadIn=0){
    if(this.playing || !this.ctx) return this.ctx ? this.ctx.currentTime : 0;
    if(this.ctx.state==="suspended") this.ctx.resume();
    const when=this.ctx.currentTime+whenDelay;
    const offset=(this.staticPos||0) - Math.max(0, leadIn);
    this._startSources(when, offset);
    // anchor so pos() reads `offset` at ctx time `when`, advancing at syncRatio
    this._anchorPos=offset; this._anchorTime=when; this._anchorRatio=this.syncRatio;
    this.playing=true;
    return when;
  }

  // ── PRECOUNT via the REAL metronome WAV (no synthesis → no output-latency
  // double-hit). We copy the actual click audio of the N beats that FOLLOW the
  // Start out of the metronome buffer and assemble a count-in AudioBuffer at the
  // song's real local tempo, then play that buffer; when it ends the song starts
  // exactly at the Start, and follows time-stretch because the precount IS the
  // metronome track. See loadPrecountMetro/usePrecountMetro above. ──
  stop(){
    if(this.playing) this.staticPos=this.pos();
    Object.values(this.stems).forEach(s=>{
      try{ s.source&&s.source.stop(); }catch(e){}
      try{ s.soundTouch&&s.soundTouch.disconnect(); }catch(e){}
      s.source=null; s.soundTouch=null;
    });
    this.playing=false;
    this._anchorTime=null;
  }
  seek(t){
    const was=this.playing;
    this.stop(); this.staticPos=Math.max(0, t);
    if(was){
      if(this.ctx.state==="suspended") this.ctx.resume();
      const when=this.ctx.currentTime+0.04;
      this._startSources(when, this.staticPos);
      this._anchorPos=this.staticPos; this._anchorTime=when; this._anchorRatio=this.syncRatio;
      this.playing=true;
    }
  }
}
