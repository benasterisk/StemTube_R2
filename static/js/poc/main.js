// main.js — wiring: transport, zoom, measure, render loop. Glue only.
const $ = s => document.querySelector(s);

const engine = new AudioEngine();
const view = View;
view.engine = engine;

const UI = {
  clearTracks(){
    document.getElementById("left-tracks").innerHTML="";
    document.getElementById("lanes").innerHTML="";
    const tc=document.getElementById("timeline-canvas"); if(tc){ const g=tc.getContext("2d"); g.clearRect(0,0,tc.width,tc.height); }
    $("#playBtn").disabled=true; $("#stopBtn").disabled=true;
    this.updateTime();
  },
  updateTime(){ $("#time").textContent=`${Math.max(0,engine.pos()).toFixed(2)} / ${(view.meta?view.meta.duration:0).toFixed(2)}`; },
  status(t){ $("#status").textContent=t; },
};

// ── Play-button beat pulse ──────────────────────────────────────────────────
// The Play button flashes a soft green glow on every metronome click — both the
// precount clicks and the song beats — so it visually "beats" with the tempo
// (and follows time-stretch, since we compare against pos() which already does).
let _pulseTimes=[];   // sorted [{t, down}] — precount clicks (if active) + song beats
let _pulseIdx=0;
function buildPulseTimes(){
  _pulseTimes=[];
  if(!view.meta) return;
  // precount clicks (only the ones baked & active) come before the Start
  if(window.PreCount && PreCount.active && PreCount.plan && Array.isArray(PreCount.plan.precount_times)){
    PreCount.plan.precount_times.forEach((t,i,arr)=> _pulseTimes.push({t, down:i===arr.length-1}));
  }
  // song beats (downbeat = bar position 1)
  const b=view.meta.beats||[], p=view.meta.positions||[];
  for(let i=0;i<b.length;i++) _pulseTimes.push({t:b[i], down:p[i]===1});
  _pulseTimes.sort((a,c)=>a.t-c.t);
}
function resetPulseIndex(){
  const pos=engine.pos();
  _pulseIdx=0;
  while(_pulseIdx<_pulseTimes.length && _pulseTimes[_pulseIdx].t < pos-0.02) _pulseIdx++;
}
function firePlayPulse(down){
  const btn=$("#playBtn"); if(!btn) return;
  btn.classList.remove("beat","down"); void btn.offsetWidth;   // restart the CSS animation
  btn.classList.add("beat"); if(down) btn.classList.add("down");
}
function pulseTick(){
  if(!engine.playing || !_pulseTimes.length) return;
  const pos=engine.pos();
  // if the playhead jumped backward (seek), re-sync the beat index
  if(_pulseIdx>0 && pos < _pulseTimes[_pulseIdx-1].t - 0.1) resetPulseIndex();
  // fire every beat we've just crossed since last frame (handles fast tempo)
  while(_pulseIdx<_pulseTimes.length && _pulseTimes[_pulseIdx].t <= pos+0.01){
    firePlayPulse(_pulseTimes[_pulseIdx].down);
    _pulseIdx++;
  }
}

// render loop
let rafId=null;
function tick(){
  UI.updateTime(); view.drawPlayheads();
  if(window.TempoPitch) TempoPitch.tick();   // sliding-window BPM read-out
  pulseTick();                               // beat-glow the Play button
  // Practice tabs follow the playhead (each .sync() is a no-op if disabled).
  if(window.mixer){
    const p=engine.pos();
    if(window.mixer.chordDisplay) window.mixer.chordDisplay.sync(p);
    if(window.mixer.structureDisplay) window.mixer.structureDisplay.sync(p);
    if(window.mixer.karaokeDisplay) window.mixer.karaokeDisplay.sync(p);
  }
  // End of song → behave like Stop (rewind to start).
  if(engine.playing && engine.pos()>=view.meta.duration){ stopAll(); return; }
  rafId=requestAnimationFrame(tick);
}
function setPlayBtn(playing){
  $("#playBtn").innerHTML = playing ? '<span class="ico">⏸</span>' : '<span class="ico">▶</span>';
}

// If a mic recording is in progress, finalize it (stops the MediaRecorder, draws
// the take's waveform). Called when the user hits Pause or Stop. Returns true if
// it was recording (so the caller knows a take just ended).
function stopRecordingIfActive(){
  var re = window.mixer && window.mixer.recordingEngine;
  if(re && re.isRecording){
    var rb = $("#recordBtn"); if(rb) rb.classList.remove("recording");
    re.stopRecording().catch(function(e){ console.error("[recording] finalize failed:", e); })
      .then(function(){
        document.querySelectorAll(".rec-device-select").forEach(function(s){ s.disabled = false; });  // unlock mic pickers (even on failure)
        if(window.mixer.waveform && window.mixer.waveform.redrawAllRecordings) window.mixer.waveform.redrawAllRecordings();
      });
    return true;
  }
  return false;
}

