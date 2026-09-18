# Changelog

All notable changes to StemTube are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

**On versions:** only `v3.0.0`, `v3.0.1` and `v3.0.2` exist as git tags (plus
`v2.2.0-monolithic`, which marks the last commit before the Blueprint refactor).
The long stretch between 2026-02 and 2026-08 was never tagged, so it is grouped
here by date and theme instead of behind invented version numbers. Entries cite
the commits that carry the change.

---

## [Unreleased]

### Added
- **Fine-stem extraction model `mvsep_mega_fine`** (CUDA only) — a three-stage
  pipeline in `core/msst/separate.py`: `htdemucs_6s` coarse split → **DrumSep**
  (inagoy, HDemucs, MIT) on the drums stem → **MVSep Mega 53-stem BS-Roformer**
  (ZFTurbo, MIT) heads splitting the remaining stems with Wiener masks. Produces up
  to 17 stems: lead/backing vocals, drums + kick/snare/toms/cymbals, bass,
  electric/acoustic guitar, piano, organ, synth, brass, winds, strings, other.
  Weights download on first use into `core/models/msst/` (`48cb9bf`).
- **Mixer scrub** — dragging the timeline ruler moves the playhead and plays short
  audible slices (`static/js/poc/scrub.js`, ported from the desktop edition).
- **Loop controls** — Shift+drag on the ruler or a waveform, draggable bounds,
  numeric fields accepting a timecode (`1:23.45`) or a bar (`b17`), and a clear
  button; plus a shared **snap-to-beat** toggle used by loops and markers
  (`static/js/poc/snap.js`).
- **Explicit re-extraction** — re-run a song with another model (or the same one);
  the previous stems and their stale ZIP are removed.
- **`POST /api/extractions/<id>/analyze-structure`** — runs MSAF on one song and
  stores its sections; `utils/analysis/reanalyze_all_structure.py [--force] [--limit N]`
  was rewritten to backfill `structure_data` for the whole library (~30 s per song).
- **`POST /api/recordings/convert`** — converts a take the browser cannot decode
  (mostly iOS; WebM/Opus, MP4/AAC, Ogg) to 16-bit PCM WAV with ffmpeg, the fallback
  `recording-utils.js` already called. Errors: 400, 413 (64 MB upload / 512 MB WAV),
  415, 422, 504.

### Changed
- **Lyrics come from LRCLIB aligned on Whisper**, replacing Musixmatch, whose unofficial
  desktop API stopped serving anonymous clients around April 2026 (all-zero user token,
  unrelated canned search results). `core/lrclib_client.py` looks the song up on
  [LRCLIB](https://lrclib.net) (free, no account; artist and track must both match,
  line-synced records preferred, closest duration wins); faster-whisper transcribes the
  vocals stem and `align_lines_with_whisper()` in `core/lyrics_merger.py` puts the LRCLIB
  words on the Whisper word timings (source `lrclib+whisper`, with `alignment_stats`).
  Below 30 % matched words the lyrics are rejected: a line-synced record falls back to its
  own line timing, plain text to Whisper alone; songs missing from LRCLIB use Whisper alone.
  Measured: 81.9 % words matched on a plain-text record, 70.7 % and 50.6 % on synced ones.
- **One lyrics pipeline**: `detect_lyrics_unified()` runs after extraction and on
  Regenerate; the post-extraction step now runs it on the vocals stem instead of Whisper
  alone. The download phase only looks LRCLIB up and stores a line-timed preview when the
  record is line-synced. `lyrics_progress` reports metadata, search, Whisper and alignment steps.
- **YouTube metadata is stored**: `core/media_metadata.py` keeps artist, track, language,
  uploader, tags and duration from yt-dlp in the new `media_metadata` column (fetched
  lazily for songs downloaded earlier) and resolves the artist/track used for the lookup.
