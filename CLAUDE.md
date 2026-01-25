# CLAUDE.md - StemTube Development Guide

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
external/
  BTC-ISMIR19/          # BTC chord detection model (170 chord vocabulary)
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
- Conventional commit format: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`
