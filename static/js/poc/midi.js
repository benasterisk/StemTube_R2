// midi.js — MIDI companion tracks ("<stem>_midi") in the mixer.
// Each one is an audio file the server renders from the notes of its stem. Here:
//  - the lane of a MIDI track shows its notes (piano roll) instead of a waveform;
//  - the ♪ button of a track opens a popover: mode (Normal / Simplified, for the stems
//    that play chords or arpeggios), instrument, note editor (midi-editor.js);
//  - the ⇄ button plays the MIDI track INSTEAD of its audio stem (and back);
//  - the ♪ button of the toolbar holds the presets (which tracks play as audio, which
//    as MIDI), the song's .mid file, the (re)creation of the tracks and the quantize
//    of the whole song into a straightened copy.
const MidiTracks = {
  engine: null, view: null, _pop: null, _menu: null,
  notes: {},            // "<stem>_midi" -> { mode, drums, rev, notes:[[start,end,pitch,vel]] }
  _asked: {},
  VOCALS: ["vocals", "backing_vocals"],
  DRUMS: ["drums", "kick", "snare", "toms", "cymbals", "hihat"],
  BLEED_LIMIT: 0.25,    // share of a stem that is bleed above which its MIDI replaces it

  PRESETS: [
    { id: "audio", label: "Audio only", hint: "Every audio track, MIDI tracks muted" },
    { id: "midi_voice", label: "MIDI + vocals", hint: "The instruments played as MIDI, the real vocals" },
    { id: "midi_drums", label: "MIDI drums + audio", hint: "The drums played as MIDI, everything else as audio" },
    { id: "repair", label: "Vocals + MIDI on the damaged tracks",
      hint: "Replaces the tracks that are full of bleed with their MIDI, keeps the others as audio" },
    { id: "double", label: "Audio + MIDI (doubling)", hint: "Every audio track doubled by its MIDI track" },
  ],

  isMidi(name){ return /_midi$/.test(name || ""); },
  parent(name){ return String(name || "").replace(/_midi$/, ""); },
  // What the track is called: its instrument once the user chose it, else the stem it doubles.
  title(name){ const i = this.info(name); return (i && i.title) || this.parent(name).replace(/_/g, " "); },
  // Put the current name of a track on its row (after a change of instrument).
  renameRow(name){
    const el = document.querySelector(`#left-tracks .midi-name[data-midi-name="${name}"]`);
    if(!el) return;
    const info = this.info(name);
    el.textContent = (info && info.title) || this.parent(name);
    el.title = `${this.title(name)} — MIDI track of ${this.parent(name)}`;
  },
  info(name){ const m = this.view && this.view.meta && this.view.meta.midi; return m ? m[name] : null; },
  job(){ return this.view && this.view.meta && this.view.meta.job; },
  names(){ const m = this.view && this.view.meta && this.view.meta.midi; return m ? Object.keys(m) : []; },
  status(text){ if(window.UI && UI.status) UI.status(text); },

  // Called at the end of Mixer.build().
  wire(engine, view){
    this.engine = engine; this.view = view;
    document.querySelectorAll("#left-tracks .midi-set").forEach(btn => {
      btn.onclick = (ev) => { ev.stopPropagation(); this.open(btn.dataset.midi, btn); };
    });
    document.querySelectorAll("#left-tracks .midi-swap").forEach(btn => {
      btn.onclick = (ev) => { ev.stopPropagation(); this.swap(btn.dataset.midi); };
    });
    this.names().forEach(name => {
      const cv = view.canvases[name];
      if(cv && !cv._midiDbl){
        cv._midiDbl = true;
        cv.addEventListener("dblclick", () => { if(window.MidiEditor) MidiEditor.open(name); });
        cv.title = "Double-click: edit the notes";
      }
    });
    this._wireToolbar();
    this.refreshSwapButtons();
    if(this._job !== this.job()){ this._job = this.job(); this.notes = {}; this._asked = {}; }
    // Mixer.build() runs more than once per load: ask for the notes of a track only once
    this.names().forEach(name => { if(!this._asked[name]){ this._asked[name] = true; this.loadNotes(name); } });
    if(!this._outside){
      this._outside = (ev) => {
        if(this._pop && !this._pop.contains(ev.target) && !ev.target.closest(".midi-set")) this.close();
        if(this._menu && !this._menu.contains(ev.target) && !ev.target.closest("#midiBtn")) this._closeMenu();
      };
      document.addEventListener("mousedown", this._outside);
      // mute buttons change what "replaced by MIDI" means: keep the ⇄ buttons honest
      document.addEventListener("click", (ev) => {
        if(ev.target.closest && ev.target.closest("#left-tracks button[data-act]")) this.refreshSwapButtons();
      });
    }
  },

  // ── notes (for the lanes and the editor) ──
  async loadNotes(name){
    const job = this.job();
    try{
      const r = await API.midiNotes(job, name);
      if(job !== this.job()) return null;
      this.notes[name] = r;
      if(this.view.drawWave) this.view.drawWave(name);
      return r;
    }catch(e){ console.warn("[midi] notes not loaded for", name, e); return null; }
  },

  // Draw the notes of a MIDI track in its lane. Returns false when they are not
  // loaded yet (the caller then draws the waveform as for any stem).
  drawLane(view, name, c){
    const data = this.notes[name];
    if(!data || !data.notes) return false;
    const w = view.visW(), h = view.laneH(name); view.sizeCanvas(c, w, h);
    const sx = view.scrollX();
    c.style.left = sx + "px";
    const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
    const notes = data.notes;
    let rowOf, rows;
    if(data.drums){
      const keys = Array.from(new Set(notes.map(n => n[2]))).sort((a, b) => b - a);
      rows = Math.max(1, keys.length);
      const idx = {}; keys.forEach((k, i) => { idx[k] = i; });
      rowOf = p => idx[p] || 0;
    } else {
      let lo = 127, hi = 0;
      for(const n of notes){ if(n[2] < lo) lo = n[2]; if(n[2] > hi) hi = n[2]; }
      if(lo > hi){ lo = 48; hi = 72; }
      lo -= 1; hi += 1;
      rows = hi - lo + 1;
      rowOf = p => hi - p;
    }
    const rh = (h - 6) / rows, bar = Math.max(2, Math.min(9, rh - 1));
    const t0 = (sx / view.pxPerSec) - (view.leadPad || 0), t1 = t0 + w / view.pxPerSec;
    g.fillStyle = stemColor(name);
    for(const n of notes){
      if(n[1] < t0) continue;
      if(n[0] > t1) break;
      const x = view.timeToX(n[0]) - sx;
      const len = Math.max(2, (data.drums ? 0.04 : (n[1] - n[0])) * view.pxPerSec - 1);
      g.globalAlpha = 0.4 + 0.6 * (n[3] / 127);
      g.fillRect(x, 3 + rowOf(n[2]) * rh + (rh - bar) / 2, len, bar);
    }
    g.globalAlpha = 1;
    const beats = view.meta.beats || [], pos = view.meta.positions || [];
    for(let i = 0; i < beats.length; i++){
      const x = view.timeToX(beats[i]) - sx;
      if(x < 0) continue; if(x > w) break;
      const down = pos[i] === 1;
      g.strokeStyle = down ? "rgba(255,255,255,.45)" : "rgba(255,255,255,.10)";
      g.lineWidth = down ? 1.5 : 1;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    return true;
  },

  // After the server rendered a track again (settings or notes changed).
  async afterRender(name, r, notes){
    const job = this.job();
    if(this.view.meta && this.view.meta.midi) this.view.meta.midi[name] = r.track;
    this.renameRow(name);
    if(notes) this.notes[name] = Object.assign({}, this.notes[name] || {}, { notes, rev: r.track.rev, mode: r.track.mode });
    await this.engine.reloadStem(job, name, r.tag);
    if(!notes) await this.loadNotes(name);
    else if(this.view.drawWave) this.view.drawWave(name);
  },

  // ── MIDI instead of audio, track by track ──
  isSwapped(name){
    const a = this.engine.stems[this.parent(name)], m = this.engine.stems[name];
    return !!(a && m && a.muted && !m.muted);
  },
  swap(name){
    const a = this.engine.stems[this.parent(name)], m = this.engine.stems[name];
    if(!a || !m) return;
    const on = !this.isSwapped(name);
    this.engine.setMute(a.name, on);
    this.engine.setMute(name, !on);
    this._synced();
    this.status(on ? `${this.parent(name)}: the MIDI track replaces the audio` : `${this.parent(name)}: back to the audio`);
  },
  refreshSwapButtons(){
    document.querySelectorAll("#left-tracks .midi-swap").forEach(b =>
      b.classList.toggle("on", this.isSwapped(b.dataset.midi)));
  },
  _synced(){
    // SessionState is a top-level const of state.js: visible here, but not a window property
    if(typeof SessionState !== "undefined") SessionState.syncControls(this.view, this.engine);
    this.refreshSwapButtons();
    if(window.Loader) Loader.persist();
  },

  // ── presets: which tracks play as audio, which as MIDI ──
  applyPreset(id){
    const stems = this.engine.stems, midi = this.view.meta.midi || {};
    const audio = Object.keys(this.view.meta.stems || {}).filter(n => n !== "metronome" && !this.isMidi(n) && stems[n]);
    const hasMidi = n => !!(midi[n + "_midi"] && stems[n + "_midi"]);
    const kitInMidi = this.DRUMS.some(hasMidi);
    let replaced = 0;
    const set = (n, asMidi, mute) => {
      stems[n].muted = !!mute || asMidi; stems[n].solo = false;
      if(hasMidi(n)){ stems[n + "_midi"].muted = !asMidi; stems[n + "_midi"].solo = false; if(asMidi) replaced++; }
    };
    audio.forEach(n => {
      const vocal = this.VOCALS.includes(n), drum = this.DRUMS.includes(n);
      if(id === "audio") set(n, false);
      else if(id === "double"){ set(n, false); if(hasMidi(n)) stems[n + "_midi"].muted = false; }
      else if(id === "midi_voice"){
        if(vocal) set(n, false); else set(n, hasMidi(n), !hasMidi(n));
      }
      else if(id === "midi_drums"){
        // a kit stem without MIDI next to pieces that have one is what is left of the kit: off too
        if(drum) set(n, hasMidi(n), kitInMidi && !hasMidi(n)); else set(n, false);
      }
      else if(id === "repair"){
        const rough = hasMidi(n) && !vocal && (midi[n + "_midi"].bleed || 0) >= this.BLEED_LIMIT;
        set(n, rough);
      }
    });
    this.engine.applyGains();
    this._synced();
    const p = this.PRESETS.find(x => x.id === id);
    if(id === "repair" && !replaced)
      this.status("No track is above the measured bleed threshold: use ⇄ on the track to replace.");
    else this.status(`Preset “${p ? p.label : id}” applied` + (replaced ? ` (${replaced} track${replaced > 1 ? "s" : ""} as MIDI)` : ""));
  },

  // ── per-track popover ──
  close(){ if(this._pop){ this._pop.remove(); this._pop = null; } },

  open(name, anchor){
    this.close();
    const info = this.info(name);
    if(!info) return;
    const pop = document.createElement("div");
    pop.className = "midi-pop";
    const modes = (info.modes || []).length > 1 ? `
      <div class="midi-pop-lab">Mode</div>
      <div class="midi-pop-modes">
        <button data-mode="normal" title="Every note that is played">Normal</button>
        <button data-mode="simple" title="Block chords, one per chord change and per bar">Simplified</button>
      </div>` : "";
    const opt = (it) => `<option value="${it.id}">${it.label}</option>`;
    const rec = (info.options && info.options.recommended) || [];
    const groups = (info.options && info.options.groups) || [];
    const bleed = Math.round((info.bleed || 0) * 100);
    pop.innerHTML = `
      <div class="midi-pop-title">MIDI track — ${this.parent(name).replace(/_/g, " ")}</div>
      ${info.named ? `<div class="midi-pop-lab">Named after its instrument: ${info.title}</div>` : ""}
      <div class="midi-pop-lab">${info.notes} notes${bleed >= 10 ? ` · audio track: ${bleed}% bleed` : ""}</div>
      ${modes}
      <div class="midi-pop-lab">Instrument</div>
      <select class="midi-pop-inst">
        ${rec.length ? `<optgroup label="Recommended for this track">${rec.map(opt).join("")}</optgroup>` : ""}
        ${groups.map(g => `<optgroup label="${g.label}">${g.items.map(opt).join("")}</optgroup>`).join("")}
      </select>
      <div class="midi-pop-row">
        <button class="midi-pop-edit" title="Open the piano roll: move, add, delete, quantize notes">Edit the notes</button>
        <button class="midi-pop-swap" title="Play this MIDI track instead of the audio track (and back)">⇄ Instead of the audio</button>
      </div>
      <div class="midi-pop-foot">
        <a class="midi-pop-dl" href="#" download>Download the .mid</a>
        <span class="midi-pop-status"></span>
      </div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)) + "px";
    pop.style.top = Math.max(6, Math.min(window.innerHeight - pop.offsetHeight - 6, r.bottom + 4)) + "px";
    this._pop = pop;
    this._reflect(name);
    const sel = pop.querySelector(".midi-pop-inst");
    sel.onchange = () => this.apply(name, { instrument: sel.value });
    pop.querySelectorAll(".midi-pop-modes button").forEach(b => {
      b.onclick = () => { if(!b.classList.contains("on")) this.apply(name, { mode: b.dataset.mode }); };
    });
    pop.querySelector(".midi-pop-edit").onclick = () => { this.close(); if(window.MidiEditor) MidiEditor.open(name); };
    pop.querySelector(".midi-pop-swap").onclick = () => { this.swap(name); this._reflect(name); };
  },

  // Show the current settings of the track in the open popover.
  _reflect(name){
    const info = this.info(name), pop = this._pop;
    if(!info || !pop) return;
    const sel = pop.querySelector(".midi-pop-inst");
    // the same instrument can sit in "recommended" and in its group: pick the first
    const first = Array.from(sel.options).find(o => o.value === info.instrument);
    if(first) first.selected = true;
    pop.querySelectorAll(".midi-pop-modes button").forEach(b =>
      b.classList.toggle("on", b.dataset.mode === info.mode));
    pop.querySelector(".midi-pop-swap").classList.toggle("on", this.isSwapped(name));
    const dl = pop.querySelector(".midi-pop-dl");
    if(dl) dl.href = `/api/midi/${encodeURIComponent(this.job())}/file/${info.stem}${info.mode === "simple" ? ".simple" : ""}.mid`;
  },

  async apply(name, change){
    const pop = this._pop, job = this.job();
    const status = pop && pop.querySelector(".midi-pop-status");
    const controls = pop ? pop.querySelectorAll("select,button") : [];
    controls.forEach(c => c.disabled = true);
    if(status) status.textContent = "Rendering…";
    try{
      const r = await API.setMidiTrack(job, Object.assign({ stem: name }, change));
      await this.afterRender(name, r);
      if(window.MidiEditor && MidiEditor.name === name) MidiEditor.reload();
      this.status(`MIDI track ${this.parent(name)}: ${r.track.instrument_label}` +
        (r.track.mode === "simple" ? " (simplified)" : ""));
      if(status) status.textContent = "";
    }catch(e){
      console.warn("[midi] change failed:", e);
      if(status) status.textContent = "Failed: " + e.message;
    }finally{
      controls.forEach(c => c.disabled = false);
      this._reflect(name);
    }
  },

  // ── toolbar ♪ button: presets, song .mid, (re)generation, quantize ──
  _wireToolbar(){
    const btn = document.getElementById("midiBtn");
    if(!btn || btn._wired) return;
    btn._wired = true;
    btn.disabled = false;
    btn.onclick = () => (this._menu ? this._closeMenu() : this._openMenu(btn));
  },

  _closeMenu(){ if(this._menu){ this._menu.remove(); this._menu = null; } },

  _openMenu(anchor){
    const has = this.names().length > 0;
    const menu = document.createElement("div");
    menu.className = "midi-pop midi-menu";
    const presets = has ? `
      <div class="midi-pop-lab">Presets — which tracks play as audio, which as MIDI</div>
      <div class="midi-presets">
        ${this.PRESETS.map(p => `<button data-preset="${p.id}" title="${p.hint}">${p.label}</button>`).join("")}
      </div>
      <div class="midi-pop-sep"></div>` : `<div class="midi-pop-lab">This song has no MIDI tracks yet.</div>`;
    menu.innerHTML = `
      <div class="midi-pop-title">MIDI tracks</div>
      ${presets}
      ${has ? `<a class="midi-pop-dl" href="/api/midi/${encodeURIComponent(this.job())}/file/song.mid" download>Download the MIDI of the song</a>` : ""}
      <button class="midi-pop-gen">${has ? "Rebuild the MIDI tracks" : "Create the MIDI tracks"}</button>
      <div class="midi-pop-sep"></div>
      <div class="midi-pop-lab">Quantize the song: creates a “Retimed” copy on a regular grid.
        The MIDI notes are snapped to the grid and every audio track (the vocals too) is
        stretched to follow.</div>
      <div class="midi-q">
        <label>Note grid
          <select class="midi-q-div">
            <option value="1/4">quarter note</option><option value="1/8">eighth note</option>
            <option value="1/16" selected>sixteenth note</option>
            <option value="1/8T">eighth-note triplet</option><option value="1/16T">sixteenth-note triplet</option>
          </select></label>
        <label>Audio
          <select class="midi-q-follow">
            <option value="beat" selected>every beat on the grid</option>
            <option value="bar">tempo only (keeps the groove)</option>
          </select></label>
        <label>Strength
          <select class="midi-q-strength">
            <option value="1" selected>100%</option><option value="0.75">75%</option><option value="0.5">50%</option>
          </select></label>
      </div>
      <button class="midi-pop-gen midi-q-go">Quantize (retimed copy)</button>
      <span class="midi-pop-status"></span>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, r.left)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - menu.offsetHeight - 6, r.bottom + 4)) + "px";
    this._menu = menu;
    menu.querySelectorAll("[data-preset]").forEach(b => { b.onclick = () => this.applyPreset(b.dataset.preset); });
    menu.querySelector(".midi-pop-gen:not(.midi-q-go)").onclick = () => this._generate(menu);
    menu.querySelector(".midi-q-go").onclick = () => this._retime(menu);
  },

  async _generate(menu){
    const job = this.job();
    const status = menu.querySelector(".midi-pop-status");
    const btn = menu.querySelector(".midi-pop-gen:not(.midi-q-go)");
    const edited = this.names().some(n => ((this.info(n) || {}).edited || []).length);
    let keep = false;
    if(edited) keep = window.confirm("Some tracks have notes that were edited by hand.\n\n" +
      "OK: keep your notes, modes and sounds (only the levels and the render are redone).\n" +
      "Cancel: transcribe everything again from the audio (your edits are lost).");
    btn.disabled = true;
    try{
      await API.generateMidi(job, keep);
      // poll until the server is done, then reload the mixer to show the tracks
      for(;;){
        await new Promise(res => setTimeout(res, 1500));
        const s = await API.midiTracks(job);
        const j = (s && s.job) || {};
        if(j.state === "running"){ status.textContent = `Transcribing… ${j.progress || 0}% ${j.message || ""}`; continue; }
        if(j.state === "error") throw new Error(j.error || "error");
        break;
      }
      status.textContent = "Done, reloading…";
      if(window.Loader) Loader.persist();
      location.reload();
    }catch(e){
      status.textContent = "Failed: " + e.message;
      btn.disabled = false;
    }
  },

  async _retime(menu){
    const job = this.job();
    const status = menu.querySelector(".midi-pop-status");
    const btn = menu.querySelector(".midi-q-go");
    btn.disabled = true;
    try{
      await API.retime(job, {
        division: menu.querySelector(".midi-q-div").value,
        follow: menu.querySelector(".midi-q-follow").value,
        strength: parseFloat(menu.querySelector(".midi-q-strength").value),
      });
      let result = null;
      for(;;){
        await new Promise(res => setTimeout(res, 1500));
        const j = await API.retimeStatus(job);
        if(j.state === "running"){ status.textContent = `${Math.round(j.progress || 0)}% — ${j.message || ""}`; continue; }
        if(j.state === "error") throw new Error(j.error || "error");
        result = j.result; break;
      }
      status.innerHTML = "";
      const done = document.createElement("span");
      done.textContent = `Copy created: ${result.title} (${result.bpm} BPM, drift corrected ±${Math.round(result.drift_ms)} ms). `;
      const go = document.createElement("button");
      go.className = "midi-pop-gen"; go.textContent = "Open the copy";
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
      this.status(`Song retimed: ${result.title}`);
    }catch(e){
      status.textContent = "Failed: " + e.message;
    }finally{
      btn.disabled = false;
    }
  },
};
window.MidiTracks = MidiTracks;
