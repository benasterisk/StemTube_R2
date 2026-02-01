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
- madmom (music analysis)
- faster-whisper (lyrics transcription)
- MSAF (structure analysis)
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
├── stems_extractor.py          # Demucs stem extraction
├── demucs_wrapper.py           # Demucs CLI wrapper
├── wrap_demucs.py              # Demucs process wrapper
│
├── chord_detector.py           # Chord detection manager
├── btc_chord_detector.py       # BTC Transformer (170 vocab)
├── madmom_chord_detector.py    # madmom CRF (24 types)
├── hybrid_chord_detector.py    # Hybrid fallback detector
│
├── lyrics_detector.py          # faster-whisper lyrics
├── structure_detector.py       # Structure analysis manager
├── msaf_structure_detector.py  # MSAF structure detector
├── llm_structure_analyzer.py   # LLM-based analyzer
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

**Purpose**: Demucs stem extraction orchestration

**Size**: ~1,190 lines

**Key Features**:
- Demucs model selection (htdemucs, htdemucs_6s)
- Stem selection (vocals, drums, bass, other, guitar, piano)
- GPU acceleration
- Progress tracking via WebSocket
- Automatic chord/lyrics/structure analysis

**Extraction Pipeline**:
```python
def extract_stems(video_id, model='htdemucs', stems=None, user_id=None):
    """
    Extract stems using Demucs.

    Pipeline:
    1. Load audio file
    2. Run Demucs separation
    3. Save individual stems
    4. Generate chord detection
    5. Generate lyrics transcription
    6. Generate structure analysis
    7. Update database
    8. Emit completion via WebSocket

    Args:
        video_id: Video ID to extract
        model: Demucs model ('htdemucs' or 'htdemucs_6s')
        stems: List of stems to extract (default: all)
        user_id: User ID for progress updates

    Returns:
        dict: Extraction results
    """
    from demucs import separate
    import torch

    # Get download
    download = find_global_download(video_id)
    audio_path = download['file_path']

    # Emit progress: Starting
    emit_progress(user_id, 0, 'Initializing Demucs...')

    # Run Demucs
    output_dir = f'downloads/global/{video_id}/stems/{model}/'
    os.makedirs(output_dir, exist_ok=True)

    # Check GPU availability
    device = 'cuda' if torch.cuda.is_available() else 'cpu'

    # Separate stems
    emit_progress(user_id, 25, 'Separating stems...')
    separate.main([
        '--two-stems', 'vocals',  # Or select specific stems
        '-n', model,
        '-o', output_dir,
        '--device', device,
        audio_path
    ])

    # Save stems paths
    stems_paths = {
        'vocals': os.path.join(output_dir, 'vocals.wav'),
        'drums': os.path.join(output_dir, 'drums.wav'),
        'bass': os.path.join(output_dir, 'bass.wav'),
        'other': os.path.join(output_dir, 'other.wav')
    }

    if model == 'htdemucs_6s':
        stems_paths.update({
            'guitar': os.path.join(output_dir, 'guitar.wav'),
            'piano': os.path.join(output_dir, 'piano.wav')
        })

    # Chord detection
    emit_progress(user_id, 50, 'Detecting chords...')
    chords = detect_chords(audio_path, backend='btc')

    # Lyrics transcription
    emit_progress(user_id, 75, 'Transcribing lyrics...')
    lyrics = transcribe_lyrics(stems_paths['vocals'])

    # Structure analysis
    emit_progress(user_id, 90, 'Analyzing structure...')
    structure = analyze_structure(audio_path)

    # Update database
    update_extraction(video_id, {
        'extracted': True,
        'extraction_model': model,
        'stems_paths': json.dumps(stems_paths),
        'chords_data': json.dumps(chords),
        'lyrics_data': json.dumps(lyrics),
        'structure_data': json.dumps(structure)
    })

    # Emit completion
    emit_progress(user_id, 100, 'Complete!')
    emit_complete(user_id, video_id, stems_paths)

    return stems_paths
```

