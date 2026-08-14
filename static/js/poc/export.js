// export.js — server-side mix export UI.
//
// The "⤓" transport button opens a small modal: choose format (MP3/WAV) and
// whether to bake in the metronome. The current mixer state (per-stem volume/pan/
// mute/solo, the chosen click resolution, the count-in beats, and the End marker)
// is collected and POSTed to /poc-mixer/export; the server renders the mix exactly
// as it sounds (count-in → song → click stops at the End marker) and streams back
// a file we download. Tempo/pitch are NOT applied (export is at original tempo).
const MixExport = {
  engine:null, view:null, _modal:null, _busy:false,

  init(engine, view){ this.engine=engine; this.view=view; this._wire(); },

  _wire(){
    const btn=document.getElementById("exportBtn");
    if(btn) btn.onclick=()=>this.open();
  },

  // ── State collection ────────────────────────────────────────────────────
  // Real stems (everything except the metronome) with their mixer controls.
  _collectTracks(){
    const tracks={};
    Object.values(this.engine.stems).forEach(s=>{
      if(s.name==="metronome") return;
      tracks[s.name]={ vol:s.vol, pan:s.pan||0, muted:!!s.muted, solo:!!s.solo };
    });
    return tracks;
  },
  // The metronome is a stem too; "include" defaults to: it exists and isn't muted.
  _metroState(){
    const m=this.engine.stems["metronome"];
    return { exists:!!m, muted:m?!!m.muted:true, vol:m?m.vol:1.0 };
  },

  _buildBody(fmt, includeMetro){
    const pc=window.PreCount||{};
    const title=(document.getElementById("song-title-display")?.textContent || "mix").trim();
    const ms=this._metroState();
    // Export mirrors the mixer: count-in if armed, click between the Start and End
    // markers. No "from_start" mode — the markers ARE the start/end.
    return {
      tracks:this._collectTracks(),
      include_metronome:!!includeMetro,
      metro_resolution:this.engine.metroRes||"1",
      precount_beats:(pc.beats>0)?pc.beats:0,
      stop_time:(typeof pc.stopTime==="number")?pc.stopTime:null,
      start_time:(typeof pc.startTime==="number")?pc.startTime:null,
      metro_gain:ms.vol,
      format:fmt,
      title:title,
    };
  },

  // ── Modal ───────────────────────────────────────────────────────────────
  open(){
    if(!this._modal) this._build();
    if(!this.view.meta){
      // no song ready — show the modal but tell the user why nothing will export
      this._setStatus("Aucun morceau chargé.");
      this._modal.querySelector("#exp-go").disabled = true;
      this._modal.style.display="flex";
      return;
    }
    this._modal.querySelector("#exp-go").disabled = false;
    // reflect current state — the metronome checkbox defaults to the mixer's state
    const ms=this._metroState();
    const incEl=this._modal.querySelector("#exp-include-metro");
    incEl.checked = ms.exists && !ms.muted;
    incEl.disabled = !ms.exists;
    this._refreshSummary();
    this._setStatus("");
    this._modal.style.display="flex";
  },
  close(){ if(this._modal) this._modal.style.display="none"; },

  _build(){
    const el=document.createElement("div");
    el.id="exportModal";
    el.innerHTML=`
      <div class="box">
        <div class="bhead">
          <strong style="flex:1">Exporter le mix</strong>
          <button id="exp-close" class="iconbtn" title="Fermer">✕</button>
        </div>
        <div class="bbody">
          <label class="row"><span>Format</span>
            <select id="exp-format">
              <option value="mp3">MP3 (192 kbps)</option>
              <option value="wav">WAV (sans perte)</option>
            </select>
          </label>
          <label class="row"><input type="checkbox" id="exp-include-metro"> <span>Inclure le métronome</span></label>
          <div class="exp-summary" id="exp-summary"></div>
          <div class="exp-note">Le métronome est exporté tel qu'en lecture : décompte (si activé), clic entre le repère de début et de fin. Tempo/hauteur à l'origine.</div>
          <div class="exp-status" id="exp-status"></div>
        </div>
        <div class="bfoot">
          <button id="exp-cancel">Annuler</button>
          <button id="exp-go" class="primary">Exporter</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._modal=el;
    // styles (scoped) — reuse the file-browser modal look
    if(!document.getElementById("exportModalCss")){
      const css=document.createElement("style"); css.id="exportModalCss";
      css.textContent=`
        #exportModal{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:none;
          align-items:center; justify-content:center; z-index:20; }
        #exportModal .box{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
          width:420px; max-width:92vw; display:flex; flex-direction:column; }
        #exportModal .bhead{ padding:12px 14px; border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:center; }
        #exportModal .bbody{ padding:14px; display:flex; flex-direction:column; gap:12px; }
        #exportModal .row{ display:flex; align-items:center; gap:10px; justify-content:space-between; }
        #exportModal .row span{ color:var(--text); font-size:14px; }
        #exportModal select{ background:var(--bg); color:var(--text); border:1px solid var(--line);
          border-radius:6px; padding:6px 8px; }
        #exportModal .exp-summary{ background:var(--bg); border:1px solid var(--line); border-radius:8px;
          padding:10px; font-size:13px; color:var(--muted); line-height:1.6; }
        #exportModal .exp-note{ font-size:12px; color:var(--muted); }
        #exportModal .exp-status{ font-size:13px; min-height:18px; color:var(--accent); }
        #exportModal .bfoot{ padding:12px 14px; border-top:1px solid var(--line); display:flex; gap:8px; justify-content:flex-end; }
        #exportModal .bfoot button{ background:var(--panel); color:var(--text); border:1px solid var(--line);
          border-radius:7px; padding:7px 14px; cursor:pointer; font-weight:600; }
        #exportModal .bfoot button.primary{ background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
        #exportModal .bfoot button:disabled{ opacity:.5; cursor:default; }`;
      document.head.appendChild(css);
    }
    el.querySelector("#exp-close").onclick=()=>this.close();
    el.querySelector("#exp-cancel").onclick=()=>this.close();
    el.querySelector("#exp-include-metro").onchange=()=>this._refreshSummary();
    el.querySelector("#exp-format").onchange=()=>this._refreshSummary();
    el.querySelector("#exp-go").onclick=()=>this.run();
    // click outside the box closes
    el.onclick=(e)=>{ if(e.target===el) this.close(); };
  },

  _refreshSummary(){
    const pc=window.PreCount||{};
    const inc=this._modal.querySelector("#exp-include-metro").checked;
    const parts=[];
    const nStems=Object.keys(this._collectTracks()).length;
    parts.push(`${nStems} piste${nStems>1?"s":""}`);
    if(inc){
      let m=`métronome (résolution ${this.engine.metroRes||"1"})`;
      if(pc.beats>0) m+=` · décompte ${pc.beats}`;
      const from = (typeof pc.startTime==="number" && pc.startTime>0.05) ? pc.startTime.toFixed(1)+"s" : "0s";
      const to = (pc.stopTime!=null) ? pc.stopTime.toFixed(1)+"s" : "fin";
      m+=` · clic ${from} → ${to}`;
      parts.push(m);
    } else {
      parts.push("sans métronome");
    }
    this._modal.querySelector("#exp-summary").innerHTML=parts.join("<br>");
  },
  _setStatus(t){ const s=this._modal&&this._modal.querySelector("#exp-status"); if(s) s.textContent=t; },

  // ── Run the export ────────────────────────────────────────────────────────
  async run(){
    if(this._busy) return;
    const job=this.view.meta && this.view.meta.job;
    if(!job){ this._setStatus("Aucun morceau chargé."); return; }
    const fmt=this._modal.querySelector("#exp-format").value;
    const inc=this._modal.querySelector("#exp-include-metro").checked;
    const goBtn=this._modal.querySelector("#exp-go");
    this._busy=true; goBtn.disabled=true; this._setStatus("Rendu en cours… (cela peut prendre quelques secondes)");
    try{
      const res = await API.exportMix(job, this._buildBody(fmt, inc));
      this._download(res.download_url, res.filename);
      // The server also dropped a copy in Downloads — tell the user where it is.
      if(res.saved_to){ this._setStatus("Enregistré dans Téléchargements : "+res.filename); }
      else { this._setStatus("Téléchargement lancé : "+res.filename); }
      setTimeout(()=>this.close(), 2200);
    }catch(e){
      console.error("[export] failed:", e);
      this._setStatus("Échec : "+(e&&e.message?e.message:e));
    }finally{
      this._busy=false; goBtn.disabled=false;
    }
  },
  // Trigger the browser download via a REAL navigation to the streaming endpoint.
  // WebView2 silently ignores programmatic blob: downloads, but it handles a genuine
  // same-origin navigation to a Content-Disposition:attachment URL natively. The
  // anchor is placed in the TOP document (not this iframe) so the click isn't blocked.
  _download(url, filename){
    const topDoc = (window.top && window.top.document) || document;
    const a=topDoc.createElement("a");
    a.href=url; a.download=filename||"mix"; a.style.display="none";
    topDoc.body.appendChild(a); a.click();
    setTimeout(()=>{ try{ a.remove(); }catch(e){} }, 4000);
  },
};
window.MixExport = MixExport;
// init after the engine/view globals exist (main.js defines them above this script)
if(typeof engine!=="undefined" && typeof view!=="undefined"){ MixExport.init(engine, view); }
