# CLAUDE.md

**Technical documentation for Claude Code AI assistant.**

This file provides architectural guidance when working with the StemTube codebase. For user-facing documentation, see **README.md**.
For contributor workflow, coding style, and testing expectations, review **AGENTS.md**.

---

## Quick Reference

**Installation:** See README.md (fully automated)
**Running:** `source venv/bin/activate && python app.py`
**Database:** SQLite at `stemtubes.db`
**Port:** 5011 (configurable in `core/config.json`)

---

## Architecture Overview

StemTube is a Flask-based web application for YouTube audio downloading and AI-powered stem extraction using Demucs. The architecture follows a **download-centric design** where extractions are properties of downloads, not separate entities.

### Core Principles

1. **Download-Centric:** All operations revolve around `video_id`. Extractions are flags on download records.
2. **Global Deduplication:** Single file/extraction shared across unlimited users (instant access).
3. **Session-Based Processing:** Live operations in user sessions, completed ones persist to database.
4. **Real-time Updates:** WebSocket (SocketIO) for progress tracking.

### Data Flow

```
User Request → Check Global Existence → Grant Access OR Process → Update DB → Grant Access
```

**Downloads:** Check `global_downloads` → Use existing OR download → Add `user_downloads` access
**Extractions:** Check `global_downloads.extracted=1` → Use existing OR extract → Update download record

---

## Database Schema

**Tables:**
- `users` - Authentication (Flask-Login + bcrypt)
- `global_downloads` - Master file records with deduplication
- `user_downloads` - User access to files

**Critical Fields:**
```python
global_downloads:
  - video_id (TEXT PRIMARY KEY) - Unique video/upload identifier
  - extracted (BOOLEAN) - Stems exist flag
  - extraction_model (TEXT) - AI model used (htdemucs, etc.)
  - stems_paths (JSON) - Individual stem file paths
  - detected_bpm (FLOAT) - Audio analysis result
  - detected_key (TEXT) - Musical key (e.g. "F major")
  - chords_data (JSON) - Chord progression with timestamps
  - structure_data (JSON) - Song sections (intro, verse, chorus)
  - lyrics_data (JSON) - Transcribed lyrics with word timestamps
```

**Analysis Data Priority:**
`list_extractions_for()` uses `COALESCE(global.field, user.field)` to prefer global data over user data for consistency.

---

## Core Components

### 1. Download System
**Files:** `core/downloads_db.py`, `core/download_manager.py`

**Key Functions:**
- `find_global_download(video_id)` - Check if video already downloaded
- `add_user_access(user_id, global_id)` - Grant user access to existing download
- `db_add_download()` - Create new global download entry

**Deduplication Pattern:**
```python
global_download = find_global_download(video_id)
if global_download:
    add_user_access(user_id, global_download.id)  # Instant access
else:
    download_file()  # Download + create records
```

**File Organization:**
```
core/downloads/
  {video_title}/
    audio/
      {filename}.mp3
    stems/
      vocals.mp3
      drums.mp3
      bass.mp3
      other.mp3
      {filename}_stems.zip
```

### 2. Extraction System
**Files:** `core/stems_extractor.py`, `core/downloads_db.py`

**Process:**
```python
1. Check: find_global_extraction(video_id, model)
2. If exists: add_user_extraction_access() → done
3. If not: Run Demucs → mark_extraction_complete() → add_user_extraction_access()
```

**Models:**
- `htdemucs` (4 stems: vocals, drums, bass, other) - Default
- `htdemucs_6s` (6 stems: adds piano, guitar)
- `mdx_extra` (4 stems: alternative)

**GPU Acceleration:**
- Automatic CUDA detection and configuration in `app.py`
- Uses `os.execv()` to restart Python with correct `LD_LIBRARY_PATH`
- 4-8x faster than CPU (20-60s vs 3-8 min for 4 stems)

### 3. Audio Analysis
**Files:** `core/download_manager.py`, `core/madmom_chord_detector.py`, `core/msaf_structure_detector.py`