**Model Selection**:
- `htdemucs`: 4-stem (vocals, drums, bass, other) - Faster, general-purpose
- `htdemucs_6s`: 6-stem (adds guitar, piano) - Slower, better for instrumental music

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

**Purpose**: Chord detection manager (3 backends)

**Size**: ~530 lines

**Backends**:
1. BTC Transformer (170 chord vocabulary)
2. madmom CRF (24 chord types)
3. Hybrid detector (fallback combination)

**Detection**:
```python
def detect_chords(audio_path, backend='btc'):
    """
    Detect chords using specified backend.

    Args:
        audio_path: Path to audio file
        backend: 'btc', 'madmom', or 'hybrid'

    Returns:
        list: [{'timestamp': 0.0, 'chord': 'C:maj'}, ...]
    """
    if backend == 'btc':
        from core.btc_chord_detector import BTCChordDetector
        detector = BTCChordDetector()
    elif backend == 'madmom':
        from core.madmom_chord_detector import MadmomChordDetector
        detector = MadmomChordDetector()
    elif backend == 'hybrid':
        from core.hybrid_chord_detector import HybridChordDetector
        detector = HybridChordDetector()
    else:
        raise ValueError(f"Unknown backend: {backend}")

    chords = detector.detect(audio_path)

    return chords
```

**File**: core/chord_detector.py

---

#### 8. btc_chord_detector.py

**Purpose**: BTC Transformer chord detection (170 vocabulary)

**Size**: ~230 lines

**Model**: External dependency - `../essentiatest/BTC-ISMIR19`

**Vocabulary**: 170 chord types (major, minor, 7th, 9th, 11th, 13th, sus, add, dim, aug, etc.)

**Usage**:
```python
from core.btc_chord_detector import BTCChordDetector

detector = BTCChordDetector()
chords = detector.detect('audio.mp3')

# Output: [{'timestamp': 0.0, 'chord': 'C:maj7'}, {'timestamp': 2.5, 'chord': 'Am9'}, ...]
```

**Genres**: All genres, especially jazz/complex harmonies

**File**: core/btc_chord_detector.py

---

#### 9. madmom_chord_detector.py

**Purpose**: madmom CRF chord detection (24 types)

**Size**: ~245 lines

**Model**: Built-in madmom trained model

**Vocabulary**: 24 chord types:
- Major: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- Minor: Cm, C#m, Dm, D#m, Em, Fm, F#m, Gm, G#m, Am, A#m, Bm
- No chord: N

**Usage**:
```python
from core.madmom_chord_detector import MadmomChordDetector

detector = MadmomChordDetector()
chords = detector.detect('audio.mp3')

# Output: [{'timestamp': 0.0, 'chord': 'C:maj'}, {'timestamp': 2.5, 'chord': 'Am'}, ...]
```

**Accuracy**: Professional-grade (Chordify/Moises level)

**Genres**: Pop, rock, folk, country

**File**: core/madmom_chord_detector.py

---

#### 10. hybrid_chord_detector.py

**Purpose**: Hybrid fallback chord detector

**Size**: ~600 lines

**Strategy**:
1. Try BTC Transformer
2. If unavailable, try madmom
3. Combine results with confidence weighting

**Usage**:
```python
from core.hybrid_chord_detector import HybridChordDetector

detector = HybridChordDetector()
chords = detector.detect('audio.mp3')
```

**File**: core/hybrid_chord_detector.py

---

#### 11. lyrics_detector.py

**Purpose**: Lyrics transcription using faster-whisper

**Size**: ~280 lines

**Model**: faster-whisper (Whisper v2/v3)

**Features**:
- Word-level timestamps
- GPU acceleration
- Multiple languages (English best)

