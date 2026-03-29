/**
 * PlayerEngine — persistent audio playback with queue, shuffle, and MediaSession.
 *
 * The <audio> element lives permanently in the DOM. The UI (mini-player, expanded view)
 * subscribes to events and can show/hide without interrupting playback.
 *
 * Usage:
 *   window.playerEngine = new PlayerEngine();
 *   playerEngine.loadQueue(tracks);  // [{video_id, title, artist, file_path, thumbnail, duration}]
 *   playerEngine.play(0);
 */

class PlayerEngine {
    constructor() {
        // Create persistent audio element
        this.audio = document.createElement('audio');
        this.audio.id = 'persistentAudio';
        this.audio.preload = 'auto';
        document.body.appendChild(this.audio);

        // Queue state
        this.queue = [];          // original order
        this.shuffleOrder = [];   // shuffled indices
        this.currentIndex = -1;   // index into queue (or shuffleOrder if shuffled)
        this.shuffleEnabled = false;

        // Event listeners
        this._listeners = {};

        // Wire audio events
        this.audio.addEventListener('ended', () => this._onEnded());
        this.audio.addEventListener('play', () => this._emit('play'));
        this.audio.addEventListener('pause', () => this._emit('pause'));
        this.audio.addEventListener('timeupdate', () => this._emit('progress', {
            currentTime: this.audio.currentTime,
            duration: this.audio.duration || 0,
        }));
        this.audio.addEventListener('error', () => {
            console.error('[PlayerEngine] Audio error:', this.audio.error);
            // Try next track on error
            if (this.hasNext) this.next();
        });
    }

    // ── Queue Management ────────────────────────────────────

    /**
     * Load a queue of tracks and optionally start playing.
     * @param {Object[]} tracks - [{video_id, title, artist, file_path, thumbnail, duration}]
     */
    loadQueue(tracks) {
        this.queue = tracks || [];
        this.currentIndex = -1;
        this._buildShuffleOrder();
        this._emit('queuechange', { queue: this.queue });
    }

    /**
     * Add tracks to the end of the current queue.
     * @param {Object[]} tracks
     */
    addToQueue(tracks) {
        this.queue.push(...tracks);
        this._buildShuffleOrder();
        this._emit('queuechange', { queue: this.queue });
    }

    // ── Playback Controls ───────────────────────────────────

    /**
     * Play a track by index (in the current order). If no index, resume.
     * @param {number} [index]
     */
    play(index) {
        if (typeof index === 'number') {
            this.currentIndex = index;
            this._loadCurrentTrack();
        }
        this.audio.play().catch(e => console.warn('[PlayerEngine] Play failed:', e));
        this._updateMediaSession();
        this._emit('trackchange', { track: this.currentTrack, index: this._realIndex() });
    }

    pause() {
        this.audio.pause();
    }

    togglePlayPause() {
        if (this.isPlaying) this.pause();
        else this.play();
    }

    next() {
        if (!this.hasNext) return;
        this.currentIndex++;
        this._loadCurrentTrack();
        this.audio.play().catch(() => {});
        this._updateMediaSession();
        this._emit('trackchange', { track: this.currentTrack, index: this._realIndex() });
    }

    prev() {
        // If more than 3s in, restart current track
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        if (!this.hasPrev) return;
        this.currentIndex--;
        this._loadCurrentTrack();
        this.audio.play().catch(() => {});
        this._updateMediaSession();
        this._emit('trackchange', { track: this.currentTrack, index: this._realIndex() });
    }

    seek(time) {
        if (isFinite(time)) this.audio.currentTime = time;
    }

    stop() {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.queue = [];
        this.currentIndex = -1;
        this._emit('stop');
    }

    // ── Shuffle ─────────────────────────────────────────────

    toggleShuffle() {
        this.shuffleEnabled = !this.shuffleEnabled;
        if (this.shuffleEnabled) {
            this._buildShuffleOrder();
            // Put current track at position 0 of shuffle
            if (this.currentIndex >= 0) {
                const realIdx = this._realIndex();
                const pos = this.shuffleOrder.indexOf(realIdx);
                if (pos > 0) {
                    this.shuffleOrder.splice(pos, 1);
                    this.shuffleOrder.unshift(realIdx);
                }
                this.currentIndex = 0;
            }
        } else {
            // Restore position in original order
            if (this.currentIndex >= 0) {
                const realIdx = this._realIndex();
                this.currentIndex = realIdx;
            }
        }
        this._emit('shufflechange', { enabled: this.shuffleEnabled });
    }

    // ── Getters ─────────────────────────────────────────────

    get currentTrack() {
        const idx = this._realIndex();
        return idx >= 0 && idx < this.queue.length ? this.queue[idx] : null;
    }

    get isPlaying() {
        return !this.audio.paused && !this.audio.ended;
    }

    get hasNext() {
        return this.currentIndex < this._orderLength() - 1;
    }

    get hasPrev() {
        return this.currentIndex > 0;
    }

    get progress() {
        return {
            currentTime: this.audio.currentTime,
            duration: this.audio.duration || 0,
        };
    }

    // ── Events ──────────────────────────────────────────────

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }

    _emit(event, data) {
        for (const cb of (this._listeners[event] || [])) {
            try { cb(data); } catch (e) { console.error('[PlayerEngine] Event handler error:', e); }
        }
    }

    // ── Private ─────────────────────────────────────────────

    _realIndex() {
        if (this.currentIndex < 0) return -1;
        if (this.shuffleEnabled && this.shuffleOrder.length > 0) {
            return this.shuffleOrder[this.currentIndex] ?? -1;
        }
        return this.currentIndex;
    }

    _orderLength() {
        return this.shuffleEnabled ? this.shuffleOrder.length : this.queue.length;
    }

    _buildShuffleOrder() {
        this.shuffleOrder = Array.from({ length: this.queue.length }, (_, i) => i);
        // Fisher-Yates shuffle
        for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
        }
    }

    _loadCurrentTrack() {
        const track = this.currentTrack;
        if (!track) return;
        const url = `/api/stream-audio?file_path=${encodeURIComponent(track.file_path)}`;
        this.audio.src = url;
        this.audio.load();
    }

    _onEnded() {
        this._emit('ended');
        if (this.hasNext) {
            this.next();
        } else {
            this._emit('queueend');
        }
    }

    _updateMediaSession() {
        if (!('mediaSession' in navigator)) return;
        const track = this.currentTrack;
        if (!track) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Unknown',
            artist: track.artist || '',
            album: track.album || '',
            artwork: track.thumbnail ? [
                { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
            ] : [],
        });

        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime != null) this.seek(details.seekTime);
        });
    }
}

// Global singleton
window.playerEngine = new PlayerEngine();
