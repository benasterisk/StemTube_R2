// timeline.js — drawing: timeline ruler, waveforms, beat grid, playhead, zoom.
// All share ONE time→px mapping (pxPerSec), so they stay aligned at any zoom.

// One distinct colour per stem (accent green reserved for metronome+drums emphasis).
const STEM_COLORS = {
  metronome: "#3ddc84",  // green  (click track)
  drums:     "#ff7a59",  // orange
  bass:      "#5b8def",  // blue
  vocals:    "#e85d9e",  // pink
  other:     "#c9a227",  // gold
  guitar:    "#9b6dff",  // purple
  piano:     "#2dd4bf",  // teal
};
function stemColor(name){ return STEM_COLORS[name] || "#8a93a0"; }

const View = {
  pxPerSec: 80,
  zoomV: 1.0,
  BASE_H: 80,
  meta: null,
  engine: null,         // AudioEngine
  canvases: {},         // name -> canvas
  scrollMode: "page", // "manual" | "page" | "center" — default is page
  _suppressScrollHandler: false, // guard so our own auto-scrolls aren't mistaken for manual ones
  // Lead-in pad (seconds): when a count-in is armed and the intro is too short to
  // fit it, this much SILENCE is inserted in front of the whole song. Everything —
  // ruler, waveforms, beats, markers, playhead — is shifted right by this, so the
  // empty space is VISIBLE on the timeline and the count-in clicks have room before
  // the Start. song-time t is drawn at (t + leadPad) * pxPerSec.
  leadPad: 0,

  trackH(){ return Math.round(this.BASE_H * this.zoomV); },
  // Extra height (px) added to a SPECIFIC track's row so its left control can host
  // more widgets than the others. Only the metronome needs it (instrument dropdown
  // on its own line). Returns 0 for every other track → no layout change elsewhere.
  // Kept zoom-independent (a fixed widget strip, not scaled with vertical zoom).
  METRO_EXTRA_H: 26,
  laneExtra(name){ return name==="metronome" ? this.METRO_EXTRA_H : 0; },
  laneH(name){ return this.trackH() + this.laneExtra(name); },
  // Total stacked height of all lanes (each = trackH + its own extra).
  lanesTotalH(){
    let t=0; Object.keys(this.engine ? this.engine.stems : {}).forEach(n=> t+=this.laneH(n));
    return t;
  },
  // Total content duration including the inserted lead-in silence.
  totalDuration(){ return (this.meta ? this.meta.duration : 0) + (this.leadPad || 0); },
  // song-time (seconds) → song-x (px, before subtracting scrollX)
  timeToX(t){ return (t + (this.leadPad || 0)) * this.pxPerSec; },
  laneWidth(){ return this.meta ? Math.max(window.innerWidth, this.totalDuration() * this.pxPerSec) : window.innerWidth; },

  setCanvas(name, cv){ this.canvases[name]=cv; },
  clearCanvases(){ this.canvases={}; },

  sizeCanvas(c, w, h){
    const dpr=window.devicePixelRatio||1;
    c.style.width=w+"px"; c.style.height=h+"px";
    c.width=Math.round(w*dpr); c.height=Math.round(h*dpr);
    const g=c.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); return g;
  },
  niceStep(pps){
    const target=70/pps, steps=[0.1,0.25,0.5,1,2,5,10,15,30,60];
    for(const s of steps){ if(s>=target) return s; }
    return 120;
  },
  // ── VIEWPORT RENDERING ──
  // Canvases are only as wide as the VISIBLE pane (never the whole song), so we
  // never hit the browser's ~65536px canvas limit. We draw the slice of the song
  // currently in view and redraw on scroll/zoom. The lane <div> keeps the full
  // width (for a correct scrollbar); the canvas is sticky at left:0.

  visW(){ return document.getElementById("rightpane").clientWidth; },
  scrollX(){ return document.getElementById("rightpane").scrollLeft; },

  // Draw the timeline ruler for the visible slice [scrollX, scrollX+visW].
  drawTimeline(c){
    const w=this.visW(); this.sizeCanvas(c, w, 26);
    const sx=this.scrollX();
    c.style.left = sx + "px";    // pin the viewport-sized canvas to the visible edge
    const g=c.getContext("2d"); g.clearRect(0,0,w,26);
    const step=this.niceStep(this.pxPerSec);
    const pad=this.leadPad||0;
    // ruler labels are SONG time (0 at the song start, after the pad); start at the
    // visible song-time, but never before -pad (the pad region shows no labels).
    const visSongT=(sx/this.pxPerSec)-pad;
    let t0=Math.floor(visSongT/step)*step; if(t0<0) t0=0;
    g.fillStyle="#7d8794"; g.strokeStyle="rgba(255,255,255,.12)"; g.font="11px system-ui"; g.textBaseline="top";
    for(let t=t0; t<=this.meta.duration; t+=step){
      const x=this.timeToX(t) - sx;            // viewport-relative
      if(x<-40) continue; if(x>w) break;
      g.beginPath(); g.moveTo(x,16); g.lineTo(x,26); g.stroke();
      const mm=Math.floor(t/60), ss=(t%60);
      g.fillText(`${mm}:${ss.toFixed(step<1?1:0).padStart(step<1?4:2,"0")}`, x+3, 2);
    }
  },

  // Draw one stem's visible slice straight from the audio buffer (crisp, no cache).
  drawWave(name){
    const s=this.engine.stems[name]; const c=this.canvases[name]; if(!s||!s.buffer||!c) return;
    const w=this.visW(), h=this.laneH(name); this.sizeCanvas(c, w, h);
    const sx=this.scrollX();
    c.style.left = sx + "px";    // pin the viewport-sized canvas to the visible edge
    const g=c.getContext("2d"); g.clearRect(0,0,w,h);
    const mid=h/2, amp=h*0.46, col=stemColor(name);
    const pad=this.leadPad||0, padPx=pad*this.pxPerSec;
    const N=s.buffer.length, data=s.buffer.getChannelData(0);

    // Map a SONG time (seconds) to a sample index in THIS buffer.
    //  - normal stems: sample i == song-time i/sr_song, where sr_song = len/duration.
    //  - the precount metronome buffer is LONGER than the song by metroLeadSilence
    //    (baked count-in + silence in front): buffer-time bt == song-time bt - lead,
    //    so song-time t == buffer sample (t + lead) * sr (sr = buffer's own rate).
    const isPrecountMetro = (name==="metronome" && this.engine.precountActive);
    const metroLead = isPrecountMetro ? (this.engine.metroLeadSilence||0) : 0;
    const sr = (s.buffer.sampleRate) || (N / this.meta.duration);
    const sampForSongT = isPrecountMetro
      ? (t)=> (t + metroLead) * sr                       // precount metro: account for baked lead
      : (t)=> t * (N / this.meta.duration);              // normal stem

    // center line
    g.strokeStyle="rgba(255,255,255,.06)"; g.lineWidth=1;
    g.beginPath(); g.moveTo(0,mid); g.lineTo(w,mid); g.stroke();

    // waveform: one column per visible pixel. column px maps to song-x = sx+px; the
    // first `padPx` of song-x is the inserted silence (no samples there). For the
    // precount metro, only the HEARD count-in clicks should show — draw from the
    // first heard click (startTime - beats*ibi), NOT from the full baked lead. This
    // makes the visible click count match the chosen 2/4/8.
    let minSongT = 0;
    if(isPrecountMetro && window.PreCount){
      const n=PreCount.beats||0, iv=PreCount.ibi?PreCount.ibi():0.5;
      minSongT = (n>0) ? (PreCount.startTime - n*iv) : -metroLead;
    }
    g.strokeStyle=col; g.lineWidth=1; g.beginPath();
    for(let px=0; px<w; px++){
      const songX=sx+px;
      const songT=(songX - padPx)/this.pxPerSec;        // seconds into the SONG (may be <0 in the pad)
      if(songT<minSongT) continue;
      const a=Math.floor(sampForSongT(songT)), b=Math.min(N, Math.floor(sampForSongT(songT + 1/this.pxPerSec)));
      if(b<=a || a<0 || a>=N) continue;
      let mn=1.0, mx=-1.0; const stride=Math.max(1, Math.floor((b-a)/512));
      for(let j=a;j<b;j+=stride){ const v=data[j]; if(v<mn)mn=v; if(v>mx)mx=v; }
      let top=mid-mx*amp, bot=mid-mn*amp; if(bot-top<1) bot=top+1;
      g.moveTo(px+0.5, top); g.lineTo(px+0.5, bot);
    }
    g.stroke();

    // beat grid (only lines within the visible slice), shifted by the lead pad
    for(let i=0;i<this.meta.beats.length;i++){
      const x=this.timeToX(this.meta.beats[i]) - sx;
      if(x<0) continue; if(x>w) break;
      const down=this.meta.positions[i]===1;
      g.strokeStyle=down?"rgba(255,255,255,.45)":"rgba(255,255,255,.10)";
      g.lineWidth=down?1.5:1;
      g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke();
    }
  },

  // Full redraw: size the scroll spacer to the song width, draw timeline + lanes.
  redrawAll(){
    if(!this.meta) return;
    const fullW=Math.round(this.totalDuration()*this.pxPerSec);
    // spacer width drives the scrollbar; canvases stay viewport-sized (sticky)
    document.getElementById("timeline-wrap").style.width=fullW+"px";
    // Lanes are sized PER TRACK (each = trackH + its own extra) so a row with a
    // taller left control (metronome) stays aligned with its lane.
    document.querySelectorAll("#lanes .lane").forEach(l=>{
      const cv=l.querySelector("canvas"); const nm=cv && cv.dataset.n;
      l.style.width=fullW+"px"; l.style.height=this.laneH(nm)+"px";
    });
    this.drawTimeline(document.getElementById("timeline-canvas"));
    Object.keys(this.engine.stems).forEach(name=> this.drawWave(name));
    // Span the playhead over the FULL content height (timeline + every lane), not
    // just the visible part — otherwise it stops short when vertical zoom makes
    // the lanes taller than the viewport.
    const ph=document.getElementById("playhead-line");
    if(ph) ph.style.height=(26 + this.lanesTotalH())+"px";   // 26 = timeline ruler height
    if(window.PreCount){ PreCount.drawMarker(); PreCount.drawStopMarker(); }   // keep Start/Stop markers in sync with zoom
    if(window.LoopSel) LoopSel.draw();   // keep the loop band in sync with zoom
    this.drawPlayheads();
  },

  // Redraw only the visible content (called on scroll) — cheap, no layout change.
  redrawVisible(){
    if(!this.meta) return;
    this.drawTimeline(document.getElementById("timeline-canvas"));
    Object.keys(this.engine.stems).forEach(name=> this.drawWave(name));
  },
  drawPlayheads(){
    if(!this.meta) return;
    // pos() can be negative during a lead-in count-in; timeToX maps it into the pad.
    const x=Math.max(0, this.timeToX(this.engine.pos()));
    // Move the playhead LINE (a DOM element) only — no canvas redraw at all,
    // so the per-frame cost is ~0 (was ~64ms/frame redrawing 20000px waveforms).
    const ph=document.getElementById("playhead-line");
    if(ph) ph.style.left=x+"px";

    if(!this.engine.playing) return;
    const sc=document.getElementById("rightpane");
    const maxScroll=Math.max(0, this.laneWidth()-sc.clientWidth);
    const scrollTo=(v)=>{ const c=Math.max(0,Math.min(v,maxScroll));
      if(Math.abs(sc.scrollLeft-c)>0.5){ this._suppressScrollHandler=true; sc.scrollLeft=c; } };

    if(this.scrollMode==="center"){
      // Auto-center: playhead stays at the middle, waveform scrolls under it.
      scrollTo(Math.round(x - sc.clientWidth/2));
    } else if(this.scrollMode==="page"){
      // Page-flip (Audacity-style): when the playhead reaches the right edge,
      // jump one page so it reappears at the left with the following waveforms.
      const right=sc.scrollLeft + sc.clientWidth;
      if(x > right - 20 || x < sc.scrollLeft){
        scrollTo(Math.round(x - 20));   // new page starts ~at the playhead
      }
    }
    // "manual": do nothing — the user follows with sliders/scroll.
  },
  // px (within a lane canvas) → song time (subtract the lead pad; clamp to [0,dur])
  xToTime(x){ return Math.max(0, Math.min(this.meta.duration, x/this.pxPerSec - (this.leadPad||0))); },
};