**Transcription**:
```python
def transcribe_lyrics(vocals_path, model_size='base'):
    """
    Transcribe lyrics from vocals stem.

    Args:
        vocals_path: Path to vocals audio file
        model_size: 'tiny', 'base', 'small', 'medium', 'large'

    Returns:
        list: [
            {
                'start': 0.0,
                'end': 2.5,
                'text': 'First line of lyrics',
                'words': [
                    {'start': 0.0, 'end': 0.5, 'word': 'First'},
                    {'start': 0.6, 'end': 1.0, 'word': 'line'},
                    ...
                ]
            },
            ...
        ]
    """
    from faster_whisper import WhisperModel

    # Load model
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = WhisperModel(model_size, device=device, compute_type='float16')

    # Transcribe
    segments, info = model.transcribe(vocals_path, word_timestamps=True)

    lyrics = []
    for segment in segments:
        lyrics.append({
            'start': segment.start,
            'end': segment.end,
            'text': segment.text,
            'words': [
                {'start': w.start, 'end': w.end, 'word': w.word}
                for w in segment.words
            ]
        })

    return lyrics
```

**Performance**:
- CPU: 30-120 seconds per song
- GPU: 10-30 seconds per song (3-5x faster)

**File**: core/lyrics_detector.py

---

#### 12. structure_detector.py

**Purpose**: Structure analysis manager

**Size**: ~247 lines

**Backends**:
1. MSAF (Music Structure Analysis Framework)
2. LLM-based analyzer (experimental)

**Detection**:
```python
def analyze_structure(audio_path, backend='msaf'):
    """
    Analyze song structure.

    Args:
        audio_path: Path to audio file
        backend: 'msaf' or 'llm'

    Returns:
        list: [
            {'start': 0.0, 'end': 8.0, 'label': 'intro'},
            {'start': 8.0, 'end': 32.0, 'label': 'verse'},
            {'start': 32.0, 'end': 56.0, 'label': 'chorus'},
            ...
        ]
    """
    if backend == 'msaf':
        from core.msaf_structure_detector import detect_structure_msaf
        return detect_structure_msaf(audio_path)
    elif backend == 'llm':
        from core.llm_structure_analyzer import analyze_with_llm
        return analyze_with_llm(audio_path)
    else:
        raise ValueError(f"Unknown backend: {backend}")
```

**File**: core/structure_detector.py

---

#### 13. msaf_structure_detector.py

**Purpose**: MSAF structure detection

**Size**: ~63 lines

**Algorithm**: MSAF automatic segmentation

**Sections**: intro, verse, chorus, bridge, outro, instrumental, other

**Usage**:
```python
from core.msaf_structure_detector import detect_structure_msaf

structure = detect_structure_msaf('audio.mp3')
```

**File**: core/msaf_structure_detector.py

---

#### 14. llm_structure_analyzer.py

**Purpose**: LLM-based structure analysis (experimental)

**Size**: ~280 lines

**Note**: Requires LLM API (e.g., OpenAI, Claude)

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
    "chord_backend": "btc",
    "default_model": "htdemucs",
    "browser_logging": {
        "enabled": true,
        "log_level": "INFO"
    }
}
```

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
5. Save to global_downloads table
    ↓
6. Grant user access (user_downloads table)
    ↓
7. Emit WebSocket completion
    ↓
DONE
```

### Extraction Pipeline

```
User initiates extraction (video_id, model, stems)
    ↓
1. Load audio file
    ↓
2. Initialize Demucs model (htdemucs or htdemucs_6s)
    ↓
3. Check GPU availability
    ↓
4. Run Demucs separation
    ↓
    [Progress: 0-40%] Separating stems
    ↓
5. Save individual stem files (.wav)
    ↓
    [Progress: 40-60%] Detecting chords
    ↓
6. Chord detection (BTC/madmom/hybrid)
    ↓
    [Progress: 60-80%] Transcribing lyrics
    ↓
7. Lyrics transcription (faster-whisper)
    ↓
    [Progress: 80-95%] Analyzing structure
    ↓
8. Structure analysis (MSAF)
    ↓
    [Progress: 95-100%] Saving to database
    ↓
9. Update database with results
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
