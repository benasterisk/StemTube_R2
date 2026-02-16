# CLAUDE.md - StemTube Development Guide

## Workflow

**Tout le développement et les tests se font dans `/home/michael/Documents/Dev/stemtube_dev_v1.3`.**
La synchronisation vers `/home/michael/Documents/Dev/stemtube` (repo Git/GitHub) se fait **uniquement sur signal explicite de l'utilisateur**, suivie d'un push vers GitHub. Ne jamais synchroniser ou push de manière autonome.

## Development Commands

```bash
# Initial setup
python3.12 setup_dependencies.py

# Activate virtual environment
source venv/bin/activate

# Run development server (localhost:5011)
python app.py

# Production with ngrok HTTPS
./start_service.sh

# Stop services
./stop_service.sh

# Validate configuration
python check_config.py

# Reset admin password
python reset_admin_password.py
```

## Architecture Overview

- **Backend**: Flask with Flask-SocketIO for real-time WebSocket communication
- **Frontend**: Vanilla JavaScript with Web Audio API for audio playback and mixing
- **Database**: SQLite with three tables: `users`, `global_downloads`, `user_downloads`
- **Design Pattern**: Download-centric with global file deduplication (multi-user sharing)

### AI Processing Pipeline

- **Stem Separation**: Demucs (vocals, drums, bass, other)
- **Lyrics**: LRCLIB API (synchronized lyrics) → faster-whisper fallback (transcription + alignment)
- **Chord Detection**: BTC primary, madmom fallback, hybrid mode
- **Structure Analysis**: MSAF (Music Structure Analysis Framework)

## Key Patterns

### Global Deduplication
Always check `global_downloads` table before initiating new downloads. Multiple users share the same processed files to save storage and processing time.

### Real-Time Progress
Use WebSocket events via Flask-SocketIO for progress updates during long-running operations (downloads, stem extraction, chord detection).

### Chord Detection Fallback
The system attempts detection in this order: BTC → madmom → hybrid. Handle failures gracefully with fallback to next method.

### GPU Auto-Detection
Demucs automatically detects CUDA availability. Falls back to CPU processing when GPU is unavailable.

### Desktop/Mobile Parity
Always verify that new features work on BOTH `/` (desktop) and `/mobile` interfaces. Check that:
- API endpoints are called correctly from both `app.js` and `mobile-app.js`
- Field names match between frontend expectations and API responses (e.g., `download_id` vs `id`)
- UI components exist in both interfaces when applicable

### Mobile Development
When adding features to the mobile interface (`/mobile`):
- Always reuse existing backend routes from `app.py` - never duplicate API endpoints
- Reuse desktop JavaScript logic from `app.js` where applicable (API calls, data structures)
- Only create mobile-specific code for UI/UX adaptations (touch gestures, bottom sheets, etc.)

## Code Organization

```
app.py                  # Main Flask application (5000+ lines)
core/
  config.py             # Configuration management
  auth_db.py            # User authentication database
  auth_models.py        # Auth data models
  downloads_db.py       # Download tracking database
  stems_extractor.py    # Demucs stem separation
  chord_detector.py     # BTC/madmom chord detection
  lyrics_detector.py    # faster-whisper transcription
  lyrics_aligner.py     # LrcLib + Whisper word alignment
  lrclib_client.py      # LrcLib API client
  metadata_extractor.py # Audio file metadata extraction
  structure_analyzer.py # MSAF structure analysis
static/
  manifest.json         # PWA manifest
  sw.js                 # Service worker (offline cache)
  js/
    app.js              # Main desktop frontend
    mobile-app.js       # Mobile frontend
    pwa-init.js         # PWA initialization
    mixer/              # Audio mixer modules
  css/
    style.css           # Desktop styles
    mobile-style.css    # Mobile styles
templates/
  index.html            # Desktop template
  mobile-index.html     # Mobile template
  admin_embedded.html   # Admin panel
utils/                  # Setup scripts and testing utilities
```

## Code Style

### Python
- Follow PEP 8 conventions
- 4-space indentation
- Use type hints for function signatures
- Include docstrings for classes and public methods

### JavaScript
- ES6+ syntax
- Use `const` and `let` (never `var`)
- Prefer `async/await` over raw promises
- Class-based modules for major components

### General
- Comments in English only (no French)
- All code comments must be in English
- All UI text must be in English
- Conventional commit format: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`

## Jam Session Feature

### Architecture
- **No audio sync through server** — only shared BPM distributed to all participants
- Each client plays audio locally; server coordinates tempo, transport commands, and timing offsets
- Periodic sync heartbeats (every 5s) with drift correction (threshold: 0.5s)
- RTT measurement for network latency compensation

### Precount
- Host-only control: off, 1 bar, or 2 bars (long-press metronome dot to configure)
- Guests hear the precount but **cannot** change settings (`window.JAM_GUEST_MODE` blocks the popover)
- Host broadcasts `play` command with `precount_beats` **before** starting local precount, so both sides count down simultaneously
- After precount callback fires: `originalPlay()` starts audio, then `metronome.start()` begins regular clicks

### Metronome
- Single dot UI with pulse animation, uniform click sound (1200Hz sine, 50ms)
- **Beat map extrapolation**: `setBeatTimes()` prepends virtual beats backward to time 0, so clicks start from the very beginning of the track (no intro silence skipping)
- **Look-ahead scheduling**: clicks pre-scheduled 100ms ahead on Web Audio clock for sample-accurate timing; `start()` uses a wider 1s window for the first pass
- Constant BPM fallback when no beat map available (beats start from time 0, not from `beatOffset`)
- Click mode: all or off (toggle icon). Haptic feedback: off, beat, every

### Session Lifecycle
- Host creates session → gets shareable code → guests join via `/jam/CODE`
- Guest Flask session flags (`jam_guest`, `jam_code`, `jam_guest_name`) are auto-cleared on disconnect and on stale detection in `handle_connect()` — no more cache/cookie issues
- 30-second grace period for host reconnection before session ends
- `jam_create` clears any leftover guest flags (host can't be a guest simultaneously)

### Authentication
- Users do **NOT** need to be logged in to join a session
- Guests get auto-generated names (e.g., "Guest-A1B2")
- If logged in, username is used for display

### Key Files
- `jam-bridge.js` — Host-side: wraps mixer transport (play/pause/seek) to broadcast commands
- `jam-client.js` — Shared WebSocket client (desktop + mobile), RTT tracking, event handlers
- `jam-metronome.js` — Metronome class: precount, beat map, look-ahead scheduling, popover
- `jam-tab.js` — Desktop UI for jam tab (create/join/share)
- `mobile-app.js` — Mobile jam handlers: `_handleJamPlaybackCommand()`, `_handleJamSync()`
- `templates/mixer.html` — Desktop guest inline JS (playback/sync handlers)
- `static/css/jam.css` — Metronome dot, popover, precount styles

### Shared Backend
- Backend SocketIO events shared between desktop and mobile
- Platform-specific UI code in `jam-tab.js` (desktop) and mobile Jam section in `mobile-app.js`
