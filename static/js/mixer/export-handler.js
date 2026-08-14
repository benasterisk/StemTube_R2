/**
 * Export Handler for Desktop Mixer
 * Handles the export modal UI and integrates with MixExporter
 */

(function() {
    'use strict';

    // Wait for DOM and other scripts to load
    document.addEventListener('DOMContentLoaded', initExportHandler);

    function initExportHandler() {
        const exportBtn = document.getElementById('export-mix-btn');
        const modal = document.getElementById('export-modal');
        const closeBtn = document.getElementById('export-modal-close');
        const cancelBtn = document.getElementById('export-cancel');
        const startBtn = document.getElementById('export-start');
        const filenameInput = document.getElementById('export-filename');
        const stemsCountEl = document.getElementById('export-stems-count');
        const tempoEl = document.getElementById('export-tempo');
        const pitchEl = document.getElementById('export-pitch');
        const progressEl = document.getElementById('export-progress');
        const progressFill = document.getElementById('export-progress-fill');
        const statusEl = document.getElementById('export-status');

        if (!exportBtn || !modal) {
            console.warn('[ExportHandler] Export elements not found');
            return;
        }

        // Open modal
        exportBtn.addEventListener('click', () => {
            openExportModal();
        });

        // Close modal
        closeBtn?.addEventListener('click', closeExportModal);
        cancelBtn?.addEventListener('click', closeExportModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeExportModal();
        });

        // Start export
        startBtn?.addEventListener('click', startExport);

        function openExportModal() {
            // Get current song title
            const titleEl = document.getElementById('song-title-display');
            const title = titleEl?.textContent || 'mix';
            const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
            if (filenameInput) {
                filenameInput.value = `${safeTitle}_mix`;
            }

            // Count active stems (stems live on window.stemMixer, not window.audioEngine)
            const stems = window.stemMixer?.stems || {};
            const activeCount = Object.values(stems).filter(s => !s.muted && s.buffer).length;
            if (stemsCountEl) {
                stemsCountEl.textContent = `${activeCount} active`;
            }

            // Get tempo info
            const originalBpm = getOriginalBpm();
            const currentBpm = parseFloat(document.getElementById('current-bpm')?.value) || originalBpm;
            const tempoRatio = currentBpm / originalBpm;
            if (tempoEl) {
                tempoEl.textContent = `${Math.round(tempoRatio * 100)}% (${Math.round(currentBpm)} BPM)`;
            }

            // Get pitch info
            const pitchSemitones = getPitchSemitones();
            if (pitchEl) {
                pitchEl.textContent = pitchSemitones >= 0 ? `+${pitchSemitones} st` : `${pitchSemitones} st`;
            }

            // Reset progress
            if (progressEl) progressEl.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.classList.remove('exporting');
                startBtn.innerHTML = '<i class="fas fa-download"></i> Export';
            }

            // Show modal
            modal.setAttribute('aria-hidden', 'false');
        }

        function closeExportModal() {
            modal.setAttribute('aria-hidden', 'true');
        }

        async function startExport() {
            const stems = window.stemMixer?.stems;
            if (!stems || Object.keys(stems).length === 0) {
                alert('No stems loaded');
                return;
            }

            const filename = filenameInput?.value?.trim() || 'mix';

            // Get tempo/pitch values
            const originalBpm = getOriginalBpm();
            const currentBpm = parseFloat(document.getElementById('current-bpm')?.value) || originalBpm;
            const tempoRatio = currentBpm / originalBpm;
            const pitchSemitones = getPitchSemitones();

            // Collect mixer state
            const mixerState = {
                stems: {},
                tempo: tempoRatio,
                pitch: pitchSemitones,
                title: filename
            };

            // Collect stem states. Volume/pan are stored directly on the stem
            // object (stem.volume / stem.pan), NOT on gainNode/panNode (those are
            // null until audio graph is wired and don't reflect the slider value).
            for (const [name, stem] of Object.entries(stems)) {
                if (stem.buffer) {
                    mixerState.stems[name] = {
                        buffer: stem.buffer,
                        volume: (typeof stem.volume === 'number') ? stem.volume
                                : (stem.gainNode?.gain?.value ?? 1.0),
                        pan: (typeof stem.pan === 'number') ? stem.pan
                                : (stem.panNode?.pan?.value ?? 0),
                        muted: stem.muted || false
                    };
                }
            }

            // Optionally bake the metronome clicks into the export so the user can
            // generate a calibrated test/practice audio without screen-capturing.
            const includeMetro = document.getElementById('export-include-metronome')?.checked;
            if (includeMetro && window.stemMixer?.metronome) {
                mixerState.metronome = buildMetronomeExportSpec(window.stemMixer.metronome);
            }

            // Collect recording states
            const recEngine = window.stemMixer?.recordingEngine;
            if (recEngine && recEngine.recordings.length > 0) {
                mixerState.recordings = recEngine.recordings
                    .filter(r => !r.muted && r.audioBuffer)
                    .map(r => ({
                        audioBuffer: r.audioBuffer,
                        startOffset: r.startOffset,
                        volume: r.volume,
                        pan: r.pan,
                        muted: r.muted,
                    }));
            }

            // Show progress
            if (progressEl) progressEl.style.display = 'block';
            if (progressFill) progressFill.style.width = '0%';
            if (cancelBtn) cancelBtn.disabled = true;
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.classList.add('exporting');
                startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting… 0%';
            }

            try {
                const exporter = new MixExporter({
                    sampleRate: 44100,
                    bitRate: 192,
                    onProgress: (percent, status) => {
                        const pct = Math.max(0, Math.min(100, Math.round(percent)));
                        if (progressFill) progressFill.style.width = `${pct}%`;
                        if (statusEl) statusEl.textContent = `${status} (${pct}%)`;
                        if (startBtn) {
                            startBtn.innerHTML =
                                `<i class="fas fa-spinner fa-spin"></i> Exporting… ${pct}%`;
                        }
                    }
                });

                const mp3Blob = await exporter.exportMix(mixerState);

                // Success feedback
                if (statusEl) statusEl.textContent = `Done — ${(mp3Blob.size/1048576).toFixed(1)} MB. Downloading…`;
                if (startBtn) startBtn.innerHTML = '<i class="fas fa-check"></i> Done!';

                // Download
                exporter.downloadBlob(mp3Blob, `${filename}.mp3`);

                // Reset + close modal after a short delay so the user sees "Done"
                setTimeout(() => {
                    if (cancelBtn) cancelBtn.disabled = false;
                    if (startBtn) {
                        startBtn.disabled = false;
                        startBtn.classList.remove('exporting');
                        startBtn.innerHTML = '<i class="fas fa-download"></i> Export';
                    }
                    if (progressEl) progressEl.style.display = 'none';
                    closeExportModal();
                }, 900);

            } catch (error) {
                console.error('Export error:', error);
                if (statusEl) statusEl.textContent = `Export failed: ${error.message}`;
                alert(`Export failed: ${error.message}`);

                // Reset button
                if (cancelBtn) cancelBtn.disabled = false;
                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.classList.remove('exporting');
                    startBtn.innerHTML = '<i class="fas fa-download"></i> Export';
                }
            }
        }

        // ── Helpers ───────────────────────────────────────────────────

        function getOriginalBpm() {
            return window.simplePitchTempo?.originalBPM
                || window.EXTRACTION_INFO?.detected_bpm
                || 120;
        }

        function getPitchSemitones() {
            return window.simplePitchTempo?.currentPitchShift || 0;
        }

        /**
         * Build the metronome export spec: the exact click times (resolution +
         * manual offset already baked in by _getEffectiveBeats), plus volume.
         * The exporter synthesizes 1200Hz sine clicks at these song-times.
         * Click times are in ORIGINAL song-time; the exporter divides by tempo
         * to place them correctly in the (possibly time-stretched) output.
         */
        function buildMetronomeExportSpec(metro) {
            let beats = [];
            try {
                beats = (typeof metro._getEffectiveBeats === 'function')
                    ? metro._getEffectiveBeats()
                    : (Array.isArray(metro.beatTimes) ? metro.beatTimes.slice() : []);
            } catch (e) {
                beats = Array.isArray(metro.beatTimes) ? metro.beatTimes.slice() : [];
            }
            // Bar positions (1 = downbeat) for accenting the downbeat click.
            const positions = Array.isArray(metro.beatPositions) ? metro.beatPositions : [];
            // Diagnostic: log the actual baked grid vs the raw DB grid so we can
            // see any runtime offset (manualOffsetSec, extrapolation, etc.).
            try {
                const dbBeats = window.EXTRACTION_INFO?.beat_times;
                const db = Array.isArray(dbBeats) ? dbBeats
                          : (typeof dbBeats === 'string' ? JSON.parse(dbBeats) : []);
                console.log('[Export] baked beats[0..4]:', beats.slice(0, 5).map(x => +x.toFixed(4)));
                console.log('[Export] DB beat_times[0..4]:', (db || []).slice(0, 5).map(x => +x.toFixed(4)));
                console.log('[Export] manualOffsetSec:', metro.manualOffsetSec,
                            '| clickResolution:', metro.clickResolution,
                            '| clickLatencyOffset:', metro.clickLatencyOffset);
            } catch (e) { /* ignore */ }
            return {
                beatTimes: beats,
                positions: positions,
                volume: (typeof metro.clickVolume === 'number') ? metro.clickVolume : 0.7,
            };
        }

        console.log('[ExportHandler] Initialized');
    }
})();
