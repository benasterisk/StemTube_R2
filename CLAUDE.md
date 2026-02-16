# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
python3.12 setup_dependencies.py          # Initial setup: venv, PyTorch, dependencies, models
source venv/bin/activate                   # Activate virtual environment
python app.py                              # Dev server at http://localhost:5011
python check_config.py                     # Validate .env and config
python reset_admin_password.py             # Reset admin credentials
./start_service.sh                         # Production with ngrok HTTPS
./stop_service.sh                          # Stop services
```

Testing utilities (no automated test suite; manual testing scripts):
```bash
python utils/database/debug_db.py                     # Inspect DB state
python utils/testing/test_madmom_tempo_key.py <audio>  # Test chord detection
python utils/testing/test_lyrics_cpu.py <audio>        # Test transcription
python utils/analysis/reanalyze_all_chords.py          # Re-run chord detection on all tracks
python utils/analysis/reanalyze_all_structure.py       # Re-run structure analysis on all tracks
```

## Architecture Overview

Flask app with Flask-SocketIO for real-time WebSocket communication. Frontend is vanilla JavaScript with Web Audio API. SQLite database (`stemtubes.db`) with 4 tables. PWA-enabled with separate desktop (`/`) and mobile (`/mobile`) interfaces.

### Core Design: Download-Centric with Global Deduplication

All operations revolve around `video_id`. A single downloaded file and its extractions are shared across all users — `global_downloads` stores the master record, `user_downloads` grants per-user access. Always check `find_global_download(video_id)` before initiating new downloads/extractions.

```
User Request → Check global_downloads → Use existing OR Process → Add user_downloads access
```

### Processing Pipeline (4 phases)

1. **Download** — yt-dlp downloads from YouTube, converts to MP3. File upload also supported.
2. **Audio Analysis** (auto after download) — BPM/key detection (librosa/scipy), chord detection (BTC → madmom → hybrid fallback), structure analysis (MSAF), lyrics lookup (Musixmatch API only).
3. **Stem Extraction** (user-triggered) — Demucs separation: `htdemucs` (4 stems), `htdemucs_6s` (6 stems), `mdx_extra` (4 stems). Auto GPU detection with CPU fallback.
4. **Post-Extraction** (auto) — Lyrics re-detection using vocals stem (Musixmatch → faster-whisper fallback). Replaces download-phase lyrics with better source.

### GPU Startup (`app.py` lines 1-55)

`configure_gpu_and_restart()` runs before any imports. Sets `LD_LIBRARY_PATH` for cuDNN, then uses `os.execv()` to restart Python — necessary because the dynamic linker needs the path before loading libraries. Guard flag `_STEMTUBE_GPU_CONFIGURED` prevents infinite restart loops.

## Database Schema

Four tables in `stemtubes.db`:

- **`users`** — Authentication (Flask-Login + werkzeug bcrypt). Fields: `id`, `username`, `password_hash`, `is_admin`, `disclaimer_accepted`.
- **`global_downloads`** — Master file records. Key fields: `video_id` (unique key), `extracted`, `extraction_model`, `stems_paths` (JSON), `chords_data` (JSON), `structure_data` (JSON), `lyrics_data` (JSON), `detected_bpm`, `detected_key`, `beat_offset`.
- **`user_downloads`** — Per-user access (denormalized copy of global fields for query speed). FK to `global_downloads.id`.
- **`recordings`** — User recording takes. Fields: `id` (UUID hex), `user_id`, `download_id`, `name`, `start_offset` (timeline position in seconds), `filename` (WAV path). FK to `global_downloads.id`.

Analysis data queries use `COALESCE(global.field, user.field)` — prefer global data. JSON fields (`stems_paths`, `chords_data`, `structure_data`, `lyrics_data`) are stored as TEXT and parsed in application code. Database migrations are auto-applied on startup via `_add_extraction_fields_if_missing()` in `core/downloads_db.py`.

## Key Backend Modules (`core/`)

| Module | Purpose |
|--------|---------|
| `downloads_db.py` | All database operations, deduplication logic, `_conn()` context manager |
| `download_manager.py` | Queue-based download processing, BPM/key detection, analysis orchestration |
| `stems_extractor.py` | Demucs integration, GPU auto-detection, silent stem detection |
| `chord_detector.py` | BTC chord detector (170 chord vocabulary, GPU-optimized) |
| `madmom_chord_detector.py` | madmom CRF chord detector (24 chord types, CPU-friendly) |
| `hybrid_chord_detector.py` | Combines multiple backends as fallback |
| `lyrics_detector.py` | faster-whisper transcription with word-level timestamps |
| `lyrics_aligner.py` | LrcLib + Whisper word alignment |
| `syncedlyrics_client.py` | Musixmatch synced lyrics API |
| `vocal_onset_detector.py` | Vocal onset alignment for lyrics timing |
| `msaf_structure_detector.py` | MSAF structure analysis (Foote boundaries) |
| `config.py` | Configuration management, `get_setting()` / `update_setting()` |
| `auth_db.py` | User authentication, `create_user()`, `authenticate_user()` |

`app.py` (~220 lines) handles bootstrap, Flask/SocketIO setup, and blueprint registration. `extensions.py` contains shared singletons (`socketio`, `login_manager`, `UserSessionManager`, decorators). Routes are organized in `routes/` as Flask Blueprints:

| Blueprint | File | Scope |
|-----------|------|-------|
| `auth_bp` | `routes/auth.py` | Login, logout |
| `pages_bp` | `routes/pages.py` | Index, mobile, mixer, service worker |
| `admin_bp` | `routes/admin.py` | Admin pages, user management forms |
| `admin_api_bp` | `routes/admin_api.py` | Admin REST API (24 routes) |
| `downloads_bp` | `routes/downloads.py` | Search, download CRUD |
| `extractions_bp` | `routes/extractions.py` | Stem extraction CRUD |
| `media_bp` | `routes/media.py` | Lyrics, chords, beats, musixmatch |
| `library_bp` | `routes/library.py` | User library, disclaimer, cleanup |
| `files_bp` | `routes/files.py` | Upload, download, stream, stems serving |
| `config_bp` | `routes/config_routes.py` | App config, FFmpeg, browser logging config |
| `logging_bp` | `routes/logging_routes.py` | Browser log collection, log viewing |
| `jam_bp` | `routes/jam.py` | Jam HTTP routes + SocketIO events |
| `recordings_bp` | `routes/recordings.py` | Recording CRUD (upload, list, rename, delete) |
| `mobile_bp` | `mobile_routes.py` | Mobile API config/toggle |

### Database Layer (`core/db/`)

`downloads_db.py` is a backwards-compatible re-export. Actual code lives in `core/db/`:
- `connection.py` (DB_PATH, `_conn()`, path resolution)
- `schema.py` (`init_table()`, migration)
- `downloads.py` (CRUD for global_downloads/user_downloads)
- `extractions.py` (extraction reservation, progress, completion)
- `recordings.py` (recording CRUD — `recordings` table)
- `admin.py` (admin queries, storage stats)
- `cleanup.py` (stuck extraction cleanup, orphan removal)
- `user_views.py` (user session/access management)

## Key Frontend Modules (`static/js/`)

**Desktop app** (split from monolithic `app.js`):
- `app-core.js` — globals, Socket.IO init, config, event listeners
- `app-downloads.js` — search, upload, download/extraction management
- `app-utils.js` — settings, toast, display helpers
- `app-admin.js` — admin cleanup, user management, library tab
- `app-extensions.js` — tab management, extraction status, mixer loading

**Mobile app** (split from monolithic `mobile-app.js`):
- `mobile-constants.js` — music theory constants, chord quality maps
- `mobile-guitar-diagram.js` — GuitarDiagramSettings, GuitarDiagramHelper
- `mobile-neumorphic-dial.js` — NeumorphicDial touch control
- `mobile-app.js` — MobileApp class (navigation, search, library, mixer, chords, lyrics, jam)
- `mobile-admin.js` — MobileAdmin class + initialization

**CSS** (split into subdirectories via `@import`):
- `style.css` → 7 files in `css/desktop/`
- `mobile-style.css` → 7 files in `css/mobile/`
- `mixer/mixer.css` → 7 files in `css/mixer/`

**Mixer modules** (`static/js/mixer/`): Each module follows the pattern `class ModuleName { constructor(mixer) { ... } sync(currentTime) { ... } }`. Key modules: `core.js` (coordinator), `audio-engine.js` (desktop Web Audio), `mobile-audio-engine.js` (iOS-optimized), `chord-display.js`, `karaoke-display.js`, `simple-pitch-tempo.js` (SoundTouch), `structure-display.js`, `waveform.js`, `timeline.js`, `track-controls.js`, `recording-engine.js` (multi-track recording), `soundtouch-engine.js` (WASM).

**Jam session:** `jam-bridge.js` (host transport wrapper), `jam-client.js` (shared WebSocket client), `jam-metronome.js` (beat scheduling), `jam-tab.js` (desktop UI).

## Configuration

- **Secrets** (`.env`): `FLASK_SECRET_KEY` (required), `NGROK_URL` (optional). Never commit.
- **App settings** (`core/config.json`): Managed via Admin Panel. Key settings: `use_gpu_for_extraction`, `default_stem_model`, `lyrics_model_size`, `chords_use_madmom`, `chords_use_hybrid`, `downloads_directory`.

## Desktop/Mobile Parity

Always verify new features work on BOTH `/` (desktop) and `/mobile` interfaces:
- API endpoints are called correctly from both `app.js` and `mobile-app.js`
- Field names match between frontend expectations and API responses (e.g., `download_id` vs `id`)
- When adding mobile features: reuse existing backend routes, never duplicate API endpoints. Only create mobile-specific code for UI/UX adaptations.

## WebSocket Events

Progress updates use Flask-SocketIO with per-user room isolation. Key events: `download_progress`, `download_complete`, `download_error`, `extraction_progress`, `extraction_complete`, `extraction_error`, `extraction_completed_global` (broadcast to all users).

Callback chain: `StemsExtractor.on_extraction_complete → UserSessionManager._emit_complete_with_room → Database persistence → WebSocket emission`.

## Jam Session

Real-time collaborative playback — host shares transport control, no audio streamed through server. Each client plays stems locally; server coordinates BPM, transport commands, and timing offsets.

### Session Lifecycle
Host creates session (`jam_create`) → gets 6-char code → guests join via `/jam/CODE` (no login required, auto-generated names). Host controls play/pause/seek; `jam-bridge.js` intercepts mixer transport to broadcast commands. Periodic sync heartbeats (5s) with drift correction (threshold: 0.5s). RTT measurement for latency compensation. 30-second grace period for host reconnection.

### Precount & Metronome
Host-only control: off, 1 bar, or 2 bars (long-press metronome dot). Host broadcasts `play` with `precount_beats` before starting local precount, so both sides count down simultaneously. `jam-metronome.js` uses Web Audio look-ahead scheduling (100ms ahead) for sample-accurate clicks. Beat map extrapolation prepends virtual beats backward to time 0. Guest mode (`window.JAM_GUEST_MODE`) blocks transport controls and settings popover.

### Stale Session Handling
Flask session flags (`jam_guest`, `jam_code`, `jam_guest_name`) auto-cleared on disconnect, on stale detection in `handle_connect()`, and on route entry. `jam_create` clears leftover guest flags.

### Key Files
`routes/jam.py` (HTTP routes + SocketIO events via `register_jam_socketio_events()`), `jam-bridge.js`, `jam-client.js`, `jam-metronome.js`, `jam-tab.js`, `jam-guest.html`, `jam-guest-mobile.html`, `static/css/jam.css`.

## Code Style

- **Python**: PEP 8, 4-space indent, type hints on public functions, docstrings on classes/public methods.
- **JavaScript**: ES6+, `const`/`let` (never `var`), `async/await`, class-based modules.
- **All comments and UI text in English only** (no French).
- **Commits**: Conventional format — `feat:`, `fix:`, `docs:`, `style:`, `refactor:`.
