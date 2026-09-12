// scrub.js — drag the playhead along the timeline and hear the audio follow.
//
// Dragging the ruler moves the playhead AND plays a short slice of the mix at
// each new position, so you can hunt for a spot by ear — the "scratch" feel of
// a DAW. The engine's own transport is left alone: nothing is started, stopped
// or seeked mid-drag except the playhead itself, and a single seek lands the
// real transport when the drag ends.
//
// Why not reuse the engine's playing sources: they run through the SoundTouch
// worklet (time-stretch / pitch-shift), which is the wrong tool for 150 ms
// bursts — restarting it per slice would crackle and drift. Each slice gets a
// throwaway BufferSource straight into the master gain instead: cheap, precise,
// and it stops cleanly. This mirrors the approach of the older
// static/js/mixer/audio-engine.js scratchAt(), which the POC engine dropped.
const Scrub = {
  engine: null,
  view: null,

  // ── tuning ───────────────────────────────────────────────────────────────
  SLICE_SEC: 0.14,     // length of each audible slice
  THROTTLE_MS: 55,     // min gap between slices — below this it turns to mush
  FADE_SEC: 0.008,     // tiny in/out ramp; without it every slice clicks

  _lastPlay: 0,
  _live: [],           // slices currently sounding, so a drag end can cut them

  init(engine, view) {
    this.engine = engine;
    this.view = view;
  },

  /**
   * Move the playhead to `t` and play a slice there.
   * Call this on every mousemove of a timeline drag.
   */
  at(t) {
    if (!this.engine) return;
    const dur = (this.view && this.view.meta) ? this.view.meta.duration : 0;
    const pos = Math.max(0, Math.min(t, dur || t));

    // The playhead should track the pointer smoothly, so move it every time…
    this.engine._scrubbing = true;   // silence jam/recording side-effects mid-drag
    try {
      this.engine.seek(pos);
      if (this.view && this.view.drawPlayheads) this.view.drawPlayheads();
    } catch (e) { /* engine not ready */ }

    // …but only make sound at a sane rate.
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - this._lastPlay < this.THROTTLE_MS) return;
    this._lastPlay = now;
    this._playSlice(pos);
  },

  /** Silence anything still ringing (call when the drag ends). */
  stop() {
    const eng = this.engine;
    if (eng && eng._scrubbing) {
      eng._scrubbing = false;
      // one final seek at the drop point: this is the call jam guests and the
      // recording engine actually need to hear about.
      try { eng.seek(eng.pos()); } catch (err) { /* engine not ready */ }
    }
    for (const node of this._live) {
      try { node.stop(); } catch (e) { /* already finished */ }
    }
    this._live = [];
  },

  // ── internals ────────────────────────────────────────────────────────────

  _playSlice(pos) {
    const eng = this.engine;
    const ctx = eng && eng.ctx;
    if (!ctx || ctx.state === 'closed') return;
    // Never scrub over the top of real playback — the two would fight.
    if (eng.playing) return;

    const stems = eng.stems || {};
    // Respect solo/mute exactly like normal playback, otherwise scrubbing would
    // reveal tracks the user has silenced.
    const names = Object.keys(stems).filter((n) => n !== 'metronome');
    const soloed = names.filter((n) => stems[n].solo);
    const audible = (soloed.length ? soloed : names).filter((n) => !stems[n].muted);
    if (!audible.length) return;

    const out = (typeof eng._out === 'function') ? eng._out() : ctx.destination;
    const t0 = ctx.currentTime;
    const len = this.SLICE_SEC;
    const fade = this.FADE_SEC;

    for (const name of audible) {
      const s = stems[name];
      const buf = s && s.buffer;
      if (!buf) continue;
      if (pos >= buf.duration) continue;

      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const g = ctx.createGain();
        // Level per track, scaled down: several stems summing at full volume
        // would clip on every slice.
        const vol = (typeof s.vol === 'number' ? s.vol : 1) * 0.8;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + fade);
        g.gain.setValueAtTime(vol, t0 + len - fade);
        g.gain.linearRampToValueAtTime(0, t0 + len);

        src.connect(g);
        g.connect(out);
        src.start(t0, pos, len);

        this._live.push(src);
        src.onended = () => {
          const i = this._live.indexOf(src);
          if (i >= 0) this._live.splice(i, 1);
          try { g.disconnect(); } catch (e) { /* already gone */ }
        };
      } catch (e) {
        // A single bad stem must not abort the whole slice.
        console.warn('[Scrub] slice failed for', name, e);
      }
    }
  },
};

window.Scrub = Scrub;
