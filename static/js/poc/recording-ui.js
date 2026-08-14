// recording-ui.js — UI bridge for friend's RecordingEngine on the POC mixer.
//
// FUNCTIONAL logic = friend (recording-engine.js / recording-effects.js, verbatim).
// VISUAL design   = the POC tracks (compact controls left, waveform lane right).
//
// friend's engine draws every recording waveform (live, final, de-bleed) into
//   document.getElementById('rec-track-<id>').querySelector('.waveform')  →  <canvas>
// and positions it as ratios of that container's FULL width (full-song width × zoom).
// So we build, per recording:
//   • a control block in #left-tracks  (id rec-ctrl-<id>, POC .lctrl look)
//   • a lane in #lanes  (id rec-track-<id>) holding a <div class="waveform"> sized to
//     the full song width, with a <canvas> filling it — the element friend targets.
// mixer.waveform.{renderRecordingWaveform,drawGrid} reproduce friend's full-width
// algorithm so the live and final renders agree.
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

  var DPR = window.devicePixelRatio || 1;

  // full song width in px (the lane/.waveform width), like a POC lane.
  function fullWidth() {
    var V = window.View;
    var dur = (V && V.meta && V.meta.duration) || (engine.duration) || 0;
    var pps = (V && V.pxPerSec) || 80;
    return Math.max(window.innerWidth, dur * pps);
  }
  function trackHeight() { var V = window.View; return (V && V.trackH) ? V.trackH() : 80; }

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
  mixer.waveform = {
    drawGrid: function (ctx, width, height) {
      var V = window.View; if (!V || !V.meta) return;
      var beats = V.meta.beats || [], pos = V.meta.positions || [];
      var pps = (V.pxPerSec || 80) * DPR;          // canvas is full-width × DPR
      for (var i = 0; i < beats.length; i++) {
        var x = beats[i] * pps;
        if (x > width) break;
        var down = pos[i] === 1;
        ctx.strokeStyle = down ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.06)";
        ctx.lineWidth = down ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
    },

    // friend passes trackEl.querySelector('.waveform'); we accept that OR resolve by id.
    renderRecordingWaveform: function (rec, waveContainer) {
      if (!rec || !rec.audioBuffer) return;
      var wc = (waveContainer && waveContainer.classList && waveContainer.classList.contains("waveform"))
        ? waveContainer : waveContainerFor(rec.id);
      if (!wc) return;
      var canvas = wc.querySelector("canvas") || wc.appendChild(document.createElement("canvas"));

      var w = (wc.offsetWidth || fullWidth()) * DPR;
      var h = (wc.offsetHeight || trackHeight()) * DPR;
      canvas.width = w; canvas.height = h; canvas.style.width = "100%"; canvas.style.height = "100%";
      var ctx = canvas.getContext("2d");
      var centerY = h / 2;
      ctx.clearRect(0, 0, w, h);
      this.drawGrid(ctx, w, h);

      var V = window.View;
      var pps = (V && V.pxPerSec || 80) * DPR;
      var buf = rec.audioBuffer;
      var raw = buf.getChannelData(0);
      var startX = (rec.startOffset || 0) * pps;       // clip start in full-width px
      var waveW = buf.duration * pps;
      var samples = Math.max(1, Math.floor(waveW));
      var vz = (window.mixer.zoomLevels && window.mixer.zoomLevels.vertical) || 1;

      var color = rec.saved ? "#2ecc71" : "#ff5d5d";   // green if saved, red otherwise
      // dim spacer before the clip start
      if (startX > 0) { ctx.fillStyle = rec.saved ? "rgba(46,204,113,.05)" : "rgba(255,93,93,.06)"; ctx.fillRect(0, 0, Math.min(startX, w), h); }

      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1 * DPR;
      var samplesPerPx = raw.length / samples;
      for (var px = 0; px < samples; px++) {
        var x = startX + px; if (x > w) break; if (x < 0) continue;
        var i0 = Math.floor(px * samplesPerPx);
        var i1 = Math.min(raw.length, i0 + Math.ceil(samplesPerPx));
        var mn = 1, mx = -1;
        for (var i = i0; i < i1; i++) { var v = raw[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        if (i1 <= i0) { mn = mx = 0; }
        ctx.moveTo(x, centerY - mx * vz * (h * 0.45));
        ctx.lineTo(x, centerY - mn * vz * (h * 0.45));
      }
      ctx.stroke();
    },

    redrawAllRecordings: function () {
      var re = window.mixer && window.mixer.recordingEngine; if (!re || !re.recordings) return;
      var self = this;
      re.recordings.forEach(function (r) {
        if (!r.audioBuffer) return;
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
        lane.style.minHeight = h;
        var wave = lane.querySelector(".waveform");
        if (wave) { wave.style.width = w; wave.style.height = h; }
      });
      document.querySelectorAll("#left-tracks .rec-lctrl").forEach(function (lc) { lc.style.minHeight = h; });
    },
  };

  // Zoom / resize redraws go through View.redrawAll — extend it so the recording
  // lanes resize with the stems and their takes re-render at the new scale.
  if (window.View && typeof View.redrawAll === "function" && !View.__recUiPatched) {
    View.__recUiPatched = true;
    var _redrawAll = View.redrawAll.bind(View);
    View.redrawAll = function () {
      _redrawAll();
      try { mixer.waveform.syncLanes(); mixer.waveform.redrawAllRecordings(); } catch (e) {}
    };
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
          '<span class="track-name" contenteditable="false" title="Double-clic pour renommer">' + recording.name + '</span>' +
          '<button class="rec-expand-btn" title="Réglages d\'enregistrement"><i class="fas fa-chevron-down"></i></button>' +
        '</div>' +
        '<div class="ctl-row">' +
          '<span class="btns">' +
            '<button class="rec-arm-btn' + (recording.armed ? ' on' : '') + '" title="Armer">R</button>' +
            '<button class="solo" title="Solo">S</button>' +
            '<button class="mute" title="Mute">M</button>' +
          '</span>' +
          '<input class="vol volume-slider" type="range" min="0" max="1" step="0.01" value="' + g2s(recording.volume) + '" title="Volume">' +
          '<span class="pan"><span class="panlab">L</span>' +
            '<input class="panrange pan-knob" type="range" min="-1" max="1" step="0.02" value="' + (recording.pan || 0) + '"><span class="panlab">R</span></span>' +
        '</div>' +
        '<div class="rec-expanded-controls">' +
          '<div class="rec-popover-title">Réglages de piste</div>' +
          '<select class="rec-device-select" title="Périphérique d\'entrée"><option value="">Select mic…</option></select>' +
          '<div class="rec-input-row">' +
            '<div class="input-level-meter" title="Niveau d\'entrée"><div class="input-level-fill"></div></div>' +
            '<div class="monitor-control" title="Monitoring"><i class="fas fa-headphones"></i>' +
              '<input type="range" class="monitor-slider" min="0" max="1" step="0.01" value="0"></div>' +
          '</div>' +
          '<div class="rec-debleed-row"><label class="rec-debleed-label" title="Retirer le repiquage (Demucs)"><i class="fas fa-magic"></i> De-bleed :</label>' +
            '<select class="rec-debleed-select"><option value="off">Off</option><option value="vocals">Vocals</option>' +
              '<option value="bass">Bass</option><option value="drums">Drums</option><option value="other">Other (Guitar/Keys)</option></select></div>' +
          '<div class="rec-fx-row"><label class="rec-fx-label" title="Preset d\'effets"><i class="fas fa-sliders-h"></i> FX :</label>' +
            '<select class="rec-fx-select"><option value="off">Off</option><option value="subtle">Subtle</option>' +
              '<option value="warm">Warm</option><option value="heavy">Heavy</option></select></div>' +
          '<span class="rec-fx-desc"></span>' +
          '<div class="rec-action-buttons"><button class="rec-delete-btn" title="Supprimer"><i class="fas fa-trash"></i> Supprimer</button></div>' +
        '</div>';
      left.appendChild(lc);

      // waveform lane (right) — id rec-track-<id>, full-width .waveform + canvas.
      var lane = document.createElement("div");
      lane.className = "lane rec-lane";
      lane.id = "rec-track-" + recording.id;
      lane.style.minHeight = h + "px";
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

      var debleedSelect = lc.querySelector(".rec-debleed-select");
      var fxSelect = lc.querySelector(".rec-fx-select");
      var fxDesc = lc.querySelector(".rec-fx-desc");
      function updateFxDesc() {
        if (!fxDesc) return;
        var cat = debleedSelect ? debleedSelect.value : "other";
        var preset = fxSelect ? fxSelect.value : "off";
        fxDesc.textContent = (typeof RecordingEffects !== "undefined") ? RecordingEffects.describePreset(cat === "off" ? "other" : cat, preset) : "";
      }
      if (debleedSelect) {
        debleedSelect.value = recording.debleedStem || "off";
        debleedSelect.addEventListener("change", function (e) {
          recEngine.setTrackDebleed(recording.id, e.target.value);
          if (fxSelect && fxSelect.value !== "off") recEngine.setTrackFxPreset(recording.id, fxSelect.value);
          updateFxDesc();
        });
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
    },
  };
})();
