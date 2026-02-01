/**
 * Karaoke Display Module
 * Displays synchronized lyrics with playback for karaoke-style experience
 */

// CSRF token helper function
function getCsrfToken() {
    // Return empty string since CSRF is disabled
    return '';
}

class KaraokeDisplay {
    constructor(containerSelector, extractionId) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) {
            console.warn('[KaraokeDisplay] Container not found:', containerSelector);
        }

        this.extractionId = extractionId;
        this.lyricsData = null;
        this.currentTime = 0;
        this.currentSegmentIndex = -1;
        this.enabled = false;
        this.isGenerating = false;
        this.tempoRatio = 1.0; // Legacy ratio used for stretching lyrics timeline
        this.playbackRate = 1.0;
        this.soundTouchTempo = 1.0;
        this.tempoMode = 'stretch';
        this.absoluteTime = false;

        this.init();
    }

    init() {
        if (!this.container) return;

        // Look for existing lyrics container in the HTML first
        let displayArea = this.container.querySelector('.karaoke-lyrics');

        // If not found, create it
        if (!displayArea) {
            displayArea = document.createElement('div');
            displayArea.className = 'karaoke-lyrics';
            displayArea.id = 'karaoke-lyrics';
            this.container.appendChild(displayArea);
        }

        // Initially hidden until lyrics are loaded
        displayArea.style.display = 'none';
        this.lyricsContainer = displayArea;

        // Create loading overlay for progress indication
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'karaoke-loading-overlay';
        loadingOverlay.style.display = 'none';
        loadingOverlay.innerHTML = `
            <div class="karaoke-loading-content">
                <div class="karaoke-loading-header">
                    <div class="karaoke-spinner"></div>
                    <div class="karaoke-loading-text">Generating lyrics...</div>
                </div>
                <div class="karaoke-loading-steps"></div>
            </div>
        `;
        this.container.appendChild(loadingOverlay);
        this.loadingOverlay = loadingOverlay;
        this.loadingText = loadingOverlay.querySelector('.karaoke-loading-text');
        this.loadingSteps = loadingOverlay.querySelector('.karaoke-loading-steps');
        this.progressSteps = [];

        // Listen for SocketIO progress events
        this.setupSocketListeners();

        // Get regenerate button from HTML (single unified button)
        this.regenerateButton = document.getElementById('karaoke-regenerate-btn');

        // Regenerate button event (LrcLib -> Whisper fallback)
        if (this.regenerateButton) {
            this.regenerateButton.addEventListener('click', () => {
                this.regenerateLyrics();
            });
        }

        // Try to load existing lyrics from EXTRACTION_INFO first
        this.loadLyricsFromExtractionInfo();

        // If no lyrics loaded from initial data, try fetching cached
        if (!this.lyricsData) {
            this.checkCachedLyrics();
        }

        // Listen for tempo changes from pitch/tempo controller
        // This is used to resynchronize lyrics when using timestretch (SoundTouch)
        window.addEventListener('tempoChanged', (event) => {
            const detail = event.detail || {};
            const lyricsRatio = detail.lyricsRatio ?? detail.tempoRatio ?? 1.0;
            this.tempoRatio = lyricsRatio;
            this.playbackRate = detail.playbackRate ?? lyricsRatio;
            this.soundTouchTempo = detail.soundTouchTempo ?? lyricsRatio;
            this.tempoMode = detail.mode || (this.playbackRate > 1.0 ? 'hybrid-acceleration' : 'stretch');
            this.absoluteTime = Boolean(detail.absoluteTime);

            console.log(`[KaraokeDisplay] Tempo change → lyricsRatio=${this.tempoRatio.toFixed(3)}x, playbackRate=${this.playbackRate.toFixed(3)}, soundTouch=${this.soundTouchTempo.toFixed(3)} (${this.tempoMode}), absoluteTime=${this.absoluteTime}`);
        });

        // Listen for pitch changes to update chord transpositions in lyrics
        window.addEventListener('pitchShiftChanged', (event) => {
            const detail = event.detail || {};
            const pitchShift = detail.pitchShift ?? 0;

            console.log(`[KaraokeDisplay] Pitch shift changed → ${pitchShift >= 0 ? '+' : ''}${pitchShift} semitones`);

            // Update chord transpositions in the lyrics display
            this.updateChordTransposition(pitchShift);
        });
    }

    /**
     * Setup SocketIO listeners for lyrics progress updates
     */
    setupSocketListeners() {
        // Check if socket.io is available
        if (typeof io === 'undefined') {
            console.warn('[KaraokeDisplay] SocketIO not available, progress updates disabled');
            return;
        }

        // Create socket connection
        const socket = window.mixerSocket || io();
        window.mixerSocket = socket;

        socket.on('connect', () => {
            console.log('[KaraokeDisplay] Socket connected');
        });

        socket.on('lyrics_progress', (data) => {
            // Accept events when generating (overlay is shown)
            if (!this.isGenerating) return;

            console.log(`[KaraokeDisplay] Progress: ${data.step} - ${data.message}`);
            this.updateLoadingProgress(data);
        });

        console.log('[KaraokeDisplay] Socket listeners configured');
    }

    /**
     * Add a step to the progress log
     */
    addProgressStep(icon, text, status = 'running') {
        if (!this.loadingSteps) return;

        const stepEl = document.createElement('div');
        stepEl.className = `karaoke-step karaoke-step-${status}`;
        stepEl.innerHTML = `
            <span class="karaoke-step-icon">${icon}</span>
            <span class="karaoke-step-text">${text}</span>
        `;
        this.loadingSteps.appendChild(stepEl);
        this.progressSteps.push(stepEl);

        // Auto-scroll to bottom
        this.loadingSteps.scrollTop = this.loadingSteps.scrollHeight;

        return stepEl;
    }

    /**
     * Update the last step status
     */
    updateLastStep(status, newText = null) {
        if (this.progressSteps.length === 0) return;
        const lastStep = this.progressSteps[this.progressSteps.length - 1];
        lastStep.className = `karaoke-step karaoke-step-${status}`;
        if (newText) {
            lastStep.querySelector('.karaoke-step-text').textContent = newText;
        }
    }

    /**
     * Clear all progress steps
     */
    clearProgressSteps() {
        if (this.loadingSteps) {
            this.loadingSteps.innerHTML = '';
        }
        this.progressSteps = [];
    }

    /**
     * Update loading overlay with progress information
     */
    updateLoadingProgress(data) {
        if (!this.loadingText) return;

        const step = data.step || '';
        const message = data.message || '';
        const model = data.model || 'medium';
        const gpu = data.gpu ? 'GPU' : 'CPU';

        // Update main text and add step to log
        switch (step) {
            case 'metadata':
                this.loadingText.textContent = 'Extracting metadata...';
                this.addProgressStep('📋', 'Extracting metadata...', 'running');
                break;
            case 'syncedlyrics':
                this.updateLastStep('done');
                this.loadingText.textContent = 'Searching Musixmatch...';
                this.addProgressStep('🔍', `Searching: ${message.replace('Searching word-level lyrics for: ', '')}`, 'running');
                break;
            case 'syncedlyrics_found':
                this.updateLastStep('done', `Musixmatch: ${message}`);
                this.loadingText.textContent = 'Lyrics found!';
                break;
            case 'syncedlyrics_not_found':
            case 'syncedlyrics_skip':
                this.updateLastStep('warning', 'Musixmatch: No word-level lyrics');
                this.loadingText.textContent = 'Falling back to Whisper...';
                break;
            case 'syncedlyrics_error':
                this.updateLastStep('error', `Musixmatch: ${message}`);
                this.loadingText.textContent = 'Falling back to Whisper...';
                break;
            case 'onset_sync':
                this.loadingText.textContent = 'Syncing with vocals...';
                this.addProgressStep('🎤', 'Analyzing vocal track...', 'running');
                break;
            case 'onset_sync_done':
                this.updateLastStep('done', `Vocal sync: ${message}`);
                this.loadingText.textContent = 'Sync complete!';
                break;
            case 'onset_sync_error':
                this.updateLastStep('warning', `Vocal sync failed: ${message}`);
                break;
            case 'whisper_fallback':
                this.loadingText.textContent = 'Transcribing with Whisper...';
                this.addProgressStep('🤖', `Loading Whisper ${model} (${gpu})...`, 'running');
                break;
            case 'whisper_transcribing':
                this.updateLastStep('done');
                this.addProgressStep('📝', 'Transcribing audio...', 'running');
                break;
            case 'whisper_done':
                this.updateLastStep('done', `Transcription: ${message}`);
                this.loadingText.textContent = 'Transcription complete!';
                break;
            case 'aligned':
                this.updateLastStep('done');
                this.loadingText.textContent = 'Alignment complete!';
                this.addProgressStep('✅', message, 'done');
                break;
            case 'whisper_error':
            case 'failed':
                this.updateLastStep('error', `Error: ${message}`);
                this.loadingText.textContent = 'Error';
                break;
            default:
                // For unknown steps, just log them
                if (message) {
                    this.addProgressStep('ℹ️', message, 'info');
                }
        }
    }

    /**
     * Load lyrics from EXTRACTION_INFO global variable if available
     */
    loadLyricsFromExtractionInfo() {
        if (typeof EXTRACTION_INFO !== 'undefined' && EXTRACTION_INFO && EXTRACTION_INFO.lyrics_data) {
            console.log('[KaraokeDisplay] Loading lyrics from EXTRACTION_INFO');
            let lyrics = EXTRACTION_INFO.lyrics_data;

            // Parse if JSON string
            if (typeof lyrics === 'string') {
                try {
                    lyrics = JSON.parse(lyrics);
                } catch (e) {
                    console.error('[KaraokeDisplay] Failed to parse lyrics JSON:', e);
                    return;
                }
            }

            if (lyrics && lyrics.length > 0) {
                this.loadLyrics(lyrics);
                this.showControls(true);
                this.updateRegenerateButton('Regenerate Lyrics', false);
            }
        }
    }

    /**
     * Check for cached lyrics without generating
     */
    async checkCachedLyrics() {
        if (!this.extractionId) return;

        try {
            console.log('[KaraokeDisplay] Checking for existing lyrics...');
            const response = await fetch(`/api/extractions/${this.extractionId}/lyrics`, {
                credentials: 'same-origin'
            });
            const data = await response.json();

            if (data.success && data.lyrics) {
                console.log('[KaraokeDisplay] Found cached lyrics');
                this.loadLyrics(data.lyrics);
                this.showControls(true);
                this.updateRegenerateButton('Regenerate Lyrics', false);
            }
        } catch (error) {
            console.log('[KaraokeDisplay] No cached lyrics found');
        }
    }

    /**
     * Parse title to extract artist and track
     * Handles "Artist - Track" format and various YouTube suffixes
     */
    parseTitle(title) {
        if (!title) return { artist: '', track: '' };

        let cleanTitle = title;

        // Remove common YouTube suffixes
        const patterns = [
            /\s*[\(\[]\s*(Official\s*)?(Music\s*)?(Video|Audio|Lyrics?|Visualizer|Clip)\s*[\)\]]/gi,
            /\s*[\(\[]\s*(HD|HQ|4K|1080p|720p)\s*[\)\]]/gi,
            /\s*[\(\[]\s*(Live|Acoustic|Remix|Cover|Version)\s*[\)\]]/gi,
            /\s*[\(\[]\s*\d{4}\s*[\)\]]/gi
        ];

        for (const pattern of patterns) {
            cleanTitle = cleanTitle.replace(pattern, '');
        }

        cleanTitle = cleanTitle.trim();

        // Split on " - "
        if (cleanTitle.includes(' - ')) {
            const parts = cleanTitle.split(' - ', 2);
            return {
                artist: parts[0].trim(),
                track: parts[1].trim()
            };
        }

        // No separator - return full title as track
        return { artist: '', track: cleanTitle };
    }

    /**
     * Show dialog to edit artist/track before regenerating lyrics
     */
    showLyricsDialog() {
        return new Promise((resolve) => {
            // Get current title from EXTRACTION_INFO
            const title = (typeof EXTRACTION_INFO !== 'undefined' && EXTRACTION_INFO?.title) || '';
            const parsed = this.parseTitle(title);

            // Create dialog overlay
            const overlay = document.createElement('div');
            overlay.className = 'lyrics-dialog-overlay';
            overlay.innerHTML = `
                <div class="lyrics-dialog">
                    <h3>Regenerate Lyrics</h3>
                    <p class="lyrics-dialog-hint">Edit artist and track for Musixmatch search:</p>

                    <div class="lyrics-dialog-field">
                        <label for="lyrics-artist">Artist</label>
                        <input type="text" id="lyrics-artist" value="${this.escapeHtml(parsed.artist)}" placeholder="e.g. The Police">
                    </div>

                    <div class="lyrics-dialog-field">
                        <label for="lyrics-track">Track</label>
                        <input type="text" id="lyrics-track" value="${this.escapeHtml(parsed.track)}" placeholder="e.g. So Lonely">
                    </div>

                    <div class="lyrics-dialog-buttons">
                        <button class="lyrics-dialog-btn lyrics-dialog-cancel">Cancel</button>
                        <button class="lyrics-dialog-btn lyrics-dialog-whisper">Whisper Only</button>
                        <button class="lyrics-dialog-btn lyrics-dialog-musixmatch">Musixmatch Only</button>
                        <button class="lyrics-dialog-btn lyrics-dialog-submit primary">Musixmatch + Sync</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Prevent keyboard events from propagating (space bar, etc.)
            const stopPropagation = (e) => {
                e.stopPropagation();
            };
            overlay.addEventListener('keydown', stopPropagation);
            overlay.addEventListener('keyup', stopPropagation);
            overlay.addEventListener('keypress', stopPropagation);

            // Focus on artist field
            setTimeout(() => {
                const artistInput = overlay.querySelector('#lyrics-artist');
                if (artistInput) artistInput.focus();
            }, 100);

            // Handle buttons
            const cancelBtn = overlay.querySelector('.lyrics-dialog-cancel');
            const whisperBtn = overlay.querySelector('.lyrics-dialog-whisper');
            const musixmatchBtn = overlay.querySelector('.lyrics-dialog-musixmatch');
            const submitBtn = overlay.querySelector('.lyrics-dialog-submit');

            const cleanup = () => {
                overlay.removeEventListener('keydown', stopPropagation);
                overlay.removeEventListener('keyup', stopPropagation);
                overlay.removeEventListener('keypress', stopPropagation);
                overlay.remove();
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            whisperBtn.addEventListener('click', () => {
                cleanup();
                resolve({ artist: '', track: '', forceWhisper: true, skipOnsetSync: false });
            });

            musixmatchBtn.addEventListener('click', () => {
                const artist = overlay.querySelector('#lyrics-artist').value.trim();
                const track = overlay.querySelector('#lyrics-track').value.trim();
                cleanup();
                resolve({ artist, track, forceWhisper: false, skipOnsetSync: true });
            });

            submitBtn.addEventListener('click', () => {
                const artist = overlay.querySelector('#lyrics-artist').value.trim();
                const track = overlay.querySelector('#lyrics-track').value.trim();
                cleanup();
                resolve({ artist, track, forceWhisper: false, skipOnsetSync: false });
            });

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(null);
                }
            });

            // Handle Enter/Escape keys (after stopPropagation)
            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const artist = overlay.querySelector('#lyrics-artist').value.trim();
                    const track = overlay.querySelector('#lyrics-track').value.trim();
                    cleanup();
                    resolve({ artist, track, forceWhisper: false, skipOnsetSync: false });
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup();
                    resolve(null);
                }
            };
            overlay.addEventListener('keydown', handleKeydown);
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Regenerate lyrics using unified endpoint (LrcLib -> Whisper fallback)
     */
    async regenerateLyrics() {
        if (!this.extractionId) {
            console.warn('[KaraokeDisplay] No extraction ID provided');
            return;
        }

        if (this.isGenerating) {
            console.log('[KaraokeDisplay] Already generating lyrics...');
            return;
        }

        // Show dialog to get artist/track
        const dialogResult = await this.showLyricsDialog();
        if (!dialogResult) {
            console.log('[KaraokeDisplay] Dialog cancelled');
            return;
        }

        console.log('[KaraokeDisplay] Regenerating lyrics with:', dialogResult);
        this.isGenerating = true;
        this.updateRegenerateButton('Regenerating...', true);
        this.showLoadingOverlay(true);

        try {
            const response = await fetch(`/api/extractions/${this.extractionId}/lyrics/regenerate`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({
                    artist: dialogResult.artist,
                    track: dialogResult.track,
                    force_whisper: dialogResult.forceWhisper,
                    skip_onset_sync: dialogResult.skipOnsetSync
                })
            });

            this.showLoadingOverlay(false);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();

            if (data.success && data.lyrics) {
                const source = data.source || 'unknown';
                console.log(`[KaraokeDisplay] Lyrics regenerated (${source}): ${data.segments_count} segments`);
                this.loadLyrics(data.lyrics);
                this.showControls(true);

                // Update source tag display
                this.updateSourceTag(source);

                // Build success message with source info and alignment stats
                const sourceLabel = this.getSourceLabel(source);
                let message = `Lyrics loaded (${sourceLabel}): ${data.segments_count} segments`;

                // Add alignment stats if available
                const stats = data.alignment_stats;
                if (stats && stats.match_rate !== undefined) {
                    message += `\n\nSync statistics:`;
                    message += `\n- Words matched: ${stats.matched_words}/${stats.total_words} (${stats.match_rate}%)`;
                    if (stats.global_offset_sec !== undefined) {
                        message += `\n- Global offset: ${stats.global_offset_sec}s`;
                    }
                }

                alert(message);
            } else {
                console.error('[KaraokeDisplay] Failed to regenerate lyrics:', data.error);
                alert(`Failed to regenerate lyrics: ${data.error || 'Unknown error'}`);
            }

        } catch (error) {
            console.error('[KaraokeDisplay] Error regenerating lyrics:', error);
            this.showLoadingOverlay(false);
            alert(`Error: ${error.message}`);
        } finally {
            this.isGenerating = false;
            this.updateRegenerateButton('Regenerate Lyrics', false);
        }
    }

    /**
     * Get human-readable source label
     */
    getSourceLabel(source) {
        const labels = {
            'musixmatch+onset': 'Musixmatch + Vocal Sync',
            'musixmatch': 'Musixmatch',
            'syncedlyrics': 'Musixmatch (word-level)',
            'lrclib+whisper': 'LrcLib + Whisper',
            'lrclib': 'LrcLib',
            'whisper': 'Whisper AI'
        };
        return labels[source] || source;
    }

    /**
     * Update the source tag display
     */
    updateSourceTag(source) {
        // Emit event for parent to update UI
        window.dispatchEvent(new CustomEvent('lyricsSourceChanged', {
            detail: { source, label: this.getSourceLabel(source) }
        }));
    }

    /**
     * Update regenerate button state
     * @param {string} text - Button text
     * @param {boolean} disabled - Whether button is disabled
     */
    updateRegenerateButton(text, disabled) {
        if (this.regenerateButton) {
            const label = this.regenerateButton.querySelector('span');
            if (label) {
                label.textContent = text;
            }
            this.regenerateButton.disabled = disabled;
            this.regenerateButton.style.opacity = disabled ? '0.5' : '1';
            this.regenerateButton.style.cursor = disabled ? 'not-allowed' : 'pointer';
        }
    }

    /**
     * Show or hide the loading overlay
     * @param {boolean} show - Whether to show the overlay
     */
    showLoadingOverlay(show) {
        if (this.loadingOverlay) {
            if (show) {
                // Clear previous steps when showing
                this.clearProgressSteps();
                this.loadingText.textContent = 'Generating lyrics...';
            }
            this.loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show/hide karaoke controls
     * @param {boolean} hasLyrics - Whether lyrics are loaded
     */
    showControls(hasLyrics) {
        // Visibility is now managed by TabManager
        // This method is kept for compatibility but does minimal work
        if (hasLyrics && !this.enabled) {
            // Auto-show lyrics on first load
            this.enabled = true;
            if (this.lyricsContainer) {
                this.lyricsContainer.style.display = 'block';
            }
        }
    }

    /**
     * Load lyrics data and render
     * @param {Array} lyrics - Array of {start, end, text, words} objects
     */
    loadLyrics(lyrics) {
        if (!lyrics || lyrics.length === 0) {
            console.log('[KaraokeDisplay] No lyrics data available');
            this.clear();
            return;
        }

        console.log(`[KaraokeDisplay] Loading ${lyrics.length} lyric segments`);
        this.lyricsData = lyrics;

        // Debug: log first segment's word timestamps to verify data structure
        if (lyrics[0] && lyrics[0].words && lyrics[0].words.length > 0) {
            const seg = lyrics[0];
            const words = seg.words.slice(0, 3);
            console.log(`[KaraokeDisplay] Sample segment: start=${seg.start}s, end=${seg.end}s`);
            words.forEach((w, i) => {
                console.log(`  Word ${i}: "${w.word}" [${w.start}s - ${w.end}s] (${((w.end || 0) - (w.start || 0)).toFixed(2)}s)`);
            });
        }

        this.render();

        // Auto-show lyrics after loading/regenerating
        if (!this.enabled) {
            this.enabled = true;
            if (this.lyricsContainer) {
                this.lyricsContainer.style.display = 'block';
            }
        }
    }

    /**
     * Build chord lookup for songbook-style display
     */
    buildChordLookupForLyrics() {
        // Get chords from ChordDisplay if available
        const chords = window.chordDisplay?.chords || [];
        if (!chords.length) return [];

        const lookup = [];
        let lastChord = null;

        chords.forEach(chord => {
            const chordName = chord.chord || '';
            const timestamp = chord.timestamp || 0;

            // Only add if it's a new chord (chord change)
            if (chordName && chordName !== lastChord) {
                lookup.push({
                    chord: chordName,
                    timestamp: timestamp,
                    isChange: true,
                    used: false
                });
                lastChord = chordName;
            }
        });

        return lookup;
    }

    /**
     * Find chord at a specific time
     */
    findChordAtTime(time, chordLookup) {
        if (!chordLookup || chordLookup.length === 0) return null;

        const tolerance = 0.5; // 500ms tolerance

        for (let i = chordLookup.length - 1; i >= 0; i--) {
            const chordInfo = chordLookup[i];
            const diff = time - chordInfo.timestamp;

            if (diff >= -tolerance && diff <= tolerance) {
                if (!chordInfo.used) {
                    chordInfo.used = true;
                    return chordInfo;
                }
            }
        }

        return null;
    }

    /**
     * Transpose a chord by semitones
     */
    transposeChord(chord, semitones) {
        if (!chord || semitones === 0) return chord;

        const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const FLAT_TO_SHARP = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };

        // Extract root note and suffix
        let match = chord.match(/^([A-G][#b]?)(.*)$/);
        if (!match) return chord;

        let root = match[1];
        const suffix = match[2];

        // Convert flat to sharp for transposition
        if (FLAT_TO_SHARP[root]) {
            root = FLAT_TO_SHARP[root];
        }

        const rootIndex = NOTE_NAMES.indexOf(root);
        if (rootIndex === -1) return chord;

        // Calculate new root
        let newIndex = (rootIndex + semitones) % 12;
        if (newIndex < 0) newIndex += 12;

        return NOTE_NAMES[newIndex] + suffix;
    }

    /**
     * Get current pitch shift from mixer
     */
    getCurrentPitchShift() {
        return window.mixer?.pitchTempo?.currentPitchShift || 0;
    }

    /**
     * Render lyrics segments with word-level timestamps and chord annotations
     */
    render() {
        if (!this.lyricsContainer || !this.lyricsData) return;

        this.lyricsContainer.innerHTML = '';

        // Reset scroll position to top when rendering new lyrics
        this.lyricsContainer.scrollTop = 0;

        // Build chord lookup for songbook display
        const chordLookup = this.buildChordLookupForLyrics();
        const hasChordsData = chordLookup.length > 0;
        const pitchShift = this.getCurrentPitchShift();

        // Create a line for each segment
        this.lyricsData.forEach((segment, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'karaoke-line';
            lineDiv.dataset.index = index;
            lineDiv.dataset.start = segment.start;
            lineDiv.dataset.end = segment.end;

            // Add timestamp
            const timeSpan = document.createElement('span');
            timeSpan.className = 'karaoke-time';
            timeSpan.textContent = this.formatTime(segment.start);
            lineDiv.appendChild(timeSpan);

            // Add text container for words with chord annotations
            const textContainer = document.createElement('div');
            textContainer.className = hasChordsData ? 'karaoke-text songbook-style' : 'karaoke-text';

            // If we have word-level timestamps, render words with chord annotations
            if (segment.words && segment.words.length > 0) {
                segment.words.forEach((wordData, wordIndex) => {
                    if (hasChordsData) {
                        const wordWrapper = document.createElement('span');
                        wordWrapper.className = 'karaoke-word-wrapper';

                        // Check if there's a chord change at this word
                        const chordInfo = this.findChordAtTime(wordData.start, chordLookup);
                        if (chordInfo && chordInfo.isChange) {
                            const chordLabel = document.createElement('span');
                            chordLabel.className = 'karaoke-chord';
                            chordLabel.dataset.originalChord = chordInfo.chord;
                            chordLabel.dataset.chordTime = chordInfo.timestamp;
                            chordLabel.textContent = this.transposeChord(chordInfo.chord, pitchShift);
                            wordWrapper.appendChild(chordLabel);
                        }

                        const wordSpan = document.createElement('span');
                        wordSpan.className = 'karaoke-word';
                        wordSpan.dataset.wordIndex = wordIndex;
                        wordSpan.dataset.start = wordData.start;
                        wordSpan.dataset.end = wordData.end;
                        wordSpan.textContent = wordData.word;

                        wordWrapper.appendChild(wordSpan);
                        textContainer.appendChild(wordWrapper);
                    } else {
                        const wordSpan = document.createElement('span');
                        wordSpan.className = 'karaoke-word';
                        wordSpan.dataset.wordIndex = wordIndex;
                        wordSpan.dataset.start = wordData.start;
                        wordSpan.dataset.end = wordData.end;
                        wordSpan.textContent = wordData.word;

                        // Add space between words (except after last word)
                        if (wordIndex < segment.words.length - 1) {
                            wordSpan.textContent += ' ';
                        }

                        textContainer.appendChild(wordSpan);
                    }
                });
            } else {
                // Fallback: no word timestamps
                if (hasChordsData) {
                    const chordInfo = this.findChordAtTime(segment.start, chordLookup);
                    if (chordInfo) {
                        const chordLabel = document.createElement('span');
                        chordLabel.className = 'karaoke-chord';
                        chordLabel.dataset.originalChord = chordInfo.chord;
                        chordLabel.textContent = this.transposeChord(chordInfo.chord, pitchShift);
                        textContainer.appendChild(chordLabel);
                    }
                }
                const textSpan = document.createElement('span');
                textSpan.textContent = segment.text;
                textContainer.appendChild(textSpan);
            }

            lineDiv.appendChild(textContainer);

            // Click to seek
            lineDiv.addEventListener('click', () => {
                this.onLineClick(segment);
            });

            this.lyricsContainer.appendChild(lineDiv);
        });

        console.log('[KaraokeDisplay] Rendered lyrics with word-level timing' + (hasChordsData ? ' and songbook chords' : ''));
    }

    /**
     * Update chord labels when pitch changes
     */
    updateChordTransposition(pitchShift) {
        const chordLabels = this.lyricsContainer?.querySelectorAll('.karaoke-chord') || [];
        chordLabels.forEach(label => {
            const originalChord = label.dataset.originalChord;
            if (originalChord) {
                label.textContent = this.transposeChord(originalChord, pitchShift);
            }
        });
    }

    /**
     * Sync lyrics with playback time (word-level highlighting)
     * @param {number} currentTime - Current playback time in seconds
     */
    sync(currentTime) {
        if (!this.lyricsData || !this.enabled) return;

        // Apply tempo factor to adjust for timestretch
        // When tempo is increased, we progress through lyrics faster
        const adjustedTime = this.absoluteTime ? currentTime : currentTime * this.tempoRatio;
        this.currentTime = adjustedTime;

        // Find current segment using adjusted time
        let segmentIndex = -1;
        for (let i = 0; i < this.lyricsData.length; i++) {
            const seg = this.lyricsData[i];
            if (adjustedTime >= seg.start && adjustedTime <= seg.end) {
                segmentIndex = i;
                break;
            }
        }

        // Update line highlight if changed
        if (segmentIndex !== this.currentSegmentIndex) {
            this.currentSegmentIndex = segmentIndex;
            this.highlightCurrentLine(segmentIndex);

            // Debug: log segment change with word timestamps
            if (segmentIndex >= 0) {
                const seg = this.lyricsData[segmentIndex];
                const firstWord = seg.words?.[0];
                console.log(`[KaraokeSync] Segment ${segmentIndex} active at ${adjustedTime.toFixed(2)}s`);
                console.log(`  Segment: ${seg.start}s - ${seg.end}s "${seg.text.substring(0, 30)}..."`);
                if (firstWord) {
                    console.log(`  First word: "${firstWord.word}" [${firstWord.start}s - ${firstWord.end}s]`);
                }
            }
        }

        // Highlight words within current line
        if (segmentIndex >= 0) {
            this.highlightWords(segmentIndex, adjustedTime);
        }
    }

    /**
     * Highlight the current lyrics line
     * @param {number} index - Index of segment to highlight
     */
    highlightCurrentLine(index) {
        if (!this.lyricsContainer) return;

        const lines = this.lyricsContainer.querySelectorAll('.karaoke-line');

        lines.forEach((line, i) => {
            if (i === index) {
                line.classList.add('active');
                line.classList.remove('past', 'future');

                // Scroll to keep active line in view
                this.scrollToLine(line);
            } else if (i < index) {
                line.classList.remove('active', 'future');
                line.classList.add('past');
            } else {
                line.classList.remove('active', 'past');
                line.classList.add('future');
            }
        });
    }

    /**
     * Highlight words within the current line (karaoke-style)
     * @param {number} segmentIndex - Index of the current segment
     * @param {number} currentTime - Current playback time in seconds
     */
    highlightWords(segmentIndex, currentTime) {
        if (!this.lyricsContainer) return;

        const lines = this.lyricsContainer.querySelectorAll('.karaoke-line');
        const currentLine = lines[segmentIndex];

        if (!currentLine) return;

        // Get all word spans in the current line
        const wordSpans = currentLine.querySelectorAll('.karaoke-word');

        // Debug: one-time log when entering a new segment to show word states
        if (this._lastDebugSegment !== segmentIndex) {
            this._lastDebugSegment = segmentIndex;
            console.log(`[KaraokeHighlight] Segment ${segmentIndex} at time=${currentTime.toFixed(2)}s`);
            let futureCount = 0, currentCount = 0, pastCount = 0;
            wordSpans.forEach((ws, idx) => {
                const start = parseFloat(ws.dataset.start);
                const end = parseFloat(ws.dataset.end);
                if (currentTime < start) futureCount++;
                else if (currentTime >= start && currentTime <= end) currentCount++;
                else pastCount++;
                if (idx < 3) {
                    console.log(`  Word ${idx}: "${ws.textContent.trim()}" [${start}s-${end}s] → ${currentTime < start ? 'FUTURE' : (currentTime <= end ? 'CURRENT' : 'PAST')}`);
                }
            });
            console.log(`  Summary: ${futureCount} future, ${currentCount} current, ${pastCount} past (total: ${wordSpans.length})`);
        }

        wordSpans.forEach((wordSpan) => {
            const wordStart = parseFloat(wordSpan.dataset.start);
            let wordEnd = parseFloat(wordSpan.dataset.end);

            // Safeguard: ensure minimum word duration to prevent instant display
            // and division by zero in progress calculation
            const minDuration = 0.15; // 150ms minimum
            if (isNaN(wordEnd) || wordEnd <= wordStart) {
                wordEnd = wordStart + minDuration;
            } else if (wordEnd - wordStart < minDuration) {
                wordEnd = wordStart + minDuration;
            }

            // Remove all previous states
            wordSpan.classList.remove('word-past', 'word-current', 'word-future');

            if (currentTime < wordStart) {
                // Word hasn't been sung yet
                wordSpan.classList.add('word-future');
            } else if (currentTime >= wordStart && currentTime <= wordEnd) {
                // Word is currently being sung
                wordSpan.classList.add('word-current');

                // Calculate fill percentage for smooth animation
                const duration = wordEnd - wordStart;
                const progress = (currentTime - wordStart) / duration;
                const fillPercent = Math.min(100, Math.max(0, progress * 100));

                // Apply gradient fill effect
                wordSpan.style.background = `linear-gradient(to right, var(--accent-color) ${fillPercent}%, transparent ${fillPercent}%)`;
                wordSpan.style.webkitBackgroundClip = 'text';
                wordSpan.style.backgroundClip = 'text';
                wordSpan.style.webkitTextFillColor = 'transparent';
            } else {
                // Word has already been sung
                wordSpan.classList.add('word-past');

                // Reset fill to complete
                wordSpan.style.background = 'var(--accent-color)';
                wordSpan.style.webkitBackgroundClip = 'text';
                wordSpan.style.backgroundClip = 'text';
                wordSpan.style.webkitTextFillColor = 'transparent';
            }
        });

        // Maintain focus on the active line continuously
        this.scrollToLine(currentLine);
    }

    /**
     * Scroll to keep line in view
     * @param {HTMLElement} line - Line element to scroll to
     */
    scrollToLine(line, immediate = false) {
        if (!this.lyricsContainer || !line) return;

        // Determine the actual scroll container
        // When in popup, .lyrics-popup-content is the scroll container, not .karaoke-lyrics
        const popupContent = this.lyricsContainer.closest('.lyrics-popup-content');
        const isPopup = Boolean(popupContent);
        const scrollContainer = isPopup ? popupContent : this.lyricsContainer;

        const containerHeight = scrollContainer.clientHeight;

        // Validate container is laid out
        if (containerHeight < 50) {
            setTimeout(() => this.scrollToLine(line, immediate), 100);
            return;
        }

        // Popup: position at 15% from top, Main: position at 65% from top
        const topMargin = isPopup ? (containerHeight * 0.15) : (containerHeight * 0.65);

        // Use getBoundingClientRect for accurate cross-container positioning
        const lineRect = line.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        const lineTopInContainer = lineRect.top - containerRect.top + scrollContainer.scrollTop;

        let targetTop = lineTopInContainer - topMargin;
        const maxScroll = Math.max(0, scrollContainer.scrollHeight - containerHeight);
        targetTop = Math.max(0, Math.min(targetTop, maxScroll));

        if (immediate) {
            scrollContainer.scrollTop = targetTop;
            return;
        }

        if (Math.abs(scrollContainer.scrollTop - targetTop) < 1) return;

        scrollContainer.scrollTo({
            top: targetTop,
            behavior: 'smooth'
        });
    }

    /**
     * Force refocus on the currently active line (used after UI interactions)
     */
    refocusCurrentLine(immediate = false) {
        if (!this.lyricsContainer || this.currentSegmentIndex < 0) return;
        const lines = this.lyricsContainer.querySelectorAll('.karaoke-line');
        const line = lines[this.currentSegmentIndex];
        if (line) {
            this.scrollToLine(line, immediate);
        }
    }

    /**
     * Handle line click (seek to time)
     * @param {Object} segment - Lyrics segment
     */
    onLineClick(segment) {
        console.log(`[KaraokeDisplay] Line clicked: "${segment.text}" at ${segment.start}s`);

        // Seek via mixer's audio engine
        if (window.mixer && window.mixer.audioEngine) {
            window.mixer.audioEngine.seekToPosition(segment.start);
        }
    }


    /**
     * Clear lyrics display
     */
    clear() {
        if (this.lyricsContainer) {
            this.lyricsContainer.innerHTML = '';
        }
        this.lyricsData = null;
        this.currentSegmentIndex = -1;
    }

    /**
     * Show/hide karaoke container
     * @param {boolean} visible
     */
    setVisible(visible) {
        if (this.container) {
            this.container.style.display = visible ? 'block' : 'none';
        }
    }

    /**
     * Format time in MM:SS
     * @param {number} seconds
     * @returns {string}
     */
    formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
}

// Make available globally
window.KaraokeDisplay = KaraokeDisplay;