**BPM Detection:**
- Custom autocorrelation algorithm using scipy
- Octave error correction (prefers 80-140 BPM range)
- Runs automatically after download

**Key Detection:**
- Pitch class histogram via chroma features
- Determines musical key (e.g., "C major", "D minor")

**Chord Detection (3 Backends):**

1. **BTC Transformer** (170 chord vocabulary) - Most accurate
   - External dependency: `../essentiatest/BTC-ISMIR19`
   - GPU-optimized, supports complex jazz/advanced harmonies
   - Default backend when available

2. **madmom CRF** (24 chord types) - Professional-grade
   - CNN-based chroma extraction + CRF recognition
   - Built-in, trained on 1000+ songs
   - Chordify/Moises accuracy level
   - Works on all genres including distorted/rock

3. **Hybrid Detector** - Fallback combination
   - Automatic fallback when BTC unavailable
   - Combines multiple backends for robustness

**Features:**
- **Chord Transposition:** Automatically transposes when user changes pitch in mixer
- **Backend Selection:** Configurable via `core/config.json` (`chord_backend` setting)

**Structure Analysis (MSAF):**
- Boundary detection: `boundaries_id="foote"` (kernel checkerboard)
- Label assignment: `labels_id="fmc2d"` (generic clustering)
- Returns sections with start/end/label/confidence
- Stored as JSON array in `structure_data`

### 4. Lyrics System
**Files:** `core/lyrics_detector.py`

**faster-whisper Integration:**
- GPU-accelerated speech recognition (3-5x faster than CPU)
- Automatic GPU library configuration in `app.py` startup
- Word-level timestamps for karaoke synchronization
- Multi-language support with auto-detection
- VAD (Voice Activity Detection) filtering

**Process:**
```python
1. Prefer vocals stem if available
2. Load Whisper model (tiny/base/small/medium/large/large-v3)
3. Transcribe with word timestamps
4. Save to lyrics_data JSON
5. Display in mixer karaoke interface
```

**GPU Configuration:**
- `app.py` detects cuDNN library path at startup
- Uses `os.execv()` to restart with `LD_LIBRARY_PATH` configured
- Automatic fallback to CPU if GPU unavailable

### 5. File Upload System
**Files:** `app.py` (`/api/upload-file`), `templates/index.html`

**Supported Formats:**
- Audio: MP3, WAV, FLAC, M4A, AAC, OGG, WMA
- Video: MP4, AVI, MKV, MOV, WEBM

**Process:**
```python
1. User uploads file via drag & drop or click
2. Backend validates format
3. FFmpeg auto-converts to MP3 (if not already MP3)
4. Generate unique video_id: "upload_xxxxxxxxxxxxx"
5. Save to database using existing deduplication logic
6. File appears in Downloads tab
```

### 6. User Session Management
**Files:** `app.py` (`UserSessionManager`)

**Per-User Managers:**
- `DownloadManager` - Queue-based download processing
- `StemsExtractor` - Extraction with progress callbacks
- WebSocket room isolation (user-specific events)

**WebSocket Callback Chain:**
```python
StemsExtractor.on_extraction_complete
  → UserSessionManager._emit_complete_with_room
  → Database persistence
  → WebSocket emission to user
```

---

## Frontend Architecture

**Location:** `static/js/`

**Main Application (1,500 lines):**
- `app.js` - Tab management, WebSocket, download/extraction UI
- `app-extensions.js` - Utility functions
- `auth.js` - Authentication flow

**Mixer Interface (8,257 lines across 11 modules):**

1. **core.js** - Main coordinator, platform detection, analysis data loading
2. **audio-engine.js** - Desktop Web Audio API processing
3. **mobile-audio-engine.js** - iOS-optimized audio processing
4. **chord-display.js** (489 lines) - Real-time chord display with transposition
5. **structure-display.js** (567 lines) - Visual song section timeline
6. **karaoke-display.js** - Scrolling lyrics with word highlighting
7. **simple-pitch-tempo.js** - SoundTouch integration, pitch/tempo controls
8. **waveform.js** - Canvas waveform visualization
9. **timeline.js** - Playhead and time management
10. **track-controls.js** - Per-stem volume/pan/mute
11. **soundtouch-engine.js** - WASM processor loading

