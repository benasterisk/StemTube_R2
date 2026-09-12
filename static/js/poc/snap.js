// snap.js — one snap-to-beat setting shared by every surface.
//
// Loop bounds (dragged on a waveform OR on the timeline) and the Start/Stop
// markers all used to snap to the nearest detected beat, each with its own copy
// of the same loop. That meant no single place to turn snapping off, and the
// only escape was holding a modifier for one drag at a time.
//
// This module owns the setting and the maths. Callers ask Snap.toBeat(t, view)
// and honour Snap.enabled; a per-drag modifier key still overrides it locally,
// so the familiar Alt-to-ignore-the-grid gesture keeps working.
//
// Beats come from madmom (see core/poc/beats.py), so the grid follows the real
// performance — including tempo drift — rather than a fixed metronome ruler.
const Snap = {
  enabled: true,

  init() {
    this._wire();
    this.updateUI();
  },

  set(on) {
    this.enabled = !!on;
    this.updateUI();
    // Persist through the usual state.js save path, so the choice survives a
    // reload like scrollMode does.
    try { if (window.Loader) Loader.persist(); } catch (e) { /* not ready yet */ }
  },

  toggle() { this.set(!this.enabled); },

  /**
   * Nearest detected beat to `t`, or `t` itself when snapping is off or the
   * song has no beat grid. Never returns a negative time.
   */
  toBeat(t, view) {
    if (!this.enabled) return Math.max(0, t);
    const v = view || window.View;
    const beats = v && v.meta && v.meta.beats;
    if (!beats || !beats.length) return Math.max(0, t);
    let best = t, d = Infinity;
    for (const bt of beats) {
      const dd = Math.abs(bt - t);
      if (dd < d) { d = dd; best = bt; }
    }
    return Math.max(0, best);
  },

  updateUI() {
    const btn = document.getElementById('snapBtn');
    if (!btn) return;
    btn.classList.toggle('on', this.enabled);
    btn.title = this.enabled
      ? 'Snap to beat: ON — loop bounds and markers land on the nearest beat (hold Alt to ignore for one drag)'
      : 'Snap to beat: OFF — loop bounds and markers stay exactly where you drop them';
  },

  _wire() {
    const btn = document.getElementById('snapBtn');
    // onclick, not addEventListener: this may run again on a re-render and we
    // must not stack handlers (one click would then toggle several times).
    if (btn) btn.onclick = () => this.toggle();
  },
};

window.Snap = Snap;
