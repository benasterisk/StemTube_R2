// api.js — all server calls in one place.
// friend-v2: the mixer is fed by an extraction_id and talks to the /poc-mixer/*
// bridge (routes/poc_mixer.py), which presents friend extractions in the POC
// engine's expected shape. "job" === extraction_id throughout.
const API = {
  // Kick off (or reuse) preparation of the POC artifacts for an extraction.
  async prepare(job){
    return (await fetch("/poc-mixer/prepare/" + encodeURIComponent(job),
      { method: "POST", credentials: "same-origin" })).json();
  },
  async progress(job){
    return (await fetch("/poc-mixer/progress/" + encodeURIComponent(job),
      { credentials: "same-origin" })).json();
  },
  async meta(job){
    return (await fetch("/poc-mixer/meta/" + encodeURIComponent(job),
      { credentials: "same-origin" })).json();
  },
  audioUrl(job, stem){ return `/poc-mixer/audio/${encodeURIComponent(job)}/${stem}`; },
  async audioBuffer(job, stem){
    return (await fetch(this.audioUrl(job, stem), { credentials: "same-origin" })).arrayBuffer();
  },
  async detectIntro(job, body){
    return (await fetch("/poc-mixer/detect_intro/" + encodeURIComponent(job),
      { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(body || {}) })).json();
  },
  // Catalogue of metronome timbres: { instruments:[{id,label}], default }.
  async metroInstruments(){
    return (await fetch("/poc-mixer/metro_instruments",
      { credentials: "same-origin" })).json();
  },
  // Switch the metronome timbre server-side; renders the instrument's WAVs + re-bakes
  // any active count-in. Returns { instrument, metronome_resolutions, precount }.
  async setMetroInstrument(job, instrument){
    return (await fetch("/poc-mixer/set_metro_instrument/" + encodeURIComponent(job),
      { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ instrument }) })).json();
  },
  // MIDI companion tracks. setMidiTrack renders one track again with another mode
  // and/or instrument and returns { name, track, tag }; throws with the server message.
  async setMidiTrack(job, body){
    const r = await fetch("/api/midi/" + encodeURIComponent(job) + "/track",
      { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  },
  async midiTracks(job){
    return (await fetch("/api/midi/" + encodeURIComponent(job) + "/tracks",
      { credentials: "same-origin" })).json();
  },
  // keep=true: measure and render the tracks again but keep their notes, modes and sounds.
  async generateMidi(job, keep){
    return this._post("/api/midi/" + encodeURIComponent(job) + "/generate", { keep: !!keep });
  },
  // Notes a MIDI track currently plays: { mode, drums, rev, notes:[[start,end,pitch,vel]] }.
  async midiNotes(job, name){
    const r = await fetch("/api/midi/" + encodeURIComponent(job) + "/notes/" + encodeURIComponent(name),
      { credentials: "same-origin", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if(!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  },
  // Replace the notes of a MIDI track (editor); the server renders it again.
  async saveMidiNotes(job, name, notes){
    return this._post("/api/midi/" + encodeURIComponent(job) + "/notes", { stem: name, notes });
  },
  // Straighten the song into a copy (regular grid, quantized MIDI, warped audio).
  async retime(job, body){
    return this._post("/api/retime/" + encodeURIComponent(job), body || {});
  },
  async retimeStatus(job){
    return (await fetch("/api/retime/" + encodeURIComponent(job) + "/status",
      { credentials: "same-origin", cache: "no-store" })).json();
  },
  // Pre-mix: the tracks that currently play, cleaned and balanced in a style, as a
  // new song with independent stems. tracks = { name: { muted, solo } }.
  async automixStyles(){
    return (await fetch("/api/automix/styles", { credentials: "same-origin" })).json();
  },
  async premix(job, body){
    return this._post("/api/automix/premix/" + encodeURIComponent(job), body || {});
  },
  async premixStatus(job){
    return (await fetch("/api/automix/premix/" + encodeURIComponent(job) + "/status",
      { credentials: "same-origin", cache: "no-store" })).json();
  },
  async _post(url, body){
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  },
  // Export the current mix server-side. The server renders the file, drops a copy
  // in the user's Downloads folder, and returns {download_url, filename, saved_to}.
  // The caller triggers the actual browser download by navigating to download_url
  // (a real navigation — WebView2 ignores programmatic blob: downloads). Throws an
  // Error carrying the server message on failure.
  async exportMix(job, body){
    const r = await fetch("/poc-mixer/export/" + encodeURIComponent(job),
      { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(body || {}) });
    if(!r.ok){
      let msg = "export failed ("+r.status+")";
      try{ const j = await r.json(); if(j && j.error) msg = j.error; }catch(e){}
      throw new Error(msg);
    }
    const j = await r.json();
    if(j && j.error) throw new Error(j.error);
    return j;   // { download_url, filename, saved_to }
  },
};
