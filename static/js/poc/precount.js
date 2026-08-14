// precount.js — "Detect Intro" + hard-baked count-in.
//
// New method (replaces the synthesized/overlay count-in that had latency &
// tempo-drift issues): the count-in is BAKED INTO the metronome WAVs server-side
// (one per resolution). Because the precount clicks ARE the metronome track, they
// are sample-locked to the stems and follow time-stretch automatically — perfect
// sync at any tempo, including slow-down.
//
// "Detect Intro": detect the real start (or use a user-dragged Start), compute
// the precount tempo from the 4 real beats after it, erase the pre-intro metro,
// bake `count` precount beats just before the Start into metronome_precount_*.wav.
// The precount toggle (Off/2/4/8) chooses how many of those beats we actually
// hear by starting playback that many beats before the Start.
const PreCount = {
  engine:null, view:null,
  beats:0,              // 0 = off, else how many precount beats to play (2/4/8)
  startTime:0,          // the musical "1"
  stopTime:null,        // seconds (original timeline) where the CLICK stops; null = runs to the end
  plan:null,            // server plan { precount_bpm, precount_ibi, precount_count, precount_times, lead_silence, stop_time, files }
  active:false,         // are the precount WAVs loaded & in use?
  _countTimer:null,

  COUNTS:[0,2,4,8],

  init(engine, view){ this.engine=engine; this.view=view; this._wire(); },

  load(meta){
    this.startTime = (typeof this._pendingStart==="number") ? this._pendingStart
                   : (typeof meta.start_time==="number" ? meta.start_time : 0);
    this._pendingStart=undefined;
    // metronome-stop marker: pending (restored session, may be a number OR null) >
    // baked plan > none. _pendingStop===undefined means "no restored value".
    this.stopTime = (this._pendingStop!==undefined) ? this._pendingStop
                  : (meta.precount && typeof meta.precount.stop_time==="number" ? meta.precount.stop_time : null);
    this._pendingStop=undefined;
    if(typeof this._pendingBeats==="number"){ this.beats=this._pendingBeats; this._pendingBeats=undefined; }
    // a precount may already be baked (meta.precount) from a previous Detect Intro
    this.plan = meta.precount ? {
      precount_bpm: meta.precount.bpm, precount_ibi: meta.precount.ibi,
      precount_count: meta.precount.count, precount_times: meta.precount.times,
      lead_silence: meta.precount.lead_silence, stop_time: meta.precount.stop_time,
      files: meta.precount.files, stop_files: meta.precount.stop_files || {},
    } : null;
    this.active=false;
    this._job = meta.job;
    this.updateUI();
    this._updateLeadPad();   // apply the lead-in pad for the restored count + start
    // Reload the baked buffers if a precount/cutoff was baked before, then restore
    // the correct metronome mode (count-in if it was active, else stop-cutoff if an
    // End marker is set, else original).
    if(this.plan && this.plan.files){
      const wasActive = this._pendingActive;
      Promise.all([
        this.engine.loadPrecountMetro(this._job, this.plan.files, this.plan.lead_silence),
        (this.plan.stop_files && Object.keys(this.plan.stop_files).length)
          ? this.engine.loadStopMetro(this._job, this.plan.stop_files) : Promise.resolve(),
      ]).then(()=>{ if(wasActive){ this.active=true; } this._applyMetroMode(); this.updateUI(); });
    }
    this._pendingActive=undefined;
  },

  // Adopt a precount block returned by the server (e.g. after a timbre change re-baked
  // the count-in) and reload its baked buffers so the new instrument is heard. Keeps
  // the current active/mode. `precount` has the server-meta shape ({bpm,ibi,count,
  // times,lead_silence,stop_time,files,stop_files}); `tag` busts the buffer cache.
  async applyServerPlan(precount, tag){
    if(!precount || !precount.files) return;
    this.plan = {
      precount_bpm: precount.bpm, precount_ibi: precount.ibi,
      precount_count: precount.count, precount_times: precount.times,
      lead_silence: precount.lead_silence, stop_time: precount.stop_time,
      files: precount.files, stop_files: precount.stop_files || {},
    };
    await Promise.all([
      this.engine.loadPrecountMetro(this._job, this.plan.files, this.plan.lead_silence, tag),
      (this.plan.stop_files && Object.keys(this.plan.stop_files).length)
        ? this.engine.loadStopMetro(this._job, this.plan.stop_files, tag) : Promise.resolve(),
    ]);
    this._applyMetroMode();
    this.updateUI();
  },

  // ── Decide which metronome buffer set the engine should play ──
  // Count-in active (beats>0 + baked) → precount track; else an End marker set +
  // baked → stop-cutoff track; else the plain original metronome.
  _applyMetroMode(){
    const hasPrecount = !!(this.plan && this.plan.files);
    const hasStop = !!(this.plan && this.plan.stop_files && this.stopTime!==null
                       && Object.keys(this.plan.stop_files).length);
    const precountOn = hasPrecount && this.active && this.beats>0;
    const stopOn = !precountOn && hasStop;
    // set both flags + refresh the buffer in one shot (no wrong-buffer flicker)
    if(this.engine.setMetroMode) this.engine.setMetroMode(precountOn, stopOn);
    else { if(this.engine.usePrecountMetro) this.engine.usePrecountMetro(precountOn);
           if(this.engine.useStopMetro) this.engine.useStopMetro(stopOn); }
  },

  ibi(){ return this.plan ? this.plan.precount_ibi : 0.5; },
  bpm(){ return this.plan ? this.plan.precount_bpm : (this.view.meta?.median_bpm||120); },

  // We always bake the MAXIMUM number of precount beats once; the Off/2/4/8 button
  // then chooses how many of those baked clicks we actually HEAR (by starting that
  // many beats before the Start). So changing the count is instant (no server call)
  // — the only thing that triggers a (re)bake is MOVING the Start flag.
  BAKE_COUNT: 8,

  // ── Bake the count-in WAVs for the current Start (server-side). Triggered when
  // the Start flag moves (setStartFromTime) or, on demand, by the Detect-Intro
  // button / first play. Always bakes BAKE_COUNT beats. Serialized: if a bake is
  // running we remember the latest Start and run it once the current finishes. ──
  async detectIntro(startTimeOverride){
    if(!this._job) return Promise.resolve();
    // Serialize: if a bake is running, remember the LATEST request (start + the
    // current stop) and run it once the in-flight one finishes. Capturing the stop
    // in the queue is what stops a stale server response from clobbering a stop the
    // user changed mid-bake.
    if(this._baking){ this._bakeQueued = { start:startTimeOverride, stop:this.stopTime }; return this._bakingPromise; }
    this._baking = true;
    this._setBusy(true);
    // Snapshot the stop we are about to bake; the CLIENT is authoritative for the
    // cutoff, so we do NOT overwrite this.stopTime from the response — we only adopt
    // it if the user hasn't changed it since this request started.
    const requestedStop = (typeof this.stopTime==="number") ? this.stopTime : null;
    this._bakingPromise = (async () => {
    try{
      const body = { precount_count: this.BAKE_COUNT };
      if(typeof startTimeOverride==="number") body.start_time = startTimeOverride;
      if(requestedStop!==null) body.stop_time = requestedStop;
      const plan = await API.detectIntro(this._job, body);
      if(plan.error){ UI && UI.status && UI.status("Detect Intro failed: "+plan.error); return; }
      this.plan = plan;
      this.startTime = plan.start_time;
      // Only adopt the server's stop if the user hasn't moved it during the bake.
      if(this.stopTime===requestedStop){
        this.stopTime = (typeof plan.stop_time==="number") ? plan.stop_time : null;
      }
      // load the baked metronome buffers (count-in track + optional stop-cutoff track)
      await this.engine.loadPrecountMetro(this._job, plan.files, plan.lead_silence);
      if(plan.stop_files && Object.keys(plan.stop_files).length && this.engine.loadStopMetro){
        await this.engine.loadStopMetro(this._job, plan.stop_files);
      }
      // switch the audible metronome track to match the current mode
      this.active = this.beats > 0;
      this._applyMetroMode();
      if(this.view.drawWave) this.view.drawWave("metronome");                // intro erased + precount visible
      this.updateUI();
      this._updateLeadPad();   // start_time may have moved → recompute the lead-in pad
      this._persist();
      UI && UI.status && UI.status(`Count-in baked: start ${plan.start_time}s @ ${plan.precount_bpm} BPM`
        + (plan.lead_silence>0 ? `, +${plan.lead_silence}s lead silence` : ""));
    } finally {
      this._baking = false; this._setBusy(false);
      // run the most recent queued request if the markers actually moved since
      if(this._bakeQueued){ const q=this._bakeQueued; this._bakeQueued=null;
        const startMoved = (typeof q.start==="number" && q.start!==this.startTime);
        const stopMoved = (q.stop!==requestedStop);
        if(startMoved || stopMoved){ this.detectIntro(typeof q.start==="number" ? q.start : this.startTime); }
      }
    }
    })();
    return this._bakingPromise;
  },

  // toggle between baked-precount metronome and the original metronome
  setActive(on){
    if(on && !this.plan){ return this.detectIntro(); }   // need to bake first
    this.active=!!on;
    this._applyMetroMode();
    if(this.view.drawWave) this.view.drawWave("metronome");   // redraw (precount vs original)
    this.updateUI(); this._persist();
  },

  // ── Start marker ──
  setStart(t){
    this.startTime=Math.max(0, Math.min(t, this.view.meta?this.view.meta.duration:t));
    this.updateUI(); this._updateLeadPad();   // start moved → pad may change; redraws markers
  },
  _snapToBeat(t){
    const b=this.view.meta && this.view.meta.beats;
    let snapped=t;
    if(b && b.length){ let d=Infinity; for(const bt of b){ const dd=Math.abs(bt-t); if(dd<d){d=dd;snapped=bt;} } }
    return snapped;
  },
  setStartFromTime(t){
    const snapped=this._snapToBeat(t);
    this.setStart(snapped);
    // moving the Start re-bakes the precount at the new position (auto)
    this.detectIntro(snapped);
  },

  // ── Metronome-stop marker ──
  // Where the CLICK goes silent; the stems (and an export) keep playing to the end.
  // Setting/moving/clearing it re-bakes the precount WAVs so the cutoff is sample-
  // locked into the metronome track (same mechanism as the Start flag).
  async setStopFromTime(t){
    const snapped=this._snapToBeat(t);
    // a stop before the Start makes no sense (count-in is always kept) — ignore.
    this.stopTime=Math.max(this.startTime, Math.min(snapped, this.view.meta?this.view.meta.duration:snapped));
    this.updateUI(); this.drawStopMarker();
    await this._rebakeForStop();         // re-bake with the new cutoff
  },
  async clearStop(){
    if(this.stopTime===null) return;
    this.stopTime=null;
    this.updateUI(); this.drawStopMarker();
    await this._rebakeForStop();         // re-bake without a cutoff (click to the end)
  },
  // Re-bake after the End marker changed, awaiting it so a failure can re-sync the
  // audible buffer with the in-memory stopTime (otherwise the click would cut at the
  // old point while the marker shows the new one).
  async _rebakeForStop(){
    try{
      await this.detectIntro(this.startTime);
    }catch(e){
      console.warn("[precount] stop re-bake failed:", e);
    }
    this._applyMetroMode();              // keep the active buffer consistent either way
  },
  // Transport button: drop the End at the playhead, or remove it if already set.
  // Fire-and-forget (async re-bake): swallow rejections so a failed bake can't raise
  // an unhandledrejection (the error is already surfaced via UI.status in detectIntro).
  toggleStopAtPlayhead(){
    const swallow=e=>console.warn("[precount] stop toggle failed:", e);
    if(this.stopTime!==null){ Promise.resolve(this.clearStop()).catch(swallow); return; }
    const pos=this.engine ? this.engine.pos() : 0;
    Promise.resolve(this.setStopFromTime(pos)).catch(swallow);
  },

  // Does the currently-baked plan hold at least `n` precount clicks? We always bake
  // BAKE_COUNT once, but a plan RESTORED from a previous session (meta.precount) — or
  // one baked by older code / a smaller request — may hold fewer. Reading n beats out
  // of a WAV that only contains m<n clicks would play only those m, so playFromStart()
  // re-bakes on demand when this returns false before starting the count-in.
  _bakedCount(){ return (this.plan && Number.isFinite(this.plan.precount_count)) ? this.plan.precount_count : 0; },
  _planCoversBeats(n){ return !!(this.plan && this.plan.files) && this._bakedCount() >= n; },

  // ── Precount count = how many of the baked clicks we HEAR ──
  // INSTANT: just sets the count + toggles the audible precount metro. Never bakes
  // (the bake happens when the Start flag moves, always BAKE_COUNT clicks; a short
  // restored plan is topped up on demand by playFromStart()).
  setBeats(n){
    const v=this.COUNTS.includes(n)?n:0;
    this.beats=v;
    // switch the audible metronome track only if we have baked WAVs to use
    if(this.plan && this.plan.files){
      this.active = v>0;
      this._applyMetroMode();
      if(this.view.drawWave) this.view.drawWave("metronome");
    }
    this.updateUI(); this._updateLeadPad(); this._persist();   // count changed → recompute the lead-in pad
  },
  cycleBeats(){ const i=this.COUNTS.indexOf(this.beats); this.setBeats(this.COUNTS[(i+1)%this.COUNTS.length]); },

  // ── Trigger: play with the baked count-in ──
  // Everything is in the WAVs, so we just start playback N beats before the Start.
  // No synthesis, no temporary mute, no live scheduling → sample-accurate sync,
  // and it follows time-stretch because the precount IS the metronome track.
  async playFromStart(){
    if(!this.engine || !this.view.meta) return false;
    // If a count-in is wanted but nothing is baked yet (Start flag never moved), OR the
    // baked plan holds fewer clicks than we want to HEAR (e.g. a restored low-count plan
    // while a higher count is selected), (re)bake at the current Start so all `beats`
    // clicks really exist in the WAV before we play.
    if(this.beats>0 && !this._planCoversBeats(this.beats)){
      await this.detectIntro(typeof this.startTime==="number" ? this.startTime : undefined);
    }
    // make sure the baked precount metro is the ACTIVE metronome buffer before we
    // play — unconditionally, so engine.precountActive is guaranteed true (else the
    // metro would be treated like a stem and delayed with the count-in, and the song
    // would seem to start at the Start/0 with no audible lead-in).
    if(this.beats>0 && this.plan && this.plan.files){
      this.active=true;
      this._applyMetroMode();
    }
    const n=this.beats, iv=this.ibi();
    // Where the n HEARD count-in beats begin, in song time. If the intro has room
    // it's >=0; if not it goes negative and we start playback there (over silence),
    // so the count-in clicks play IN FRONT of the song — the original "insert beats"
    // behavior. The baked WAV already holds those clicks at negative song times
    // (its lead_silence covers up to BAKE_COUNT beats), and the engine reads the
    // metro from (offset + metroLeadSilence) so the first heard click lands at play.
    const desired = this.startTime - n*iv;
    this.engine.stop();
    if(n>0 && desired<0){
      const leadIn = -desired;                      // only as much silence as the n beats need
      this.engine.staticPos = 0;
      this.engine.play(0.06, leadIn);               // start at song pos -leadIn (count-in over silence)
      this._runCountdown(desired, n, iv);
    } else {
      const firstOffset = Math.max(0, desired);
      this.engine.staticPos = firstOffset;
      this.engine.play();
      if(n>0) this._runCountdown(firstOffset, n, iv);
    }
    return true;
  },

  // visual countdown based on PLAYBACK POSITION (works at any tempo since pos()
  // already accounts for time-stretch). Counts N…1 until the Start is reached.
  _runCountdown(firstOffset, n, iv){
    if(this._countTimer){ clearInterval(this._countTimer); this._countTimer=null; }
    const el=document.getElementById("countdown"); if(!el) return;
    el.style.display="block";
    const tick=()=>{
      if(!this.engine.playing){ el.style.display="none"; clearInterval(this._countTimer); this._countTimer=null; return; }
      const pos=this.engine.pos();
      if(pos >= this.startTime - 0.03){ el.style.display="none"; clearInterval(this._countTimer); this._countTimer=null; return; }
      const elapsedBeats = Math.floor((pos - firstOffset)/iv);   // 0..n-1
      el.textContent = Math.max(1, n - elapsedBeats);
    };
    tick();
    this._countTimer=setInterval(tick, 40);
  },

  // ── Lead-in pad: when a count-in is armed and the intro is too short to fit the
  // n heard beats before the Start, insert that much SILENCE in front of the whole
  // song (visible on the timeline). leadPad = max(0, n*ibi - startTime). ──
  _updateLeadPad(){
    const n=this.beats, iv=this.ibi();
    const pad = (n>0) ? Math.max(0, n*iv - this.startTime) : 0;
    const prev = this.view.leadPad || 0;
    this.view.leadPad = pad;
    if(Math.abs(pad - prev) > 1e-4 && this.view.redrawAll) this.view.redrawAll();
    else { this.drawMarker(); this.drawStopMarker(); }
  },

  // ── Start marker drawing (shifted by the lead pad) ──
  drawMarker(){
    if(!this.view.meta) return;
    let m=document.getElementById("start-line");
    if(!m){ m=document.createElement("div"); m.id="start-line"; document.getElementById("rightpane").appendChild(m); }
    m.style.left=this.view.timeToX(this.startTime)+"px";
    m.style.height=(26 + (this.view.lanesTotalH ? this.view.lanesTotalH()
      : document.querySelectorAll("#lanes .lane").length*this.view.trackH()))+"px";
  },
  // ── Metronome-stop marker drawing (hidden when no cutoff) ──
  drawStopMarker(){
    if(!this.view.meta) return;
    let m=document.getElementById("stop-line");
    if(this.stopTime===null){ if(m) m.style.display="none"; return; }
    if(!m){ m=document.createElement("div"); m.id="stop-line"; document.getElementById("rightpane").appendChild(m); }
    m.style.display="block";
    m.style.left=this.view.timeToX(this.stopTime)+"px";
    m.style.height=(26 + (this.view.lanesTotalH ? this.view.lanesTotalH()
      : document.querySelectorAll("#lanes .lane").length*this.view.trackH()))+"px";
  },

  // ── UI ──
  updateUI(){
    const pcBtn=document.getElementById("precountBtn");
    if(pcBtn){ pcBtn.innerHTML=`<span class="ico">⏱</span><span class="lbl">${this.beats||"Off"}</span>`; pcBtn.classList.toggle("on", this.beats>0); }
    const di=document.getElementById("detectIntroBtn");
    if(di) di.classList.toggle("on", this.active);
    const smBtn=document.getElementById("stopMetroBtn");
    if(smBtn){
      const on=this.stopTime!==null;
      smBtn.classList.toggle("on", on);
      smBtn.title = on
        ? `Fin du métronome à ${this.stopTime.toFixed(2)}s — clic pour la retirer. Le clic s'arrête là, les pistes continuent.`
        : "Fin du métronome — clic pour la poser à la tête de lecture. Le clic s'arrêtera là, les pistes continuent. (Ctrl-clic sur une piste pour la placer.)";
    }
    const st=document.getElementById("startInfo");
    if(st){
      const stopTxt = this.stopTime!==null ? ` · ⏹ ${this.stopTime.toFixed(2)}s` : "";
      st.textContent = `⚑ ${this.startTime.toFixed(2)}s${stopTxt}`;   // ⚑ = same flag as the From-Start button + timeline marker
      st.title = this.plan
        ? `Start ${this.startTime.toFixed(2)}s · precount ${this.bpm()} BPM`+(this.plan.lead_silence>0?` · +${this.plan.lead_silence}s lead silence`:"")+(this.stopTime!==null?` · métronome jusqu'à ${this.stopTime.toFixed(2)}s`:"")
        : `Start ${this.startTime.toFixed(2)}s — click Detect Intro to bake the count-in. Alt/Shift-click a lane to move it.`;
    }
    this.drawMarker();
    this.drawStopMarker();
  },
  _setBusy(b){ const di=document.getElementById("detectIntroBtn"); if(di){ di.disabled=b; di.innerHTML=b?'<span class="ico">⏳</span>':'<span class="ico">🔍</span>'; } },

  _persist(){ if(window.Loader) Loader.persist(); },
  _wire(){
    const pb=document.getElementById("precountBtn"); if(pb) pb.onclick=()=>this.cycleBeats();
    const di=document.getElementById("detectIntroBtn"); if(di) di.onclick=()=>this.detectIntro();
    const sm=document.getElementById("stopMetroBtn"); if(sm) sm.onclick=()=>this.toggleStopAtPlayhead();
    // From-Start button wired in main.js (needs render-loop hooks).
  },
};
window.PreCount = PreCount;