// Play/Pause toggle: play resumes from the current position; pause keeps it.
function togglePlayPause(){
  if(engine.playing){
    stopRecordingIfActive();    // Pause also ends an in-progress recording
    engine.stop();              // engine.stop() remembers the position = pause
    if(rafId) cancelAnimationFrame(rafId);
    setPlayBtn(false);
    view.drawPlayheads(); UI.updateTime(); Loader.persist();
  } else {
    // If we're at (or past) the end, rewind to the start before playing.
    if(view.meta && engine.staticPos >= view.meta.duration - 0.05){
      engine.staticPos = 0;
      document.getElementById("rightpane").scrollLeft = 0;
    }
    // Count-in: if a precount is armed AND we're at/near the song beginning
    // (before the Start marker), run the count-in instead of a plain play.
    if(window.PreCount && PreCount.beats>0 && view.meta
       && engine.staticPos <= PreCount.startTime + 0.05){
      startWithPrecount(); return;
    }
    engine.play();              // resumes from staticPos
    setPlayBtn(true);
    buildPulseTimes(); resetPulseIndex();
    tick();
  }
}
// Run the count-in then play (used by Play-when-armed and the From-Start button).
// playFromStart() is async (it may bake the count-in WAVs on first use); wait for
// playback to actually start before kicking off the render loop / beat pulses.
async function startWithPrecount(){
  setPlayBtn(true);
  await PreCount.playFromStart();
  buildPulseTimes(); resetPulseIndex();
  tick();
}
// Stop: halt AND rewind to the start of the song.
function stopAll(){
  stopRecordingIfActive();      // Stop also ends an in-progress recording
  engine.stop();
  engine.staticPos = 0;         // rewind to beginning
  if(rafId) cancelAnimationFrame(rafId);
  setPlayBtn(false);
  // bring the view back to the start too
  document.getElementById("rightpane").scrollLeft = 0;
  view.drawPlayheads(); UI.updateTime(); Loader.persist();
}

$("#playBtn").onclick=()=> togglePlayPause();
$("#stopBtn").onclick=()=> stopAll();
// From Start: always count-in (if armed) from the Start marker.
$("#fromStartBtn").onclick=()=>{ if(engine.playing){ engine.stop(); if(rafId) cancelAnimationFrame(rafId); } startWithPrecount(); };

// Scroll-mode tri-toggle: Manual → Page → Center → (cycle).
const SCROLL_MODES = ["manual", "page", "center"];
const SCROLL_LABELS = { manual:'<span class="ico">✕</span><span class="lbl">Manual</span>', page:'<span class="ico">⏭</span><span class="lbl">Page</span>', center:'<span class="ico">⊕</span><span class="lbl">Center</span>' };
function setScrollMode(mode){
  view.scrollMode = mode;
  const btn = $("#scrollModeBtn");
  btn.innerHTML = SCROLL_LABELS[mode];
  btn.classList.toggle("on", mode!=="manual");   // highlight when an auto mode is on
  Loader.persist();
}
$("#scrollModeBtn").onclick=()=>{
  const i = SCROLL_MODES.indexOf(view.scrollMode);
  setScrollMode(SCROLL_MODES[(i+1)%SCROLL_MODES.length]);
};

// zoom — stepped −/+ buttons (StemTube format), keeping the selected scroll mode.
// Guard with _zooming: resizing the lane spacer can clamp scrollLeft and fire a
// scroll event; without the guard that would wrongly drop us back to Manual.
const ZOOM = {
  H_MIN:20, H_MAX:600, H_DEFAULT:80, H_FACTOR:1.25,   // horizontal: multiplicative
  V_MIN:0.5, V_MAX:3, V_DEFAULT:1, V_STEP:0.2,         // vertical: additive
};
function withZoomGuard(fn){ view._zooming=true; fn(); setTimeout(()=>{ view._zooming=false; }, 0); }
function applyZoomH(pps){
  const v=Math.max(ZOOM.H_MIN, Math.min(ZOOM.H_MAX, Math.round(pps)));
  withZoomGuard(()=>{ view.pxPerSec=v; view.redrawAll(); }); Loader.persist();
}
function applyZoomV(z){
  const v=Math.max(ZOOM.V_MIN, Math.min(ZOOM.V_MAX, Math.round(z*100)/100));
  withZoomGuard(()=>{ view.zoomV=v;
    // per-track height (metronome row is taller for its instrument dropdown)
    document.querySelectorAll("#left-tracks .lctrl").forEach(lc=>{
      const volEl=lc.querySelector("input.vol"); const nm=volEl && volEl.dataset.n;
      lc.style.height=view.laneH(nm)+"px";
    });
    view.redrawAll(); }); Loader.persist();
}
$("#zoomHin").onclick =()=> applyZoomH(view.pxPerSec*ZOOM.H_FACTOR);
$("#zoomHout").onclick=()=> applyZoomH(view.pxPerSec/ZOOM.H_FACTOR);
$("#zoomVin").onclick =()=> applyZoomV(view.zoomV+ZOOM.V_STEP);
$("#zoomVout").onclick=()=> applyZoomV(view.zoomV-ZOOM.V_STEP);
$("#zoomReset").onclick=()=>{ applyZoomH(ZOOM.H_DEFAULT); applyZoomV(ZOOM.V_DEFAULT); };