**Modular Pattern:**
```javascript
class ModuleName {
    constructor(mixer) {
        this.mixer = mixer;
        this.init();
    }
    sync(currentTime) { }  // Called during playback
}
```

---

## API Endpoints Reference

**Authentication:** (3)
- `GET/POST /login`, `GET /logout`, `GET /`

**Downloads:** (8)
- `GET /api/downloads` - List user downloads
- `POST /api/downloads` - Add new download (with deduplication)
- `GET /api/downloads/<id>` - Get status
- `DELETE /api/downloads/<id>` - Cancel download
- `POST /api/downloads/<id>/retry` - Retry failed
- `DELETE /api/downloads/<id>/delete` - Remove record
- `DELETE /api/downloads/clear-all` - Clear all user downloads
- `GET /api/downloads/<video_id>/extraction-status` - Check if extracted

**Extractions:** (9)
- `GET /api/extractions` - List user extractions
- `POST /api/extractions` - Start extraction (atomic reservation)
- `GET /api/extractions/<id>` - Get status
- `DELETE /api/extractions/<id>` - Cancel
- `POST /api/extractions/<id>/retry` - Retry
- `DELETE /api/extractions/<id>/delete` - Remove
- `POST /api/extractions/<id>/create-zip` - Create ZIP
- `GET /api/extracted_stems/<id>/<stem>` - Serve stem file
- `HEAD /api/extracted_stems/<id>/<stem>` - Check exists

**Lyrics:** (2)
- `GET /api/extractions/<id>/lyrics` - Get cached lyrics
- `POST /api/extractions/<id>/lyrics/generate` - Generate transcription

**Admin:** (15)
- `GET /admin`, `GET /admin/embedded` - Admin interfaces
- `POST /admin/add_user`, `POST /admin/edit_user`, `POST /admin/delete_user`
- `POST /admin/reset_password`
- `GET /api/admin/cleanup/downloads` - List all downloads
- `GET /api/admin/cleanup/storage-stats` - Storage statistics
- `DELETE /api/admin/cleanup/downloads/<video_id>` - Delete by video ID
- `POST /api/admin/cleanup/downloads/bulk-delete` - Bulk delete
- `POST /api/admin/cleanup/downloads/bulk-reset` - Reset extractions
- `GET /api/logs/list`, `GET /api/logs/view/<file>`, `GET /api/logs/download/<file>`

**Library:** (3)
- `GET /api/library` - Browse global library
- `POST /api/library/<id>/add-download` - Add from library
- `POST /api/library/<id>/add-extraction` - Add extraction from library

**Search:** (2)
- `GET /api/search` - YouTube search
- `GET /api/video/<video_id>` - Video metadata

**File Operations:** (5)
- `POST /api/upload-file` - Upload audio/video
- `GET /api/download-file` - Download file
- `POST /api/list-files`, `POST /api/open-folder`

**Config:** (4)
- `GET /api/config`, `POST /api/config`
- `GET /api/config/ffmpeg/check`, `POST /api/config/ffmpeg/download`

**WebSocket Events:**
- `download_progress`, `download_complete`, `download_error`
- `extraction_progress`, `extraction_complete`, `extraction_error`
- `extraction_completed_global` (broadcast to all users)

---

## Development Patterns

### Adding New Extraction Models

1. Add to `STEM_MODELS` in `core/config.py`
2. Update `StemsExtractor` model loading logic
3. No database changes needed (model stored as string)

### Adding New File Formats

1. Add extension to `allowed_extensions` in `upload_file_route()` (app.py)
2. Update `accept` attribute in file input (templates/index.html)
3. FFmpeg handles conversion automatically

### Database Migrations

