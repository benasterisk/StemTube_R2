// recording-ui.js — UI bridge for friend's RecordingEngine on the POC mixer.
//
// FUNCTIONAL logic = friend (recording-engine.js / recording-effects.js, verbatim).
// VISUAL design   = the POC tracks (compact controls left, waveform lane right).
//
// friend's engine draws every recording waveform (live and final) into
//   document.getElementById('rec-track-<id>').querySelector('.waveform')  →  <canvas>
// So we build, per recording:
//   • a control block in #left-tracks  (id rec-ctrl-<id>, POC .lctrl look)
//   • a lane in #lanes  (id rec-track-<id>) holding a <div class="waveform"> sized to
//     the full song width, with a <canvas> inside — the element friend targets.
//
// COORDINATES: the canvas is drawn exactly like a stem lane (timeline.js drawWave):
// viewport-sized, pinned at left = scrollX, song time t at View.timeToX(t) - scrollX.
// That is what keeps a take aligned with the stems — friend's own full-width,
// ratio-of-container model ignored the lead-in pad (count-in) and the min
// window-width of a lane, so the waveform landed a few hundred px off while the
// audio itself played at the right place; and a full-width canvas × DPR blew the
// ~65536 px canvas cap at high zoom, which blanked the grid entirely.
// The engine's _renderLiveWaveforms (same ratio model) is replaced below for the
// same reason, so the live and final renders agree with the stems.
//
// Loaded AFTER mixer-compat.js (needs window.mixer + engine + View).
(function () {
  if (!window.mixer || typeof engine === "undefined") {
    console.error("[recording-ui] window.mixer / engine missing — load order wrong");
    return;
  }

  // gain (0–1.5) <-> slider (0–1), unity 1.0 at 0.75 (friend's mapping).
  function g2s(g) { g = g == null ? 1 : g; return g <= 1 ? g * 0.75 : 0.75 + (g - 1) * 0.5; }
  function s2g(s) { return s <= 0.75 ? s / 0.75 : 1 + (s - 0.75); }

  // timeline.js declares `const View` — a global LEXICAL binding, reachable as
  // `View` but NOT as `window.View`. Every `window.View` check here used to be
  // undefined, which silently disabled the grid and the zoom/scroll redraw hooks.
  function getView() { return window.View || (typeof View !== "undefined" ? View : null); }

  // full song width in px (the lane/.waveform width), like a POC lane.
  function fullWidth() {
    var V = getView();
    if (V && V.laneWidth) return V.laneWidth();     // song + lead pad, min viewport
    return Math.max(window.innerWidth, (engine.duration || 0) * 80);
  }
  function trackHeight() { var V = getView(); return (V && V.trackH) ? V.trackH() : 80; }

  function waveContainerFor(recId) {
    var lane = document.getElementById("rec-track-" + recId);
    return lane ? lane.querySelector(".waveform") : null;
  }

  // close every open track-settings popover (they are fixed-position floaters)
  function closeAllRecPopovers() {
    document.querySelectorAll(".rec-expanded-controls.open").forEach(function (p) { p.classList.remove("open"); });
    document.querySelectorAll(".rec-expand-btn.open").forEach(function (b) { b.classList.remove("open"); });
  }
  // outside click / Escape / scrolling the lanes closes the popover
  document.addEventListener("click", function (e) {
    if (!e.target.closest || (!e.target.closest(".rec-expanded-controls") && !e.target.closest(".rec-expand-btn"))) closeAllRecPopovers();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAllRecPopovers(); });
  var rp = document.getElementById("rightpane");
  if (rp) rp.addEventListener("scroll", closeAllRecPopovers, { passive: true });

  // ─────────────────────────────────────────────────────────────────────────
  // mixer.waveform — full-width render (matches friend's _renderLiveWaveforms /
  // waveform.js renderRecordingWaveform coordinate model).
  // ─────────────────────────────────────────────────────────────────────────
  // Size a recording canvas like a stem canvas: viewport-wide, pinned to the
  // visible edge. Returns {g, w, h, sx} or null when the View is not ready.
  function beginLaneDraw(canvas) {
    var V = getView(); if (!V || !V.meta || !V.sizeCanvas) return null;
    var w = V.visW(), h = trackHeight(), sx = V.scrollX();
    var g = V.sizeCanvas(canvas, w, h);
    canvas.style.left = sx + "px";
    g.clearRect(0, 0, w, h);
    // center line, as drawWave
    g.strokeStyle = "rgba(255,255,255,.06)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    return { g: g, w: w, h: h, sx: sx };
  }

  // visible column px -> song time (seconds), the inverse of View.timeToX
  function colToSongT(px, sx) {
    var V = getView();
    return (sx + px) / V.pxPerSec - (V.leadPad || 0);
  }

  mixer.waveform = {
    // Beat grid for the visible slice — same lines, same alphas as the stems
    // (timeline.js drawWave), so a recording lane reads like any other lane.
    drawGrid: function (g, w, h, sx) {
      var V = getView(); if (!V || !V.meta) return;
      if (sx == null) sx = V.scrollX();
      var beats = V.meta.beats || [], pos = V.meta.positions || [];
      for (var i = 0; i < beats.length; i++) {
        var x = V.timeToX(beats[i]) - sx;
        if (x < 0) continue; if (x > w) break;
        var down = pos[i] === 1;
        g.strokeStyle = down ? "rgba(255,255,255,.45)" : "rgba(255,255,255,.10)";
        g.lineWidth = down ? 1.5 : 1;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
    },

    // friend passes trackEl.querySelector('.waveform'); we accept that OR resolve by id.
    renderRecordingWaveform: function (rec, waveContainer) {
      if (!rec || !rec.audioBuffer) return;
      var wc = (waveContainer && waveContainer.classList && waveContainer.classList.contains("waveform"))
        ? waveContainer : waveContainerFor(rec.id);
      if (!wc) return;
      var canvas = wc.querySelector("canvas") || wc.appendChild(document.createElement("canvas"));
      var d = beginLaneDraw(canvas); if (!d) return;
      var g = d.g, w = d.w, h = d.h, sx = d.sx, V = getView();
      var mid = h / 2, amp = h * 0.46;
      var buf = rec.audioBuffer, data = buf.getChannelData(0), N = data.length, sr = buf.sampleRate;
      var start = rec.startOffset || 0;
      var color = rec.saved ? "#2ecc71" : "#ff5d5d";   // green if saved, red otherwise

      // dim spacer before the clip start (visible part only)
      var startX = V.timeToX(start) - sx;
      if (startX > 0) { g.fillStyle = rec.saved ? "rgba(46,204,113,.05)" : "rgba(255,93,93,.06)"; g.fillRect(0, 0, Math.min(startX, w), h); }

      // one column per visible pixel: column px <-> song time, like drawWave
      g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
      for (var px = 0; px < w; px++) {
        var bt = colToSongT(px, sx) - start;              // seconds into the take
        if (bt < 0) continue;
        var a0 = Math.floor(bt * sr), a1 = Math.min(N, Math.floor((bt + 1 / V.pxPerSec) * sr));
        if (a0 >= N) break; if (a1 <= a0) a1 = a0 + 1;
        var mn = 1, mx = -1, stride = Math.max(1, Math.floor((a1 - a0) / 512));
        for (var j = a0; j < a1; j += stride) { var v = data[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
        var top = mid - mx * amp, bot = mid - mn * amp; if (bot - top < 1) bot = top + 1;
        g.moveTo(px + 0.5, top); g.lineTo(px + 0.5, bot);
      }
      g.stroke();
      this.drawGrid(g, w, h, sx);
    },

    redrawAllRecordings: function () {
      var re = window.mixer && window.mixer.recordingEngine; if (!re || !re.recordings) return;
      var self = this;
      re.recordings.forEach(function (r) {
        if (!r.audioBuffer) {
          // empty lane: still show the grid so the row reads like the others
          var wc = waveContainerFor(r.id), cv = wc && wc.querySelector("canvas");
          if (cv) { var d = beginLaneDraw(cv); if (d) self.drawGrid(d.g, d.w, d.h, d.sx); }
          return;
        }
        self.renderRecordingWaveform(r, waveContainerFor(r.id));
        // the engine clears 'empty-track' on the lane (#rec-track-*); our "(vide)"
        // label lives on the control block — clear it here once the take exists
        var ctrl = document.getElementById("rec-ctrl-" + r.id);
        if (ctrl) ctrl.classList.remove("empty-track");
      });
    },

    // keep every recording lane sized to the current zoom (full song width × trackH)
    syncLanes: function () {
      var w = fullWidth() + "px", h = trackHeight() + "px";
      document.querySelectorAll("#lanes .rec-lane").forEach(function (lane) {
        lane.style.width = w; lane.style.height = h; lane.style.minHeight = h;
        var wave = lane.querySelector(".waveform");
        if (wave) { wave.style.width = w; wave.style.height = h; }
      });
      document.querySelectorAll("#left-tracks .rec-lctrl").forEach(function (lc) { lc.style.minHeight = h; });
    },
  };

  // Live render during a take, in the stems' coordinate model (replaces friend's
  // ratio-of-container version — see the header). Same data: liveWaveformData
  // holds one level per analyser tick, spread evenly over the elapsed time.
  if (typeof RecordingEngine !== "undefined" && !RecordingEngine.prototype.__pocLive) {
    RecordingEngine.prototype.__pocLive = true;
    RecordingEngine.prototype._renderLiveWaveforms = function () {
      var V = getView(); if (!V || !V.meta) return;
      var now = this.mixer.currentTime || 0, start = this.recordingStartOffset || 0;
      var elapsed = Math.max(0, now - start);
      for (var k = 0; k < this.recordingTrackIds.length; k++) {
        var trackId = this.recordingTrackIds[k];
        var data = this.liveWaveformData.get(trackId);
        var wc = waveContainerFor(trackId); if (!wc) continue;
        var canvas = wc.querySelector("canvas") || wc.appendChild(document.createElement("canvas"));
        var d = beginLaneDraw(canvas); if (!d) continue;
        var g = d.g, w = d.w, h = d.h, sx = d.sx, mid = h / 2;
        var startX = V.timeToX(start) - sx;
        if (startX > 0) { g.fillStyle = "rgba(255,93,93,.06)"; g.fillRect(0, 0, Math.min(startX, w), h); }
        if (data && data.length) {
          g.strokeStyle = "#ff5d5d"; g.lineWidth = 1; g.beginPath();
          var n = data.length;
          for (var i = 0; i < n; i++) {
            var x = V.timeToX(start + elapsed * i / n) - sx;
            if (x < 0) continue; if (x > w) break;
            var amp = data[i] * h * 0.8;
            g.moveTo(x, mid - amp / 2); g.lineTo(x, mid + amp / 2);
          }
          g.stroke();
        }
        mixer.waveform.drawGrid(g, w, h, sx);
      }
    };
  }

  // Zoom / resize redraws go through View.redrawAll — extend it so the recording
  // lanes resize with the stems and their takes re-render at the new scale.
  if (getView() && typeof View.redrawAll === "function" && !View.__recUiPatched) {
    View.__recUiPatched = true;
    var _redrawAll = View.redrawAll.bind(View);
    View.redrawAll = function () {
      _redrawAll();
      try { mixer.waveform.syncLanes(); mixer.waveform.redrawAllRecordings(); } catch (e) {}
    };
    // viewport rendering: the visible slice must be redrawn on every scroll, like
    // the stems (otherwise the pinned canvas scrolls away with stale content)
    if (typeof View.redrawVisible === "function") {
      var _redrawVisible = View.redrawVisible.bind(View);
      View.redrawVisible = function () {
        _redrawVisible();
        try { mixer.waveform.redrawAllRecordings(); } catch (e) {}
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // mixer.trackControls.createRecordingTrackElement — POC-styled control block in
  // #left-tracks + a full-width waveform lane (#lanes) friend's engine draws into.
  // ─────────────────────────────────────────────────────────────────────────
  function populateDeviceSelect(selectEl, recEngine) {
    if (!selectEl) return Promise.resolve();
    return recEngine.getInputDevices().then(function (devices) {
      var cur = selectEl.value;
      selectEl.innerHTML = '<option value="">Select mic…</option>';
      devices.forEach(function (d) {
        var o = document.createElement("option");
        o.value = d.deviceId; o.textContent = d.label || ("Microphone " + selectEl.options.length);
        selectEl.appendChild(o);
      });
      if (cur) selectEl.value = cur;
    }).catch(function () {});
  }

  mixer.trackControls = {
    createRecordingTrackElement: function (recording) {
      var left = document.getElementById("left-tracks");
      var lanes = document.getElementById("lanes");
      var recEngine = window.mixer.recordingEngine;
      if (!left || !lanes || !recEngine) return;
      var h = trackHeight();

      // control block (left, POC .lctrl look)
      var lc = document.createElement("div");
      lc.className = "lctrl rec-lctrl recording-track" + (recording.audioBuffer ? "" : " empty-track");
      lc.id = "rec-ctrl-" + recording.id;
      lc.style.minHeight = h + "px";
      lc.innerHTML =
        '<div class="name recording-title">' +
          '<span class="dot" style="background:#ff5d5d"></span>' +
          '<span class="track-name" contenteditable="false" title="Double-click to rename">' + recording.name + '</span>' +
          '<button class="rec-expand-btn" title="Recording settings"><i class="fas fa-chevron-down"></i></button>' +
        '</div>' +
        '<div class="ctl-row">' +
          '<span class="btns">' +
            '<button class="rec-arm-btn' + (recording.armed ? ' on' : '') + '" title="Arm">R</button>' +
            '<button class="solo" title="Solo">S</button>' +
            '<button class="mute" title="Mute">M</button>' +
          '</span>' +
          '<input class="vol volume-slider" type="range" min="0" max="1" step="0.01" value="' + g2s(recording.volume) + '" title="Volume">' +
          '<span class="pan"><span class="panlab">L</span>' +
            '<input class="panrange pan-knob" type="range" min="-1" max="1" step="0.02" value="' + (recording.pan || 0) + '"><span class="panlab">R</span></span>' +
        '</div>' +
        '<div class="rec-expanded-controls">' +
          '<div class="rec-popover-title">Track settings</div>' +
          '<select class="rec-device-select" title="Input device"><option value="">Select mic…</option></select>' +
          '<div class="rec-input-row">' +
            '<div class="input-level-meter" title="Input level"><div class="input-level-fill"></div></div>' +
            '<div class="monitor-control" title="Monitoring"><i class="fas fa-headphones"></i>' +
              '<input type="range" class="monitor-slider" min="0" max="1" step="0.01" value="0"></div>' +
          '</div>' +
          '<div class="rec-fx-row"><label class="rec-fx-label" title="Effects preset"><i class="fas fa-sliders-h"></i> FX :</label>' +
            '<select class="rec-fx-select"><option value="off">Off</option><option value="subtle">Subtle</option>' +
              '<option value="warm">Warm</option><option value="heavy">Heavy</option></select></div>' +
          '<span class="rec-fx-desc"></span>' +
          '<div class="rec-action-buttons"><button class="rec-delete-btn" title="Delete"><i class="fas fa-trash"></i> Delete</button></div>' +
        '</div>';
      left.appendChild(lc);

      // waveform lane (right) — id rec-track-<id>, full-width .waveform + canvas.
      var lane = document.createElement("div");
      lane.className = "lane rec-lane";
      lane.id = "rec-track-" + recording.id;
      lane.style.width = fullWidth() + "px";
      lane.style.height = h + "px"; lane.style.minHeight = h + "px";
      var wave = document.createElement("div");
      wave.className = "waveform";
      wave.style.width = fullWidth() + "px";
      wave.style.height = h + "px";
      wave.appendChild(document.createElement("canvas"));
      lane.appendChild(wave);
      lanes.appendChild(lane);

      // ── handlers (friend logic) ──
      var expandBtn = lc.querySelector(".rec-expand-btn");
      var panel = lc.querySelector(".rec-expanded-controls");
      expandBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var willOpen = !panel.classList.contains("open");
        closeAllRecPopovers();
        if (willOpen) {
          panel.classList.add("open");
          // anchor the floating popover next to the control block, clamped to the
          // viewport (it can never end up unreachable below the fold)
          var r = lc.getBoundingClientRect();
          var pw = 240, ph = Math.min(panel.scrollHeight + 24, window.innerHeight * 0.62);
          var leftPos = Math.min(r.right + 6, window.innerWidth - pw - 8);
          var topPos = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8));
          panel.style.left = leftPos + "px";
          panel.style.top = topPos + "px";
        }
        expandBtn.classList.toggle("open", panel.classList.contains("open"));
      });
      panel.addEventListener("click", function (ev) { ev.stopPropagation(); });

      var deviceSelect = lc.querySelector(".rec-device-select");
      var levelFill = lc.querySelector(".input-level-fill");
      var monitorSlider = lc.querySelector(".monitor-slider");
      populateDeviceSelect(deviceSelect, recEngine);

      var levelAnimId = null;
      function updateLevel() {
        var lvl = recEngine.getTrackInputLevel(recording.id);
        if (levelFill) levelFill.style.width = Math.round(lvl * 100) + "%";
        levelAnimId = requestAnimationFrame(updateLevel);
      }
      deviceSelect.addEventListener("change", function (e) {
        recEngine.setTrackDevice(recording.id, e.target.value).then(function () {
          document.querySelectorAll(".rec-device-select").forEach(function (s) { if (s !== deviceSelect) populateDeviceSelect(s, recEngine); });
          if (levelAnimId) cancelAnimationFrame(levelAnimId);
          if (e.target.value) updateLevel();
        }).catch(function (err) { console.warn("[recording-ui] device init failed:", err); });
      });
      monitorSlider.addEventListener("input", function (e) { recEngine.setTrackMonitorVolume(recording.id, parseFloat(e.target.value)); });

      var fxSelect = lc.querySelector(".rec-fx-select");
      var fxDesc = lc.querySelector(".rec-fx-desc");
      function updateFxDesc() {
        if (!fxDesc) return;
        var preset = fxSelect ? fxSelect.value : "off";
        // RecordingEngine.setTrackFxPreset always applies the "vocals" preset family,
        // so describe that family to match what is actually heard.
        fxDesc.textContent = (typeof RecordingEffects !== "undefined") ? RecordingEffects.describePreset("vocals", preset) : "";
      }
      if (fxSelect) {
        fxSelect.value = recording.fxPreset || "off";
        fxSelect.addEventListener("change", function (e) { recEngine.setTrackFxPreset(recording.id, e.target.value); updateFxDesc(); });
        updateFxDesc();
      }

      var armBtn = lc.querySelector(".rec-arm-btn");
      armBtn.addEventListener("click", function () {
        if (recording.armed) recEngine.disarmTrack(recording.id); else recEngine.armTrack(recording.id);
        armBtn.classList.toggle("on", recording.armed);
      });
      lc.querySelector(".solo").addEventListener("click", function () { recEngine.toggleSolo(recording.id); lc.querySelector(".solo").classList.toggle("on", recording.solo); });
      lc.querySelector(".mute").addEventListener("click", function () { recEngine.toggleMute(recording.id); lc.querySelector(".mute").classList.toggle("on", recording.muted); });
      lc.querySelector(".volume-slider").addEventListener("input", function (e) { recEngine.setVolume(recording.id, s2g(parseFloat(e.target.value))); });
      lc.querySelector(".pan-knob").addEventListener("input", function (e) { recEngine.setPan(recording.id, parseFloat(e.target.value)); });
      lc.querySelector(".rec-delete-btn").addEventListener("click", function () {
        if (levelAnimId) cancelAnimationFrame(levelAnimId);
        var done = recording.serverId ? recEngine.deleteFromServer(recording.serverId).catch(function () {}) : Promise.resolve();
        done.then(function () {
          recEngine.deleteRecording(recording.id);                     // removes #rec-track-<id> (lane) + audio nodes
          var c = document.getElementById("rec-ctrl-" + recording.id); if (c) c.remove();
        });
      });

      // inline rename (name lives in the control block; keep both in sync)
      var nameEl = lc.querySelector(".track-name");
      nameEl.addEventListener("dblclick", function () {
        nameEl.contentEditable = "true"; nameEl.focus();
        var range = document.createRange(); range.selectNodeContents(nameEl);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      });
      nameEl.addEventListener("blur", function () {
        nameEl.contentEditable = "false";
        var n = nameEl.textContent.trim();
        if (n && n !== recording.name) { recording.name = n; }   // engine.renameRecording targets #rec-track <.track-name> (the lane) which has none; set directly
      });
      nameEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); } });

      if (recording.audioBuffer) mixer.waveform.renderRecordingWaveform(recording, wave);
      else { var d0 = beginLaneDraw(wave.querySelector("canvas")); if (d0) mixer.waveform.drawGrid(d0.g, d0.w, d0.h, d0.sx); }
    },
  };
})();
