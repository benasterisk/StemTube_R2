// midi-editor.js — piano-roll editor of one MIDI companion track.
// A panel docked at the bottom of the mixer. It edits the notes the track plays in
// its current mode (normal or simplified): select, move, stretch, draw, delete,
// quantize, velocity, undo. The grid is the song's own beat grid (subdivided), so
// "on the beat" means on the beats the mixer shows. A change is sent to the server
// a moment after the last edit; the server renders the track again and only that
// track's audio is reloaded (see MidiTracks.afterRender).
const MidiEditor = {
  name: null, notes: [], drums: false, rows: [], mode: "normal",
  el: null, cv: null, head: null,
  t0: 0, pps: 140, top: 0,
  RH: 12, KEYW: 58, RULER: 18,
  tool: "select", division: "1/16", snapOn: true, follow: true, lastVel: 96,
  undo: [], _drag: null, _raf: 0, _timer: null, _saving: false, _again: false, _lines: null,

  DRUM_KEYS: [49, 51, 46, 42, 48, 45, 43, 38, 36],
  DRUM_NAMES: { 36: "Kick", 38: "Snare", 42: "Closed hi-hat", 46: "Open hi-hat",
                49: "Crash", 51: "Ride", 43: "Low tom", 45: "Mid tom", 48: "High tom" },
  DIV: { "1/4": 1, "1/8": 2, "1/16": 4, "1/8T": 3, "1/16T": 6 },
  NOTE_NAMES: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],

  get engine(){ return MidiTracks.engine; },
  get view(){ return MidiTracks.view; },

  // ── panel ──
  _ensure(){
    if(this.el) return;
    const el = document.createElement("div");
    el.id = "midiEditor"; el.tabIndex = 0;
    el.innerHTML = `
      <div class="me-bar">
        <b class="me-title"></b>
        <span class="me-sep"></span>
        <button data-tool="select" class="on" title="Select, move, stretch (double-click: add a note)">Select</button>
        <button data-tool="draw" title="Click to add notes">Pencil</button>
        <span class="me-sep"></span>
        <label>Grid
          <select class="me-div">
            <option value="1/4">quarter note</option><option value="1/8">eighth note</option>
            <option value="1/16" selected>sixteenth note</option>
            <option value="1/8T">eighth-note triplet</option><option value="1/16T">sixteenth-note triplet</option>
            <option value="off">free</option>
          </select></label>
        <button class="me-quant" title="Snap the start of the selected notes (or of all of them) to the grid">Quantize</button>
        <label>Velocity <input class="me-vel" type="range" min="1" max="127" value="96"></label>
        <button class="me-del" title="Delete the selection (Del)">Delete</button>
        <button class="me-undo" title="Undo (Ctrl+Z)">Undo</button>
        <span class="me-sep"></span>
        <button class="me-zo" title="Zoom out">−</button><button class="me-zi" title="Zoom in (Ctrl+wheel)">+</button>
        <button class="me-follow on" title="Follow the playhead">Follow</button>
        <button class="me-big" title="Enlarge / shrink the editor">⤢</button>
        <span class="me-status"></span>
        <button class="me-close" title="Close (Esc)">✕</button>
      </div>
      <div class="me-body"><canvas></canvas><div class="me-playhead"></div></div>`;
    document.body.appendChild(el);
    this.el = el; this.cv = el.querySelector("canvas"); this.head = el.querySelector(".me-playhead");
    const q = s => el.querySelector(s);
    el.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => {
      this.tool = b.dataset.tool;
      el.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x === b));
      this.cv.style.cursor = this.tool === "draw" ? "crosshair" : "default";
    });
    q(".me-div").onchange = e => {
      this.snapOn = e.target.value !== "off";
      if(this.snapOn) this.division = e.target.value;
      this._lines = null; this.draw();
    };
    q(".me-quant").onclick = () => this.quantize();
    const vel = q(".me-vel");
    vel.addEventListener("pointerdown", () => { this._velUndo = false; });
    vel.oninput = () => {
      const sel = this.selected(); this.lastVel = +vel.value;
      if(!sel.length) return;
      if(!this._velUndo){ this.pushUndo(); this._velUndo = true; }
      sel.forEach(n => { n.v = +vel.value; });
      this.draw();
    };
    vel.onchange = () => { if(this.selected().length) this.markDirty(); };
    q(".me-del").onclick = () => this.removeSelected();
    q(".me-undo").onclick = () => this.undoLast();
    q(".me-zo").onclick = () => this.zoom(1 / 1.3);
    q(".me-zi").onclick = () => this.zoom(1.3);
    q(".me-follow").onclick = e => { this.follow = !this.follow; e.currentTarget.classList.toggle("on", this.follow); };
    q(".me-big").onclick = () => { el.classList.toggle("big"); this.draw(); };
    q(".me-close").onclick = () => this.close();
    const cv = this.cv;
    cv.addEventListener("mousedown", e => this._down(e));
    cv.addEventListener("mousemove", e => { if(!this._drag) this._hover(e); });
    cv.addEventListener("dblclick", e => this._dbl(e));
    cv.addEventListener("wheel", e => this._wheel(e), { passive: false });
    window.addEventListener("mousemove", e => { if(this._drag) this._move(e); });
    window.addEventListener("mouseup", e => { if(this._drag) this._up(e); });
    window.addEventListener("resize", () => { if(this.name) this.draw(); });
    el.addEventListener("keydown", e => this._key(e));
  },

  async open(name){
    this._ensure();
    if(this.name && this.name !== name) await this.flush();
    this.name = name;
    this.undo = [];
    this.el.style.display = "flex";
    document.body.classList.add("midi-editing");
    await this.reload(true);
    this.el.focus();
    if(!this._raf){ const tick = () => { this._raf = requestAnimationFrame(tick); this._playhead(); }; tick(); }
  },

  // (Re)read the notes of the track: at opening, and after its mode changed.
  async reload(first){
    const name = this.name; if(!name) return;
    const data = MidiTracks.notes[name] && !first ? await MidiTracks.loadNotes(name)
               : (MidiTracks.notes[name] || await MidiTracks.loadNotes(name));
    if(!data || this.name !== name) return;
    this.drums = !!data.drums; this.mode = data.mode;
    this.notes = data.notes.map(n => ({ s: n[0], e: n[1], p: n[2], v: n[3], sel: false }));
    this._lines = null;
    this._rows();
    this.el.querySelector(".me-title").textContent =
      `Notes — ${MidiTracks.title(name)}` + (this.mode === "simple" ? " (simplified)" : "");
    if(first){
      this.pps = Math.max(110, Math.min(400, (this.view.pxPerSec || 80) * 1.6));
      this.t0 = Math.max(0, (this.engine.pos ? this.engine.pos() : 0) - 1);
      // open on the register the track plays in
      const mid = this.notes.length ? this.notes.map(n => this.rowOf(n.p)).sort((a, b) => a - b)[this.notes.length >> 1] : 0;
      this.top = Math.max(0, mid - Math.floor(this._visRows() / 2));
    }
    this.setStatus(`${this.notes.length} notes`);
    this.draw();
  },

  close(){
    if(!this.el) return;
    this.flush();
    this.el.style.display = "none";
    document.body.classList.remove("midi-editing");
    this.name = null;
    if(this._raf){ cancelAnimationFrame(this._raf); this._raf = 0; }
  },

  setStatus(text){ const s = this.el && this.el.querySelector(".me-status"); if(s) s.textContent = text; },

  // ── rows (one per pitch, or per drum piece) ──
  _rows(){
    if(this.drums){
      const used = this.notes.map(n => n.p);
      this.rows = Array.from(new Set(this.DRUM_KEYS.concat(used))).sort((a, b) => b - a);
    } else {
      let lo = 127, hi = 0;
      this.notes.forEach(n => { if(n.p < lo) lo = n.p; if(n.p > hi) hi = n.p; });
      if(lo > hi){ lo = 48; hi = 72; }
      lo = Math.max(0, lo - 12); hi = Math.min(127, hi + 12);
      this.rows = []; for(let p = hi; p >= lo; p--) this.rows.push(p);
    }
  },
  rowOf(p){
    if(!this.drums) return this.rows[0] - p;
    const i = this.rows.indexOf(p); return i < 0 ? 0 : i;
  },
  _visRows(){ return Math.max(1, Math.floor((this.cv.clientHeight - this.RULER) / this.RH)); },
  xOf(t){ return this.KEYW + (t - this.t0) * this.pps; },
  tOf(x){ return this.t0 + (x - this.KEYW) / this.pps; },
  rowAt(y){ return Math.floor((y - this.RULER) / this.RH + this.top); },
  yOf(row){ return this.RULER + (row - this.top) * this.RH; },
  selected(){ return this.notes.filter(n => n.sel); },

  // ── grid: the song's beats, subdivided ──
  lines(){
    if(this._lines) return this._lines;
    const beats = (this.view.meta && this.view.meta.beats) || [];
    const div = this.DIV[this.division] || 4, dur = (this.view.meta && this.view.meta.duration) || 0;
    const out = [];
    if(beats.length < 2){
      for(let t = 0; t <= dur; t += 0.5 / div) out.push(t);
    } else {
      const first = (beats[1] - beats[0]) / div, last = (beats[beats.length - 1] - beats[beats.length - 2]) / div;
      for(let t = beats[0] - first * Math.floor(beats[0] / first); t < beats[0] - 1e-6; t += first) out.push(t);
      for(let i = 0; i < beats.length - 1; i++)
        for(let j = 0; j < div; j++) out.push(beats[i] + (beats[i + 1] - beats[i]) * j / div);
      for(let t = beats[beats.length - 1]; t <= dur; t += last) out.push(t);
    }
    return (this._lines = out);
  },
  _near(t){
    const L = this.lines(); if(!L.length) return 0;
    let a = 0, b = L.length - 1;
    while(b - a > 1){ const m = (a + b) >> 1; if(L[m] <= t) a = m; else b = m; }
    return (t - L[a] <= L[b] - t) ? a : b;
  },
  snap(t, ev){ if(!this.snapOn || (ev && ev.altKey)) return t; return this.lines()[this._near(t)]; },
  stepAt(t){
    const L = this.lines(); if(L.length < 2) return 0.125;
    const i = Math.min(L.length - 2, this._near(t)); return Math.max(0.03, L[i + 1] - L[i]);
  },

  // ── drawing ──
  _css(name, fallback){
    const v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback;
  },
  draw(){
    const cv = this.cv; if(!cv || !this.name) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if(cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)){
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = this._css("--bg", "#15171c"), line = this._css("--line", "#2c313b"),
          text = this._css("--text", "#e7ebf0"), muted = this._css("--muted", "#5a6472"),
          accent = this._css("--accent", "#3ddc84");
    const col = (typeof stemColor === "function") ? stemColor(this.name) : accent;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.rows.length - this._visRows())));
    this.t0 = Math.max(0, this.t0);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const K = this.KEYW, R = this.RULER, RH = this.RH;
    // rows
    const r0 = Math.floor(this.top), r1 = Math.min(this.rows.length, r0 + this._visRows() + 2);
    g.font = "10px system-ui"; g.textBaseline = "middle";
    for(let r = r0; r < r1; r++){
      const y = this.yOf(r), p = this.rows[r];
      const black = !this.drums && [1, 3, 6, 8, 10].includes(p % 12);
      g.fillStyle = black ? "rgba(0,0,0,.22)" : "rgba(255,255,255,.025)";
      g.fillRect(K, y, w - K, RH - 1);
      g.fillStyle = black ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.07)";
      g.fillRect(0, y, K - 1, RH - 1);
      if(this.drums || p % 12 === 0){
        g.fillStyle = text;
        g.fillText(this.drums ? (this.DRUM_NAMES[p] || ("Note " + p)) : ("C" + (Math.floor(p / 12) - 1)), 4, y + RH / 2);
      }
    }
    // grid
    const tA = this.t0, tB = this.tOf(w);
    const beats = (this.view.meta && this.view.meta.beats) || [], pos = (this.view.meta && this.view.meta.positions) || [];
    if(this.snapOn){
      const L = this.lines();
      const stepPx = this.stepAt((tA + tB) / 2) * this.pps;
      if(stepPx >= 5){
        g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1; g.beginPath();
        for(let i = Math.max(0, this._near(tA) - 1); i < L.length && L[i] <= tB; i++){
          const x = Math.round(this.xOf(L[i])) + 0.5; if(x < K) continue;
          g.moveTo(x, R); g.lineTo(x, h);
        }
        g.stroke();
      }
    }
    let bar = 0;
    for(let i = 0; i < beats.length; i++){
      const down = pos[i] === 1; if(down) bar++;
      if(beats[i] < tA) continue; if(beats[i] > tB) break;
      const x = Math.round(this.xOf(beats[i])) + 0.5;
      g.strokeStyle = down ? "rgba(255,255,255,.34)" : "rgba(255,255,255,.13)";
      g.beginPath(); g.moveTo(x, down ? 0 : R); g.lineTo(x, h); g.stroke();
      if(down){ g.fillStyle = muted; g.fillText(String(bar), x + 3, R / 2); }
    }
    // notes
    for(const n of this.notes){
      if(n.e < tA || n.s > tB) continue;
      const r = this.rowOf(n.p); if(r < r0 - 1 || r > r1) continue;
      const x = Math.max(K, this.xOf(n.s)), xe = this.drums ? this.xOf(n.s) + 7 : this.xOf(n.e);
      if(xe <= K) continue;
      const y = this.yOf(r);
      g.globalAlpha = 0.45 + 0.55 * (n.v / 127);
      g.fillStyle = col; g.fillRect(x, y + 1, Math.max(2, xe - x - 1), RH - 3);
      g.globalAlpha = 1;
      if(n.sel){ g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 1.5, Math.max(2, xe - x - 2), RH - 4); }
    }
    // ruler + gutter borders
    g.fillStyle = line; g.fillRect(0, R - 1, w, 1); g.fillRect(K - 1, 0, 1, h);
    // rubber band
    const d = this._drag;
    if(d && d.kind === "band"){
      g.strokeStyle = accent; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    }
  },

  _playhead(){
    if(!this.name || !this.engine) return;
    const pos = this.engine.pos ? this.engine.pos() : 0, w = this.cv.clientWidth;
    let x = this.xOf(pos);
    if(this.follow && this.engine.playing && !this._drag && (x > w * 0.92 || x < this.KEYW)){
      this.t0 = Math.max(0, pos - (w - this.KEYW) * 0.08 / this.pps); this.draw(); x = this.xOf(pos);
    }
    this.head.style.display = (x >= this.KEYW && x <= w) ? "block" : "none";
    this.head.style.left = x + "px";
  },

  zoom(f, x){
    const cx = (x === undefined) ? (this.KEYW + (this.cv.clientWidth - this.KEYW) / 2) : x;
    const t = this.tOf(cx);
    this.pps = Math.max(20, Math.min(1500, this.pps * f));
    this.t0 = Math.max(0, t - (cx - this.KEYW) / this.pps);
    this.draw();
  },

  // ── editing ──
  pushUndo(){
    this.undo.push(JSON.stringify(this.notes.map(n => [n.s, n.e, n.p, n.v])));
    if(this.undo.length > 60) this.undo.shift();
  },
  undoLast(){
    const last = this.undo.pop(); if(!last) return;
    this.notes = JSON.parse(last).map(n => ({ s: n[0], e: n[1], p: n[2], v: n[3], sel: false }));
    this._rowsKeepView(); this.draw(); this.markDirty();
  },
  _rowsKeepView(){
    const p = this.rows[Math.floor(this.top)]; this._rows();
    if(p !== undefined){ const i = this.rows.indexOf(p); if(i >= 0) this.top = i; }
  },
  removeSelected(){
    if(!this.selected().length) return;
    this.pushUndo(); this.notes = this.notes.filter(n => !n.sel); this.draw(); this.markDirty();
  },
  quantize(){
    const L = this.lines(); if(!L.length) return;
    let set = this.selected(); if(!set.length) set = this.notes;
    if(!set.length) return;
    this.pushUndo();
    set.forEach(n => { const t = L[this._near(n.s)], d = t - n.s; n.s = Math.max(0, t); n.e = Math.max(n.s + 0.03, n.e + d); });
    this.draw(); this.markDirty();
    this.setStatus(`${set.length} note${set.length > 1 ? "s" : ""} snapped to the grid`);
  },
  addNote(x, y, ev){
    const r = this.rowAt(y); if(r < 0 || r >= this.rows.length) return null;
    let t = Math.max(0, this.tOf(x));
    if(this.snapOn && !(ev && ev.altKey)){
      const L = this.lines(); let i = this._near(t); if(L[i] > t + 1e-6 && i > 0) i--; t = L[i];
    }
    this.pushUndo();
    this.notes.forEach(n => { n.sel = false; });
    const n = { s: t, e: t + (this.drums ? 0.1 : this.stepAt(t)), p: this.rows[r], v: this.lastVel, sel: true };
    this.notes.push(n);
    this.beep(n.p);
    return n;
  },
  hit(x, y){
    const r = this.rowAt(y);
    for(let i = this.notes.length - 1; i >= 0; i--){
      const n = this.notes[i]; if(this.rowOf(n.p) !== r) continue;
      const x0 = this.xOf(n.s), x1 = this.drums ? x0 + 8 : this.xOf(n.e);
      if(x >= x0 - 1 && x <= x1 + 1)
        return { n, edge: (!this.drums && x > x1 - 6 && x1 - x0 > 10) ? "end" : "body" };
    }
    return null;
  },
  _xy(e){ const b = this.cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; },

  _hover(e){
    const [x, y] = this._xy(e);
    if(y < this.RULER || x < this.KEYW){ this.cv.style.cursor = "pointer"; return; }
    const h = this.hit(x, y);
    this.cv.style.cursor = h ? (h.edge === "end" ? "ew-resize" : "move") : (this.tool === "draw" ? "crosshair" : "default");
  },

  _down(e){
    if(e.button !== 0) return;
    this.el.focus();
    const [x, y] = this._xy(e);
    if(y < this.RULER){
      if(x >= this.KEYW && this.engine.seek){ this.engine.seek(Math.max(0, this.tOf(x))); if(this.view.drawPlayheads) this.view.drawPlayheads(); if(window.UI && UI.updateTime) UI.updateTime(); }
      return;
    }
    if(x < this.KEYW){ const r = this.rowAt(y); if(r >= 0 && r < this.rows.length) this.beep(this.rows[r]); return; }
    let h = this.hit(x, y);
    if(!h && this.tool === "draw"){
      const n = this.addNote(x, y, e);
      if(!n) return;
      this._drag = { kind: "resize", grab: n, t: n.e, row: this.rowAt(y), changed: true, undone: true,
                     orig: [{ n, s: n.s, e: n.e, p: n.p }] };
      this.draw(); return;
    }
    if(h){
      if(e.shiftKey) h.n.sel = !h.n.sel;
      else if(!h.n.sel){ this.notes.forEach(n => { n.sel = false; }); h.n.sel = true; }
      const vel = this.el.querySelector(".me-vel"); vel.value = h.n.v; this.lastVel = h.n.v;
      this._drag = { kind: h.edge === "end" ? "resize" : "move", grab: h.n, t: this.tOf(x), row: this.rowAt(y),
                     changed: false, undone: false,
                     orig: this.selected().map(n => ({ n, s: n.s, e: n.e, p: n.p })) };
      this.beep(h.n.p);
    } else {
      if(!e.shiftKey) this.notes.forEach(n => { n.sel = false; });
      this._drag = { kind: "band", x0: x, y0: y, x1: x, y1: y, keep: this.selected() };
    }
    this.draw();
    e.preventDefault();
  },

  _move(e){
    const d = this._drag, [x, y] = this._xy(e);
    if(d.kind === "band"){
      d.x1 = x; d.y1 = y;
      const ta = this.tOf(Math.min(d.x0, x)), tb = this.tOf(Math.max(d.x0, x));
      const ra = this.rowAt(Math.min(d.y0, y)), rb = this.rowAt(Math.max(d.y0, y));
      this.notes.forEach(n => {
        const r = this.rowOf(n.p);
        n.sel = d.keep.includes(n) || (n.e >= ta && n.s <= tb && r >= ra && r <= rb);
      });
      this.draw(); return;
    }
    const g = d.orig.find(o => o.n === d.grab) || d.orig[0];
    const dt = this.tOf(x) - d.t;
    const touch = () => { if(!d.undone){ this._restore(d); this.pushUndo(); d.undone = true; } d.changed = true; };
    if(d.kind === "move"){
      const ds = Math.max(-Math.min(...d.orig.map(o => o.s)), this.snap(g.s + dt, e) - g.s);
      let dr = this.rowAt(y) - d.row;
      const rows = d.orig.map(o => this.rowOf(o.p));
      dr = Math.max(-Math.min(...rows), Math.min(this.rows.length - 1 - Math.max(...rows), dr));
      if(Math.abs(ds) < 1e-6 && dr === 0 && !d.changed) return;
      touch();
      const before = d.grab.p;
      d.orig.forEach(o => { o.n.s = o.s + ds; o.n.e = o.e + ds; o.n.p = this.rows[this.rowOf(o.p) + dr]; });
      if(d.grab.p !== before) this.beep(d.grab.p);
    } else {
      const de = this.snap(g.e + dt, e) - g.e;
      if(Math.abs(de) < 1e-6 && !d.changed) return;
      touch();
      d.orig.forEach(o => { o.n.e = Math.max(o.s + 0.03, o.e + de); });
    }
    this.draw();
  },
  // put the dragged notes back where the drag started (so the undo snapshot is the state before it)
  _restore(d){ d.orig.forEach(o => { o.n.s = o.s; o.n.e = o.e; o.n.p = o.p; }); },

  _up(){
    const d = this._drag; this._drag = null;
    if(d.kind !== "band" && d.changed){
      this.notes.sort((a, b) => a.s - b.s);
      this.markDirty();
    }
    const sel = this.selected().length;
    if(d.kind === "band" && sel) this.setStatus(`${sel} note${sel > 1 ? "s" : ""} selected`);
    this.draw();
  },

  _dbl(e){
    const [x, y] = this._xy(e);
    if(y < this.RULER || x < this.KEYW || this.tool === "draw" || this.hit(x, y)) return;
    if(this.addNote(x, y, e)){ this.notes.sort((a, b) => a.s - b.s); this.draw(); this.markDirty(); }
  },

  _wheel(e){
    e.preventDefault();
    const [x] = this._xy(e);
    if(e.ctrlKey || e.metaKey) this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, x);
    else if(e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)){
      this.t0 = Math.max(0, this.t0 + (e.deltaX || e.deltaY) / this.pps); this.draw();
    } else { this.top += e.deltaY / this.RH / 2; this.draw(); }
  },

  _key(e){
    if(e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.key !== "Escape") return;
    const sel = this.selected(), ctrl = e.ctrlKey || e.metaKey;
    let used = true;
    if(e.key === "Escape") this.close();
    else if(e.key === "Delete" || e.key === "Backspace") this.removeSelected();
    else if(ctrl && e.key.toLowerCase() === "z") this.undoLast();
    else if(ctrl && e.key.toLowerCase() === "a"){ this.notes.forEach(n => { n.sel = true; }); this.draw(); }
    else if(e.key === " "){ const b = document.getElementById("playBtn"); if(b && !b.disabled) b.click(); }
    else if((e.key === "ArrowUp" || e.key === "ArrowDown") && sel.length){
      const dr = (e.key === "ArrowUp" ? -1 : 1) * (e.shiftKey && !this.drums ? 12 : 1);
      const rows = sel.map(n => this.rowOf(n.p));
      if(Math.min(...rows) + dr >= 0 && Math.max(...rows) + dr < this.rows.length){
        this.pushUndo(); sel.forEach(n => { n.p = this.rows[this.rowOf(n.p) + dr]; });
        this.beep(sel[0].p); this.draw(); this.markDirty();
      }
    }
    else if((e.key === "ArrowLeft" || e.key === "ArrowRight") && sel.length){
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      this.pushUndo();
      sel.forEach(n => { const d = dir * (this.snapOn ? this.stepAt(n.s) : 0.01); const s = Math.max(0, n.s + d); n.e += s - n.s; n.s = s; });
      this.notes.sort((a, b) => a.s - b.s); this.draw(); this.markDirty();
    }
    else used = false;
    if(used){ e.preventDefault(); e.stopPropagation(); }
  },

  // A short tone so a note can be placed by ear (only once the audio context runs).
  beep(p){
    const ctx = this.engine && this.engine.ctx; if(!ctx || ctx.state !== "running") return;
    try{
      const t = ctx.currentTime, gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (this.drums ? 0.07 : 0.22));
      const osc = ctx.createOscillator();
      osc.type = this.drums ? "square" : "triangle";
      osc.frequency.value = this.drums ? (p <= 36 ? 70 : p <= 40 ? 190 : p <= 48 ? 130 : 900) : 440 * Math.pow(2, (p - 69) / 12);
      osc.connect(gain); osc.start(t); osc.stop(t + 0.25);
    }catch(e){}
  },

  // ── saving: a moment after the last edit ──
  markDirty(){
    this.setStatus("Edited…");
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 1100);
    this._dirty = true;
  },
  async flush(){
    clearTimeout(this._timer);
    if(!this._dirty || !this.name) return;
    if(this._saving){ this._again = true; return; }
    this._saving = true; this._dirty = false;
    const name = this.name, job = MidiTracks.job();
    const payload = this.notes.map(n => [Math.round(n.s * 1e4) / 1e4, Math.round(n.e * 1e4) / 1e4, n.p, n.v]);
    this.setStatus("Rendering…");
    try{
      const r = await API.saveMidiNotes(job, name, payload);
      await MidiTracks.afterRender(name, r, payload);
      if(this.name === name && !this._dirty) this.setStatus(`Up to date · ${payload.length} notes`);
    }catch(e){
      console.warn("[midi-editor] save failed:", e);
      if(this.name === name) this.setStatus("Saving failed: " + e.message);
    }finally{
      this._saving = false;
      if(this._again || this._dirty){ this._again = false; this._dirty = true; this.flush(); }
    }
  },
};
window.MidiEditor = MidiEditor;
