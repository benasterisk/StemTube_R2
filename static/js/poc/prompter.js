// Stage Prompter — full-screen chords + lyrics teleprompter for live musicians.
//
// Design intent: an INSTRUMENT, not a dashboard. Phosphor-amber on near-black
// (stage-tuner contrast, readable meters away), a fixed NOW rail the content
// flows through, and a giant current/next chord panel with a beats-to-change
// countdown — what a playing musician actually glances at.
//
// Self-contained: consumes existing data read-only (mixer.chordDisplay.chords,
// EXTRACTION_INFO lyrics/beats, the compat clock) and drives transport through
// the same entry points as the UI (playBtn click, engine.seek) so jam
// broadcasting keeps working. Nothing in the existing popups is touched.
(function () {
  "use strict";

  const FONT_HREF =
    "https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@500;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&display=swap";

  let overlay = null;
  let clockId = null;   // setInterval, immune to hidden-view rAF throttling
  let lines = [];          // [{start, end, el, words:[{start, text, el, chord}]}]
  let flat = [];           // flattened word list for the highlight walk
  let beats = [];          // parsed beat_times (seconds)
  let chords = [];         // [{t, label}]
  let lastLineIdx = -1;
  let lastWordIdx = -1;
  let lastChordIdx = -1;
  let fontsInjected = false;

  // ── data ─────────────────────────────────────────────────────────

  function parseMaybeJson(v, fallback) {
    if (v == null) return fallback;
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch (e) { return fallback; }
    }
    return v;
  }

  function collectData() {
    const info = window.EXTRACTION_INFO || {};
    beats = parseMaybeJson(info.beat_times, []) || [];
    if (!Array.isArray(beats)) beats = [];

    const cdChords = (window.mixer && window.mixer.chordDisplay &&
                      window.mixer.chordDisplay.chords) || [];
    chords = cdChords
      .map((c) => ({ t: +c.timestamp || 0, label: (c.chord || "").trim() }))
      .filter((c) => c.label)
      .sort((a, b) => a.t - b.t);

    // Lyrics live on the karaoke display (loaded from /api/extractions);
    // EXTRACTION_INFO carries no lyrics_data on this page. Keep it as a
    // fallback for robustness.
    const fromKaraoke = window.mixer && window.mixer.karaokeDisplay &&
                        window.mixer.karaokeDisplay.lyricsData;
    const rawLyrics = parseMaybeJson(fromKaraoke, null) ||
                      parseMaybeJson(info.lyrics_data, []) || [];
    return Array.isArray(rawLyrics) ? rawLyrics : [];
  }

  // Split a segment into timed words (native word timing when present,
  // else linear interpolation across the segment — same policy as the
  // chord grid's word flattening).
  function segmentWords(seg) {
    if (Array.isArray(seg.words) && seg.words.length) {
      return seg.words
        .map((w) => ({ text: ((w.word != null ? w.word : w.text) || "").trim(),
                       start: +w.start || 0 }))
        .filter((w) => w.text);
    }
    const text = (seg.text || "").trim();
    if (!text) return [];
    const parts = text.split(/\s+/).filter(Boolean);
    const st = +seg.start || 0;
    const en = (typeof seg.end === "number" && seg.end > st)
      ? seg.end : st + parts.length * 0.3;
    const step = parts.length > 1 ? (en - st) / parts.length : 0;
    return parts.map((p, i) => ({ text: p, start: st + i * step }));
  }

  function chordAt(t) {
    let lo = 0, hi = chords.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chords[mid].t <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

  // Build display lines: lyric segments become word rows with chord-change
  // markers; instrumental gaps (> ~8s without lyrics) become chord-only rows
  // so the river never goes blank mid-song.
  function buildLines(segments) {
    const rows = [];
    const duration = (window.mixer && window.mixer.maxDuration) || 0;

    const pushChordRow = (from, to) => {
      const cs = chords.filter((c) => c.t >= from && c.t < to);
      if (!cs.length) return;
      for (let i = 0; i < cs.length; i += 8) {
        const slice = cs.slice(i, i + 8);
        rows.push({
          start: slice[0].t,
          end: (slice[7] || cs[cs.length - 1]).t + 2,
          instrumental: true,
          words: slice.map((c) => ({ text: "▪", start: c.t, chordLabel: c.label })),
        });
      }
    };

    let cursor = 0;
    segments.forEach((seg) => {
      const st = +seg.start || 0;
      if (st - cursor > 8) pushChordRow(cursor, st);
      const words = segmentWords(seg);
      if (words.length) {
        let prevChord = -1;
        const decorated = words.map((w) => {
          const ci = chordAt(w.start);
          const label = (ci !== -1 && ci !== prevChord) ? chords[ci].label : null;
          if (ci !== -1) prevChord = ci;
          return { text: w.text, start: w.start, chordLabel: label };
        });
        rows.push({
          start: st,
          end: +seg.end || (words[words.length - 1].start + 1.5),
          instrumental: false,
          words: decorated,
        });
      }
      cursor = Math.max(cursor, +seg.end || st);
    });
    if (duration - cursor > 8) pushChordRow(cursor, duration);
    return rows.sort((a, b) => a.start - b.start);
  }

  // ── DOM ──────────────────────────────────────────────────────────

  function injectFonts() {
    if (fontsInjected) return;
    fontsInjected = true;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONT_HREF;
    document.head.appendChild(l);
  }

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function build() {
    injectFonts();
    overlay = h("div", "prompter");
    overlay.id = "prompter";

    // header
    const head = h("header", "prompter-head");
    const title = h("div", "prompter-title",
      (window.EXTRACTION_INFO && window.EXTRACTION_INFO.title) || "");
    const clock = h("div", "prompter-clock", "0:00");
    clock.id = "prompterClock";
    const close = h("button", "prompter-close", "✕");
    close.setAttribute("aria-label", "Close prompter");
    close.onclick = Prompter.close;
    head.append(title, clock, close);

    // chord panel (left)
    const panel = h("aside", "prompter-chordpanel");
    const nowChord = h("div", "prompter-chord-now", "—");
    nowChord.id = "prompterChordNow";
    const nextWrap = h("div", "prompter-chord-nextwrap");
    nextWrap.append(h("span", "prompter-chord-nextlabel", "NEXT"));
    const nextChord = h("div", "prompter-chord-next", "—");
    nextChord.id = "prompterChordNext";
    nextWrap.append(nextChord);
    const dots = h("div", "prompter-beatdots");
    dots.id = "prompterBeatDots";
    for (let i = 0; i < 4; i++) dots.append(h("span", "prompter-dot"));
    panel.append(nowChord, nextWrap, dots);

    // lyric river (right) with fixed rail
    const river = h("section", "prompter-river");
    const rail = h("div", "prompter-rail");
    const flow = h("div", "prompter-flow");
    flow.id = "prompterFlow";
    river.append(rail, flow);

    // transport foot
    const foot = h("footer", "prompter-foot");
    const back = h("button", "prompter-btn", "‹ 5s");
    back.onclick = () => seekRel(-5);
    const play = h("button", "prompter-btn prompter-play", "⏯");
    play.id = "prompterPlay";
    play.onclick = () => { const b = document.getElementById("playBtn"); if (b) b.click(); };
    const fwd = h("button", "prompter-btn", "5s ›");
    fwd.onclick = () => seekRel(5);
    foot.append(back, play, fwd);

    overlay.append(head, panel, river, foot);
    document.body.appendChild(overlay);

    // rows
    const frag = document.createDocumentFragment();
    lines.forEach((row) => {
      const rowEl = h("div", "prompter-line" + (row.instrumental ? " prompter-line-instr" : ""));
      row.words.forEach((w) => {
        const wordEl = h("span", "prompter-word");
        if (w.chordLabel) {
          const c = h("span", "prompter-word-chord", w.chordLabel);
          wordEl.append(c);
        }
        wordEl.append(h("span", "prompter-word-text", w.text));
        w.el = wordEl;
        rowEl.append(wordEl, document.createTextNode(" "));
      });
      row.el = rowEl;
      frag.append(rowEl);
    });
    flow.append(frag);

    flat = [];
    lines.forEach((row, li) =>
      row.words.forEach((w, wi) => flat.push({ start: w.start, li, wi, el: w.el })));
    flat.sort((a, b) => a.start - b.start);

    document.addEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (!overlay) return;
    if (e.key === "Escape") { e.preventDefault(); Prompter.close(); }
    else if (e.key === " ") {
      e.preventDefault();
      const b = document.getElementById("playBtn"); if (b) b.click();
    }
  }

  function seekRel(d) {
    try {
      const p = Math.max(0, engine.pos() + d);
      engine.seek(p);
    } catch (err) { /* engine not ready */ }
  }

  // ── sync loop ────────────────────────────────────────────────────

  function now() {
    return (window.mixer && window.mixer.currentTime) || 0;
  }

  function fmt(t) {
    t = Math.max(0, t | 0);
    return ((t / 60) | 0) + ":" + String(t % 60).padStart(2, "0");
  }

  function findIndex(arr, t, key) {
    let lo = 0, hi = arr.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((key ? arr[mid][key] : arr[mid]) <= t) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  function tick() {
    if (!overlay) return;
    const t = now();

    document.getElementById("prompterClock").textContent = fmt(t);

    // chord panel
    const ci = chordAt(t);
    if (ci !== lastChordIdx) {
      lastChordIdx = ci;
      const nowEl = document.getElementById("prompterChordNow");
      const nextEl = document.getElementById("prompterChordNext");
      nowEl.textContent = ci === -1 ? "—" : chords[ci].label;
      nextEl.textContent = (ci + 1 < chords.length) ? chords[ci + 1].label : "—";
      nowEl.classList.remove("prompter-chord-hit");
      void nowEl.offsetWidth;                    // restart the hit animation
      nowEl.classList.add("prompter-chord-hit");
    }

    // beats-to-next-chord dots (4 dots = 4 beats horizon)
    if (beats.length && ci + 1 < chords.length) {
      const nextT = chords[ci + 1].t;
      const bi = findIndex(beats, t);
      let remaining = 0;
      for (let i = bi + 1; i < beats.length && beats[i] <= nextT + 0.05; i++) remaining++;
      const dots = document.getElementById("prompterBeatDots").children;
      for (let i = 0; i < dots.length; i++) {
        dots[i].classList.toggle("prompter-dot-on", remaining > 0 && i < Math.min(4, remaining));
      }
    }

    // word highlight
    const wi = findIndex(flat, t, "start");
    if (wi !== lastWordIdx) {
      if (lastWordIdx !== -1 && flat[lastWordIdx]) flat[lastWordIdx].el.classList.remove("prompter-word-now");
      for (let i = Math.max(0, lastWordIdx); i <= wi; i++) {
        if (flat[i]) flat[i].el.classList.add("prompter-word-past");
      }
      if (wi !== -1) {
        flat[wi].el.classList.remove("prompter-word-past");
        flat[wi].el.classList.add("prompter-word-now");
      }
      lastWordIdx = wi;
    }

    // line rail: translate the flow so the active line sits on the rail
    const li = wi === -1 ? -1 : flat[wi].li;
    if (li !== lastLineIdx && li !== -1) {
      lastLineIdx = li;
      lines.forEach((row, i) => {
        row.el.classList.toggle("prompter-line-now", i === li);
        row.el.classList.toggle("prompter-line-past", i < li);
      });
      const flow = document.getElementById("prompterFlow");
      const target = lines[li].el;
      const railY = flow.parentElement.clientHeight * 0.32;
      flow.style.transform = "translateY(" + (railY - target.offsetTop) + "px)";
    }

  }

  // ── public API ───────────────────────────────────────────────────

  const Prompter = {
    open() {
      if (overlay) return;
      const segments = collectData();
      lines = buildLines(segments);
      if (!lines.length && !chords.length) {
        console.warn("[Prompter] no chords and no lyrics to display");
        return;
      }
      build();
      lastLineIdx = lastWordIdx = lastChordIdx = -2;
      document.body.classList.add("prompter-open");
      // Fixed-rate clock instead of rAF: browsers freeze rAF in hidden or
      // throttled views, and a stage prompter must keep tracking playback
      // even when the compositor naps. CSS transitions do the smoothing.
      clockId = setInterval(tick, 100);
      tick();
    },
    close() {
      if (!overlay) return;
      clearInterval(clockId);
      clockId = null;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      overlay = null;
      document.body.classList.remove("prompter-open");
    },
    toggle() { overlay ? Prompter.close() : Prompter.open(); },
  };

  window.Prompter = Prompter;

  // tab-bar button (styled by prompter.css, placed with the other tabs)
  function mountButton() {
    const tabs = document.getElementById("mixerTabs");
    if (!tabs || document.getElementById("prompterTabBtn")) return;
    const btn = h("button", "prompter-tab-btn", "🎤 Prompter");
    btn.id = "prompterTabBtn";
    btn.type = "button";
    btn.onclick = Prompter.toggle;
    tabs.appendChild(btn);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
