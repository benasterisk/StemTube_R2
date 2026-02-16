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

            // Count active stems
            const stems = window.audioEngine?.stems || {};
            const activeCount = Object.values(stems).filter(s => !s.muted && s.buffer).length;
            if (stemsCountEl) {
                stemsCountEl.textContent = `${activeCount} active`;
            }

            // Get tempo info
            const originalBpm = window.audioEngine?.originalBPM || window.EXTRACTION_INFO?.detected_bpm || 120;
            const currentBpm = parseFloat(document.getElementById('current-bpm')?.value) || originalBpm;
            const tempoRatio = currentBpm / originalBpm;
            if (tempoEl) {
                tempoEl.textContent = `${Math.round(tempoRatio * 100)}% (${Math.round(currentBpm)} BPM)`;
            }

            // Get pitch info
            const pitchSemitones = window.audioEngine?.currentPitchShift || 0;
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
            const stems = window.audioEngine?.stems;
            if (!stems || Object.keys(stems).length === 0) {
                alert('No stems loaded');
                return;
            }

            const filename = filenameInput?.value?.trim() || 'mix';

            // Get tempo/pitch values
            const originalBpm = window.audioEngine?.originalBPM || window.EXTRACTION_INFO?.detected_bpm || 120;
            const currentBpm = parseFloat(document.getElementById('current-bpm')?.value) || originalBpm;
            const tempoRatio = currentBpm / originalBpm;
            const pitchSemitones = window.audioEngine?.currentPitchShift || 0;

            // Collect mixer state
            const mixerState = {
                stems: {},
                tempo: tempoRatio,
                pitch: pitchSemitones,
                title: filename
            };

            // Collect stem states
            for (const [name, stem] of Object.entries(stems)) {
                if (stem.buffer) {
                    mixerState.stems[name] = {
                        buffer: stem.buffer,
                        volume: stem.gainNode?.gain?.value ?? 1.0,
                        pan: stem.panNode?.pan?.value ?? 0,
                        muted: stem.muted || false
                    };
                }
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
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.classList.add('exporting');
                startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
            }

            try {
                const exporter = new MixExporter({
                    sampleRate: 44100,
                    bitRate: 192,
                    onProgress: (percent, status) => {
                        if (progressFill) {
                            progressFill.style.width = `${percent}%`;
                        }
                        if (statusEl) {
                            statusEl.textContent = status;
                        }
                    }
                });

                const mp3Blob = await exporter.exportMix(mixerState);

                // Download
                exporter.downloadBlob(mp3Blob, `${filename}.mp3`);

                // Close modal after short delay
                setTimeout(() => {
                    closeExportModal();
                }, 500);

            } catch (error) {
                console.error('Export error:', error);
                alert(`Export failed: ${error.message}`);

                // Reset button
                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.classList.remove('exporting');
                    startBtn.innerHTML = '<i class="fas fa-download"></i> Export';
                }
            }
        }

        console.log('[ExportHandler] Initialized');
    }
})();
