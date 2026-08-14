/**
 * JamMetronome - Visual beat indicator with optional haptic and audible click.
 * Shows a single pulsing dot that flashes on each beat, with uniform click sound.
 *
 * Features:
 * - Tap the speaker icon to toggle audible click on/off
 * - Long-press the metronome to configure precount (off / 2 / 4 / 8 beats)
 * - Precount plays a count-in sequence before playback starts
 * - Look-ahead scheduling on Web Audio clock for sample-accurate click timing
 */
class JamMetronome {
    constructor(containerSelector, options = {}) {
        // Accept single element, NodeList, array, or CSS selector string
        if (typeof containerSelector === 'string') {
            this.containers = Array.from(document.querySelectorAll(containerSelector));
        } else if (containerSelector instanceof NodeList) {
            this.containers = Array.from(containerSelector);
        } else if (Array.isArray(containerSelector)) {
            this.containers = containerSelector;
        } else if (containerSelector) {
            this.containers = [containerSelector];
        } else {
            this.containers = [];
        }
        this.containers = this.containers.filter(c => c != null);

        // Keep legacy .container reference (first container)
        this.container = this.containers[0] || null;

        this.bpm = options.bpm || 120;
        this.beatOffset = options.beatOffset || 0;
        this.beatsPerBar = options.beatsPerBar || 4;
        this.getCurrentTime = options.getCurrentTime || (() => 0);
        this.audioContext = options.audioContext || null;

        this.dotSets = []; // Array of dot arrays (one per container)
        this.dots = [];    // Legacy: first container's dots
        this.animationId = null;
        this.running = false;
        this.lastBeat = -1;

        // Haptic settings
        this.hapticMode = localStorage.getItem('jam_haptic_mode') || 'off';

        // Click settings (simplified: on or off)
        this.clickMode = localStorage.getItem('jam_click_mode') || 'off';
        // Normalize legacy modes to 'all' or 'off'
        if (this.clickMode !== 'off') this.clickMode = 'all';
        this.clickVolume = parseFloat(localStorage.getItem('jam_click_volume') || '0.5');
        // Resolution: 1 = on time (every beat), 0.5 = half time (every 2 beats), 2 = double time (twice per beat)
        this.clickResolution = parseFloat(localStorage.getItem('jam_click_resolution') || '1');
        this.clickGainNode = null;

        // Toggle icon references
        this._toggleIcons = [];

        // Precount settings (stored as beat count: 0=off, 2, 4, 8)
        this.precountAudible = localStorage.getItem('jam_precount_audible') !== 'false';
        this.precountBeats = parseInt(localStorage.getItem('jam_precount_beats') || '0', 10);
        this._precounting = false;
        this._precountAnimId = null;
        this._precountTotal = 0;
        this._precountCallback = null;
        this._precountScheduledNodes = [];
        this._precountStartTime = 0;
        this._precountEndTime = 0;
        this._precountBeatDuration = 0;
        this._precountLastVisualBeat = -1;

        // Beat map (variable tempo): array of beat timestamps in seconds
        this.beatTimes = null;
        this._beatTimesReady = false;

        // Beat positions from downbeat detector (1=downbeat, 2,3,4=regular beats in bar)
        this.beatPositions = null;

        // Look-ahead click scheduling
        this._scheduledBeatIndex = -1;   // Last beat index scheduled for audio click
        this._scheduledNodes = [];        // Scheduled oscillators (for cleanup on stop)
        this._lookAheadTime = 0.1;       // Schedule clicks 100ms ahead

        // Playback rate callback: returns the ratio between song-time and real-time
        // (e.g., 1.5 means song advances 1.5x faster than real clock)
        this.getPlaybackRate = options.getPlaybackRate || (() => 1.0);

        // Audio pipeline latency compensation (seconds).
        // When stems go through SoundTouch AudioWorklet, they arrive later than
        // the metronome click (which is a direct oscillator). This delay shifts
        // clicks forward to match the perceived audio output.
        this.clickLatencyOffset = 0;
        // ── Manual beat-grid alignment offset (seconds) ──────────────────
        // A single user-facing nudge applied to the WHOLE effective beat grid
        // (every click, the visual dot, AND the precount). Positive = grid
        // later (clicks land later). This is on top of the backend's built-in
        // +25 ms madmom latency correction. Sources that write it:
        //   - Tap Sync (re-derives phase against the user's taps)
        //   - The +/- fine-tune buttons in the metronome popover
        // Persisted per-track by the mixer via the 'metronomeOffsetChanged' event.
        this.manualOffsetSec = options.manualOffsetSec || 0;

        // Tap Sync state
        this.tapSyncOffset = 0;
        this._tapTimes = [];          // wall-clock (performance.now) per tap — BPM estimate
        this._tapSongPositions = [];  // song position (getCurrentTime) per tap — phase alignment
        this._tapResetTimer = null;
        this._tapAutoCloseTimer = null;

        // Long-press state
        this._longPressTimers = [];
        this._activePopover = null;

        if (this.containers.length > 0) {
            this.render();
        }
    }

    render() {
        this.dotSets = [];
        this._toggleIcons = [];
        for (const container of this.containers) {
            container.innerHTML = '';
            container.classList.add('metronome-container');

            // Single dot — no downbeat distinction
            const dots = [];
            const dot = document.createElement('div');
            dot.className = 'metronome-dot';
            container.appendChild(dot);
            dots.push(dot);
            this.dotSets.push(dots);

            // Add click toggle icon
            const toggleIcon = document.createElement('span');
            toggleIcon.className = 'metronome-toggle-icon';
            toggleIcon.innerHTML = this.clickMode === 'off'
                ? '<i class="fas fa-volume-mute"></i>'
                : '<i class="fas fa-volume-up"></i>';
            if (this.clickMode === 'off') toggleIcon.classList.add('muted');
            container.appendChild(toggleIcon);
            this._toggleIcons.push(toggleIcon);
        }
        // Legacy: keep this.dots pointing to first set
        this.dots = this.dotSets[0] || [];

        this._setupToggleListeners();
        this._setupLongPress();
    }

    // ── Click Toggle ──────────────────────────────────────────────

