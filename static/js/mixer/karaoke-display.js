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
                <div class="karaoke-spinner"></div>
                <div class="karaoke-loading-text">Generating lyrics...</div>
                <div class="karaoke-loading-subtext">Using Whisper "medium" model with GPU</div>
            </div>
        `;
        this.container.appendChild(loadingOverlay);
        this.loadingOverlay = loadingOverlay;

        // Get generate button from HTML
        this.generateButton = document.getElementById('karaoke-generate-btn');

        // Generate button event (Whisper)
        if (this.generateButton) {
            this.generateButton.addEventListener('click', () => {
                this.fetchOrGenerateLyrics();
            });
        }

        // Get LrcLib button from HTML
        this.lrcLibButton = document.getElementById('karaoke-lrclib-btn');

        // LrcLib button event
        if (this.lrcLibButton) {
            this.lrcLibButton.addEventListener('click', () => {
                this.fetchLrcLibLyrics();
            });
        }

        // Try to load existing lyrics from EXTRACTION_INFO first
        this.loadLyricsFromExtractionInfo();

        // If no lyrics loaded from initial data, try fetching
        if (!this.lyricsData) {
            this.fetchOrGenerateLyrics(false); // false = don't generate, just check if exists
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
                this.updateGenerateButton('Regenerate Lyrics', false);
            }
        }
    }

    /**
     * Fetch existing lyrics or generate new ones
     * @param {boolean} forceGenerate - If true, always generate new lyrics
     */
    async fetchOrGenerateLyrics(forceGenerate = true) {
        if (!this.extractionId) {
            console.warn('[KaraokeDisplay] No extraction ID provided');
            return;
        }

        if (this.isGenerating) {
            console.log('[KaraokeDisplay] Already generating lyrics...');
            return;
        }

        try {
            // First, check if lyrics already exist
            if (!forceGenerate) {
                console.log('[KaraokeDisplay] Checking for existing lyrics...');
                const response = await fetch(`/api/extractions/${this.extractionId}/lyrics`, {
                    credentials: 'same-origin'
                });
                const data = await response.json();

                if (data.success && data.lyrics) {
                    console.log('[KaraokeDisplay] Found cached lyrics');
                    this.loadLyrics(data.lyrics);
                    this.showControls(true);
                    // Update button to show "Regenerate" since lyrics already exist
                    this.updateGenerateButton('Regenerate Lyrics', false);
                    return;
                }
            }

            // Generate lyrics if not found or forced
            if (forceGenerate) {
                console.log('[KaraokeDisplay] Generating lyrics...');
                this.isGenerating = true;
                this.updateGenerateButton('Generating...', true);

                // Show loading overlay
                this.showLoadingOverlay(true);

                const response = await fetch(`/api/extractions/${this.extractionId}/lyrics/generate`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': getCsrfToken()
                    },
                    body: JSON.stringify({
                        language: null // Auto-detect - model uses server setting
                    })
                });

                // Hide loading overlay
                this.showLoadingOverlay(false);

                // Check HTTP status
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[KaraokeDisplay] HTTP error:', response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const data = await response.json();

                if (data.success && data.lyrics) {
                    console.log(`[KaraokeDisplay] Generated ${data.segments_count} lyric segments`);
                    this.loadLyrics(data.lyrics);
                    this.showControls(true);
                } else {
                    console.error('[KaraokeDisplay] Failed to generate lyrics:', data.error);
                    alert(`Failed to generate lyrics: ${data.error || 'Unknown error'}`);
                }

                this.isGenerating = false;
                this.updateGenerateButton('Regenerate Lyrics', false);
            }

        } catch (error) {
            console.error('[KaraokeDisplay] Error fetching/generating lyrics:', error);

            // Hide loading overlay on error
            this.showLoadingOverlay(false);

            this.isGenerating = false;
            this.updateGenerateButton('Generate Lyrics', false);
            alert(`Error: ${error.message}`);
        }
    }

    /**
     * Fetch lyrics from LrcLib API (crowdsourced synchronized lyrics)
     */
    async fetchLrcLibLyrics() {
        if (!this.extractionId) {
            console.warn('[KaraokeDisplay] No extraction ID for LrcLib fetch');
            return;
        }

        console.log(`[KaraokeDisplay] Fetching LrcLib lyrics for: ${this.extractionId}`);
        this.updateLrcLibButton('Fetching...', true);

        try {
            // First try without providing artist/track (auto-extract from metadata)
            let response = await fetch(`/api/extractions/${this.extractionId}/lyrics/lrclib`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            let data = await response.json();
            console.log('[KaraokeDisplay] LrcLib response:', data);

            // If artist is needed, prompt user
            if (data.need_artist || (response.status === 400 && data.error?.includes('Artist'))) {
                const track = data.extracted_track || window.EXTRACTION_INFO?.title || '';
                const artist = prompt(`Enter artist name for "${track}":`, '');

                if (!artist) {
                    console.log('[KaraokeDisplay] User cancelled artist input');
                    this.updateLrcLibButton('LrcLib', false);
                    return;
                }

                // Retry with artist
                response = await fetch(`/api/extractions/${this.extractionId}/lyrics/lrclib`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        artist_name: artist.trim(),
                        track_name: track
                    })
                });

                data = await response.json();
                console.log('[KaraokeDisplay] LrcLib retry response:', data);
            }

            if (data.error) {
                if (response.status === 404) {
                    const useWhisper = confirm(
                        `Lyrics not found on LrcLib for "${data.artist} - ${data.track}".\n\n` +
                        'Would you like to generate lyrics using Whisper AI instead?'
                    );
                    if (useWhisper) {
                        this.fetchOrGenerateLyrics(true);
                    }
                    this.updateLrcLibButton('LrcLib', false);
                    return;
                }
                throw new Error(data.error);
            }

            // Success!
            if (data.lyrics) {
                console.log(`[KaraokeDisplay] LrcLib found ${data.lyrics.length} lyrics lines`);
                this.loadLyrics(data.lyrics);
                this.showControls(true);
                this.updateGenerateButton('Regenerate', false);
                alert(`Found ${data.lyrics.length} lyrics lines from LrcLib!`);
            }

        } catch (error) {
            console.error('[KaraokeDisplay] LrcLib fetch error:', error);
            alert(`LrcLib error: ${error.message}`);
        } finally {
            this.updateLrcLibButton('LrcLib', false);
        }
    }

    /**
     * Update LrcLib button state
     */
    updateLrcLibButton(text, disabled) {
        if (this.lrcLibButton) {
            const label = this.lrcLibButton.querySelector('span');
            if (label) {
                label.textContent = text;
            }
            this.lrcLibButton.disabled = disabled;
            this.lrcLibButton.style.opacity = disabled ? '0.5' : '1';
            this.lrcLibButton.style.cursor = disabled ? 'not-allowed' : 'pointer';
        }
    }

    /**
     * Update generate button state
     * @param {string} text - Button text
     * @param {boolean} disabled - Whether button is disabled
     */
    updateGenerateButton(text, disabled) {
        if (this.generateButton) {
            const label = this.generateButton.querySelector('span');
            if (label) {
                label.textContent = text;
            }
            this.generateButton.disabled = disabled;
            this.generateButton.style.opacity = disabled ? '0.5' : '1';
            this.generateButton.style.cursor = disabled ? 'not-allowed' : 'pointer';
        }
    }

    /**
     * Show or hide the loading overlay
     * @param {boolean} show - Whether to show the overlay
     */
    showLoadingOverlay(show) {
        if (this.loadingOverlay) {
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

        wordSpans.forEach((wordSpan) => {
            const wordStart = parseFloat(wordSpan.dataset.start);
            const wordEnd = parseFloat(wordSpan.dataset.end);

            // Remove all previous states
            wordSpan.classList.remove('word-past', 'word-current', 'word-future');

            if (currentTime < wordStart) {
                // Word hasn't been sung yet
                wordSpan.classList.add('word-future');
            } else if (currentTime >= wordStart && currentTime <= wordEnd) {
                // Word is currently being sung
                wordSpan.classList.add('word-current');

                // Calculate fill percentage for smooth animation
                const progress = (currentTime - wordStart) / (wordEnd - wordStart);
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