- The Regenerate dialog (desktop and mobile) searches LRCLIB (`POST /api/lyrics/search`),
  marks results **L** (line-synced) or **T** (text only), and offers "LRCLIB timing" or
  "LRCLIB + Whisper sync"; `/lyrics/regenerate` takes `lrclib_id` and `sync_with_whisper`.
- Mixer artifacts (metronome, waveform peaks, `meta.json`) are now built at the end
  of an extraction, so the first mixer open is a cache hit instead of a ~1 min wait.
- The mixer shows its tracks and server-side waveforms immediately and decodes each
  stem as its own download finishes, with per-stem progress.
- Metronome tracks are served as MP3 (82 MB → 11 MB per song) and `meta.json` is
  gzipped (1.3 MB → 0.27 MB). Audio responses revalidate instead of hard-caching.
- Mobile no longer downloads the full mix just to draw one waveform.
- The horizontal scroll mode defaults to **Center**, and only a choice made with the
  toolbar button is remembered.
- The metronome track starts muted.

### Fixed
- **Playback died until the page was reloaded**: every stem's gain and pan nodes
  stayed connected to the master bus on stop, so each seek leaked a full chain and
  the browser's audio thread eventually gave up.
- **Silence when moving the playhead with a loop armed**: a source started past
  `loopEnd` never wraps, so every stem ran to the end of its buffer while the
  playhead kept looping.
- **Tempo leaking between songs**: a session state saved before `TempoPitch.load()`
  stretched other songs to 120 BPM on the next open.
- Lyrics regeneration reads `stems_paths['vocals']` instead of a hard-coded path.
- A failed or cancelled re-extraction no longer relabels the existing stems with the
  new model name.
- **Structure analysis works again**: msaf 0.1.80 failed to import on modern SciPy
  (`scipy.inf`, `scipy.signal.gaussian`), so `structure_data` was NULL for every song.
  `core/msaf_structure_detector.py` restores both names before importing msaf, logs
  the real import error instead of "not installed", gives each run its own temporary
  feature cache (no more `.features_msaf_tmp.json` in the working directory) and drops
  zero-length sections. Sections are similarity clusters labelled A, B, C… in order of
  first appearance — MSAF does not name verses or choruses.
- **Structure data reaches the mixer**: `routes/pages.py` now passes `structure_data`
  in `EXTRACTION_INFO`, so the desktop mixer's structure bar shows the sections.
  `static/js/poc/main.js` handed the stored JSON text straight to `loadStructure()`, which
  cleared the bar and threw; both loaders now go through `StructureDisplay.parseSections()`,
  and sections are colored by their MSAF cluster label (the chord-based grouping never parsed
  the chords and gave every section its own color).
- **Mixer opened right after an extraction lost its analysis**: for an extraction still held
  in memory, `/mixer` read BPM, key, chords, beat grid, Skip Intro and structure from the
  in-memory item, which has none of them. The page now always takes them from the database
  record (matched by `video_id`).
- **Regenerating chords or beats no longer resets Skip Intro or the beat offset**:
  `update_download_analysis()` defaulted `beat_offset` and `music_start_time` to 0.0,
  which `COALESCE` could not protect. `/chords/regenerate` no longer writes the beat
  grid (BTC detects none) and returns the stored grid, so the metronome stays aligned;
  `/beats/regenerate` stores the new grid and keeps Skip Intro.
  The chord reanalysis scripts in `utils/analysis/` store chords only, for the same reason.
- **Offline playback on mobile works**: songs are saved with the URLs the POC mixer
  actually requests (`/poc-mixer/meta` and every `/poc-mixer/audio` stem, metronome and
  count-in file from the meta, then a completion manifest); `static/sw.js` (v2.40) serves
  them network-first with the saved copy as fallback, answers `prepare`/`progress` offline,
  precaches the current mobile shell (socket.io included) one file at a time, and serves
  static files network-first so unversioned ES-module and CSS `@import` files no longer stay
  stale after a deploy. Old stem caches are removed; songs must be saved again. Removing
  `download_1` no longer also removes `download_12`.