Manual SQLite ALTERs required:
```sql
ALTER TABLE global_downloads ADD COLUMN new_field TEXT;
ALTER TABLE user_downloads ADD COLUMN new_field TEXT;
```

---

## Configuration

**Location:** `core/config.json`

**Key Settings:**
```json
{
  "port": 5011,
  "max_concurrent_downloads": 3,
  "use_gpu_for_extraction": true,
  "enable_silent_stem_detection": true,
  "silent_stem_threshold_db": -40.0,
  "extraction_model": "htdemucs"
}
```

**Environment Variables (.env):**
```env
FLASK_SECRET_KEY=<required-64-char-hex>
NGROK_URL=<optional-custom-subdomain>
```

---

## GPU Acceleration Implementation

**Location:** `app.py` (lines 1-54)

**How It Works:**
```python
def configure_gpu_and_restart():
    """Run at startup before any imports."""
    if os.environ.get('_STEMTUBE_GPU_CONFIGURED') == '1':
        return  # Already configured

    cudnn_lib_path = site.getsitepackages()[0] + '/nvidia/cudnn/lib'
    if os.path.exists(cudnn_lib_path):
        os.environ['LD_LIBRARY_PATH'] = f"{cudnn_lib_path}:..."
        os.environ['_STEMTUBE_GPU_CONFIGURED'] = '1'
        os.execv(sys.executable, [sys.executable] + sys.argv)  # Restart
```

**Why os.execv() is necessary:**
- `LD_LIBRARY_PATH` must be set **before** dynamic linker loads libraries
- Modifying after Python starts has no effect
- `os.execv()` creates new process with correct environment

**Setup Process:**
1. `setup_dependencies.py` detects CUDA version (11.x or 12.x)
2. Installs matching PyTorch (cu118 or cu121)
3. Installs matching cuDNN package (nvidia-cudnn-cu11 or cu12)
4. `app.py` auto-configures library path on startup

---

## Testing & Debugging

**Database:**
```bash
python utils/database/debug_db.py           # Inspect DB state
python utils/database/clear_database.py     # Reset (DESTRUCTIVE)
```

**Analysis:**
```bash
python utils/testing/test_lyrics_cpu.py <audio>       # Test transcription
python utils/testing/test_madmom_tempo_key.py <audio> # Test chord detection
```

**Admin:**
```bash
python reset_admin_password.py  # Reset administrator password
```

**Re-analysis:**
```bash
python utils/analysis/reanalyze_all_chords.py     # Re-run chord detection
python utils/analysis/reanalyze_all_structure.py  # Re-run structure analysis
```

---

## Common Development Tasks

### 1. Fix Stuck Extractions
```python
# Run at startup (app.py already does this)
from core.downloads_db import cleanup_stuck_in_progress_flags
cleanup_stuck_in_progress_flags()
```

### 2. Re-analyze Audio
```python
from core.download_manager import detect_audio_properties
detect_audio_properties(audio_path, video_id)
```

### 3. Grant User Access to Existing File
```python
from core.downloads_db import find_global_download, add_user_access
global_dl = find_global_download(video_id)
if global_dl:
    add_user_access(user_id, global_dl.id)
```

### 4. Check Extraction Status
```python
from core.downloads_db import find_global_extraction
extraction = find_global_extraction(video_id, "htdemucs")
if extraction:
    print(f"Stems: {extraction.stems_paths}")
```

---

## Performance Optimization

**GPU vs CPU (3-4 minute song):**
| Task | CPU | GPU | Speedup |
|------|-----|-----|---------|
| Stem extraction | 3-8 min | 20-60s | 4-8x |
| Lyrics transcription | 30-120s | 10-30s | 3-5x |

**Concurrency Limits:**
- Downloads: 3 concurrent (configurable)
- Extractions: 1 (CPU) or 2-3 (GPU with queue)
- WebSocket: Per-user room isolation

**Caching:**
- Demucs models: `~/.cache/torch/hub/` (~2 GB)
- Whisper models: `~/.cache/huggingface/` (~500 MB per model)

