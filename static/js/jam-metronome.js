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
        this.clickMode = localStorage.getItem('jam_click_mode') || 'all';
        // Normalize legacy modes to 'all' or 'off'
        if (this.clickMode !== 'off') this.clickMode = 'all';
        this.clickVolume = parseFloat(localStorage.getItem('jam_click_volume') || '0.5');
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

        // Look-ahead click scheduling
        this._scheduledBeatIndex = -1;   // Last beat index scheduled for audio click
        this._scheduledNodes = [];        // Scheduled oscillators (for cleanup on stop)
        this._lookAheadTime = 0.1;       // Schedule clicks 100ms ahead

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

        // Position on document.body with fixed positioning to escape stacking contexts
        const rect = container.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.left = `${rect.left + rect.width / 2}px`;
        popover.style.transform = 'translateX(-50%)';
        popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;

        document.body.appendChild(popover);
        this._activePopover = popover;

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

        // Pre-schedule ALL click sounds on the Web Audio clock (uniform sound)
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
     * Uniform sound — no downbeat differentiation.
     */
    _schedulePrecountClick(when) {
        if (!this.audioContext || !this.clickGainNode) return;

        const ctx = this.audioContext;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.frequency.value = 1200;
        osc.type = 'sine';

        env.gain.setValueAtTime(0.8, when);
        env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);

        osc.connect(env);
        env.connect(this.clickGainNode);

        osc.start(when);
        osc.stop(when + 0.06);

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
            // Extrapolate beats backwards to cover from time 0
            // so the metronome clicks from the very start of the track
            const interval = beatTimes[1] - beatTimes[0];
            if (interval > 0 && beatTimes[0] > 0.01) {
                const extra = [];
                let t = beatTimes[0] - interval;
                while (t >= -0.01) {
                    extra.unshift(Math.max(0, t));
                    t -= interval;
                }
                this.beatTimes = [...extra, ...beatTimes];
            } else {
                this.beatTimes = beatTimes;
            }
            this._beatTimesReady = true;
            console.log(`[Metronome] Beat map loaded: ${beatTimes.length} original, ${this.beatTimes.length} total (extrapolated to 0)`);
        } else if (Array.isArray(beatTimes) && beatTimes.length === 1) {
            this.beatTimes = beatTimes;
            this._beatTimesReady = true;
            console.log(`[Metronome] Beat map loaded: 1 beat`);
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
     * Get beat info at a given time, using beat map if available.
     * Returns { beatIndex, beatInBar, beatPhase, valid }.
     */
    _getBeatInfo(currentTime) {
        if (this._beatTimesReady) {
            return this._getBeatInfoFromMap(currentTime);
        }
        return this._getBeatInfoConstant(currentTime);
    }

    /**
     * Binary search beat map to find current beat position.
     */
    _getBeatInfoFromMap(currentTime) {
        const beats = this.beatTimes;
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
     */
    _getBeatInfoConstant(currentTime) {
        if (this.bpm <= 0) {
            return { beatIndex: -1, beatInBar: -1, beatPhase: 0, valid: false };
        }

        const beatDuration = 60 / this.bpm;
        // Start from time 0 (don't skip the intro)
        const timeSinceFirstBeat = currentTime;

        if (timeSinceFirstBeat < 0) {
            return { beatIndex: -1, beatInBar: -1, beatPhase: 0, valid: false };
        }

        const totalBeats = timeSinceFirstBeat / beatDuration;
        const beatIndex = Math.floor(totalBeats);
        const beatInBar = beatIndex % this.beatsPerBar;
        const beatPhase = totalBeats - beatIndex;

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
        if (!ctx) return;
        this._ensureClickGain();

        const audioNow = ctx.currentTime;

        if (this._beatTimesReady) {
            this._scheduleFromBeatMap(currentSongTime, audioNow);
        } else if (this.bpm > 0) {
            this._scheduleFromConstantBPM(currentSongTime, audioNow);
        }
    }

    _scheduleFromBeatMap(currentSongTime, audioNow) {
        const bt = this.beatTimes;
        const startIdx = Math.max(0, this._scheduledBeatIndex + 1);

        for (let i = startIdx; i < bt.length; i++) {
            const audioTimeForBeat = audioNow + (bt[i] - currentSongTime);

            if (audioTimeForBeat > audioNow + this._lookAheadTime) break;
            if (audioTimeForBeat < audioNow - 0.01) continue; // Skip past beats

            this._scheduleClickAtTime(audioTimeForBeat);
            this._scheduledBeatIndex = i;
        }
    }

    _scheduleFromConstantBPM(currentSongTime, audioNow) {
        const beatDuration = 60 / this.bpm;
        // Start beats from time 0 (don't skip the intro)
        const timeSinceFirst = currentSongTime;
        if (timeSinceFirst < -this._lookAheadTime) return;

        const currentBeatIndex = Math.max(0, Math.floor(timeSinceFirst / beatDuration));
        const startIdx = Math.max(this._scheduledBeatIndex + 1, currentBeatIndex);

        for (let i = startIdx; ; i++) {
            const beatSongTime = i * beatDuration;
            const audioTimeForBeat = audioNow + (beatSongTime - currentSongTime);

            if (audioTimeForBeat > audioNow + this._lookAheadTime) break;
            if (audioTimeForBeat < audioNow - 0.01) continue;

            this._scheduleClickAtTime(audioTimeForBeat);
            this._scheduledBeatIndex = i;
        }
    }

    /**
     * Schedule a single click oscillator at an exact Web Audio time.
     */
    _scheduleClickAtTime(when) {
        const ctx = this.audioContext;
        if (!ctx || !this.clickGainNode) return;

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

        this._scheduledNodes.push(osc);

        // Clean up old nodes periodically (keep list manageable)
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

    _ensureClickGain() {
        if (this.clickGainNode || !this.audioContext) return;
        this.clickGainNode = this.audioContext.createGain();
        this.clickGainNode.gain.value = this.clickVolume;
        this.clickGainNode.connect(this.audioContext.destination);
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
        this.clickVolume = Math.max(0, Math.min(1, volume));
        localStorage.setItem('jam_click_volume', this.clickVolume.toString());
        if (this.clickGainNode) {
            this.clickGainNode.gain.value = this.clickVolume;
        }
    }

    getClickVolume() {
        return this.clickVolume;
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
