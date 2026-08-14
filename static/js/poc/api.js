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
