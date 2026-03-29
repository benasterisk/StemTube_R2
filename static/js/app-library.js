// ── Library Views — Playlists, Albums, Tracks, Stems ────────────

(function() {
    'use strict';

    let currentView = 'playlists';

    document.addEventListener('DOMContentLoaded', () => {
        // View switcher buttons
        document.querySelectorAll('.library-view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.library-view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                renderCurrentView();
            });
        });
    });

    // Expose for use by other modules
    window._libraryCurrentView = () => currentView;
    window._libraryRenderView = renderCurrentView;

    function renderCurrentView() {
        // _myLibraryRawData is set by app-downloads.js loadDownloads()
        const data = window._myLibraryRawData || [];
        switch (currentView) {
            case 'playlists': renderPlaylistsView(); break;
            case 'albums': renderAlbumsView(data); break;
            case 'tracks': renderTracksView(data); break;
            case 'stems': renderStemsView(data); break;
            default: renderPlaylistsView(); break;
        }
    }

    // ── Tracks View (renamed from Songs — uses existing createDownloadElement) ──

    function renderTracksView(data) {
        // Delegate to existing _renderMyLibrary which handles sort/search
        if (typeof _renderMyLibrary === 'function') {
            _renderMyLibrary();
        }
        // After rendering, inject "Add to Playlist" buttons on each track card
        setTimeout(() => _injectAddToPlaylistButtons(), 50);
    }

    // ── Albums View ─────────────────────────────────────────────

    async function renderAlbumsView(data) {
        const container = document.getElementById('downloadsContainer');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            const res = await fetch('/api/library/albums');
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            const albums = result.albums || [];
            const singlesCount = result.singles_count || 0;

            if (albums.length === 0 && singlesCount === 0) {
                container.innerHTML = '<div class="empty-state">No albums found</div>';
                return;
            }

            container.innerHTML = '<div class="library-artist-grid"></div>';
            const grid = container.querySelector('.library-artist-grid');

            // Render album cards
            for (const album of albums) {
                const card = document.createElement('div');
                card.className = 'library-artist-card';
                card.innerHTML = `
                    <img src="${album.thumbnail_url || '/static/img/default-thumb.svg'}" class="library-artist-thumb" alt="">
                    <div class="library-artist-info">
                        <div class="library-artist-name">${_esc(album.name)}</div>
                        <div class="library-artist-count">${_esc(album.artist || '')}</div>
                        <div class="library-artist-count">${album.track_count} track${album.track_count !== 1 ? 's' : ''}</div>
                    </div>
                `;
                card.addEventListener('click', () => drillDownAlbum(album.id, album.name));
                grid.appendChild(card);
            }

            // Render "(Singles)" group if there are tracks with no album
            if (singlesCount > 0) {
                const card = document.createElement('div');
                card.className = 'library-artist-card';
                card.innerHTML = `
                    <div class="library-artist-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--bg-secondary);font-size:24px;"><i class="fas fa-music"></i></div>
                    <div class="library-artist-info">
                        <div class="library-artist-name">(Singles)</div>
                        <div class="library-artist-count">${singlesCount} track${singlesCount !== 1 ? 's' : ''}</div>
                    </div>
                `;
                card.addEventListener('click', () => drillDownAlbum(null, '(Singles)'));
                grid.appendChild(card);
            }

        } catch (e) {
            console.error('renderAlbumsView error:', e);
            container.innerHTML = '<div class="empty-state">Failed to load albums</div>';
        }
    }

    async function drillDownAlbum(albumId, albumName) {
        const container = document.getElementById('downloadsContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            const url = albumId !== null
                ? `/api/library/albums/${albumId}/tracks`
                : '/api/library/albums/singles';
            const res = await fetch(url);
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            const tracks = result.tracks || [];

            let html = `<div class="library-drilldown">
                <div class="library-drilldown-header">
                    <button class="btn btn-small library-back-btn"><i class="fas fa-arrow-left"></i> Back</button>
                    <h3>${_esc(albumName)}</h3>
                    <span>${tracks.length} tracks</span>
                    <button class="btn btn-small btn-primary library-play-all-btn"><i class="fas fa-play"></i> Play All</button>
                </div>
                <div class="library-drilldown-items"></div>
            </div>`;

            container.innerHTML = html;

            const itemsContainer = container.querySelector('.library-drilldown-items');
            for (const t of tracks) {
                if (typeof createDownloadElement === 'function') {
                    itemsContainer.appendChild(createDownloadElement(t));
                }
            }

            // Batch update extraction statuses
            const videoIds = tracks.filter(t => t.video_id).map(t => t.video_id);
            if (videoIds.length > 0 && typeof batchUpdateExtractionStatuses === 'function') {
                batchUpdateExtractionStatuses(videoIds);
            }

            container.querySelector('.library-back-btn').addEventListener('click', () => renderAlbumsView(window._myLibraryRawData || []));
            container.querySelector('.library-play-all-btn')?.addEventListener('click', () => {
                playQueue(tracks.filter(t => t.file_path || t.video_id).map(t => t.video_id));
            });

            // Inject "Add to Playlist" buttons
            setTimeout(() => _injectAddToPlaylistButtons(itemsContainer), 50);

        } catch (e) {
            console.error('drillDownAlbum error:', e);
            container.innerHTML = '<div class="empty-state">Failed to load album tracks</div>';
        }
    }

    // ── Stems View (renamed from Extracted) ────────────────────

    let stemsSubView = 'songs'; // 'songs' or 'artists'

    function renderStemsView(data) {
        const container = document.getElementById('downloadsContainer');
        if (!container) return;

        const searchQuery = (document.getElementById('myLibrarySearch')?.value || '').toLowerCase();
        const extracted = data.filter(item => {
            if (!item.extracted || item.extracted === 0) return false;
            if (searchQuery) {
                return (item.title || '').toLowerCase().includes(searchQuery) ||
                       (item.artist || '').toLowerCase().includes(searchQuery);
            }
            return true;
        });

        if (extracted.length === 0) {
            container.innerHTML = '<div class="empty-state">No extracted stems yet</div>';
            return;
        }

        // Sub-view switcher
        let html = `<div class="library-sub-switcher">
            <button class="library-sub-btn ${stemsSubView === 'songs' ? 'active' : ''}" data-subview="songs">All Tracks</button>
            <button class="library-sub-btn ${stemsSubView === 'artists' ? 'active' : ''}" data-subview="artists">By Artist</button>
            <span style="flex:1"></span>
            <button class="btn btn-small btn-primary" id="stemsPlayAllBtn"><i class="fas fa-play"></i> Play All</button>
        </div><div id="stemsContent"></div>`;
        container.innerHTML = html;

        container.querySelectorAll('.library-sub-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                stemsSubView = btn.dataset.subview;
                renderStemsView(data);
            });
        });

        container.querySelector('#stemsPlayAllBtn')?.addEventListener('click', () => {
            playQueue(extracted.filter(s => s.file_path).map(s => s.video_id));
        });

        const content = document.getElementById('stemsContent');
        if (stemsSubView === 'artists') {
            // Group by artist
            const artistMap = {};
            for (const item of extracted) {
                const artist = item.artist || '(Unknown)';
                if (!artistMap[artist]) artistMap[artist] = { songs: [], thumbnail: item.thumbnail_url || item.thumbnail || '' };
                artistMap[artist].songs.push(item);
            }
            const sorted = Object.entries(artistMap).sort((a, b) => a[0].localeCompare(b[0], undefined, {sensitivity: 'base'}));
            content.innerHTML = '<div class="library-artist-grid"></div>';
            const grid = content.querySelector('.library-artist-grid');
            for (const [artist, info] of sorted) {
                const card = document.createElement('div');
                card.className = 'library-artist-card';
                card.innerHTML = `
                    <img src="${info.thumbnail || '/static/img/default-thumb.svg'}" class="library-artist-thumb" alt="">
                    <div class="library-artist-info">
                        <div class="library-artist-name">${_esc(artist)}</div>
                        <div class="library-artist-count">${info.songs.length} stem${info.songs.length > 1 ? 's' : ''}</div>
                    </div>`;
                card.addEventListener('click', () => drillDownStemsArtist(artist, info.songs));
                grid.appendChild(card);
            }
        } else {
            // Flat list
            extracted.forEach(item => {
                if (typeof createDownloadElement === 'function') {
                    content.appendChild(createDownloadElement(item));
                }
            });
            const videoIds = extracted.filter(s => s.video_id).map(s => s.video_id);
            if (videoIds.length > 0 && typeof batchUpdateExtractionStatuses === 'function') {
                batchUpdateExtractionStatuses(videoIds);
            }
        }
    }

    function drillDownStemsArtist(artist, songs) {
        const container = document.getElementById('downloadsContainer');
        if (!container) return;

        let html = `<div class="library-drilldown">
            <div class="library-drilldown-header">
                <button class="btn btn-small library-back-btn"><i class="fas fa-arrow-left"></i> Back</button>
                <h3>${_esc(artist)}</h3>
                <span>${songs.length} stems</span>
                <button class="btn btn-small btn-primary library-play-all-btn"><i class="fas fa-play"></i> Play All</button>
            </div>
            <div class="library-drilldown-items"></div>
        </div>`;

        container.innerHTML = html;

        const itemsContainer = container.querySelector('.library-drilldown-items');
        songs.forEach(item => {
            if (typeof createDownloadElement === 'function') {
                itemsContainer.appendChild(createDownloadElement(item));
            }
        });

        const videoIds = songs.filter(s => s.video_id && s.status === 'completed').map(s => s.video_id);
        if (videoIds.length > 0 && typeof batchUpdateExtractionStatuses === 'function') {
            batchUpdateExtractionStatuses(videoIds);
        }

        container.querySelector('.library-back-btn').addEventListener('click', () => renderStemsView(window._myLibraryRawData || []));
        container.querySelector('.library-play-all-btn')?.addEventListener('click', () => {
            playQueue(songs.filter(s => s.file_path).map(s => s.video_id));
        });
    }

    // ── Playlists View ──────────────────────────────────────────

    async function renderPlaylistsView() {
        const container = document.getElementById('downloadsContainer');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            const res = await fetch('/api/playlists');
            const data = await res.json();
            const playlists = data.playlists || [];

            let html = `
            <div class="library-import-section" style="display:flex; gap:8px; align-items:center; margin-bottom:16px; padding:10px; background:var(--bg-secondary); border-radius:8px;">
                <input type="text" id="spotifyImportUrl" placeholder="Paste a Spotify or YouTube playlist URL to import..." style="flex:1; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-primary); color:var(--text-primary); font-size:14px;">
                <button class="btn btn-small btn-primary" id="spotifyImportBtn"><i class="fas fa-file-import"></i> Import</button>
            </div>
            <div class="library-playlists-header">
                <button class="btn btn-small btn-primary" id="createPlaylistBtn"><i class="fas fa-plus"></i> New Playlist</button>
            </div>`;

            if (playlists.length === 0) {
                html += '<div class="empty-state">No playlists yet. Create one or import a Spotify/YouTube playlist above.</div>';
            } else {
                html += '<div class="library-playlist-grid">';
                for (const pl of playlists) {
                    html += `<div class="library-playlist-card" data-id="${pl.id}">
                        <img src="${pl.thumbnail_url || '/static/img/default-thumb.svg'}" class="library-playlist-thumb">
                        <div class="library-playlist-info">
                            <div class="library-playlist-name">${_esc(pl.name)}</div>
                            <div class="library-playlist-count">${pl.track_count || 0} tracks</div>
                        </div>
                        <button class="btn btn-icon library-playlist-del" data-id="${pl.id}" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>`;
                }
                html += '</div>';
            }

            container.innerHTML = html;

            // Import Spotify/YouTube playlist
            const importBtn = document.getElementById('spotifyImportBtn');
            const importInput = document.getElementById('spotifyImportUrl');
            if (importBtn && importInput) {
                const doImport = async () => {
                    const url = importInput.value.trim();
                    if (!url) { if (typeof showToast === 'function') showToast('Paste a playlist URL first', 'warning'); return; }
                    importBtn.disabled = true;
                    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    try {
                        if (typeof window.importSpotifyPlaylist === 'function') {
                            const result = await window.importSpotifyPlaylist(url);
                            if (result) {
                                importInput.value = '';
                                renderPlaylistsView();
                            }
                        }
                    } finally {
                        importBtn.disabled = false;
                        importBtn.innerHTML = '<i class="fas fa-file-import"></i> Import';
                    }
                };
                importBtn.addEventListener('click', doImport);
                importInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doImport(); });
            }

            // Create playlist button
            document.getElementById('createPlaylistBtn')?.addEventListener('click', async () => {
                const name = prompt('Playlist name:');
                if (!name) return;
                await fetch('/api/playlists', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({name})
                });
                renderPlaylistsView();
            });

            // Click playlist to view tracks
            container.querySelectorAll('.library-playlist-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.library-playlist-del')) return;
                    drillDownPlaylist(parseInt(card.dataset.id));
                });
            });

            // Delete playlist
            container.querySelectorAll('.library-playlist-del').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this playlist?')) return;
                    await fetch(`/api/playlists/${btn.dataset.id}`, {method: 'DELETE'});
                    renderPlaylistsView();
                });
            });

        } catch (e) {
            container.innerHTML = '<div class="empty-state">Failed to load playlists</div>';
        }
    }

    async function drillDownPlaylist(playlistId) {
        const container = document.getElementById('downloadsContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            const res = await fetch(`/api/playlists/${playlistId}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            const playlist = data.playlist;
            const tracks = playlist.tracks || [];

            let html = `<div class="library-drilldown">
                <div class="library-drilldown-header">
                    <button class="btn btn-small library-back-btn"><i class="fas fa-arrow-left"></i> Back</button>
                    <h3>${_esc(playlist.name)}</h3>
                    <span>${tracks.length} tracks</span>
                    <button class="btn btn-small btn-primary library-play-all-btn"><i class="fas fa-play"></i> Play All</button>
                </div>
                <div class="library-drilldown-items"></div>
            </div>`;

            container.innerHTML = html;

            const itemsContainer = container.querySelector('.library-drilldown-items');
            for (let i = 0; i < tracks.length; i++) {
                const t = tracks[i];
                const dur = t.duration_ms ? Math.floor(t.duration_ms / 60000) + ':' + String(Math.round((t.duration_ms % 60000) / 1000)).padStart(2, '0') : '';
                const row = document.createElement('div');
                row.className = 'library-playlist-track';
                row.innerHTML = `
                    <span class="library-track-num">${i + 1}</span>
                    <div class="library-track-info">
                        <div class="library-track-title">${_esc(t.title)}</div>
                        <div class="library-track-artist">${_esc(t.artist)}</div>
                    </div>
                    <span class="library-track-duration">${dur}</span>
                `;
                itemsContainer.appendChild(row);
            }

            container.querySelector('.library-back-btn').addEventListener('click', () => renderPlaylistsView());
            container.querySelector('.library-play-all-btn')?.addEventListener('click', () => {
                const vids = tracks.filter(t => t.video_id).map(t => t.video_id);
                playQueue(vids);
            });

        } catch (e) {
            container.innerHTML = '<div class="empty-state">Failed to load playlist</div>';
        }
    }

    // ── Playlist Player via PlayerEngine ���──────────────────────

    // ── Add to Playlist dropdown ──────────────────────────────

    function _injectAddToPlaylistButtons(scope) {
        const root = scope || document.getElementById('downloadsContainer');
        if (!root) return;
        // Find all download-item cards that have a video_id
        root.querySelectorAll('.download-item[data-video-id]').forEach(el => {
            if (el.querySelector('.library-add-to-playlist-btn')) return; // already injected
            const videoId = el.dataset.videoId;
            if (!videoId) return;

            const btn = document.createElement('button');
            btn.className = 'btn btn-icon library-add-to-playlist-btn';
            btn.title = 'Add to Playlist';
            btn.innerHTML = '<i class="fas fa-plus-circle"></i>';
            btn.style.cssText = 'margin-left:4px; font-size:14px; cursor:pointer; background:none; border:none; color:var(--text-secondary); position:relative;';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                _showPlaylistDropdown(btn, videoId);
            });

            // Insert into the actions area if present, otherwise append
            const actions = el.querySelector('.download-actions') || el;
            actions.appendChild(btn);
        });
    }

    async function _showPlaylistDropdown(anchorBtn, videoId) {
        // Close any existing dropdown
        document.querySelectorAll('.library-playlist-dropdown').forEach(d => d.remove());

        const dropdown = document.createElement('div');
        dropdown.className = 'library-playlist-dropdown';
        dropdown.style.cssText = 'position:absolute; z-index:1000; background:var(--bg-primary); border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.3); min-width:180px; max-height:240px; overflow-y:auto; padding:4px 0;';
        dropdown.innerHTML = '<div style="text-align:center;padding:8px"><i class="fas fa-spinner fa-spin"></i></div>';

        // Position near the button
        anchorBtn.style.position = 'relative';
        anchorBtn.appendChild(dropdown);

        try {
            const res = await fetch('/api/playlists');
            const data = await res.json();
            const playlists = data.playlists || [];

            if (playlists.length === 0) {
                dropdown.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--text-secondary)">No playlists yet</div>';
            } else {
                dropdown.innerHTML = '';
                for (const pl of playlists) {
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:8px 14px; cursor:pointer; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
                    item.textContent = pl.name;
                    item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-secondary)'; });
                    item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
                    item.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        try {
                            await fetch(`/api/playlists/${pl.id}/tracks`, {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({video_ids: [videoId]})
                            });
                            if (typeof showToast === 'function') showToast(`Added to "${pl.name}"`, 'success');
                        } catch (err) {
                            if (typeof showToast === 'function') showToast('Failed to add to playlist', 'error');
                        }
                        dropdown.remove();
                    });
                    dropdown.appendChild(item);
                }
            }
        } catch (e) {
            dropdown.innerHTML = '<div style="padding:10px;color:red;font-size:13px">Failed</div>';
        }

        // Close on outside click
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== anchorBtn) {
                dropdown.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    async function playQueue(videoIds) {
        if (!videoIds || videoIds.length === 0) return;
        if (!window.playerEngine) { console.error('PlayerEngine not loaded'); return; }

        try {
            const res = await fetch('/api/library/queue', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({video_ids: videoIds})
            });
            const data = await res.json();
            if (!data.success || !data.queue.length) {
                if (typeof showToast === 'function') showToast('No playable tracks', 'warning');
                return;
            }

            window.playerEngine.loadQueue(data.queue);
            window.playerEngine.play(0);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Failed to start playback', 'error');
        }
    }

    // Expose playQueue globally
    window.playQueue = playQueue;

    // ── Mini Player UI wiring ───────────────────────────────────

    function initMiniPlayer() {
        const pe = window.playerEngine;
        if (!pe) return;

        const el = {
            bar: document.getElementById('miniPlayer'),
            title: document.getElementById('miniTitle'),
            artist: document.getElementById('miniArtist'),
            thumb: document.getElementById('miniThumb'),
            playPause: document.getElementById('miniPlayPause'),
            prev: document.getElementById('miniPrev'),
            next: document.getElementById('miniNext'),
            shuffle: document.getElementById('miniShuffle'),
            close: document.getElementById('miniClose'),
            progressFill: document.getElementById('miniProgressFill'),
            progressBar: document.getElementById('miniProgressBar'),
        };

        if (!el.bar) return;

        // Show/hide mini player
        function show() {
            el.bar.style.display = 'flex';
            document.body.classList.add('player-active');
        }
        function hide() {
            el.bar.style.display = 'none';
            document.body.classList.remove('player-active');
        }

        // Update track info
        pe.on('trackchange', (data) => {
            if (!data.track) return;
            show();
            el.title.textContent = data.track.title || '';
            el.artist.textContent = data.track.artist || '';
            el.thumb.src = data.track.thumbnail || '/static/img/default-thumb.svg';
            el.playPause.innerHTML = '<i class="fas fa-pause"></i>';
            el.prev.disabled = !pe.hasPrev;
            el.next.disabled = !pe.hasNext;
        });

        pe.on('play', () => { el.playPause.innerHTML = '<i class="fas fa-pause"></i>'; });
        pe.on('pause', () => { el.playPause.innerHTML = '<i class="fas fa-play"></i>'; });
        pe.on('stop', () => hide());
        pe.on('queueend', () => { el.playPause.innerHTML = '<i class="fas fa-play"></i>'; });

        pe.on('progress', (data) => {
            if (data.duration > 0) {
                el.progressFill.style.width = (data.currentTime / data.duration * 100) + '%';
            }
        });

        pe.on('shufflechange', (data) => {
            el.shuffle.classList.toggle('active', data.enabled);
        });

        // Button handlers
        el.playPause.addEventListener('click', () => pe.togglePlayPause());
        el.prev.addEventListener('click', () => pe.prev());
        el.next.addEventListener('click', () => pe.next());
        el.shuffle.addEventListener('click', () => pe.toggleShuffle());
        el.close.addEventListener('click', () => { pe.stop(); hide(); });

        // Click progress bar to seek
        el.progressBar?.addEventListener('click', (e) => {
            const rect = el.progressBar.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            pe.seek(pct * (pe.audio.duration || 0));
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Wait for PlayerEngine to be ready
        if (window.playerEngine) initMiniPlayer();
        else setTimeout(initMiniPlayer, 500);
    });

    // ── Helpers ──────────────────────────────────────────────────

    function _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
})();
