# StemTube Backend Guide

Complete guide to the Python backend architecture and modules.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Core Modules](#core-modules)
  - [Downloads & YouTube](#downloads--youtube)
  - [Audio Processing](#audio-processing)
  - [Music Analysis](#music-analysis)
  - [Authentication](#authentication)
  - [Configuration](#configuration)
  - [Utilities](#utilities)
- [Processing Pipelines](#processing-pipelines)
- [Database Operations](#database-operations)
- [Queue Management](#queue-management)

---

## Overview

**Total Lines**: ~10,800 lines of Python

**Module Count**: 21 core Python modules

**Technology Stack**:
- Flask 3.x (web framework)
- SocketIO (real-time communication)
- PyTorch 2.x + Demucs 4.x (AI stem separation)
- MSST BS-Roformer, vendored in `core/msst/` (MVSep Mega fine stems, CUDA only)
- BTC-ISMIR19 transformer (chord detection)
- madmom (beat/downbeat detection only)
- LRCLIB + faster-whisper (lyrics: LRCLIB text aligned on Whisper word timings)
- MSAF (structure analysis: sections labelled A, B, C... by similarity)
- SQLite3 (database)
- aiotube + yt-dlp (YouTube download)

**Python Version**: 3.12+

---

## Architecture

### Module Organization

```
core/
├── config.py                   # Configuration management
├── config.json                 # JSON configuration
│
├── aiotube_client.py           # YouTube integration (no API key)
├── download_manager.py         # Download queue management
├── file_cleanup.py             # File management
│
├── stems_extractor.py          # Demucs / MSST subprocess runner, GPU lock
├── demucs_wrapper.py           # Demucs CLI wrapper
├── wrap_demucs.py              # Demucs process wrapper
├── msst/                       # Vendored BS-Roformer + separate.py (mvsep_mega_fine)
├── poc/                        # Mixer artifact pipeline (beats, metronome, precount, export)
│
├── chord_detector.py           # analyze_audio_file(): BTC only
├── btc_chord_detector.py       # BTC Transformer (170 vocab)
├── madmom_chord_detector.py    # madmom - used ONLY for beat/downbeat detection
├── hybrid_chord_detector.py    # DEAD (no importers)
│
├── lyrics_detector.py          # detect_lyrics_unified(): LRCLIB lookup → Whisper → alignment
├── lyrics_merger.py            # align_lines_with_whisper(): LRCLIB words on Whisper timings
├── lrclib_client.py            # LRCLIB API client (lrclib.net, free, no account)
├── media_metadata.py           # yt-dlp metadata, resolve_artist_track()
│
├── msaf_structure_detector.py  # MSAF structure detector (A/B/C similarity sections)
├── structure_detector.py       # DEAD (no importers)
├── llm_structure_analyzer.py   # DEAD (no importers)
│
├── downloads_db.py             # Downloads database
├── auth_db.py                  # Authentication database
├── auth_models.py              # User model
│
├── logging_config.py           # Logging setup
├── request_logging.py          # HTTP request logging
│
└── models/                     # Demucs model storage
```

---

## Core Modules

### Downloads & YouTube

#### 1. aiotube_client.py

**Purpose**: YouTube integration without API key

**Size**: ~570 lines

**Key Features**:
- Search YouTube videos
- Get video metadata
- No API key required (uses aiotube)
- YouTube cache database

**Main Functions**:

**Search**:
```python
async def search_youtube(query, max_results=10):
    """
    Search YouTube for videos.

    Args:
        query: Search query string
        max_results: Maximum number of results

    Returns:
        list: List of video metadata dicts
    """
    from aiotube import Search

    search = Search(query)
    results = []

    for video in search.videos[:max_results]:
        results.append({
            'id': video.video_id,
            'title': video.title,
            'author': video.author,
            'duration': video.length,  # In seconds
            'thumbnails': video.thumbnails
        })

    return results
```

**Get Video Info**:
```python
def get_video_info(video_id):
    """
    Get detailed video information.

    Args:
        video_id: YouTube video ID

    Returns:
        dict: Video metadata
    """
    from aiotube import YouTube

    yt = YouTube(f'https://www.youtube.com/watch?v={video_id}')

    return {
        'id': video_id,
        'title': yt.title,
        'author': yt.author,
        'duration': yt.length,
        'thumbnails': yt.thumbnails,
        'description': yt.description
    }
```

**Cache System**:
- SQLite database: `youtube_cache.db`
- Caches video metadata to reduce YouTube requests
- Automatic expiry (30 days)

**File**: core/aiotube_client.py

---

#### 2. download_manager.py

**Purpose**: Download queue management and audio analysis

**Size**: ~1,025 lines

**Responsibilities**:
- YouTube audio download (yt-dlp)
- File upload handling
- Download queue management
- BPM detection
- Musical key detection
- Download-phase analysis: BTC chords, MSAF structure, `media_metadata` + LRCLIB line-synced lyrics preview
- Download progress via WebSocket

**Download Pipeline**:
```python
def download_audio(video_id, user_id):
    """
    Download audio from YouTube.

    Pipeline:
    1. Check if already downloaded
    2. Download audio with yt-dlp
    3. Detect BPM
    4. Detect musical key
    5. Save to database
    6. Emit WebSocket progress

    Args:
        video_id: YouTube video ID
        user_id: User ID for access control

    Returns:
        dict: Download metadata
    """
    import yt_dlp

    # Check if exists globally
    existing = find_global_download(video_id)
    if existing:
        # Just grant user access
        grant_user_access(user_id, existing['id'], video_id)
        return existing

    # Download with yt-dlp
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': f'downloads/global/{video_id}/audio.%(ext)s',
        'quiet': False,
        'progress_hooks': [progress_hook],  # WebSocket updates
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=True)
        file_path = ydl.prepare_filename(info)

    # Analyze audio
    bpm = detect_bpm(file_path)
    key = detect_key(file_path)

    # Save to database
    meta = {
        'video_id': video_id,
        'title': info['title'],
        'file_path': file_path,
        'file_size': os.path.getsize(file_path),
        'detected_bpm': bpm,
        'detected_key': key
    }

    global_download_id = add_global_download(meta)
    grant_user_access(user_id, global_download_id, video_id)

    return meta
```

**BPM Detection**:
```python
def detect_bpm(audio_path):
    """
    Detect tempo (BPM) using autocorrelation.

    Algorithm:
    1. Load audio with soundfile
    2. Convert to mono
    3. Compute onset strength envelope
    4. Apply autocorrelation
    5. Find tempo peaks

    Args:
        audio_path: Path to audio file

    Returns:
        float: Detected BPM (e.g., 120.5)
    """
    import soundfile as sf
    import librosa

    # Load audio
    y, sr = sf.read(audio_path)

    # Convert to mono
    if y.ndim > 1:
        y = y.mean(axis=1)

    # Detect tempo
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)

    return float(tempo)
```

**Musical Key Detection**:
```python
def detect_key(audio_path):
    """
    Detect musical key using librosa.

    Args:
        audio_path: Path to audio file

    Returns:
        str: Detected key (e.g., "C major", "Am")
    """
    import librosa
    import numpy as np

    # Load audio
    y, sr = librosa.load(audio_path, duration=30)  # First 30 seconds

    # Compute chroma features
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)

    # Aggregate chroma over time
    chroma_sum = np.sum(chroma, axis=1)

    # Find dominant note (0=C, 1=C#, ..., 11=B)
    dominant_note = np.argmax(chroma_sum)

    # Determine major or minor
    # (Simplified heuristic - full implementation more complex)
    is_major = chroma_sum[dominant_note] > chroma_sum[(dominant_note + 3) % 12]

    # Map to key name
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    key = notes[dominant_note] + (' major' if is_major else ' minor')

    return key
```

**File**: core/download_manager.py

---

#### 3. file_cleanup.py

**Purpose**: File management and cleanup

**Size**: ~280 lines

**Features**:
- Cleanup orphaned files (no DB entry)
- Cleanup orphaned DB entries (no file)
- Calculate storage statistics
- Delete downloads with all associated files

**Cleanup**:
```python
def cleanup_orphaned_files(downloads_dir):
    """
    Remove files without database entries.

    Process:
    1. Scan filesystem for all audio files
    2. Check each file has DB entry
    3. Delete files without DB entry

    Args:
        downloads_dir: Downloads directory path

    Returns:
        int: Number of files deleted
    """
    from pathlib import Path
    from core.downloads_db import find_global_download

    deleted_count = 0

    for audio_file in Path(downloads_dir).rglob('*.m4a'):
        video_id = audio_file.parent.name

        # Check if DB entry exists
        download = find_global_download(video_id)

        if not download:
            # No DB entry - delete file
            audio_file.unlink()
            deleted_count += 1

    return deleted_count
```

**File**: core/file_cleanup.py

---

### Audio Processing

#### 4. stems_extractor.py

**Purpose**: Stem extraction orchestration (Demucs and MSST subprocesses)

**Size**: ~1,190 lines

**Key Features**:
- Model selection from `STEM_MODELS` in `core/config.py`
- Stem separation only - chords and structure run at download time, lyrics and beats run
  post-extraction in `extensions.py`
- GPU auto-detection with CPU fallback (MSST requires CUDA)
- Global `_MSST_GPU_LOCK`: only one `mvsep_mega_fine` job holds the GPU at a time
- Silent stem detection
- Progress tracking via WebSocket

**Extraction Pipeline** (simplified):
```python
# StemsExtractor worker, per ExtractionItem
engine = model_engine(item.model_name)          # "demucs" (default) or "msst"

if engine == "msst":
    self._acquire_msst_slot(item)               # global GPU lock
    cmd = [sys.executable, '-m', 'core.msst.separate', ...]
else:
    cmd = [sys.executable, '-m', 'demucs.separate', '-n', item.model_name, ...]

subprocess.Popen(cmd, ...)                      # progress parsed from output
# stems copied as MP3, silent stems detected (ZIP built on demand via /create-zip)
# → on_extraction_complete → extensions.py post-extraction steps:
#     remove_replaced_stems(item)               # re-extraction replaces old stems
#     db_mark_extraction_complete(...)
#     detect_lyrics_unified(vocals)             # LRCLIB + Whisper, aligned
#     MadmomChordDetector beat/downbeat detection
#     routes.poc_mixer.warm_prepare(...)        # pre-build mixer artifacts
```

**Model Selection** (`STEM_MODELS`):
- `htdemucs`: 4-stem (vocals, drums, bass, other) - Faster, general-purpose (default)
- `htdemucs_ft`: 4-stem, fine-tuned HTDemucs
- `htdemucs_6s`: 6-stem (adds guitar, piano) - Slower, better for instrumental music
- `mdx_extra`: 4-stem MDX
- `mdx_extra_q`: 4-stem - unreachable (disabled in both templates, `diffq` not installed)
- `mvsep_mega_fine`: 17 stems, engine `msst`, CUDA only, min 6 GB VRAM. 3-stage hybrid in
  `core/msst/separate.py`: `htdemucs_6s` coarse split → DrumSep (inagoy, HDemucs, MIT) on the
  drums stem → MVSep Mega 53-stem BS-Roformer heads (ZFTurbo, MIT) split the remaining stems
  with Wiener masks. Weights auto-downloaded to `core/models/msst/`. Also writes
  `drums_full.mp3` (not a mixer track) for metronome beat detection.

**Re-extraction**: `force_reextract` with another model replaces the previous stems
(`remove_replaced_stems()` in `extensions.py`).

**File**: core/stems_extractor.py

---

#### 5. demucs_wrapper.py

**Purpose**: Demucs CLI wrapper

**Size**: ~45 lines

**Wraps**: `python -m demucs.separate`

**Configuration**:
```python
def run_demucs(audio_path, model, output_dir, device='cpu'):
    """
    Run Demucs separation.

    Args:
        audio_path: Input audio file
        model: Demucs model name
        output_dir: Output directory
        device: 'cpu' or 'cuda'

    Returns:
        int: Return code (0=success)
    """
    import subprocess

    cmd = [
        'python', '-m', 'demucs.separate',
        '-n', model,
        '-o', output_dir,
        '--device', device,
        audio_path
    ]

    process = subprocess.run(cmd, capture_output=True, text=True)

    return process.returncode
```

**File**: core/demucs_wrapper.py

---

#### 6. wrap_demucs.py

**Purpose**: Demucs process wrapper with FFmpeg configuration

**Size**: ~26 lines

**Features**:
- Automatic FFmpeg path detection
- Environment variable configuration

**File**: core/wrap_demucs.py

---

### Music Analysis

#### 7. chord_detector.py

**Purpose**: Chord detection entry point - BTC only

**Size**: ~530 lines

**Backend**: BTC Transformer (170 chord vocabulary). There is no backend selection; the
`chords_use_madmom` and `chords_use_hybrid` config keys are no longer read.

**Detection**:
```python
def analyze_audio_file(audio_file_path, bpm=None, **_kwargs):
    """
    Analyze an audio file: BTC for chords only.
    Beat detection is handled post-extraction in extensions.py via madmom.

    Returns:
        tuple: (chords_json, 0.0, [], [])  - no beats
    """
    from core.btc_chord_detector import analyze_audio_file as btc_analyze, is_available

    chords_json = None
    if is_available():
        chords_json = btc_analyze(audio_file_path, bpm)[0]

    return chords_json, 0.0, [], []
```

**Called by**: `core/download_manager.py` (download phase), `/chords/regenerate` in
`routes/media.py`

**File**: core/chord_detector.py

---

#### 8. btc_chord_detector.py

**Purpose**: BTC Transformer chord detection (170 vocabulary)

**Size**: ~230 lines

**Model**: External dependency - `external/BTC-ISMIR19` (weights:
`external/BTC-ISMIR19/test/btc_model_large_voca.pt`)

**Vocabulary**: 170 chord types (major, minor, 7th, 9th, 11th, 13th, sus, add, dim, aug, etc.)

**Usage**:
```python
from core.btc_chord_detector import analyze_audio_file, is_available

if is_available():
    chords_json = analyze_audio_file('audio.mp3')[0]
```

**Genres**: All genres, especially jazz/complex harmonies

**File**: core/btc_chord_detector.py

---

#### 9. madmom_chord_detector.py

**Purpose**: Beat and downbeat detection (madmom). Its chord recognition is no longer used.

**Size**: ~245 lines

**Model**: Built-in madmom trained models

**Live callers**:
- `extensions.py` - post-extraction beat/downbeat detection
- `routes/media.py` - `POST /api/extractions/<id>/beats/regenerate`

**Usage**:
```python
from core.madmom_chord_detector import MadmomChordDetector

detector = MadmomChordDetector()
beat_offset, beats, beat_positions = detector._detect_beats(audio_path, detected_bpm)
```

**File**: core/madmom_chord_detector.py

---

#### 10. hybrid_chord_detector.py

**Status**: DEAD - no importers. Not part of the chord pipeline.

**File**: core/hybrid_chord_detector.py

---

#### 11. lyrics_detector.py

**Purpose**: Unified lyrics detection - LRCLIB lookup, faster-whisper transcription in the sung
language, then alignment of the LRCLIB words on the Whisper word timings. Used after extraction
and on Regenerate; the download phase (`download_manager.py`) runs only the LRCLIB lookup
(`find_best_record()`) and stores a line-timed preview when the record is line-synced.

**Size**: ~440 lines

**Modules**:
- `core/lyrics_detector.py` - `detect_lyrics_unified()`, `detect_song_lyrics()` (Whisper only),
  `choose_language()`, `is_hallucination()`
- `core/lyrics_merger.py` - `align_lines_with_whisper()`: SequenceMatcher on normalized words;
  matched words take the Whisper timings, misheard runs share the Whisper span, the rest use the
  line estimates shifted by the median offset (or their neighbours); returns `alignment_stats`
- `core/lrclib_client.py` - LRCLIB API (lrclib.net, free, no account): `search_tracks()`,
  `get_record()`, `find_best_record()` (artist and track ≥0.6 similarity, synced preferred,
  closest duration), `parse_synced()` / `parse_plain()` / `record_to_lines()` (level `line` or
  `text`), `spread_words()`; retries 429/502/503/504. Never word-level timing
- `core/media_metadata.py` - `from_ytdlp_info()`, `load_media_metadata()` (lazy metadata-only
  yt-dlp request for older YouTube songs; uploads `upload_<hex>` skipped),
  `resolve_artist_track()`: override > YouTube artist+track > "Artist - Track" title > ID3 tags
  (uploads) > "X (Musical Artist)" tag > YouTube artist > uploader (VEVO / " - Topic" stripped)

**Flow**:
```python
def detect_lyrics_unified(audio_path, title=None, model_size=None, use_gpu=True,
                          duration=None, progress_callback=None,
                          override_artist=None, override_track=None,
                          force_whisper=False, lrclib_id=None, sync_with_whisper=True,
                          media_metadata=None, file_path=None):
    """
    1. Resolve artist/track (resolve_artist_track)
    2. LRCLIB: the picked lrclib_id or find_best_record() (skipped if force_whisper)
       - synced record and sync_with_whisper=False -> LRCLIB line timing, source 'lrclib'
    3. faster-whisper on the vocals stem in the sung language: detect_language with the VAD
       filter on voiced parts (3 x 30 s windows); >= 0.7 probability wins, else the
       YouTube-declared language, else the weak guess. Credit hallucinations are dropped.
    4. Lyrics found -> align_lines_with_whisper(), source 'lrclib+whisper'
       - match_rate < 30 %: synced record keeps its line timing ('lrclib'),
         plain text -> Whisper alone ('whisper')
       Not on LRCLIB -> Whisper alone ('whisper')

    Returns:
        dict: {lyrics, source, artist, track, language, lrclib_id, alignment_stats}
        alignment_stats: {total_words, matched_words, interpolated_words, match_rate, whisper_words}
    """
```

Progress (`lyrics_progress`): `metadata`, `lyrics_search`, `lyrics_found` / `lyrics_not_found`,
`whisper`, `whisper_done`, `aligning`, `aligned` / `align_rejected`, `done` / `failed`.

Musixmatch was removed (its unofficial desktop API stopped serving anonymous clients around
April 2026), together with `musixmatch_client.py`, `syncedlyrics_client.py`, `lyrics_aligner.py`,
`vocal_onset_detector.py` and the `syncedlyrics` dependency.

**Called by**: `extensions.py` (post-extraction, on the vocals stem, extraction progress 49-72 %) and
`POST /api/extractions/<id>/lyrics/regenerate`. `/lyrics/generate` and `/lyrics/lrclib` are
deprecated shims that redirect to `/lyrics/regenerate`.

**Performance** (Whisper side):
- CPU: 30-120 seconds per song
- GPU: 10-30 seconds per song (3-5x faster)

**File**: core/lyrics_detector.py

---

#### 12. structure_detector.py

**Status**: DEAD - no importers (`utils/analysis/reanalyze_all_structure.py` now uses
`msaf_structure_detector.py`).

**File**: core/structure_detector.py

---

#### 13. msaf_structure_detector.py

**Purpose**: MSAF structure detection (Foote boundaries + FMC2D labels)

**Size**: ~125 lines

**How it works**:
- msaf 0.1.80 uses `scipy.inf` and `scipy.signal.gaussian`, both removed from modern SciPy;
  `_patch_scipy_for_msaf()` restores them (`numpy.inf`, `scipy.signal.windows.gaussian`) before
  `import msaf`. An import failure is logged with the real error.
- Each run points msaf's `features_tmp_file` at its own temp dir (removed afterwards), so no
  `.features_msaf_tmp.json` lands in the working directory and concurrent runs don't collide.
- Sections shorter than 0.5 s (msaf repeats the final boundary) are dropped.
- FMC2D cluster ids become letters in order of first appearance (`A B C D E D E D`): sections
  that sound alike share a letter. MSAF does not name verses/choruses. `confidence` is a fixed
  1.0 placeholder. Returns None on failure or when no sections are found.
- ~30 s per song on first analysis.

**Callers**: `core/download_manager.py` (download phase), `POST /api/extractions/<id>/analyze-structure`
(`routes/media.py`), `utils/analysis/reanalyze_all_structure.py [--force] [--limit N]` (backfill)

**Usage**:
```python
from core.msaf_structure_detector import detect_song_structure_msaf

structure = detect_song_structure_msaf('audio.mp3')
# [{'start': 0.0, 'end': 18.2, 'label': 'A', 'confidence': 1.0}, ...] or None
```

**File**: core/msaf_structure_detector.py

---

#### 14. llm_structure_analyzer.py

**Status**: DEAD - no importers. `/api/extractions/<id>/analyze-structure` uses
`msaf_structure_detector.py`, not this module.

**File**: core/llm_structure_analyzer.py

---

### Authentication

#### 15. auth_db.py

**Purpose**: User authentication database

**Size**: ~264 lines

**Features**:
- User creation
- Password hashing (werkzeug)
- User authentication
- Admin user management

**User Creation**:
```python
def create_user(username, password, email=None, is_admin=False):
    """
    Create new user.

    Args:
        username: Unique username
        password: Plain text password (will be hashed)
        email: Optional email
        is_admin: Admin privileges

    Returns:
        int: User ID
    """
    from werkzeug.security import generate_password_hash

    password_hash = generate_password_hash(password)

    conn = get_db_connection()
    cursor = conn.execute(
        'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
        (username, password_hash, email, is_admin)
    )
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return user_id
```

**Authentication**:
```python
def authenticate_user(username, password):
    """
    Authenticate user with password.

    Args:
        username: Username
        password: Plain text password

    Returns:
        dict: User data if authenticated, None otherwise
    """
    from werkzeug.security import check_password_hash

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()

    if user and check_password_hash(user['password_hash'], password):
        return dict(user)

    return None
```

**File**: core/auth_db.py

---

#### 16. auth_models.py

**Purpose**: User model for Flask-Login

**Size**: ~29 lines

**User Model**:
```python
from flask_login import UserMixin

class User(UserMixin):
    def __init__(self, id, username, is_admin=False):
        self.id = id
        self.username = username
        self.is_admin = is_admin

    def get_id(self):
        return str(self.id)
```

**File**: core/auth_models.py

---

### Configuration

#### 17. config.py

**Purpose**: Configuration management

**Size**: ~495 lines

**Features**:
- Load configuration from `config.json`
- Environment variable overrides
- Default values
- GPU detection
- CUDA configuration

**Configuration Loading**:
```python
def load_config():
    """
    Load configuration from config.json.

    Returns:
        dict: Configuration
    """
    import json

    config_path = Path(__file__).parent / 'config.json'

    if config_path.exists():
        with open(config_path, 'r') as f:
            config = json.load(f)
    else:
        config = {}

    # Environment variable overrides
    config['HOST'] = os.getenv('HOST', config.get('HOST', '0.0.0.0'))
    config['PORT'] = int(os.getenv('PORT', config.get('PORT', 5011)))

    # GPU detection
    config['GPU_AVAILABLE'] = torch.cuda.is_available()
    if config['GPU_AVAILABLE']:
        config['CUDA_VERSION'] = torch.version.cuda

    return config
```

**File**: core/config.py

---

#### 18. config.json

**Purpose**: JSON configuration file

**Example**:
```json
{
    "HOST": "0.0.0.0",
    "PORT": 5011,
    "DOWNLOADS_DIR": "downloads/",
    "DATABASE_PATH": "data/stemtubes.db",
    "MAX_CONTENT_LENGTH": 524288000,
    "chords_use_madmom": true,
    "chords_use_hybrid": true,
    "default_stem_model": "htdemucs",
    "browser_logging": {
        "enabled": true,
        "log_level": "INFO"
    }
}
```

**Note**: `chords_use_madmom` and `chords_use_hybrid` are inert - chord detection is BTC only.

**File**: core/config.json

---

### Utilities

#### 19. logging_config.py

**Purpose**: Application logging configuration

**Size**: ~257 lines

**Features**:
- File logging (app.log)
- Console logging
- Log rotation
- Log levels (DEBUG, INFO, WARNING, ERROR)

**Setup**:
```python
import logging

def setup_logging():
    """Configure application logging."""
    logger = logging.getLogger('stemtube')
    logger.setLevel(logging.INFO)

    # File handler
    file_handler = logging.FileHandler('app.log')
    file_handler.setLevel(logging.INFO)

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.WARNING)

    # Formatter
    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    )

    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger
```

**File**: core/logging_config.py

---

#### 20. request_logging.py

**Purpose**: HTTP request logging

**Size**: ~147 lines

**Features**:
- Log all HTTP requests
- Request duration
- Status codes
- User agent

**Middleware**:
```python
from flask import request
import time

@app.before_request
def log_request():
    request.start_time = time.time()

@app.after_request
def log_response(response):
    duration = time.time() - request.start_time
    logger.info(f"{request.method} {request.path} - {response.status_code} - {duration:.3f}s")
    return response
```

**File**: core/request_logging.py

---

#### 21. downloads_db.py

**Purpose**: Downloads database operations

**Size**: ~1,275 lines

**Features**:
- Create/read/update/delete downloads
- User access management
- Global file deduplication
- Path resolution (migration support)

**Key Functions**:

**Find Global Download**:
```python
def find_global_download(video_id):
    """
    Find download by video_id.

    Args:
        video_id: YouTube video ID

    Returns:
        dict: Download metadata or None
    """
    with _conn() as conn:
        cursor = conn.execute(
            'SELECT * FROM global_downloads WHERE video_id = ?',
            (video_id,)
        )
        download = cursor.fetchone()

    if download:
        return _resolve_paths_in_record(dict(download))

    return None
```

**Grant User Access**:
```python
def grant_user_access(user_id, global_download_id, video_id):
    """
    Grant user access to global download.

    Args:
        user_id: User ID
        global_download_id: Global download ID
        video_id: Video ID

    Returns:
        int: User download ID
    """
    # Get global download data
    global_dl = get_global_download(global_download_id)

    with _conn() as conn:
        conn.execute('''
            INSERT INTO user_downloads
                (user_id, global_download_id, video_id, title, file_path, ...)
            VALUES (?, ?, ?, ?, ?, ...)
            ON CONFLICT(user_id, video_id, media_type) DO UPDATE SET
                title = excluded.title,
                file_path = excluded.file_path,
                ...
        ''', (user_id, global_download_id, video_id, global_dl['title'], ...))

        conn.commit()
```

**Update Extraction**:
```python
def update_extraction(video_id, extraction_data):
    """
    Update extraction data in both tables.

    Args:
        video_id: Video ID
        extraction_data: Dict with extraction metadata

    Returns:
        None
    """
    with _conn() as conn:
        # Update global_downloads
        conn.execute('''
            UPDATE global_downloads
            SET extracted = ?,
                extraction_model = ?,
                stems_paths = ?,
                chords_data = ?,
                lyrics_data = ?,
                structure_data = ?
            WHERE video_id = ?
        ''', (
            extraction_data['extracted'],
            extraction_data['extraction_model'],
            extraction_data['stems_paths'],
            extraction_data.get('chords_data'),
            extraction_data.get('lyrics_data'),
            extraction_data.get('structure_data'),
            video_id
        ))

        # Update user_downloads (all users with access)
        conn.execute('''
            UPDATE user_downloads
            SET extracted = ?,
                extraction_model = ?,
                stems_paths = ?,
                ...
            WHERE video_id = ?
        ''', (..., video_id))

        conn.commit()
```

**File**: core/downloads_db.py

---

## Processing Pipelines

### Download Pipeline

```
User Input (YouTube URL or File Upload)
    ↓
1. Check if file exists globally (deduplication)
    ↓
    [EXISTS] → Grant user access → DONE
    ↓
    [NEW]
    ↓
2. Download/Upload audio file
    ↓
3. Detect BPM (librosa autocorrelation)
    ↓
4. Detect musical key (chroma features)
    ↓
5. Chord detection (BTC only)
    ↓
6. Structure detection (MSAF - A/B/C similarity sections)
    ↓
7. Store yt-dlp media_metadata; LRCLIB lookup, line-timed preview if line-synced
    ↓
8. Save to global_downloads table
    ↓
9. Grant user access (user_downloads table)
    ↓
10. Emit WebSocket completion
    ↓
DONE
```

### Extraction Pipeline

```
User initiates extraction (video_id, model, stems)
    ↓
1. Resolve model in STEM_MODELS (engine "demucs" or "msst")
    ↓
2. Check GPU availability (msst: CUDA required, global GPU lock)
    ↓
3. Run separation subprocess
   (demucs.separate, or core.msst.separate: htdemucs_6s → DrumSep → MVSep Mega)
    ↓
    [Progress] Separating stems
    ↓
4. Save individual stem files (MP3; ZIP built on demand via /create-zip)
    ↓
5. remove_replaced_stems() (re-extraction with another model)
    ↓
6. Mark extraction complete in database
    ↓
7. Lyrics: detect_lyrics_unified() on vocals (LRCLIB + Whisper, aligned)
    ↓
8. Beats/downbeats (madmom)
    ↓
9. warm_prepare() pre-builds POC mixer artifacts
    ↓
10. Emit WebSocket completion
    ↓
DONE
```

---

## Database Operations

### Connection Management

**Context Manager** (recommended):
```python
with _conn() as conn:
    cursor = conn.execute("SELECT * FROM users")
    results = cursor.fetchall()
    # Auto-commit and close
```

**Manual**:
```python
conn = _conn()
try:
    cursor = conn.execute("SELECT * FROM users")
    results = cursor.fetchall()
    conn.commit()
finally:
    conn.close()
```

### Transaction Handling

**Automatic**:
```python
with _conn() as conn:
    conn.execute("INSERT INTO ...")
    conn.execute("UPDATE ...")
    # Both committed together or rolled back on error
    conn.commit()
```

**Manual Rollback**:
```python
conn = _conn()
try:
    conn.execute("INSERT INTO ...")
    conn.execute("UPDATE ...")
    conn.commit()
except Exception as e:
    conn.rollback()
    logger.error(f"Transaction failed: {e}")
finally:
    conn.close()
```

---

## Queue Management

### Download Queue

**Thread-based** (not currently implemented, but recommended for production):

```python
import queue
import threading

download_queue = queue.Queue()

def download_worker():
    """Worker thread to process downloads."""
    while True:
        item = download_queue.get()
        if item is None:
            break

        video_id, user_id = item

        try:
            download_audio(video_id, user_id)
        except Exception as e:
            logger.error(f"Download failed: {e}")
        finally:
            download_queue.task_done()

# Start worker threads
num_workers = 2
threads = []
for i in range(num_workers):
    t = threading.Thread(target=download_worker)
    t.start()
    threads.append(t)

# Add download to queue
download_queue.put((video_id, user_id))
```

**Current Implementation**: Synchronous (one download at a time)

---

## Best Practices

### 1. Use Type Hints

```python
# GOOD
def download_audio(video_id: str, user_id: int) -> dict:
    ...

# BAD
def download_audio(video_id, user_id):
    ...
```

### 2. Use Docstrings

```python
def detect_bpm(audio_path: str) -> float:
    """
    Detect tempo (BPM) using autocorrelation.

    Args:
        audio_path: Path to audio file

    Returns:
        float: Detected BPM (e.g., 120.5)

    Raises:
        FileNotFoundError: If audio file not found
    """
    ...
```

### 3. Handle Errors

```python
try:
    audio_data = load_audio(path)
    bpm = detect_bpm(audio_data)
except FileNotFoundError:
    logger.error(f"Audio file not found: {path}")
    raise
except Exception as e:
    logger.error(f"BPM detection failed: {e}")
    return None
```

### 4. Use Context Managers

```python
# GOOD
with _conn() as conn:
    cursor = conn.execute("...")

# BAD
conn = _conn()
cursor = conn.execute("...")
conn.close()  # Easy to forget!
```

### 5. Use Logging

```python
import logging

logger = logging.getLogger(__name__)

logger.info("Download started")
logger.warning("GPU not available, using CPU")
logger.error("Download failed", exc_info=True)
```

---

## Next Steps

- [API Reference](API-REFERENCE.md) - All endpoints
- [Frontend Guide](FRONTEND-GUIDE.md) - JavaScript modules
- [Database Schema](DATABASE-SCHEMA.md) - Database structure
- [Architecture Guide](ARCHITECTURE.md) - System design

---

**Backend Version**: 2.0
**Last Updated**: December 2025
**Total Modules**: 21 Python files
**Total Lines**: ~10,800 lines