- De-bleed leftovers (recording UI dropdown, CSS, socket call) are gone.
- **One application version**: `APP_VERSION` in `core/config.py` is `3.0.2` and is
  injected into every template (`app_version`); the mobile page shows it instead of a
  hard-coded "1.3.0 PWA".
- **French songs transcribed (or regenerated) in English**: Whisper guessed the language
  from the first 30 s, often an instrumental intro. The language is now detected on voiced
  parts only (VAD, three 30 s windows); a detection at ≥ 0.7 probability wins, otherwise
  the language YouTube declares for the audio. Taxi Girl "Paris": `nn` 0.77 before,
  `fr` 0.99 now.
- Whisper credit hallucinations over instrumentals ("Sous-titrage Société Radio-Canada",
  Amara.org, "thanks for watching"…) are dropped from the transcription.

- **Shared YouTube cookie jar** (`core/cookie_broker.py`, ported from DeezpotHiFi):
  every yt-dlp session (download, search, formats, lyrics metadata) uses one in-memory
  jar instead of `cookiefile`, which made each session rewrite the whole file on close
  and lose the rolling cookies of concurrent sessions. Atomic throttled writes (mode 600),
  reload when an upload replaces the file, keep-alive every 3 min while idle, and one
  retry after a bot check ("Sign in to confirm you're not a bot", HTTP 429).
