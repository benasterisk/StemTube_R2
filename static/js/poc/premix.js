// premix.js — "Pre-mix" button of the mixer toolbar.
// Once the user has chosen what plays (mute, solo, a MIDI track instead of its audio
// stem), this redoes the mix of exactly those tracks: the server cleans, shapes and
// balances them in a mixing style and writes them as a NEW song with independent
// stems. It is not a stereo bounce and there is no master stage: the copy opens in
// the mixer with every track on its own fader.
const PreMix = {
  engine: null, view: null, _pop: null, _styles: null,

  wire(engine, view){
    this.engine = engine; this.view = view;
    const btn = document.getElementById("premixBtn");
    if(!btn) return;
    btn.disabled = false;
    if(btn._wired) return;
    btn._wired = true;
    btn.onclick = () => (this._pop ? this.close() : this.open(btn));
    document.addEventListener("mousedown", (ev) => {
      if(this._pop && !this._pop.contains(ev.target) && !ev.target.closest("#premixBtn")) this.close();
    });
  },

  close(){ if(this._pop){ this._pop.remove(); this._pop = null; } },

  // What the mixer plays right now, as the server needs it.
  tracks(){
    const out = {};
    Object.values(this.engine.stems).forEach(s => {
      if(s.name !== "metronome") out[s.name] = { muted: !!s.muted, solo: !!s.solo };
    });
    return out;
  },
  // Names of the tracks that sound (same rule as the engine: mute wins, then solo).
  audible(){
    const all = Object.values(this.engine.stems).filter(s => s.name !== "metronome");
    const solo = all.some(s => s.solo && !s.muted);
    return all.filter(s => !s.muted && (!solo || s.solo)).map(s => s.name);
  },

  async open(anchor){
    this.close();
    const pop = document.createElement("div");
    pop.className = "midi-pop midi-menu";
    const playing = this.audible();
    const label = n => /_midi$/.test(n) ? MidiTracks.title(n) + " (MIDI)" : n.replace(/_/g, " ");
    pop.innerHTML = `
      <div class="midi-pop-title">Pre-mix</div>
      <div class="midi-pop-lab">Mixes the tracks that are playing right now again, into a copy of the song
        with independent tracks: cleaning, EQ, balance and placement in the chosen style. No frozen
        stereo mix and no mastering; the original is not modified. A MIDI track that plays together
        with its audio track, or whose instrument you chose, stays a track of its own, named after
        its instrument.</div>
      <div class="midi-pop-lab"><b>${playing.length} track${playing.length > 1 ? "s" : ""}</b>:
        ${playing.length ? playing.map(label).join(", ") : "none (unmute at least one track)"}</div>
      <div class="midi-q">
        <label>Mixing style <select class="premix-style"><option>…</option></select></label>
      </div>
      <button class="midi-pop-gen premix-go" ${playing.length ? "" : "disabled"}>Create the pre-mix</button>
      <span class="midi-pop-status"></span>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)) + "px";
    pop.style.top = Math.max(6, Math.min(window.innerHeight - pop.offsetHeight - 6, r.bottom + 4)) + "px";
    this._pop = pop;
    pop.querySelector(".premix-go").onclick = () => this.run(pop);
    const sel = pop.querySelector(".premix-style");
    try{
      if(!this._styles) this._styles = await API.automixStyles();
      let last = null; try{ last = localStorage.getItem("autoRemixStyle"); }catch(e){}
      const want = (this.view.meta && this.view.meta.mix_style) || last || this._styles.default;
      sel.innerHTML = this._styles.styles.map(s =>
        `<option value="${s.key}" ${s.key === want ? "selected" : ""}>${s.label}</option>`).join("");
    }catch(e){
      pop.querySelector(".midi-pop-status").textContent = "Styles unavailable: " + e.message;
      pop.querySelector(".premix-go").disabled = true;
    }
  },

  async run(pop){
    const job = this.view.meta.job;
    const status = pop.querySelector(".midi-pop-status"), btn = pop.querySelector(".premix-go");
    const style = pop.querySelector(".premix-style").value;
    btn.disabled = true;
    try{ localStorage.setItem("autoRemixStyle", style); }catch(e){}
    try{
      await API.premix(job, { style, tracks: this.tracks() });
      let result = null;
      for(;;){
        await new Promise(res => setTimeout(res, 1500));
        const j = await API.premixStatus(job);
        if(j.state === "running"){ status.textContent = `${Math.round(j.progress || 0)}% — ${j.message || ""}`; continue; }
        if(j.state === "error") throw new Error(j.error || "error");
        result = j.result; break;
      }
      status.innerHTML = "";
      const dropped = Object.entries(result.cleaning || {}).filter(([, c]) => c.state !== "kept")
        .map(([n, c]) => `${n.replace(/_/g, " ")} (${c.state === "empty" ? "empty" : c.state === "bleed" ? "bleed only" : "merged into another track"})`);
      const done = document.createElement("span");
      done.textContent = `Pre-mix created: ${result.title} — ${result.stems.length} tracks` +
        (dropped.length ? `. Left out by the cleaning: ${dropped.join(", ")}` : "") + ". ";
      const go = document.createElement("button");
      go.className = "midi-pop-gen"; go.textContent = "Open the pre-mix";
      go.onclick = () => {
        if(window.Loader) Loader.persist();
        try{
          if(window.parent && window.parent !== window && window.parent.loadExtractionInMixer){
            window.parent.loadExtractionInMixer(result.extraction_id); return;
          }
        }catch(e){}
        location.href = "/mixer?extraction_id=" + encodeURIComponent(result.extraction_id);
      };
      status.appendChild(done); status.appendChild(go);
      if(window.UI && UI.status) UI.status(`Pre-mix created: ${result.title}`);
    }catch(e){
      status.textContent = "Failed: " + e.message;
    }finally{
      btn.disabled = false;
    }
  },
};
window.PreMix = PreMix;