---

## Security Implementation

**Authentication:**
- bcrypt password hashing
- Flask-Login session management
- Session files in `flask_session/`

**Path Validation:**
```python
# All file operations validated against downloads directory
safe_path = os.path.abspath(os.path.join(DOWNLOADS_DIR, filename))
if not safe_path.startswith(DOWNLOADS_DIR):
    raise SecurityError("Path traversal attempt")
```

**SQL Injection Prevention:**
```python
# Always use parameterized queries
cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
# NEVER: cursor.execute(f"SELECT * FROM users WHERE username = '{username}'")
```

**Access Control:**
```python
@admin_required
def admin_route():
    pass  # Only accessible to users with is_admin=True
```

---

## Technology Stack

**Backend:**
- Flask 3.x, Flask-SocketIO, Flask-Login
- PyTorch 2.x, Demucs 4.x, madmom 0.16.1
- faster-whisper 1.2.0, MSAF, librosa, scipy
- SQLite3, aiotube, yt-dlp

**Frontend:**
- Vanilla JavaScript ES6+ (no framework)
- Web Audio API, SoundTouchJS WASM
- Socket.IO client, Canvas API

**Dependencies:**
- Total: ~120 packages (including transitive)
- Essential: 18 packages (installed individually)
- Python: 3.12+ required

---

## Codebase Statistics

**Total Lines:** ~20,000+
- Backend Python: ~9,000 lines
- Frontend JavaScript: ~10,000 lines
- API Endpoints: 69 endpoints (67 routes + 2 WebSocket events)
- Frontend Modules: 25+
- Backend Modules: 20+

**Key Files:**
- `app.py`: 3,002 lines (Flask + SocketIO)
- `downloads_db.py`: 1,138 lines (Database ops)
- `download_manager.py`: 997 lines (Queue management)
- `stems_extractor.py`: 1,111 lines (Demucs integration)
- Mixer modules: 8,257 lines total

---

## Recent Major Changes

**November 2025:**
- ✅ **Automated GPU setup** - `os.execv()` in app.py for cuDNN configuration
- ✅ **Dependency conflict resolution** - Individual package installation
- ✅ **Madmom auto-patching** - Numpy compatibility automatic
- ✅ **Documentation consolidation** - README.md comprehensive, CLAUDE.md technical-only
- ✅ **Codebase cleanup** - 16 obsolete files removed

**Previous:**
- Professional chord detection with madmom CRF
- Music structure analysis via MSAF
- Lyrics/karaoke system with faster-whisper
- Chord transposition in mixer
- Structure timeline visualization
- File upload system
- Silent stem detection
- Admin interface integration
- Global library system

---

## Troubleshooting Quick Reference

**Import Errors:**
```bash
# Madmom numpy compatibility
python utils/setup/patch_madmom.py

# Rebuild venv
rm -rf venv && python3.12 setup_dependencies.py
```

**GPU Issues:**
```bash
# Check CUDA
nvidia-smi

# Check configuration
grep "GPU libraries configured" logs/stemtube.log

# Force CPU mode
# Edit core/config.json: "use_gpu_for_extraction": false
```

**Database Issues:**
```bash
# Check for locks
rm stemtubes.db-journal

# Inspect state
python utils/database/debug_db.py
```

---

## For Claude Code: Best Practices

1. **Always read database schema** before modifying queries
2. **Use existing deduplication patterns** for new features
3. **Test on both CPU and GPU** if touching extraction code
4. **Update CLAUDE.md** when changing architecture
5. **Use parameterized SQL queries** to prevent injection
6. **Follow modular frontend pattern** when adding mixer features
7. **Maintain WebSocket room isolation** for user privacy
8. **Prefer COALESCE for analysis data** to use global_downloads values

---

**Last Updated:** December 2025
**For Full Installation Guide:** See README.md
**For User Documentation:** See README.md
**For Development Utilities:** See ../utilities/
