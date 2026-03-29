// ── StemTify — import Spotify playlists, download from YouTube ──

(function() {
    'use strict';

    // Persistent state across tab switches
    let currentPlaylistId = null;
    let currentPlaylistName = '';
    let currentTracks = [];
    // playlistId → { trackIndex → status }
    let batchStatuses = {};
    let batchGlobal = null; // { current, total, text } or null
    // video_id → track index (for mapping download events to tracks)
    let videoIdToIndex = {};
    // download_id → video_id (from batch progress events)
    let downloadIdToVideoId = {};

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('spotifyFetchBtn')?.addEventListener('click', fetchPlaylist);
        document.getElementById('spotifyUrlInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') fetchPlaylist();
        });

        loadSavedPlaylists();
        window._stemtifyRefresh = () => {
            loadSavedPlaylists();
            // Re-render current track view if we have one (restores statuses)
            if (currentPlaylistId && currentTracks.length) {
                renderTracks();
            }
        };

        (function bindSocket() {
            if (typeof socket !== 'undefined' && socket) {
                socket.on('spotify_batch_progress', onBatchProgress);
                socket.on('spotify_batch_complete', onBatchComplete);
                // Listen to individual download events to update per-track bars
                socket.on('download_progress', onDownloadProgress);
                socket.on('download_complete', onDownloadComplete);
                socket.on('download_error', onDownloadError);
                console.log('[StemTify] Socket events bound');
            } else {
                setTimeout(bindSocket, 500);
            }
        })();
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
            if (!res.ok || !data.success) { showToast(data.error || 'Failed', 'error'); return; }
            showToast(`Loaded "${data.name}" — ${data.track_count} tracks`, 'success');
            urlInput.value = '';
            currentPlaylistId = data.playlist_id;
            currentPlaylistName = data.name;
            currentTracks = data.tracks;
            renderTracks();
            loadSavedPlaylists();
        } catch (e) {
            showToast('Error loading playlist', 'error');
        } finally {
            if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.innerHTML = '<i class="fas fa-search"></i> Load'; }
        }
    }

    // ── Saved playlists ────────────────────────────────────────

    async function loadSavedPlaylists() {
        const list = document.getElementById('spotifySavedList');
        if (!list) return;
        try {
            const res = await fetch('/api/spotify/playlists/saved');
            const data = await res.json();
            const playlists = data.playlists || [];
            if (playlists.length === 0) { list.innerHTML = '<div class="spotify-empty">No saved playlists yet</div>'; return; }
            list.innerHTML = '';
            for (const pl of playlists) {
                const item = document.createElement('div');
                item.className = 'spotify-saved-item' + (pl.id === currentPlaylistId ? ' active' : '');
                item.innerHTML = `
                    <img src="${pl.thumbnail_url || '/static/img/default-thumb.svg'}" class="spotify-saved-thumb">
                    <div class="spotify-saved-info">
                        <div class="spotify-saved-name">${esc(pl.name)}</div>
                        <div class="spotify-saved-meta">${pl.track_count || 0} tracks</div>
                    </div>
                    <button class="btn btn-icon spotify-del-btn" data-id="${pl.id}" title="Delete"><i class="fas fa-trash"></i></button>`;
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.spotify-del-btn')) return;
                    openSavedPlaylist(pl.id);
                });
                list.appendChild(item);
            }
            list.querySelectorAll('.spotify-del-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await fetch(`/api/spotify/playlists/saved/${btn.dataset.id}`, {method: 'DELETE'});
                    if (parseInt(btn.dataset.id) === currentPlaylistId) {
                        currentPlaylistId = null; currentTracks = [];
                        const c = document.getElementById('spotifyTracksContainer');
                        if (c) c.innerHTML = '';
                    }
                    loadSavedPlaylists();
                });
            });
        } catch (e) { console.error('[StemTify]', e); }
    }

    async function openSavedPlaylist(id) {
        try {
            const res = await fetch(`/api/spotify/playlists/saved/${id}`);
            const data = await res.json();
            if (data.success) {
                currentPlaylistId = data.playlist.id;
                currentPlaylistName = data.playlist.name;
                currentTracks = data.playlist.tracks || [];
                renderTracks();
                // Highlight in sidebar
                document.querySelectorAll('.spotify-saved-item').forEach(el => el.classList.remove('active'));
            }
        } catch (e) { showToast('Failed to load playlist', 'error'); }
    }

    // ── Render tracks with progress bars ───────────────────────

    function renderTracks() {
        const container = document.getElementById('spotifyTracksContainer');
        if (!container) return;

        const statuses = batchStatuses[currentPlaylistId] || {};

        let html = `
            <div class="spotify-tracks-header">
                <h3>${esc(currentPlaylistName)}</h3>
                <span>${currentTracks.length} tracks</span>
                <button class="btn btn-small btn-primary" id="spotifyDownloadAllBtn" data-id="${currentPlaylistId}">
                    <i class="fas fa-download"></i> Download All
                </button>
            </div>
            <div id="spotifyBatchProgress" style="${batchGlobal ? '' : 'display:none;'} margin-bottom:12px; padding:10px; background:var(--bg-secondary); border-radius:8px;">
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                    <span id="spotifyBatchText">${batchGlobal ? esc(batchGlobal.text) : ''}</span>
                    <span id="spotifyBatchCount">${batchGlobal ? batchGlobal.count : ''}</span>
                </div>
                <div style="height:6px; background:var(--border); border-radius:3px; overflow:hidden;">
                    <div id="spotifyBatchFill" style="height:100%; background:#1DB954; width:${batchGlobal ? batchGlobal.pct : 0}%; transition:width 0.3s;"></div>
                </div>
            </div>
            <div class="spotify-tracks-items">`;

        for (let i = 0; i < currentTracks.length; i++) {
            const t = currentTracks[i];
            const dur = t.duration_ms ? fmtDur(t.duration_ms) : '';
            const idx = i + 1;
            const st = statuses[idx] || (t.downloaded ? 'downloaded' : t.video_id ? 'exists' : 'pending');

            html += `<div class="spotify-track-row" data-idx="${idx}">
                <span class="spotify-track-num">${idx}</span>
                <div class="spotify-track-info">
                    <div class="spotify-track-title">${esc(t.title)}</div>
                    <div class="spotify-track-artist">${esc(t.artist)}</div>
                </div>
                <span class="spotify-track-duration">${dur}</span>
                <div class="stfy-track-progress">
                    <div class="stfy-track-bar"><div class="stfy-track-fill ${st}"></div></div>
                    <span class="stfy-track-label">${statusLabel(st)}</span>
                </div>
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;

        document.getElementById('spotifyDownloadAllBtn')?.addEventListener('click', () => downloadAll());
    }

    function statusLabel(s) {
        const map = {
            searching: 'Searching...', queued: 'Queued', downloading: 'Downloading...',
            exists: 'Done', downloaded: 'Done', failed: 'Failed', search_failed: 'Not found', pending: ''
        };
        return map[s] || s;
    }

    function updateTrackUI(idx, status) {
        const row = document.querySelector(`.spotify-track-row[data-idx="${idx}"]`);
        if (!row) return;
        const fill = row.querySelector('.stfy-track-fill');
        const label = row.querySelector('.stfy-track-label');
        if (fill) fill.className = 'stfy-track-fill ' + status;
        if (label) label.textContent = statusLabel(status);
    }

    // ── Download ───────────────────────────────────────────────

    async function downloadAll() {
        const btn = document.getElementById('spotifyDownloadAllBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        // Init statuses and video_id mapping for this playlist
        batchStatuses[currentPlaylistId] = {};
        videoIdToIndex = {};
        downloadIdToVideoId = {};
        batchGlobal = { text: 'Starting...', count: '', pct: 0 };

        // Build video_id → track index map from tracks that already have a video_id
        for (let i = 0; i < currentTracks.length; i++) {
            if (currentTracks[i].video_id) {
                videoIdToIndex[currentTracks[i].video_id] = i + 1;
            }
        }

        const progressEl = document.getElementById('spotifyBatchProgress');
        if (progressEl) progressEl.style.display = '';

        try {
            const res = await fetch(`/api/spotify/playlists/${currentPlaylistId}/download`, {method: 'POST'});
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || 'Failed', 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download All'; }
                batchGlobal = null;
                if (progressEl) progressEl.style.display = 'none';
            }
        } catch (e) {
            showToast('Error', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download All'; }
            batchGlobal = null;
        }
    }

    // ── WebSocket ──────────────────────────────────────────────

    function onBatchProgress(data) {
        const plId = data.playlist_id;
        const idx = data.current || 0;
        const total = data.total || 1;
        const title = data.track_title || '';
        const status = data.status || '';
        const pct = (idx / total * 100).toFixed(0);

        // Store status (persists across tab switches)
        if (!batchStatuses[plId]) batchStatuses[plId] = {};
        batchStatuses[plId][idx] = status;

        // Map video_id to track index for download events
        if (data.video_id) {
            videoIdToIndex[data.video_id] = idx;
        }

        // Store global progress
        batchGlobal = {
            text: `${statusLabel(status)} — ${title}`,
            count: `${idx} / ${total}`,
            pct: pct
        };

        // Update global bar
        const el = document.getElementById('spotifyBatchProgress');
        if (el) el.style.display = '';
        const textEl = document.getElementById('spotifyBatchText');
        if (textEl) textEl.textContent = batchGlobal.text;
        const countEl = document.getElementById('spotifyBatchCount');
        if (countEl) countEl.textContent = batchGlobal.count;
        const fillEl = document.getElementById('spotifyBatchFill');
        if (fillEl) fillEl.style.width = pct + '%';

        // Update per-track bar (only if viewing this playlist)
        if (plId === currentPlaylistId) {
            updateTrackUI(idx, status);
        }
    }

    function onBatchComplete(data) {
        batchGlobal = null;

        const el = document.getElementById('spotifyBatchProgress');
        if (el) {
            const t = document.getElementById('spotifyBatchText');
            if (t) t.textContent = `Done! ${data.downloaded || 0} downloaded, ${data.skipped || 0} existed, ${data.failed || 0} failed`;
            const f = document.getElementById('spotifyBatchFill');
            if (f) f.style.width = '100%';
            setTimeout(() => { el.style.display = 'none'; }, 10000);
        }

        const btn = document.getElementById('spotifyDownloadAllBtn');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download All'; }

        if (typeof loadLibrary === 'function') loadLibrary();
    }

    // ── Individual download events → per-track bars ─────────────

    function _videoIdFromDownloadId(dlId) {
        // download_id format: "{videoId}_{timestamp}"
        // Video IDs can contain underscores (e.g., OK_b2-w0u60)
        // so we match against known video_ids by checking if dlId starts with them
        if (!dlId) return null;
        for (const vid of Object.keys(videoIdToIndex)) {
            if (dlId.startsWith(vid + '_') || dlId === vid) return vid;
        }
        return null;
    }

    function _updateTrackFromVideoId(videoId, status) {
        const idx = videoIdToIndex[videoId];
        if (!idx) return;
        if (currentPlaylistId && batchStatuses[currentPlaylistId]) {
            batchStatuses[currentPlaylistId][idx] = status;
        }
        updateTrackUI(idx, status);
    }

    function onDownloadProgress(data) {
        const vid = _videoIdFromDownloadId(data.download_id);
        if (vid) _updateTrackFromVideoId(vid, 'downloading');
    }

    function onDownloadComplete(data) {
        const vid = data.video_id || _videoIdFromDownloadId(data.download_id);
        if (vid) {
            _updateTrackFromVideoId(vid, 'downloaded');
        }
    }

    function onDownloadError(data) {
        // Ignore individual download errors during batch — the batch manager
        // handles retries and final status. Showing "failed" here causes
        // false negatives when yt-dlp retries and succeeds.
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
