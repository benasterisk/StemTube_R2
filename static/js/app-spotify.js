// ── StemTify — import Spotify playlists, download from YouTube ──

(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const fetchBtn = document.getElementById('spotifyFetchBtn');
        if (fetchBtn) fetchBtn.addEventListener('click', fetchPlaylist);

        const urlInput = document.getElementById('spotifyUrlInput');
        if (urlInput) urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') fetchPlaylist();
        });

        // Load previously saved playlists
        loadSavedPlaylists();

        // WebSocket events
        if (window.socket) {
            window.socket.on('spotify_batch_progress', onBatchProgress);
            window.socket.on('spotify_batch_complete', onBatchComplete);
        }
    });

    // ── Fetch playlist from URL ────────────────────────────────

    async function fetchPlaylist() {
        const urlInput = document.getElementById('spotifyUrlInput');
        const url = urlInput?.value.trim();
        if (!url) { showToast('Paste a Spotify or YouTube playlist URL', 'warning'); return; }

        const fetchBtn = document.getElementById('spotifyFetchBtn');
        if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        try {
            const res = await fetch('/api/spotify/playlist', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url})
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || 'Failed to load playlist', 'error');
                return;
            }

            showToast(`Loaded "${data.name}" — ${data.track_count} tracks`, 'success');
            urlInput.value = '';
            showPlaylistTracks(data.playlist_id, data.name, data.tracks);
            loadSavedPlaylists(); // refresh sidebar list

        } catch (e) {
            showToast('Error loading playlist', 'error');
        } finally {
            if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.innerHTML = '<i class="fas fa-search"></i> Load'; }
        }
    }

    // ── Saved playlists list ───────────────────────────────────

    async function loadSavedPlaylists() {
        const list = document.getElementById('spotifySavedList');
        if (!list) return;

        try {
            const res = await fetch('/api/spotify/playlists/saved');
            const data = await res.json();
            const playlists = data.playlists || [];

            if (playlists.length === 0) {
                list.innerHTML = '<div class="spotify-empty">No saved playlists yet</div>';
                return;
            }

            list.innerHTML = '';
            for (const pl of playlists) {
                const item = document.createElement('div');
                item.className = 'spotify-saved-item';
                item.innerHTML = `
                    <img src="${pl.thumbnail_url || '/static/img/default-thumb.svg'}" class="spotify-saved-thumb">
                    <div class="spotify-saved-info">
                        <div class="spotify-saved-name">${esc(pl.name)}</div>
                        <div class="spotify-saved-meta">${pl.track_count || 0} tracks</div>
                    </div>
                    <button class="btn btn-icon spotify-del-btn" data-id="${pl.id}" title="Delete"><i class="fas fa-trash"></i></button>
                `;
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.spotify-del-btn')) return;
                    openSavedPlaylist(pl.id);
                });
                list.appendChild(item);
            }

            list.querySelectorAll('.spotify-del-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await fetch(`/api/spotify/playlists/saved/${btn.dataset.id}`, {method: 'DELETE'});
                    loadSavedPlaylists();
                });
            });
        } catch (e) {
            console.error('[Spotify] loadSaved error:', e);
        }
    }

    async function openSavedPlaylist(id) {
        try {
            const res = await fetch(`/api/spotify/playlists/saved/${id}`);
            const data = await res.json();
            if (data.success) {
                showPlaylistTracks(data.playlist.id, data.playlist.name, data.playlist.tracks);
            }
        } catch (e) {
            showToast('Failed to load playlist', 'error');
        }
    }

    // ── Track list display ─────────────────────────────────────

    function showPlaylistTracks(playlistId, name, tracks) {
        const container = document.getElementById('spotifyTracksContainer');
        if (!container) return;

        let html = `
            <div class="spotify-tracks-header">
                <h3>${esc(name)}</h3>
                <span>${tracks.length} tracks</span>
                <button class="btn btn-small btn-primary" id="spotifyDownloadAllBtn" data-id="${playlistId}">
                    <i class="fas fa-download"></i> Download All
                </button>
            </div>
            <div class="spotify-tracks-items">
        `;

        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            const dur = t.duration_ms ? fmtDur(t.duration_ms) : '';
            const check = t.video_id ? '<i class="fas fa-check-circle" style="color:#1DB954"></i>' : '';
            html += `<div class="spotify-track-row">
                <span class="spotify-track-num">${i + 1}</span>
                <div class="spotify-track-info">
                    <div class="spotify-track-title">${esc(t.title)}</div>
                    <div class="spotify-track-artist">${esc(t.artist)}</div>
                </div>
                <span class="spotify-track-duration">${dur}</span>
                ${check}
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;

        document.getElementById('spotifyDownloadAllBtn')?.addEventListener('click', () => downloadAll(playlistId));
    }

    async function downloadAll(playlistId) {
        const btn = document.getElementById('spotifyDownloadAllBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...'; }

        try {
            const res = await fetch(`/api/spotify/playlists/${playlistId}/download`, {method: 'POST'});
            const data = await res.json();
            if (data.success) {
                showToast(`Downloading ${data.track_count} tracks...`, 'success');
            } else {
                showToast(data.error || 'Failed', 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download All'; }
            }
        } catch (e) {
            showToast('Error', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download All'; }
        }
    }

    // ── Batch Progress ─────────────────────────────────────────

    function onBatchProgress(data) {
        const el = document.getElementById('spotifyBatchProgress');
        if (!el) return;
        el.style.display = '';
        const pct = ((data.current_track_index + 1) / data.total_tracks * 100).toFixed(0);
        const text = data.phase === 'searching' ? `Searching: ${data.current_title}`
            : data.phase === 'exists' ? `Already have: ${data.current_title}`
            : `Queued: ${data.current_title}`;
        document.getElementById('spotifyBatchText').textContent = text;
        document.getElementById('spotifyBatchCount').textContent = `${data.current_track_index + 1}/${data.total_tracks}`;
        document.getElementById('spotifyBatchFill').style.width = pct + '%';
    }

    function onBatchComplete(data) {
        const el = document.getElementById('spotifyBatchProgress');
        if (el) el.style.display = 'none';
        const btn = document.getElementById('spotifyDownloadAllBtn');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download All'; }
        showToast(`Done! ${data.downloaded} downloaded, ${data.existed} already had, ${data.failed} failed`, 'success');
        if (typeof loadLibrary === 'function') loadLibrary();
    }

    // ── Helpers ─────────────────────────────────────────────────

    function fmtDur(ms) {
        const s = Math.round(ms / 1000);
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

})();