    _setupToggleListeners() {
        for (const icon of this._toggleIcons) {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleClick();
            });
        }
    }

    toggleClick() {
        // Simple on/off toggle
        this.clickMode = this.clickMode === 'off' ? 'all' : 'off';
        localStorage.setItem('jam_click_mode', this.clickMode);
        this._updateToggleIcons();

        // Directly control clickGainNode volume
        if (this.clickGainNode) {
            this.clickGainNode.gain.value = this.clickMode === 'off' ? 0 : this.clickVolume;
        }
    }

    _updateToggleIcons() {
        const isMuted = this.clickMode === 'off';
        for (const icon of this._toggleIcons) {
            icon.innerHTML = isMuted
                ? '<i class="fas fa-volume-mute"></i>'
                : '<i class="fas fa-volume-up"></i>';
            icon.classList.toggle('muted', isMuted);
        }
    }

    // ── Long-Press Popover for Precount Settings ──────────────────

    _setupLongPress() {
        this._longPressTimers = [];

        for (const container of this.containers) {
            // Prevent browser default long-press behavior (Android context menu, iOS callout)
            container.style.touchAction = 'none';
            container.style.webkitTouchCallout = 'none';
            container.style.userSelect = 'none';
            container.style.webkitUserSelect = 'none';

            let timerId = null;

            const onDown = (e) => {
                if (e.target.closest('.metronome-toggle-icon')) return;
                if (window.JAM_GUEST_MODE) return; // Guests can't change precount settings
                e.preventDefault(); // Suppress Android context menu
                timerId = setTimeout(() => {
                    timerId = null;
                    this._showPrecountPopover(container);
                }, 500);
            };

            const onUp = () => {
                if (timerId) {
                    clearTimeout(timerId);
                    timerId = null;
                }
            };

            container.addEventListener('pointerdown', onDown);
            container.addEventListener('pointerup', onUp);
            container.addEventListener('pointerleave', onUp);
            container.addEventListener('pointercancel', onUp);
        }
    }

    _showPrecountPopover(container) {
        this._hidePrecountPopover();

        const popover = document.createElement('div');
        popover.className = 'metronome-precount-popover';

        // Prevent events from bubbling to mixer tabs
        popover.addEventListener('pointerdown', (e) => e.stopPropagation());
        popover.addEventListener('click', (e) => e.stopPropagation());
        popover.addEventListener('mousedown', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.className = 'metronome-precount-title';
        title.textContent = 'Pre-count';
        popover.appendChild(title);

        const options = [
            { label: 'Off', value: 0 },
            { label: '2 Beats', value: 2 },
            { label: '4 Beats', value: 4 },
            { label: '8 Beats', value: 8 }
        ];

        for (const opt of options) {
            const item = document.createElement('div');
            item.className = 'metronome-precount-option';
            if (this.precountBeats === opt.value) item.classList.add('active');
            item.textContent = opt.label;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setPrecountBeats(opt.value);
                this._hidePrecountPopover();
            });
            popover.appendChild(item);
        }

        // Precount audio toggle
        const pcAudioRow = document.createElement('div');
        pcAudioRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px;color:#ccc;cursor:pointer';
        const pcCheckbox = document.createElement('input');
        pcCheckbox.type = 'checkbox';
        pcCheckbox.checked = this.precountAudible;
        pcCheckbox.style.cursor = 'pointer';
        pcCheckbox.addEventListener('click', (e) => e.stopPropagation());
        pcCheckbox.addEventListener('change', (e) => {
            e.stopPropagation();
            this.precountAudible = e.target.checked;
            localStorage.setItem('jam_precount_audible', this.precountAudible.toString());
        });
        const pcLabel = document.createElement('span');
        pcLabel.textContent = 'Precount audio';
        pcAudioRow.appendChild(pcCheckbox);
        pcAudioRow.appendChild(pcLabel);
        pcAudioRow.addEventListener('click', (e) => {
            e.stopPropagation();
            pcCheckbox.checked = !pcCheckbox.checked;
            pcCheckbox.dispatchEvent(new Event('change'));
        });
        popover.appendChild(pcAudioRow);

        // Volume slider
        const volTitle = document.createElement('div');
        volTitle.className = 'metronome-precount-title';
        volTitle.style.marginTop = '6px';
        volTitle.textContent = 'Volume';
        popover.appendChild(volTitle);

        const sliderRow = document.createElement('div');
        sliderRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 10px 6px';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '3';
        slider.step = '0.05';
        slider.value = this.clickVolume.toString();
        slider.className = 'metronome-volume-slider';
        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            this.setClickVolume(parseFloat(e.target.value));
        });
        slider.addEventListener('pointerdown', (e) => e.stopPropagation());

        sliderRow.appendChild(slider);
        popover.appendChild(sliderRow);

        // Resolution selector
        const resTitle = document.createElement('div');
        resTitle.className = 'metronome-precount-title';
        resTitle.style.marginTop = '6px';
        resTitle.textContent = 'Resolution';
        popover.appendChild(resTitle);

        const resOptions = [
            { label: 'Half time', value: 0.5 },
            { label: 'On time', value: 1 },
            { label: 'Double time', value: 2 }
        ];

        for (const opt of resOptions) {
            const item = document.createElement('div');
            item.className = 'metronome-precount-option';
            if (this.clickResolution === opt.value) item.classList.add('active');
            item.textContent = opt.label;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setClickResolution(opt.value);
                this._hidePrecountPopover();
            });
            popover.appendChild(item);
        }

        // ── Tap to Sync section ──────────────────────────────────
        const tapTitle = document.createElement('div');
        tapTitle.className = 'metronome-precount-title';
        tapTitle.style.marginTop = '6px';
        tapTitle.textContent = 'Tap to Sync';
        popover.appendChild(tapTitle);

        const tapBtn = document.createElement('div');
        tapBtn.className = 'metronome-tap-sync-btn';
        tapBtn.textContent = 'Tap to Sync';
        tapBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        tapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._handleTapSync(tapBtn, popover);
        });
        popover.appendChild(tapBtn);

        // ── Fine-tune alignment section ──────────────────────────
        // These buttons shift the WHOLE effective beat grid (clicks, the
        // visual dot, AND the precount) via manualOffsetSec. Positive =
        // grid later. Applied on top of the backend latency correction.
        const nudgeTitle = document.createElement('div');
        nudgeTitle.className = 'metronome-precount-title';
        nudgeTitle.style.marginTop = '6px';
        nudgeTitle.textContent = 'Fine-tune Align';
        popover.appendChild(nudgeTitle);

        const nudgeRow = document.createElement('div');
        nudgeRow.className = 'metronome-nudge-row';

        const nudgeValues = [
            { label: '-5ms', delta: -0.005 },
            { label: '-1ms', delta: -0.001 },
            { label: '+1ms', delta:  0.001 },
            { label: '+5ms', delta:  0.005 }
        ];

        for (const nv of nudgeValues) {
            const btn = document.createElement('div');
            btn.className = 'metronome-nudge-btn';
            btn.textContent = nv.label;
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.nudgeManualOffset(nv.delta);
                this._updateNudgeDisplay();
                this._emitManualOffsetChanged();
            });
            nudgeRow.appendChild(btn);
        }

        popover.appendChild(nudgeRow);

        // Alignment offset display. Clicking it resets the offset to 0.
        const nudgeDisplay = document.createElement('div');
        nudgeDisplay.className = 'metronome-nudge-display';
        nudgeDisplay.style.cursor = 'pointer';
        nudgeDisplay.title = 'Click to reset alignment to 0';
        nudgeDisplay.addEventListener('pointerdown', (e) => e.stopPropagation());
        nudgeDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setManualOffset(0);
            this._updateNudgeDisplay();
            this._emitManualOffsetChanged();
        });
        popover.appendChild(nudgeDisplay);
        this._nudgeDisplay = nudgeDisplay;
        this._updateNudgeDisplay();

        // Position on document.body with fixed positioning
        const rect = container.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.left = `${rect.left + rect.width / 2}px`;
        popover.style.transform = 'translateX(-50%)';

        document.body.appendChild(popover);
        this._activePopover = popover;

        // Choose direction: open downward if not enough space above
        const popoverHeight = popover.offsetHeight;
        const spaceAbove = rect.top;
        if (spaceAbove >= popoverHeight + 8) {
            popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        } else {
            popover.style.top = `${rect.bottom + 8}px`;
        }

        // Close on click outside (after a small delay to avoid immediate close)
        setTimeout(() => {
            this._popoverCloseHandler = (e) => {
                if (!popover.contains(e.target)) {
                    this._hidePrecountPopover();
                }
            };
            document.addEventListener('pointerdown', this._popoverCloseHandler);
        }, 50);
    }

    _hidePrecountPopover() {
        if (this._activePopover) {
            this._activePopover.remove();
            this._activePopover = null;
        }
        if (this._popoverCloseHandler) {
            document.removeEventListener('pointerdown', this._popoverCloseHandler);
            this._popoverCloseHandler = null;
        }        // Clean up tap sync timers
        if (this._tapResetTimer) {
            clearTimeout(this._tapResetTimer);
            this._tapResetTimer = null;
        }
        if (this._tapAutoCloseTimer) {
            clearTimeout(this._tapAutoCloseTimer);
            this._tapAutoCloseTimer = null;
        }
        this._tapTimes = [];
        this._tapSongPositions = [];
        this._nudgeDisplay = null;
    }

    // ── Tap Sync ─────────────────────────────────────────────────

    /**
     * Handle a single tap for "Tap to Sync".
     *
     * Two modes, decided by whether playback is active:
     *
     *  • PLAYBACK ACTIVE — each tap also records the current song position
     *    (getCurrentTime). After ≥4 taps we find, for every tapped position,
     *    the nearest beat in the EFFECTIVE grid and take the mean signed delta
     *    (tapPos − nearestBeat). That delta is exactly how far the existing
     *    variable-tempo grid must shift to sit under the user's taps, so we
     *    apply it with nudgeManualOffset(). The madmom grid is preserved —
     *    only its phase moves. The detected BPM is shown as info only.
     *
     *  • STOPPED — we have no playback clock to anchor phase, so we fall back
     *    to the legacy behavior: show the BPM and set it (constant-BPM path),
     *    but make NO alignment change.
     *
     * After 4+ taps, auto-apply and close after 1 second.
     * Resets if no tap for 2 seconds.
     */
    _handleTapSync(tapBtn, popover) {
        const now = performance.now();
        const songPos = this.getCurrentTime();

        // Clear the 2-second inactivity reset timer
        if (this._tapResetTimer) {
            clearTimeout(this._tapResetTimer);
            this._tapResetTimer = null;
        }

        // Clear any pending auto-close timer
        if (this._tapAutoCloseTimer) {
            clearTimeout(this._tapAutoCloseTimer);
            this._tapAutoCloseTimer = null;
        }

        this._tapTimes.push(now);
        this._tapSongPositions.push(songPos);

        // Set a 2-second inactivity timer to reset
        this._tapResetTimer = setTimeout(() => {
            this._tapTimes = [];
            this._tapSongPositions = [];
            if (tapBtn && tapBtn.isConnected) {
                tapBtn.textContent = 'Tap to Sync';
                tapBtn.classList.remove('metronome-tap-sync-applied');
            }
        }, 2000);

        const tapCount = this._tapTimes.length;

        if (tapCount < 2) {
            tapBtn.textContent = 'Tap...';
            return;
        }

        // Calculate average interval from all taps
        const intervals = [];
        for (let i = 1; i < this._tapTimes.length; i++) {
            intervals.push(this._tapTimes[i] - this._tapTimes[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const detectedBPM = Math.round(60000 / avgInterval);

        if (tapCount < 3) {
            tapBtn.textContent = `Tap... ${detectedBPM} BPM`;
            return;
        }

        // 3+ taps: show running BPM estimate
        tapBtn.textContent = `Tap... ${detectedBPM} BPM`;

        if (tapCount >= 4) {
            // Decide whether we have a live playback clock: the song position
            // must be positive AND have actually advanced across the taps.
            const positions = this._tapSongPositions;
            const firstPos = positions[0];
            const lastPos = positions[positions.length - 1];
            const playbackActive = lastPos > 0 && Math.abs(lastPos - firstPos) > 0.05;

            let aligned = false;
            if (playbackActive && this._beatTimesReady) {
                // Shift the existing grid onto the taps (do NOT rebuild it).
                const meanDelta = this._computeTapAlignmentDelta(positions);
                if (meanDelta !== null && isFinite(meanDelta)) {
                    this.nudgeManualOffset(meanDelta);
                    this._updateNudgeDisplay();
                    this._emitManualOffsetChanged();
                    aligned = true;
                }
            }

            if (!aligned) {
                // Stopped (or no beat grid): legacy constant-BPM fallback.
                // No phase information is available, so don't touch alignment.
                this.setBPM(detectedBPM);
            }

            // Show applied state (report alignment when we shifted the grid)
            tapBtn.textContent = aligned
                ? `Aligned: ${detectedBPM} BPM`
                : `Applied: ${detectedBPM} BPM`;
            tapBtn.classList.add('metronome-tap-sync-applied');

            // Clear the reset timer since we're done
            if (this._tapResetTimer) {
                clearTimeout(this._tapResetTimer);
                this._tapResetTimer = null;
            }

            // Auto-close popover after 1 second
            this._tapAutoCloseTimer = setTimeout(() => {
                this._tapTimes = [];
                this._tapSongPositions = [];
                this._tapAutoCloseTimer = null;
                this._hidePrecountPopover();
            }, 1000);
        }
    }

    /**
     * Given an array of tapped song positions, compute the mean signed delta
     * (tapPos − nearestEffectiveBeat). This is how far the grid must move to
     * land on the taps. Returns null if no usable beat grid exists.
     */
    _computeTapAlignmentDelta(tapPositions) {
        const beats = (this._beatTimesReady && this.beatTimes && this.beatTimes.length >= 2)
            ? this._getEffectiveBeats() : null;
        if (!beats || beats.length === 0) return null;

        const n = beats.length;
        let sum = 0;
        let count = 0;
        for (const pos of tapPositions) {
            if (!(pos > 0)) continue; // skip taps with no valid position

            // Binary search for the last beat at or before pos.
            let lo = 0, hi = n - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >>> 1;
                if (beats[mid] <= pos) lo = mid;
                else hi = mid - 1;
            }
            // Nearest beat is either beats[lo] or beats[lo+1].
            let nearest = beats[lo];
            if (lo + 1 < n && Math.abs(beats[lo + 1] - pos) < Math.abs(pos - nearest)) {
                nearest = beats[lo + 1];
            }
            sum += (pos - nearest);
            count++;
        }
        if (count === 0) return null;
        return sum / count;
    }

    /**
     * Refresh the alignment display in the popover (if open) to reflect the
     * current manualOffsetSec. Shows e.g. "Align: +12.5 ms".
     */
    _updateNudgeDisplay() {
        if (this._nudgeDisplay && this._nudgeDisplay.isConnected) {
            const ms = (this.manualOffsetSec || 0) * 1000;
            const sign = ms >= 0 ? '+' : '';
            this._nudgeDisplay.textContent = `Align: ${sign}${ms.toFixed(1)} ms`;
        }
    }

    /**
     * Dispatch the 'metronomeOffsetChanged' event so the mixer can persist the
     * manual offset per-track. Carries the current video_id (from
     * window.EXTRACTION_INFO) and the offset in milliseconds.
     */
    _emitManualOffsetChanged() {
        const videoId = (typeof window !== 'undefined' && window.EXTRACTION_INFO)
            ? window.EXTRACTION_INFO.video_id : undefined;
        window.dispatchEvent(new CustomEvent('metronomeOffsetChanged', {
            detail: { video_id: videoId, offsetMs: (this.manualOffsetSec || 0) * 1000 }
        }));
    }

    /**
     * Backwards-compatible alias: legacy callers nudged tapSyncOffset, which
     * never affected audio. Delegate to the real grid-alignment offset so the
     * displayed value always reflects manualOffsetSec.
     */
    _nudgeTapSyncOffset(deltaSec) {
        this.nudgeManualOffset(deltaSec);
        this._updateNudgeDisplay();
        this._emitManualOffsetChanged();
    }

    // ── Precount Engine ───────────────────────────────────────────

    /**
     * Start a precount (count-in) sequence.
     * All clicks are scheduled upfront on the Web Audio clock.
     * Visual dot animates via requestAnimationFrame.
     * Calls onComplete when the precount duration has elapsed.
     */
    startPrecount(precountBeats, onComplete) {
        this.cancelPrecount();
        if (!precountBeats || precountBeats <= 0 || this.bpm <= 0) {
            if (onComplete) onComplete();
            return;
        }

        this._precounting = true;
        this._precountTotal = precountBeats;
        this._precountCallback = onComplete;
        this._precountScheduledNodes = [];

        this._ensureClickGain();

        const ctx = this.audioContext;

        // Derive the click interval from the EFFECTIVE beat grid so the
        // precount spacing matches exactly what the running metronome plays
        // (same resolution, same local tempo). A constant manual offset does
        // not change inter-beat spacing, so the interval is robust to it.
        let clickInterval;
        const eb = (this._beatTimesReady && this.beatTimes && this.beatTimes.length >= 2)
            ? this._getEffectiveBeats() : null;
        if (eb && eb.length >= 2) {
            const count = Math.min(4, eb.length - 1);
            let sum = 0;
            for (let i = 0; i < count; i++) sum += eb[i + 1] - eb[i];
            clickInterval = sum / count;  // already resolution-adjusted by _getEffectiveBeats
        } else {
            const beatDuration = 60 / this.bpm;
            const step = 1 / this.clickResolution;
            clickInterval = beatDuration * step;
        }

        const baseTime = ctx ? ctx.currentTime : performance.now() / 1000;

        this._precountStartTime = baseTime;
        this._precountBeatDuration = clickInterval;
        this._precountEndTime = baseTime + precountBeats * clickInterval;

        // Pre-schedule click sounds (only if precount audio is enabled)
        if (ctx && this.precountAudible) {
            for (let i = 0; i < precountBeats; i++) {
                const beatTime = baseTime + i * clickInterval;
                this._schedulePrecountClick(beatTime);
            }
        }

        // Start visual animation loop
        this._precountAnimId = requestAnimationFrame(() => this._precountVisualUpdate());
    }

    /**
     * Schedule a single precount click at an exact Web Audio time.
     */
    _schedulePrecountClick(when) {
        if (!this.audioContext || !this.precountGainNode) return;

        const ctx = this.audioContext;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.frequency.value = 1200;
        osc.type = 'sine';

        env.gain.setValueAtTime(0.8, when);
        env.gain.exponentialRampToValueAtTime(0.001, when + 0.04);

        osc.connect(env);
        env.connect(this.precountGainNode);

        osc.start(when);
        osc.stop(when + 0.05);

        this._precountScheduledNodes.push(osc);
    }

    /**
     * requestAnimationFrame loop for precount visual dot + haptic.
     */
    _precountVisualUpdate() {
        if (!this._precounting) return;

        const ctx = this.audioContext;
        const now = ctx ? ctx.currentTime : performance.now() / 1000;

        // Check if precount is done
        if (now >= this._precountEndTime) {
            const cb = this._precountCallback;
            this._clearPrecountState();
            if (cb) cb();
            return;
        }

        const elapsed = now - this._precountStartTime;
        const currentBeat = Math.floor(elapsed / this._precountBeatDuration);
        const beatPhase = (elapsed / this._precountBeatDuration) - currentBeat;

        // Pulse single dot across all containers
        for (const dots of this.dotSets) {
            const dot = dots[0];
            if (!dot) continue;
            const brightness = 1.0 - (beatPhase * 0.7);
            const scale = 1.0 + (1 - beatPhase) * 0.3;
            dot.style.opacity = brightness.toFixed(2);
            dot.style.transform = `scale(${scale.toFixed(2)})`;
        }

        // Trigger haptic on beat change
        if (currentBeat !== this._precountLastVisualBeat) {
            this._precountLastVisualBeat = currentBeat;
            this._triggerHaptic();
        }

        this._precountAnimId = requestAnimationFrame(() => this._precountVisualUpdate());
    }

    cancelPrecount() {
        if (!this._precounting) return;
        this._clearPrecountState();
        // Dim dot
        for (const dots of this.dotSets) {
            const dot = dots[0];
            if (dot) {
                dot.style.opacity = '0.3';
                dot.style.transform = 'scale(1)';
            }
        }
    }

    _clearPrecountState() {
        if (this._precountAnimId) {
            cancelAnimationFrame(this._precountAnimId);
            this._precountAnimId = null;
        }
        if (this._precountScheduledNodes) {
            for (const node of this._precountScheduledNodes) {
                try { node.stop(); } catch(e) {}
            }
            this._precountScheduledNodes = [];
        }
        this._precounting = false;
        this._precountTotal = 0;
        this._precountCallback = null;
        this._precountStartTime = 0;
        this._precountEndTime = 0;
        this._precountBeatDuration = 0;
        this._precountLastVisualBeat = -1;
    }

    isPrecounting() {
        return this._precounting;
    }

    setPrecountBeats(beats) {
        this.precountBeats = Math.max(0, Math.floor(beats));
        localStorage.setItem('jam_precount_beats', this.precountBeats.toString());
    }

    getPrecountBeats() {
        return this.precountBeats;
    }

    // ── Beat Map (Variable Tempo) ──────────────────────────────────

    setBeatTimes(beatTimes) {
        if (Array.isArray(beatTimes) && beatTimes.length > 1) {
            // Compute BPM from median interval (robust to outliers unlike regression)
            const intervals = [];
            for (let i = 1; i < beatTimes.length; i++) {
                intervals.push(beatTimes[i] - beatTimes[i - 1]);
            }
            intervals.sort((a, b) => a - b);
            const medianInterval = intervals[Math.floor(intervals.length / 2)];
            const medianBPM = 60 / medianInterval;

            // Store the actual beat times as-is (no regularization).
            // A constant grid drifts from real beats; the beat map stays locked.
            this.bpm = medianBPM;
            this.beatOffset = beatTimes[0];
            console.log(`[Metronome] BPM from median: ${medianBPM.toFixed(2)} (interval: ${(medianInterval*1000).toFixed(1)}ms, offset: ${this.beatOffset.toFixed(4)}s, ${beatTimes.length} beats)`);

            // Extrapolate beats backwards to cover from time 0
            const interval = medianInterval;
            if (interval > 0 && beatTimes[0] > 0.01) {
                const extra = [];
                let t = beatTimes[0] - interval;
                while (t >= -0.01) {
                    extra.unshift(Math.max(0, t));
                    t -= interval;
                }
                this.beatTimes = [...extra, ...beatTimes];

                // Also prepend beat positions by cycling backward through the bar
                if (this.beatPositions && extra.length > 0) {
                    const firstPos = this.beatPositions[0];
                    const bpb = this.beatsPerBar;
                    const extraPositions = [];
                    for (let i = extra.length; i > 0; i--) {
                        const pos = ((firstPos - 1 - i) % bpb + bpb) % bpb + 1;
                        extraPositions.push(pos);
                    }
                    this.beatPositions = [...extraPositions, ...this.beatPositions];
                }
            } else {
                this.beatTimes = [...beatTimes];
            }
            this._beatTimesReady = true;
            this._effectiveBeats = null;
            this._effectiveBeatsKey = null;
            console.log(`[Metronome] Beat map loaded: ${beatTimes.length} original → ${this.beatTimes.length} regularized (extrapolated to 0)`);
        } else if (Array.isArray(beatTimes) && beatTimes.length === 1) {
            this.beatTimes = beatTimes;
            this._beatTimesReady = true;
            this._effectiveBeats = null;
            this._effectiveBeatsKey = null;
            console.log(`[Metronome] Beat map loaded: 1 beat`);
        }
    }

    /**
     * Set beat-in-bar positions from downbeat detector (1=downbeat, 2,3,4=regular).
     * Must be called BEFORE setBeatTimes() for correct extrapolation alignment.
     */
    setBeatPositions(positions) {
        if (Array.isArray(positions) && positions.length > 0) {
            this.beatPositions = positions;
            console.log(`[Metronome] Beat positions loaded: ${positions.length} positions`);
        }
    }

    /**
     * Get the timestamp of the first detected beat (where real music starts).
     * Uses beat map if available, otherwise falls back to beatOffset.
     */
    getFirstBeatTime() {
        if (this._beatTimesReady && this.beatTimes.length > 0) {
            return this.beatTimes[0];
        }
        if (this.beatOffset > 0) {
            return this.beatOffset;
        }
        return 0;
    }

    /**
     * Get the timestamp of the first REAL detected beat (before backward extrapolation).
     * This is where the actual musical beat grid begins.
     */
    getFirstRealBeat() {
        return this.beatOffset || 0;
    }

    /**
     * Find the downbeat (beat 1) of the bar containing the given position.
     * Returns the timestamp of beat 1 at or before `position`.
     * @param {number} position - Song time in seconds
     * @returns {number} Timestamp of the bar's downbeat
     */
    findBarDownbeat(position) {
        if (!this._beatTimesReady || !this.beatTimes || this.beatTimes.length < 2) {
            // Constant BPM fallback
            if (this.bpm <= 0) return position;
            const beatDuration = 60 / this.bpm;
            const barDuration = beatDuration * this.beatsPerBar;
            const timeSinceOffset = position - (this.beatOffset || 0);
            if (timeSinceOffset < 0) return this.beatOffset || 0;
            const barIndex = Math.floor(timeSinceOffset / barDuration);
            return (this.beatOffset || 0) + barIndex * barDuration;
        }

        // Binary search: find last beat at or before position
        const bt = this.beatTimes;
        let lo = 0, hi = bt.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (bt[mid] <= position + 0.001) lo = mid;
            else hi = mid - 1;
        }
        const beatIdx = lo;

        // Walk backward through beatPositions to find downbeat (value === 1)
        if (this.beatPositions && this.beatPositions.length === bt.length) {
            for (let i = beatIdx; i >= 0; i--) {
                if (this.beatPositions[i] === 1) {
                    return bt[i];
                }
            }
            return bt[0];
        }

        // Fallback: use beatsPerBar modular arithmetic
        const posInBar = beatIdx % this.beatsPerBar;
        const downbeatIdx = beatIdx - posInBar;
        return bt[Math.max(0, downbeatIdx)];
    }

    /**
     * Get the exact precount duration in seconds for the given number of beats.
     * Uses beat map intervals when available (matches startPrecount's internal timing).
     */
    getPrecountDuration(precountBeats) {
        const eb = (this._beatTimesReady && this.beatTimes && this.beatTimes.length >= 2)
            ? this._getEffectiveBeats() : null;
        if (eb && eb.length >= 2) {
            const count = Math.min(4, eb.length - 1);
            let sum = 0;
            for (let i = 0; i < count; i++) sum += eb[i + 1] - eb[i];
            const clickInterval = sum / count; // already resolution-adjusted
            return precountBeats * clickInterval;
        }
        const beatDuration = 60 / this.bpm;
        const step = 1 / this.clickResolution;
        return precountBeats * beatDuration * step;
    }

    /**
     * Get beat info at a given time, using effective beat grid (resolution-aware).
     * Returns { beatIndex, beatInBar, beatPhase, valid }.
     */
    _getBeatInfo(currentTime) {
        if (this._beatTimesReady) {
            return this._getBeatInfoFromMap(currentTime);
        }
        return this._getBeatInfoConstant(currentTime);
    }

    /**
     * Binary search effective beat grid to find current beat position.
     * Uses resolution-adjusted grid so visual matches audio clicks.
     */
    _getBeatInfoFromMap(currentTime) {
        const beats = this._getEffectiveBeats();
        const n = beats.length;

        if (currentTime < beats[0]) {
            return { beatIndex: -1, beatInBar: -1, beatPhase: 0, valid: false };
        }

        // Binary search: find last beat at or before currentTime
        let lo = 0, hi = n - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (beats[mid] <= currentTime) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        const beatIndex = lo;
        const beatInBar = beatIndex % this.beatsPerBar;

        let beatPhase = 0;
        if (beatIndex < n - 1) {
            const beatStart = beats[beatIndex];
            const beatEnd = beats[beatIndex + 1];
            const interval = beatEnd - beatStart;
            if (interval > 0) {
                beatPhase = (currentTime - beatStart) / interval;
                beatPhase = Math.max(0, Math.min(1, beatPhase));
            }
        }

        return { beatIndex, beatInBar, beatPhase, valid: true };
    }

    /**
     * Constant-BPM fallback: compute beat info from BPM and beat offset.
     * Applies resolution so visual matches audio clicks.
     */
    _getBeatInfoConstant(currentTime) {
        if (this.bpm <= 0) {
            return { beatIndex: -1, beatInBar: -1, beatPhase: 0, valid: false };
        }

        const baseBeatDuration = 60 / this.bpm;
        const step = 1 / this.clickResolution; // base beats per click
        const clickDuration = baseBeatDuration * step;
        // Align grid to first downbeat — allow negative to extrapolate before beatOffset
        const timeSinceFirstBeat = currentTime - this.beatOffset;

        const totalClicks = timeSinceFirstBeat / clickDuration;
        const beatIndex = Math.floor(totalClicks);
        // Modulo that works correctly for negative numbers
        const beatInBar = ((beatIndex % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
        const beatPhase = totalClicks - beatIndex;

        return { beatIndex, beatInBar, beatPhase, valid: true };
    }

    // ── Playback Animation ────────────────────────────────────────

    start(options = {}) {
        if (this.running) return;
        // Don't start regular metronome while precount is playing
        if (this._precounting) return;
        this.running = true;
        this._ensureClickGain();

        // Reset look-ahead scheduling state
        this._scheduledBeatIndex = -1;
        this._scheduledNodes = [];

        this.lastBeat = -1;

        if (this.clickMode !== 'off' && this.audioContext) {
            // Pre-schedule first beats with a wider window (1s)
            // so the downbeat isn't missed when starting from position 0
            const saved = this._lookAheadTime;
            this._lookAheadTime = 1.0;
            this._scheduleUpcomingClicks(this.getCurrentTime());
            this._lookAheadTime = saved;
        }

        this._update();
    }

    stop() {
        this.running = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        // Clean up scheduled click nodes
        this._cancelScheduledClicks();
        // Dim dot across all containers
        for (const dots of this.dotSets) {
            const dot = dots[0];
            if (dot) {
                dot.style.opacity = '0.3';
                dot.style.transform = 'scale(1)';
            }
        }
    }

    _cancelScheduledClicks() {
        for (const node of this._scheduledNodes) {
            try { node.stop(); } catch(e) {}
        }
        this._scheduledNodes = [];
        this._scheduledBeatIndex = -1;
    }

    /**
     * Reset scheduling state (call on seek to avoid stale beat indices).
     */
    resetScheduling() {
        this._cancelScheduledClicks();
        this.lastBeat = -1;
    }

    _update() {
        if (!this.running) return;

        const currentTime = this.getCurrentTime();

        // Always schedule upcoming clicks regardless of visual beat state
        // (prevents silent gap when playback starts before the first beat in the map)
        if (this.clickMode !== 'off' && this.audioContext) {
            this._scheduleUpcomingClicks(currentTime);
        }

        const info = this._getBeatInfo(currentTime);

        if (!info.valid) {
            // Before the first beat or no BPM — dim dot
            for (const dots of this.dotSets) {
                const dot = dots[0];
                if (dot) {
                    dot.style.opacity = '0.3';
                    dot.style.transform = 'scale(1)';
                }
            }
            this.animationId = requestAnimationFrame(() => this._update());
            return;
        }

        const { beatIndex, beatInBar, beatPhase } = info;

        // Pulse single dot based on beat phase
        for (const dots of this.dotSets) {
            const dot = dots[0];
            if (!dot) continue;
            const brightness = 1.0 - (beatPhase * 0.7);
            const scale = 1.0 + (1 - beatPhase) * 0.3;
            dot.style.opacity = brightness.toFixed(2);
            dot.style.transform = `scale(${scale.toFixed(2)})`;
        }

        // Trigger haptic on beat change
        if (beatInBar !== this.lastBeat) {
            this.lastBeat = beatInBar;
            this._triggerHaptic();
        }

        this.animationId = requestAnimationFrame(() => this._update());
    }

    // ── Look-Ahead Click Scheduling ───────────────────────────────

    /**
     * Pre-schedule click sounds on the Web Audio clock for upcoming beats.
     * This gives sample-accurate timing instead of ~16ms rAF jitter.
     */
    _scheduleUpcomingClicks(currentSongTime) {
        const ctx = this.audioContext;
        if (!ctx || this.bpm <= 0) return;
        this._ensureClickGain();

        const audioNow = ctx.currentTime;
        // Compute song position at this exact audioNow instant to eliminate
        // ~16ms rAF lag between the cached playbackPosition and Web Audio clock
        const preciseSongTime = this.getCurrentTime(audioNow);
        const songTime = (preciseSongTime !== undefined && preciseSongTime !== null)
            ? preciseSongTime : currentSongTime;

        // Use beat map when available — stays locked to actual beat positions.
        // Fall back to constant BPM grid only when no beat data exists.
        if (this._beatTimesReady && this.beatTimes && this.beatTimes.length > 1) {
            this._scheduleFromBeatMap(songTime, audioNow);
        } else {
            this._scheduleFromConstantBPM(songTime, audioNow);
        }
    }

    /**
     * Build the effective click grid from beat map + resolution.
     * Cached and invalidated when beatTimes or resolution changes.
     */
    _getEffectiveBeats() {
        const res = this.clickResolution;
        const bt = this.beatTimes;
        const off = this.manualOffsetSec || 0;
        // Cache key includes the manual offset so a nudge invalidates the cache.
        const cacheKey = `${bt.length}_${res}_${off.toFixed(4)}`;
        if (this._effectiveBeatsKey === cacheKey && this._effectiveBeats) {
            return this._effectiveBeats;
        }

        let effective;
        if (res === 0.5) {
            // Half time: keep every other beat
            effective = bt.filter((_, i) => i % 2 === 0);
        } else if (res === 2) {
            // Double time: insert midpoint between each pair
            effective = [];
            for (let i = 0; i < bt.length; i++) {
                effective.push(bt[i]);
                if (i + 1 < bt.length) {
                    effective.push((bt[i] + bt[i + 1]) / 2);
                }
            }
        } else {
            effective = bt.slice();
        }

        // Apply the manual alignment offset to the whole grid (clamp ≥ 0).
        if (off !== 0) {
            effective = effective.map(t => Math.max(0, t + off));
        }

        this._effectiveBeats = effective;
        this._effectiveBeatsKey = cacheKey;
        return effective;
    }
    /**
     * Set the manual beat-grid alignment offset (seconds) and refresh.
     * Applied on top of the backend's built-in latency correction.
     * Positive = grid (clicks/dot/precount) shifted later.
     */
    setManualOffset(offsetSec) {
        const v = Number(offsetSec) || 0;
        // Sanity clamp: a full second of nudge is already absurd.
        this.manualOffsetSec = Math.max(-1.0, Math.min(1.0, v));
        // Invalidate caches so the new grid takes effect immediately.
        this._effectiveBeats = null;
        this._effectiveBeatsKey = null;
        // Re-schedule upcoming clicks if currently running.
        if (this.running) this.resetScheduling();
        return this.manualOffsetSec;
    }

    /** Nudge the manual offset by a delta (seconds). Returns the new value. */
    nudgeManualOffset(deltaSec) {
        return this.setManualOffset((this.manualOffsetSec || 0) + (Number(deltaSec) || 0));
    }

    _scheduleFromBeatMap(currentSongTime, audioNow) {
        const eb = this._getEffectiveBeats();
        if (!eb || eb.length === 0) return;
        // Playback rate: how fast song-time advances relative to real-time
        const rate = this.getPlaybackRate() || 1.0;

        // Find the right starting index based on current song time.
        // If _scheduledBeatIndex is behind current time (e.g. after seek), find
        // the first beat at or after currentSongTime via binary search.
        let startIdx = this._scheduledBeatIndex + 1;
        if (startIdx < 0 || startIdx >= eb.length || eb[startIdx] < currentSongTime - 0.5) {
            // Binary search for first beat >= currentSongTime - small margin
            let lo = 0, hi = eb.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (eb[mid] < currentSongTime - 0.05) lo = mid + 1;
                else hi = mid;
            }
            startIdx = lo;
        }

        for (let i = startIdx; i < eb.length; i++) {
            // Convert song-time delta to real-time delta by dividing by playback rate
            const audioTimeForBeat = audioNow + (eb[i] - currentSongTime) / rate;

            if (audioTimeForBeat > audioNow + this._lookAheadTime) break;
            if (audioTimeForBeat < audioNow - 0.01) continue;

            this._scheduleClickAtTime(audioTimeForBeat);
            this._scheduledBeatIndex = i;
        }
    }

    _scheduleFromConstantBPM(currentSongTime, audioNow) {
        // Always use base beat duration (one beat at detected BPM)
        const baseBeatDuration = 60 / this.bpm;
        const timeSinceFirst = currentSongTime - this.beatOffset;
        // Playback rate: song-time advances at rate × real-time
        const rate = this.getPlaybackRate() || 1.0;

        // Resolution determines which beats to click on:
        // 1 (ontime) = every beat, 0.5 (halftime) = every 2nd beat, 2 (double) = twice per beat
        const res = this.clickResolution;

        // For double time, subdivide beats; for halftime, skip beats
        // step = how many base-beat indices between clicks
        // e.g. res=0.5 → step=2 (click every 2 beats), res=2 → step=0.5 (click twice per beat)
        const step = 1 / res;

        // Current position in base-beat units
        const currentBeatPos = timeSinceFirst / baseBeatDuration;
        // Snap to the grid: find the nearest click index at or before current position
        const currentClickIdx = Math.floor(currentBeatPos / step);
        const startIdx = Math.max(this._scheduledBeatIndex + 1, currentClickIdx);

        for (let i = startIdx; ; i++) {
            // Convert click index back to song time
            const beatSongTime = this.beatOffset + i * step * baseBeatDuration;
            if (beatSongTime < 0) continue;
            // Convert song-time delta → real-time delta (divide by playback rate)
            const audioTimeForBeat = audioNow + (beatSongTime - currentSongTime) / rate;

            if (audioTimeForBeat > audioNow + this._lookAheadTime) break;
            if (audioTimeForBeat < audioNow - 0.01) continue;

            this._scheduleClickAtTime(audioTimeForBeat);
            this._scheduledBeatIndex = i;
        }
    }

    /**
     * Schedule a single click oscillator at an exact Web Audio time.
     * Uniform tone for all beats.
     */
    _scheduleClickAtTime(when) {
        const ctx = this.audioContext;
        if (!ctx || !this.clickGainNode) return;

        // Compensate for audio pipeline latency (SoundTouch worklet)
        const t = when + this.clickLatencyOffset;

        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.frequency.value = 1200;
        osc.type = 'sine';

        env.gain.setValueAtTime(0.8, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

        osc.connect(env);
        env.connect(this.clickGainNode);

        osc.start(t);
        osc.stop(t + 0.05);

        this._scheduledNodes.push(osc);

        // Clean up old nodes periodically
        if (this._scheduledNodes.length > 20) {
            this._scheduledNodes = this._scheduledNodes.slice(-10);
        }
    }

    // ── Haptic ────────────────────────────────────────────────────

    _triggerHaptic() {
        if (!navigator.vibrate || this.hapticMode === 'off') return;
        navigator.vibrate(30);
    }

    // ── Audio Gain ────────────────────────────────────────────────

    _ensureClickGain(destinationNode) {
        if (!this.audioContext) return;
        if (!this.clickGainNode) {
            this.clickGainNode = this.audioContext.createGain();
            this.clickGainNode.gain.value = this.clickVolume;
            // Route to provided destination (mixer chain) or direct to speakers
            const dest = destinationNode || this.audioContext.destination;
            this.clickGainNode.connect(dest);
        }
        // Separate gain for precount clicks — routes directly to destination
        // so precount audio works even when the metronome track is muted
        if (!this.precountGainNode) {
            this.precountGainNode = this.audioContext.createGain();
            this.precountGainNode.gain.value = this.clickVolume;
            this.precountGainNode.connect(this.audioContext.destination);
        }
    }

    // ── Setters / Getters ─────────────────────────────────────────

    setBPM(bpm) {
        this.bpm = bpm;
    }

    setBeatOffset(offset) {
        this.beatOffset = offset;
    }

    setAudioContext(ctx) {
        this.audioContext = ctx;
        this.clickGainNode = null;
        this.precountGainNode = null;
    }

    setHapticMode(mode) {
        this.hapticMode = mode;
        localStorage.setItem('jam_haptic_mode', mode);
    }

    getHapticMode() {
        return this.hapticMode;
    }

    setClickMode(mode) {
        // Normalize to 'all' or 'off'
        this.clickMode = mode === 'off' ? 'off' : 'all';
        localStorage.setItem('jam_click_mode', this.clickMode);
        this._updateToggleIcons();
    }

    getClickMode() {
        return this.clickMode;
    }

    setClickVolume(volume) {
        this.clickVolume = Math.max(0, Math.min(3, volume));
        localStorage.setItem('jam_click_volume', this.clickVolume.toString());
        if (this.clickGainNode) {
            this.clickGainNode.gain.value = this.clickVolume;
        }
        if (this.precountGainNode) {
            this.precountGainNode.gain.value = this.clickVolume;
        }
        // Sync track slider (slider range 0-1, clickVolume range 0-3)
        const trackSlider = document.querySelector('.track[data-stem="metronome"] .volume-slider');
        if (trackSlider) {
            const normalized = this.clickVolume / 3;
            trackSlider.value = normalized;
            const display = document.querySelector('.track[data-stem="metronome"] .volume-value');
            if (display) display.textContent = `${Math.round(normalized * 100)}%`;
            const mixer = window.stemMixer;
            if (mixer && mixer.stems['metronome']) {
                mixer.stems['metronome'].volume = normalized;
            }
        }
    }

    getClickVolume() {
        return this.clickVolume;
    }

    setClickResolution(res) {
        this.clickResolution = res;
        localStorage.setItem('jam_click_resolution', res.toString());
        // Invalidate effective beats cache and reset scheduling
        this._effectiveBeats = null;
        this._effectiveBeatsKey = null;
        this.resetScheduling();
        // Sync track resolution buttons
        const trackEl = document.querySelector('.track[data-stem="metronome"]');
        if (trackEl) {
            trackEl.querySelectorAll('.res-btn').forEach(btn => {
                btn.classList.toggle('active', parseFloat(btn.dataset.res) === res);
            });
        }
        // Redraw beat grid
        const mixer = window.stemMixer;
        if (mixer?.waveform) {
            mixer.waveform.drawMetronomeBeatGrid('metronome');
        }
    }

    getClickResolution() {
        return this.clickResolution;
    }

    destroy() {
        this.stop();
        this.cancelPrecount();
        this._hidePrecountPopover();
        if (this.clickGainNode) {
            this.clickGainNode.disconnect();
            this.clickGainNode = null;
        }        // Clean up tap sync timers
        if (this._tapResetTimer) {
            clearTimeout(this._tapResetTimer);
            this._tapResetTimer = null;
        }
        if (this._tapAutoCloseTimer) {
            clearTimeout(this._tapAutoCloseTimer);
            this._tapAutoCloseTimer = null;
        }
        this._tapTimes = [];
        this._tapSongPositions = [];
        for (const container of this.containers) {
            container.innerHTML = '';
        }
        this.dotSets = [];
        this.dots = [];
        this._toggleIcons = [];
    }
}

if (typeof window !== 'undefined') {
    window.JamMetronome = JamMetronome;
}