// persist playhead periodically while playing (so a refresh keeps the position)
setInterval(()=>{ if(engine.playing) Loader.persist(); }, 2000);
// persist on tab close/refresh
window.addEventListener("beforeunload", ()=> Loader.persist());

// keep left column vertical scroll aligned with the lanes;
// redraw the visible slice on every scroll (viewport rendering);
// a MANUAL horizontal scroll drops to Manual mode (an auto-scroll doesn't).
document.getElementById("rightpane").addEventListener("scroll", ()=>{
  document.getElementById("leftcol").scrollTop = document.getElementById("rightpane").scrollTop;
  view.redrawVisible();   // re-render the now-visible portion (always)
  if(view._suppressScrollHandler){ view._suppressScrollHandler=false; return; }
  if(view._zooming) return;          // scroll caused by a zoom resize → keep the mode
  if(view.scrollMode!=="manual") setScrollMode("manual");
});

window.addEventListener("resize", ()=> view.redrawAll());

// loader wiring — on successful load, enable transport + show info
Loader.init(engine, view, (meta, label)=>{
  $("#playBtn").disabled=false; $("#stopBtn").disabled=false;
  $("#fromStartBtn").disabled=false; $("#precountBtn").disabled=false; $("#detectIntroBtn").disabled=false;
  { const sm=$("#stopMetroBtn"); if(sm) sm.disabled=false; }
  { const eb=$("#exportBtn"); if(eb) eb.disabled=false; }
  setPlayBtn(false);   // a freshly loaded/restored song starts paused
  const nl=$("#nowLoaded"); if(nl) nl.textContent=`${(meta.duration||0).toFixed(1)}s · ${(meta.beats||[]).length} beats · ${meta.key||""}`;
  UI.status(`Loaded ${label||meta.job} — ${(meta.beats||[]).length} beats, ${meta.key||"key ?"}. ctx ${engine.sampleRate?engine.sampleRate():"?"}Hz.`);
  UI.updateTime();
  // Practice tabs (Chords/Lyrics/Structure) read from window.EXTRACTION_INFO; load
  // them now that the engine + shim are ready. Safe no-ops if a tab isn't wired yet.
  if(window.mixer){
    if(window.mixer.chordDisplay){
      if(window.EXTRACTION_INFO && window.EXTRACTION_INFO.detected_bpm) window.mixer.chordDisplay.setBPM(window.EXTRACTION_INFO.detected_bpm);
      window.mixer.chordDisplay.loadChordData();
    }
    // Structure needs the real duration → (re)load it now that we have meta.
    if(window.mixer.structureDisplay && window.EXTRACTION_INFO && window.EXTRACTION_INFO.structure_data){
      try { window.mixer.structureDisplay.loadStructure(window.EXTRACTION_INFO.structure_data, meta.duration); } catch(e){}
    }
    // Karaoke auto-loads from EXTRACTION_INFO in its constructor; nothing to do here.
    // Saved takes: restore this song's recordings (friend parity — they reappear
    // with their track row + waveform after a reload).
    if(window.mixer.recordingEngine && window.mixer.recordingEngine.loadFromServer && !window.mixer.__recordingsRestored){
      window.mixer.__recordingsRestored = true;
      window.mixer.recordingEngine.loadFromServer(window.EXTRACTION_ID)
        .catch(function(e){ console.warn("[recording] restore failed:", e); });
    }
  }
});

window.UI = UI; // mixer/loader reference UI.clearTracks

// Tempo/pitch controller (BPM time-stretch + Key pitch-shift via SoundTouch).
TempoPitch.init(engine, view);
// Count-in / Start-marker controller.
PreCount.init(engine, view);
// A/B loop selection controller.
if(window.LoopSel) LoopSel.init(engine, view);
// Load the SoundTouch worklet up front so stems get their node on first play.
// (Needs a secure context: localhost is fine; remote needs HTTPS.)
engine.loadWorklet().then(ok=>{ if(!ok) UI.status("Tempo/pitch disabled (insecure context — use localhost or HTTPS)."); });

// friend-v2: load the extraction the iframe was opened with (?extraction_id=…).
Loader.loadExtraction(window.EXTRACTION_ID, window.EXTRACTION_INFO && window.EXTRACTION_INFO.title);