- **Bookmarklet merges instead of replacing**: `document.cookie` has no HttpOnly cookies
  (Google's session cookies), so replacing the file logged the account out; the token
  check uses a constant-time comparison.
- **Cookie file upload keeps only youtube.com / google.com cookies** (a whole-browser
  export stored every other site's session on the server); the admin status counts
  `#HttpOnly_` lines (they were skipped as comments, hiding the auth cookies), shows the
  shared jar and keep-alive state, and warns when other sites' cookies are stored.

### Removed
- Musixmatch: `core/musixmatch_client.py`, `core/syncedlyrics_client.py`, the
  `syncedlyrics` dependency and `POST /api/musixmatch/search` (the Regenerate body no
  longer accepts `musixmatch_track_id` or `skip_onset_sync`).
- Dead code `core/lyrics_aligner.py` and `core/vocal_onset_detector.py`, and the old
  Musixmatch `merge_lyrics()` in `core/lyrics_merger.py`.

---

## [3.0.2] - 2026-08-16

### Fixed
- Stems ZIP returned 404 for anything not extracted in the current run (`cce0f0e`).
- `create-zip` accepts `download_<id>`, not just a bare integer (`71ce67b`), and
  resolves by global id as well as `user_downloads` id (`c278daf`).
- Stacked ZIP-button click handlers caused duplicate toasts and downloads (`2c635b2`).

## [3.0.1] - 2026-08-16

### Fixed
- A fresh clone now actually installs and runs, and the setup summary reports
  honestly what works (`a7c1374`).

## [3.0.0] - 2026-08-16

### Added
- **Sample-accurate jam sync** — shared clock, time anchors and latency
  compensation (`75ecdb4`), clock slaving for long-run drift, host session surviving
  a socket reconnect (`c66a8fb`).
- Guests follow the host's tempo and key exactly (`211cca4`); guest link and QR use
  the LAN IP when the host runs on localhost (`d5ed13c`).
- `STEMTUBE_SSL=1` self-signed HTTPS for LAN device testing (`977349b`);
  `STEMTUBE_PORT` / `STEMTUBE_HOST` overrides (`2c6f212`).

### Changed
- **The mobile PWA is the single jam guest surface** — the dedicated guest page was
  dropped (`31904bc`), and the PWA now runs the POC engine (`471670a`, `ba6f21e`).
- HTML documents are served `no-store` so deployments reach users (`353a301`).

### Fixed
- iOS: jam guests could not load stems (`cef5c2e`); measured output latency, resume
  handling and faster anchors (`688b709`).
- A guest page can never reclaim the host role (`8231a37`).
- madmom on modern numpy/scipy: pinned `librosa` (`955543f`) and `scipy==1.17.1`
  (`58b02d7`), patched the ragged-array crash (`7eae9bf`), restored numpy aliases
  (`175e498`).

## 2026-08-14 → 2026-08-15 — POC engine takes over the desktop mixer

### Changed
- **Breaking: the desktop mixer front-end was replaced by the POC front**
  (`7a191b8`), on top of a multi-user rewrite of the POC mixer blueprint
  (`0c16339`). Documentation describing the pre-POC mixer internals is obsolete.
- The jam bridge was rewritten against the POC engine (`f64e468`).
- The metronome, beat and precount engine was imported from the POC (`b86c04d`).

### Added
- **Stage View** — the focus dialogs detach into a real, synchronised browser window
  (`5969b12`, `678dff1`, `4a9e202`, `8a91d62`, `6459592`, `e7a99e0`), with chord
  highlight, karaoke wipe and auto-scroll following playback (`d1ae883`).
- Stage-size Chords Grid View and Lyrics Focus popups (`381d684`), size slider
  scaling characters (`ef9ad85`), English UI throughout (`c2b960e`).
- Metronome: manual offset, Tap-to-Sync and nudge controls (`b3bfff8`), persisted
  across reloads (`2c17d2c`), per-user grid-alignment offset (`0ab2aef`).
- Beat grid detected once per song and preserved forever (`d26f973`).
- Export: metronome bake, async MP3 encode and progress yield (`8a3e6fe`).
- Enriched madmom chord detector backported from the Friend edition (`91ae1cc`),
  synthetic-grid time mapping and per-word lyrics (`f66b93a`).

### Removed
- The full-screen **Stage Prompter** was reverted the day it landed (`90a96ac` then
  `df0c1a5`); its purpose is served by Stage View instead.

## 2026-05-30 → 2026-06-07 — Deployment hardening

### Added
- Configurable WSGI server, werkzeug or gunicorn (`5455881`).
- Failed login attempts logged for fail2ban brute-force protection (`5fcef5c`).

### Changed
- **Deno is again the primary JS runtime** for yt-dlp's YouTube challenge
  (`a6c163a`), reversing the February switch to Node.js (`27d08b9`).

## 2026-03-12 → 2026-04-26 — Public website

### Added
- Landing page for GitHub Pages with i18n, hero image and contribute section
  (`7fa94c2`, `7cd8096`, `8c01782`), expanded to **20 languages** (`7923310`),
  mobile language dropdown fixes (`1fd9936`, `d0400e0`), screenshots blocks
  (`a1b493c`, `45508db`), and `publish.sh` to sync `website/` to `gh-pages`
  (`0f59114`).

### Changed
- Hero copy reworked around learning and exploration (`0ec10f8`); the "6 AI Models"
  stat became "0 Cloud Dependency" (`84cd00f`).
- **MSAF was removed from the advertised tech stack** (`ee3fabe`).

## 2026-03-07 → 2026-03-19 — Recording overhaul

### Added
- Per-track FX presets with live monitoring (`814a2da`); digital loopback fallback
  for latency calibration with headphones (`c727c1b`); recordings auto-save
  (`1c656e7`); recording controls moved to the transport bar (`7955833`).
- Mobile recording engine integrated (`1de7f80`) and synced with the playback
  transport (`5cae2b3`); Skip Intro on every mobile view (`4ee7c3c`).
- Custom neumorphic theme with spectrum colour picker (`2ef067f`).
- Inline media player in the library views (`f759031`).

### Removed
- **De-bleed removed entirely**, desktop and mobile (`8bc0983`, cleanup `82920e6`) —
  after having been moved server-side to Demucs two weeks earlier (`78d0bc4`).
- **The metronome mixer track was removed**; latency is auto-calibrated on record
  (`26c432f`).
- The manual Save button for recordings (`1c656e7`) and the yt-dlp `player_client`
  override (`dbfc724`).

### Fixed
- iOS: AudioContext kept alive across track changes (`de8eb47`), Skip Intro seeks
  without a pause/play cycle (`9344497`), SoundTouch node always created so
  tempo/pitch works without pause/play (`fdb3191`).
- Admin cleanup deletes every entry for a `video_id` (`44f5429`).

## 2026-02-16 → 2026-02-24 — Blueprint refactor, jam, recording, themes

### Added
- **Jam Session** — precount sync, metronome, guest permissions, stale session
  handling (`ea02aad`), later Skip Intro detection and bulk admin actions
  (`bfdcf39`).
- **Multi-track recording** with latency calibration (`185f81a`).
- Glassmorphism and Cyberpunk Neon themes (`ec26c35`) with popup and chord overrides
  (`686c509`, `a1c8b43`, `7c9c1b3`).
- Metronome mixer track and extraction/export fixes (`a957c13`), smoother extraction
  progress (`be7b7a4`).

### Changed
- **The monolithic `app.py` was decomposed into Flask Blueprints** (`9f913b8`), and
  the large frontend and database files were split into modules (`8fc094d`). The tag
  `v2.2.0-monolithic` (`27d08b9`) marks the last monolithic state.
- JS runtime switched from Deno to Node.js (`27d08b9`) — reversed in June.

### Fixed
- Blueprint `url_for` endpoints, idempotent setup, metronome default off (`86e79c9`).
- A long series of mobile waveform fixes: overflow, sizing, theme colours and the
  artifact at the end of a track (`7d2b2b1`, `1c17dbe`, `e4c562d`, `c5c0b19`,
  `fe48bfc`, `b7fdb8b`, `5c42d64`, `c266260`, `86e273b`, `d5afda0`).

## 2026-02-01 → 2026-02-02 — Lyrics

### Added
- **Unified lyrics system**: Musixmatch, vocal onset alignment and Whisper fallback,
  plus cookies upload (`7c7da93`); Musixmatch track selection dialog (`bfd3216`).

### Changed
- Default Whisper model is `medium`, and admin settings are respected (`8787b11`).

---

## Earlier history

The entries below predate the public repository (first commit `6ffddb8`,
2026-01-25) and are kept as they were written.

## [2.2.0] - 2026-01-25

### Added
- **Deno JavaScript runtime** - Integration for YouTube challenge solving (replaces aiotube dependency)
- **yt-dlp automatic updates** - Nightly update check at startup ensures latest YouTube compatibility
- **Cookie.txt browser export** - Admin system for YouTube authentication via browser cookies
- **LRCLIB synchronized lyrics** - Primary lyrics source with faster-whisper fallback for alignment
- **PWA support** - Installable mobile app with offline mode and audio caching
- **Mobile Settings tab** - Cache management and offline audio controls
- **Mobile admin menu** - Full admin access on mobile devices
- **YouTube search toggle** - Admin interface toggle for YouTube search functionality
- **Desktop Settings/Admin separation** - Cleaner UI with distinct settings and admin panels

### Changed
- **Admin panel reorganization** - Now organized into 4 tabs: Users, Logs, Settings, Cleanup
- **YouTube download backend** - Replaced aiotube dependency with pure yt-dlp + Deno runtime

---

## [2.1.2] - 2026-01-13

### Fixed
- **Admin cleanup session sync** - Downloads deleted via admin cleanup now immediately disappear from all active user sessions without requiring logout/login
- **Bulk delete session sync** - Bulk delete operations now also clear downloads from active user sessions
- **Mixer stems loading after extraction** - Fixed race condition where stems wouldn't load on first click after extraction completion
  - Database persistence now happens BEFORE socket events are emitted
  - Mixer route now properly parses `stems_paths` JSON from database into `output_paths`

### Added
- `remove_download_by_video_id()` method to DownloadManager for clearing specific downloads from session
- `clear_download_from_all_sessions()` method to UserSessionManager for admin cleanup operations
- Debug logging for cleanup operations to track session clearing

---

## [2.1.1] - 2026-01-11

### Added
- **GridView2 chord transposition** - Chords now update in real-time when pitch changes via `updateGridView2Chords()` method
- **Fullscreen Lyrics chord transposition** - Chords update when pitch changes via `updateFullscreenLyricsChords()` method

### Fixed
- **GridView2 Play button** - Fixed play button not working in Grid View popup by moving `initGridView2Controls()` to main initialization
- **Duplicate event listeners** - Added guards to prevent multiple event listener registration in GridView2 popup

### Changed
- **Tempo/Pitch popup style** - Converted from full-screen overlay to floating popup at bottom of screen
- **Popup backdrop** - Reduced opacity from 80% to 30% for better content visibility while adjusting tempo/pitch

---

## [2.1.0] - 2025-12-31

### Added
- **Songbook chord display** - Chords displayed above lyrics in karaoke view (desktop)
- **Pitch shift event listener** - Lyrics popup now updates chord transpositions when pitch changes
- **setPitchShift() method** - Direct semitone control (-12 to +12) for full octave range

### Fixed
- **Grid View scroll interruption** - Changed from smooth to auto scroll behavior to prevent jitter
- **Pitch slider range** - Extended from ±6 to ±12 semitones for full octave transposition
- **Pitch slider snap-back** - Fixed slider resetting to center when exceeding ±6
- **Pitch value display** - Now updates correctly when moving popup sliders
- **Lyrics popup text size** - Size slider now works using CSS transform scale
- **Lyrics popup scroll focus** - Fixed lyrics scrolling out of view in popup mode
- **Nested scroll containers** - Removed conflicting overflow-y on popup karaoke-lyrics

### Changed
- **Popup sizes increased** - Both Lyrics Focus and Grid View popups now use 98vw × 98vh
- **Lyrics popup element refresh** - Now dynamically finds lyrics element when opening popup

---

## [2.0.0] - 2025-12-28

### Added
- **BTC Transformer chord detection** (170 chord vocabulary) - Most accurate backend
- **3 chord detection backends** with automatic fallback (BTC → madmom → hybrid)
- **Complete documentation overhaul** - Reorganized into user/admin/developer/feature guides
- **French comment translation** - All ~600 French comments translated to English
- **CONTRIBUTING.md** - Comprehensive contribution guidelines
- **CHANGELOG.md** - Project history tracking

### Changed
- **Documentation structure** - Reorganized into logical categories (user-guides/, admin-guides/, developer-guides/, feature-guides/)
- **README.md** - Modernized with badges, concise quick start, correct port (5011)
- **ARCHITECTURE.md** - Updated endpoint count (69), added BTC chord detector, removed stale notes

### Fixed
- **Port references** - Corrected from 5012 to 5011 throughout documentation
- **Endpoint count** - Updated from 78 to accurate 69 endpoints

### Documentation
- Created new documentation structure with 7 categories
- Archived 12+ outdated mobile documentation files
- Updated all internal cross-references
- Added feature-specific guides for BTC, GPU setup, mobile architecture

---

## [1.2.0] - 2025-11-24

### Added
- **Automated GPU setup** - `os.execv()` in app.py for cuDNN configuration
- **Dependency conflict resolution** - Individual package installation
- **madmom auto-patching** - Numpy compatibility automatic
- Professional chord detection with madmom CRF
- Music structure analysis via MSAF
- Lyrics/karaoke system with faster-whisper
- Chord transposition in mixer
- Structure timeline visualization
- File upload system
- Silent stem detection
- Admin interface integration
- Global library system

### Changed
- Documentation consolidation - README.md comprehensive, CLAUDE.md technical-only
- Codebase cleanup - 16 obsolete files removed

### Fixed
- GPU library path configuration
- Dependency installation conflicts
- madmom numpy compatibility issues

---

## [1.1.0] - 2025-10-15

### Added
- **Mobile-optimized interface** (`/mobile` route)
  - iOS audio unlock mechanism
  - Touch-optimized controls
  - 9 mobile-specific JavaScript modules
  - Responsive timeline and chord display
  - SVG chord diagrams with guitar-chords-db-json
- **Pitch/tempo control** - SoundTouch integration
  - Independent pitch shifting (-12 to +12 semitones)
  - Tempo control (0.5x to 2.0x)
  - Hybrid SoundTouch/playbackRate engine
- **Real-time chord display** - Synchronized with playback
- **Karaoke lyrics display** - Word-level highlighting
- **Structure timeline** - Visual song section markers

### Changed
- Frontend architecture - Modular JavaScript design (11 mixer modules)
- Audio processing - Web Audio API with AudioWorklet
- State persistence - LocalStorage for mixer settings

### Fixed
- iOS audio playback restrictions
- Android touch responsiveness
- Mobile waveform rendering
- Cross-platform audio synchronization

---

## [1.0.0] - 2025-09-01

### Added
- **Core Features**
  - Audio source retrieval (yt-dlp)
  - AI stem separation with Demucs (4-stem and 6-stem models)
  - GPU acceleration support (CUDA 11.x-13.x)
  - Multi-user authentication system
  - Global file deduplication
  - Interactive web-based mixer
- **Audio Analysis**
  - BPM detection (custom autocorrelation algorithm)
  - Musical key detection
  - madmom chord recognition (24 chord types)
  - MSAF structure analysis
- **Database**
  - SQLite with 3-table design
  - Global downloads tracking
  - User access management
  - Download/extraction metadata
- **Admin Features**
  - User management interface
  - Storage statistics
  - Download cleanup tools
  - System configuration
- **API**
  - 69 REST endpoints
  - WebSocket real-time updates
  - File upload/download
  - Extraction management

### Technical Stack
- **Backend**: Flask 3.x, SocketIO, PyTorch 2.x, Demucs 4.x
- **Frontend**: Vanilla JavaScript ES6+, Web Audio API, SoundTouchJS
- **Audio**: madmom, librosa, scipy, faster-whisper, MSAF
- **Database**: SQLite3
- **Dependencies**: ~120 packages (18 essential)

---

## Version History

- **[2.2.0]** - January 2026 - PWA support, LRCLIB lyrics, Deno/yt-dlp migration, admin panel redesign
- **[2.0.0]** - December 2025 - Documentation overhaul, BTC chord detector, French translation
- **[1.2.0]** - November 2025 - GPU automation, dependency fixes, feature additions
- **[1.1.0]** - October 2025 - Mobile interface, pitch/tempo control, karaoke
- **[1.0.0]** - September 2025 - Initial release with core features

---

## Upgrade Notes

### 2.0.0 → Current
- Documentation paths updated - Update any hardcoded references to docs
- No breaking changes to code or database

### 1.2.0 → 2.0.0
- No database migrations required
- GPU setup now fully automatic
- All French comments translated (for contributors)

### 1.1.0 → 1.2.0
- Recommended: Clear browser cache for updated mixer interface
- Optional: Re-run `setup_dependencies.py` for GPU improvements

### 1.0.0 → 1.1.0
- **CRITICAL**: HTTPS now required for pitch/tempo features
- Database schema unchanged (backward compatible)
- New dependencies installed via `setup_dependencies.py`

---

## Deprecation Notices

### Removed in 2.0.0
- Old scattered mobile documentation (archived in `docs/archive/`)
- SESSION_NOTES*.md files (archived)
- Obsolete migration guides (archived)

### Removed in 1.2.0
- 16 obsolete development files
- Redundant setup scripts
- Old dependency management approach

---

## Contributors

Special thanks to all contributors who have helped improve StemTube!

**Major Contributors:**
- Core development and architecture
- GPU acceleration implementation
- Mobile interface development
- Documentation overhaul
- French translation efforts

---

## Links

- **Repository**: https://github.com/Benasterisk/StemTube_R2
- **Documentation**: [docs/](docs/)
- **Issues**: https://github.com/Benasterisk/StemTube_R2/issues
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

**Last Updated**: January 25, 2026
