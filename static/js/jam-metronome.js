/**
 * JamMetronome - Visual beat indicator with optional haptic and audible click.
 * Shows a single pulsing dot that flashes on each beat, with uniform click sound.
 *
 * Features:
 * - Tap the speaker icon to toggle audible click on/off
 * - Long-press the metronome to configure precount (off / 1 bar / 2 bars)
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

        // Precount settings
        this.precountBars = parseInt(localStorage.getItem('jam_precount_bars') || '0', 10);
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

        // Sync with metronome track mute button
        const mixer = window.stemMixer;
        if (mixer && mixer.stems['metronome']) {
            const stem = mixer.stems['metronome'];
            const newMuted = this.clickMode === 'off';
            if (stem.muted !== newMuted) {
                stem.muted = newMuted;
                if (stem.gainNode) {
                    stem.gainNode.gain.value = newMuted ? 0 : stem.volume * 3;
                }
                const muteBtn = document.querySelector('.track[data-stem="metronome"] .mute');
                if (muteBtn) muteBtn.classList.toggle('active', newMuted);
                mixer.trackControls?.updateTrackStatus('metronome', !newMuted);
            }
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
            { label: '1 Bar', value: 1 },
            { label: '2 Bars', value: 2 }
        ];

        for (const opt of options) {
            const item = document.createElement('div');
            item.className = 'metronome-precount-option';
            if (this.precountBars === opt.value) item.classList.add('active');
            item.textContent = opt.label;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setPrecountBars(opt.value);
                this._hidePrecountPopover();
            });
            popover.appendChild(item);
        }

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
        }
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

        // Derive beat duration from beat map if available
        let beatDuration;
        if (this._beatTimesReady && this.beatTimes.length >= 2) {
            const count = Math.min(4, this.beatTimes.length - 1);
            let sum = 0;
            for (let i = 0; i < count; i++) sum += this.beatTimes[i + 1] - this.beatTimes[i];
            beatDuration = sum / count;
        } else {
            beatDuration = 60 / this.bpm;
        }

        const baseTime = ctx ? ctx.currentTime : performance.now() / 1000;

        this._precountStartTime = baseTime;
        this._precountBeatDuration = beatDuration;
        this._precountEndTime = baseTime + precountBeats * beatDuration;

        // Pre-schedule ALL click sounds on the Web Audio clock (with downbeat accent)
        if (ctx) {
            for (let i = 0; i < precountBeats; i++) {
                const beatTime = baseTime + i * beatDuration;
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
        if (!this.audioContext || !this.clickGainNode) return;

        const ctx = this.audioContext;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.frequency.value = 1200;
        osc.type = 'sine';

        env.gain.setValueAtTime(0.8, when);
        env.gain.exponentialRampToValueAtTime(0.001, when + 0.04);

        osc.connect(env);
        env.connect(this.clickGainNode);

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

    setPrecountBars(bars) {
        this.precountBars = Math.max(0, Math.floor(bars));
        localStorage.setItem('jam_precount_bars', this.precountBars.toString());
    }

    getPrecountBars() {
        return this.precountBars;
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
     * Get the exact precount duration in seconds for the given number of beats.
     * Uses beat map intervals when available (matches startPrecount's internal timing).
     */
    getPrecountDuration(precountBeats) {
        let beatDuration;
        if (this._beatTimesReady && this.beatTimes.length >= 2) {
            const count = Math.min(4, this.beatTimes.length - 1);
            let sum = 0;
            for (let i = 0; i < count; i++) sum += this.beatTimes[i + 1] - this.beatTimes[i];
            beatDuration = sum / count;
        } else {
            beatDuration = 60 / this.bpm;
        }
        return precountBeats * beatDuration;
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
        const cacheKey = `${bt.length}_${res}`;
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
            effective = bt;
        }

        this._effectiveBeats = effective;
        this._effectiveBeatsKey = cacheKey;
        return effective;
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
        if (this.clickGainNode || !this.audioContext) return;
        this.clickGainNode = this.audioContext.createGain();
        this.clickGainNode.gain.value = this.clickVolume;
        // Route to provided destination (mixer chain) or direct to speakers
        const dest = destinationNode || this.audioContext.destination;
        this.clickGainNode.connect(dest);
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
        }
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
