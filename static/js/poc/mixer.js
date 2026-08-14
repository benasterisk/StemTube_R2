// mixer.js — build track rows: fixed controls on the LEFT, waveform lanes RIGHT.
const Mixer = {
  STEM_ORDER: ["metronome","drums","bass","guitar","piano","vocals","other"], // drums+metronome on top; guitar/piano appear in 6-stem demucs models

  // ── value formatting ──
  // volume gain → dB. 1.0 = 0 dB (unity), 0 = -∞.
  fmtVol(gain){
    if(gain<=0.0001) return "−∞ dB";
    const db = 20*Math.log10(gain);
    const s = db.toFixed(1);
    return (db>0 && s!=="0.0" ? "+" : "") + s + " dB";   // unity shows "0.0 dB"
  },
  // pan -1…+1 → "C" / "L50" / "R30"
  fmtPan(v){
    const p = Math.round(v*100);
    if(p===0) return "C";
    return (p<0 ? "L"+(-p) : "R"+p);
  },
  // show the floating bubble with `text` near the slider thumb
  _bubble(slider, text){
    const b=document.getElementById("ctrl-bubble"); if(!b) return;
    const r=slider.getBoundingClientRect();
    const min=+slider.min, max=+slider.max, val=+slider.value;
    const frac=(max>min)?(val-min)/(max-min):0.5;
    b.textContent=text;
    b.style.left=(r.left + frac*r.width)+"px";   // follow the thumb horizontally
    b.style.top=(r.top)+"px";
    b.style.display="block";
  },
  _hideBubble(){ const b=document.getElementById("ctrl-bubble"); if(b) b.style.display="none"; },

  build(engine, view){
    const names = this.STEM_ORDER.filter(n => engine.stems[n]);
    const left = document.getElementById("left-tracks"); left.innerHTML="";
    const lanes = document.getElementById("lanes"); lanes.innerHTML="";
    view.clearCanvases();

    names.forEach(name=>{
      const h = view.laneH(name);   // metronome row is taller (extra widget line)
      // left control — name dot uses the stem's colour
      const col = (typeof stemColor==="function") ? stemColor(name) : "#8a93a0";
      const lc=document.createElement("div");
      lc.className = "lctrl" + (name==="metronome" ? " metro" : "");
      lc.style.height=h+"px";
      // Metronome gets a click-resolution selector (½ / 1 / 2), docked to the
      // right of its name row; the instrument dropdown gets its own row below.
      const resRow = (name==="metronome") ? `
        <div class="metrores" title="Metronome resolution: ½ = half time, 1 = on beat, 2 = double time">
          <button data-res="0.5">½×</button>
          <button data-res="1" class="on">1×</button>
          <button data-res="2">2×</button>
        </div>` : "";
      // Instrument (timbre) dropdown — own row UNDER the controls (it's wider than
      // the name row can hold). Only the metronome has it.
      const instRow = (name==="metronome") ? `
        <div class="metroinst-row">
          <span class="metroinst-lab">Sound</span>
          <select class="metroinst" title="Metronome sound (instrument)"></select>
        </div>` : "";
      // Per-track Record button (placeholder). On integration this opens a
      // dropdown for the recording params (mic source, monitoring, effects) that
      // already exist in StemTube — hence the title hint. The metronome track
      // can't be recorded, so it has no Rec button.
      const recBtn = (name==="metronome") ? "" :
        `<button class="rec" data-act="rec" data-n="${name}" title="Record this track (coming soon: mic source, monitoring & effects)"><span class="dot"></span></button>`;
      lc.innerHTML=`
        <div class="name"><span class="dot" style="background:${col}"></span>${name}${resRow}</div>
        <div class="ctl-row">
          <span class="btns">
            <button data-act="mute" data-n="${name}" title="Mute">M</button>
            <button data-act="solo" data-n="${name}" title="Solo">S</button>
            ${recBtn}
          </span>
          <input class="vol" type="range" min="0" max="${name==="metronome"?3:1.5}" step="0.01" value="1" data-n="${name}" title="Volume (double-click = 0 dB)">
          <span class="pan" title="Pan (double-click to center)">
            <span class="panlab">L</span>
            <input class="panrange" type="range" min="-1" max="1" step="0.02" value="0" data-n="${name}">
            <span class="panlab">R</span>
          </span>
        </div>${instRow}`;
      left.appendChild(lc);
      // right lane
      const lane=document.createElement("div"); lane.className="lane";
      const cv=document.createElement("canvas"); cv.dataset.n=name;
      lane.appendChild(cv); lanes.appendChild(lane);
      view.setCanvas(name, cv);
    });
    // single playhead line spanning timeline + lanes (moved via style.left, no redraw)
    let ph=document.getElementById("playhead-line");
    if(!ph){ ph=document.createElement("div"); ph.id="playhead-line"; }
    document.getElementById("rightpane").appendChild(ph);

    // reflect mute/solo state onto the M/S buttons (rec is left untouched)
    const refreshMS=()=> left.querySelectorAll("button[data-act='mute'],button[data-act='solo']").forEach(bb=>{
      const st=engine.stems[bb.dataset.n]; if(!st) return;
      bb.classList.toggle("on", bb.dataset.act==="mute" ? st.muted : st.solo);
    });
    // Mute / Solo — use currentTarget so a click on an inner <span> still resolves
    // to the button's own data-act/data-n.
    left.querySelectorAll("button[data-act='mute'],button[data-act='solo']").forEach(b=> b.onclick=e=>{
      const {act,n}=e.currentTarget.dataset;
      if(act==="mute") engine.setMute(n, !engine.stems[n].muted);
      if(act==="solo") engine.setSolo(n, !engine.stems[n].solo);
      refreshMS();
      if(window.Loader) Loader.persist();
    });
    // Per-track Record (placeholder). No engine action yet — on integration this
    // opens the StemTube recording params (mic source, monitoring, effects).
    left.querySelectorAll("button[data-act='rec']").forEach(b=> b.onclick=e=>{
      const n=e.currentTarget.dataset.n;
      if(window.UI && UI.status) UI.status(`Recording for “${n}” isn’t wired in the POC yet (mic source / monitoring / effects come with the StemTube integration).`);
    });
    const self=this;
    // attach hover/drag value bubble to a slider, given a value-formatter
    const withBubble=(slider, fmt)=>{
      const show=()=> self._bubble(slider, fmt(+slider.value));
      slider.addEventListener("input", show);
      slider.addEventListener("pointerenter", show);
      slider.addEventListener("pointermove", show);
      slider.addEventListener("mouseenter", show);   // fallback if no pointer events
      slider.addEventListener("pointerleave", ()=> self._hideBubble());
      slider.addEventListener("mouseleave", ()=> self._hideBubble());
      // keep visible during a drag even if the pointer briefly leaves; hide on release
      slider.addEventListener("pointerdown", show);
      window.addEventListener("pointerup", ()=> self._hideBubble());
    };

    // volume slider (shows dB); double-click resets to 0 dB (gain 1.0 = unity)
    left.querySelectorAll("input.vol").forEach(v=>{
      v.oninput=e=>{ engine.setVol(e.target.dataset.n, +e.target.value); if(window.Loader) Loader.persist(); };
      v.ondblclick=e=>{ e.target.value=1; engine.setVol(e.target.dataset.n, 1); if(window.Loader) Loader.persist(); self._bubble(e.target, self.fmtVol(1)); };
      withBubble(v, g=> self.fmtVol(g));
    });
    // pan slider: -1 L … 0 center … +1 R; double-click recenters (shows L/R/C)
    left.querySelectorAll("input.panrange").forEach(p=>{
      p.oninput=e=>{ engine.setPan(e.target.dataset.n, +e.target.value); if(window.Loader) Loader.persist(); };
      p.ondblclick=e=>{ e.target.value=0; engine.setPan(e.target.dataset.n, 0); if(window.Loader) Loader.persist(); self._bubble(e.target, self.fmtPan(0)); };
      withBubble(p, v=> self.fmtPan(v));
    });

    // metronome resolution selector (½ / 1 / 2)
    const resBtns = left.querySelectorAll(".metrores button[data-res]");
    if(resBtns.length){
      // reflect current selection
      const cur = engine.metroRes || "1";
      resBtns.forEach(b=> b.classList.toggle("on", b.dataset.res===cur));
      resBtns.forEach(b=> b.onclick=()=>{
        const res=b.dataset.res;
        engine.setMetroResolution(res);
        resBtns.forEach(bb=> bb.classList.toggle("on", bb===b));
        if(window.Loader) Loader.persist();
      });
    }

    // metronome instrument (timbre) dropdown
    const instSel = left.querySelector("select.metroinst");
    if(instSel) this._wireMetroInstrument(instSel, engine, view);

    // Lane interaction:
    //  - DRAG across a waveform → define the A/B loop region (snaps to beats; spans
    //    all tracks since they share one timeline). Hold Alt to disable snapping.
    //  - simple CLICK (no drag) → seek there.
    //  - Alt/Shift-click (no drag) → move the count-in Start marker.
    //  - Ctrl/Cmd-click (no drag) → set the metronome-stop marker.
    const swallowBake=err=>console.warn("[mixer] marker re-bake failed:", err);
    const laneTime=(cv,clientX)=>{
      const rect=cv.getBoundingClientRect();
      // canvas is viewport-sized & pinned at left:scrollX, so add scrollX to get song-x
      return view.xToTime(view.scrollX() + (clientX - rect.left));
    };
    const DRAG_PX=4;   // movement beyond this = a drag (loop), below = a click (seek)
    lanes.querySelectorAll("canvas").forEach(cv=>{
      cv.addEventListener("mousedown", e=>{
        if(e.button!==0) return;                       // left button only
        // a modifier means "place a marker on click" → don't start a loop drag
        if(e.altKey||e.shiftKey||e.ctrlKey||e.metaKey){ cv._mods=true; cv._downX=e.clientX; cv._downT=laneTime(cv,e.clientX); return; }
        cv._mods=false; cv._downX=e.clientX; cv._downT=laneTime(cv,e.clientX);
        cv._loopDragging=true; cv._moved=false;
        e.preventDefault();
      });
      cv.addEventListener("mousemove", e=>{
        if(!cv._loopDragging) return;
        if(Math.abs(e.clientX-cv._downX) > DRAG_PX){
          cv._moved=true;
          if(window.LoopSel){ LoopSel.setRegion(cv._downT, laneTime(cv,e.clientX), e.altKey); }
        }
      });
      const endDrag=e=>{
        // modifier-click (no drag) → markers
        if(cv._mods && Math.abs(e.clientX-cv._downX)<=DRAG_PX){
          const t=cv._downT;
          if((e.altKey||e.shiftKey) && window.PreCount){ Promise.resolve(PreCount.setStartFromTime(t)).catch(swallowBake); }
          else if((e.ctrlKey||e.metaKey) && window.PreCount){ Promise.resolve(PreCount.setStopFromTime(t)).catch(swallowBake); }
          cv._mods=false; return;
        }
        if(!cv._loopDragging) return;
        cv._loopDragging=false;
        if(cv._moved){
          // finalize the loop region (already drawn during move); persist
          if(window.LoopSel) LoopSel.setRegion(cv._downT, laneTime(cv,e.clientX), e.altKey);
          if(window.Loader) Loader.persist();
        } else {
          // no movement → plain seek
          engine.seek(cv._downT); view.drawPlayheads();
          if(window.Loader) Loader.persist();
        }
      };
      cv.addEventListener("mouseup", endDrag);
    });
    // a mouseup anywhere ends a drag that left the canvas
    window.addEventListener("mouseup", e=>{
      lanes.querySelectorAll("canvas").forEach(cv=>{
        if(cv._loopDragging){ cv._loopDragging=false; if(cv._moved && window.LoopSel){ if(window.Loader) Loader.persist(); } }
      });
    });
  },

  // Populate + wire the metronome-instrument <select>. Switching the timbre asks the
  // server to (re)render the click tracks for that instrument and re-bake any active
  // count-in, then reloads the engine's metronome buffers live. The current value is
  // taken from view.meta.metro_instrument (set by prepare / a prior switch).
  async _wireMetroInstrument(sel, engine, view){
    const job = view.meta && view.meta.job;
    // catalogue (cached on Mixer so we only fetch once per page)
    if(!this._instCatalogue){
      try{ const d=await API.metroInstruments(); this._instCatalogue=(d&&d.instruments)||[]; }
      catch(e){ this._instCatalogue=[{id:"click",label:"Click (default)"}]; }
    }
    const cur = (view.meta && view.meta.metro_instrument) || "click";
    sel.innerHTML = this._instCatalogue
      .map(it=>`<option value="${it.id}"${it.id===cur?" selected":""}>${it.label}</option>`).join("");
    sel.onchange = async ()=>{
      const instrument = sel.value;
      sel.disabled = true;
      const prev = cur;
      try{
        const r = await API.setMetroInstrument(job, instrument);
        if(r && r.error){ throw new Error(r.error); }
        if(view.meta) view.meta.metro_instrument = r.instrument || instrument;
        const tag = "inst-" + (r.instrument || instrument);   // cache-bust the WAVs
        // reload base metronome buffers (the 3 resolutions) for the new timbre
        await engine.reloadMetroBuffers(job, r.metronome_resolutions || (view.meta&&view.meta.metronome_resolutions), tag);
        // reload re-baked count-in/stop buffers if the server re-baked them
        if(r.precount && window.PreCount && PreCount.applyServerPlan){
          await PreCount.applyServerPlan(r.precount, tag);
        }
        if(view.drawWave) view.drawWave("metronome");
        if(window.Loader) Loader.persist();
        if(window.UI && UI.status) UI.status("Metronome sound: " + (r.instrument || instrument));
      }catch(e){
        console.warn("[mixer] set metronome instrument failed:", e);
        sel.value = prev;   // revert the dropdown on failure
        if(window.UI && UI.status) UI.status("Couldn't change metronome sound: " + e.message);
      }finally{
        sel.disabled = false;
      }
    };
  }
};
