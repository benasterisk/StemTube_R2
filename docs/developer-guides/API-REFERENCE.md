# StemTube API Reference

Documentation of the StemTube HTTP API endpoints and WebSocket events.

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [WebSocket Events](#websocket-events)
- [Routes - Pages](#routes---pages)
- [API - Search & Video](#api---search--video)
- [API - Downloads](#api---downloads)
- [API - Extractions](#api---extractions)
- [API - User Management](#api---user-management)
- [API - Admin](#api---admin)
- [API - Configuration](#api---configuration)
- [API - Files & Storage](#api---files--storage)
- [API - Library](#api---library)
- [API - Recordings](#api---recordings)
- [API - POC Mixer](#api---poc-mixer)
- [API - Logging](#api---logging)
- [Known Gaps](#known-gaps)

---

## Overview

**Base URL**: `http://localhost:5011` (or ngrok HTTPS URL)

**Total Endpoints**: ~115 route decorators
- HTTP routes live in Flask blueprints under `routes/*.py`, plus `mobile_routes.py` (`app.py`
  registers them via `register_all_blueprints()`)
- Plus SocketIO events (core progress events + jam session events in `routes/jam.py`)
- Not every route is documented below; see [Known Gaps](#known-gaps) for routes that are
  present but unused, and deprecated shims

**Note on `File:` references**: the `app.py:<line>` references below predate the split of
`app.py` into blueprints. The handlers now live in the matching `routes/*.py` module.

**Authentication**:
- Session-based (Flask-Login)
- Most endpoints require login
- Admin endpoints require admin role

**Response Format**: JSON (unless specified otherwise)

**Error Handling**:
```json
{
  "error": "Error message"
}
```

---

## Authentication

### POST /login

User login with credentials.

**Request**:
```json
{
  "username": "administrator",
  "password": "password",
  "remember": true
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "username": "administrator",
  "is_admin": true
}
```

**Errors**:
- 401: Invalid credentials
- 400: Missing username/password

**File**: app.py:752

---

### GET /logout

Logout current user.

**Response**: 302 Redirect to /login

**File**: app.py:775

---

## WebSocket Events

### Event: connect

Client connects to WebSocket.

**Emitted**: Automatically on connection

**Action**: Join user-specific room (`user_{user_id}`)

**File**: app.py:682

---

### Event: disconnect

Client disconnects from WebSocket.

**Emitted**: Automatically on disconnect

**Action**: Leave user room, cleanup

**File**: app.py:691

---

## Server-Emitted WebSocket Events

### download_progress

Real-time download progress updates.

**Data**:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "progress": 75.5,
  "speed": "1.5 MB/s",
  "eta": "00:30",
  "status": "downloading"
}
```

**Room**: `user_{user_id}`

---

### extraction_progress

Real-time extraction progress updates.

**Data**:
```json
{
  "extraction_id": 123,
  "progress": 50,
  "status": "extracting",
  "message": "Processing stems..."
}
```

**Room**: `user_{user_id}`

---

### extraction_complete

Extraction finished notification.

**Data**:
```json
{
  "extraction_id": 123,
  "video_id": "dQw4w9WgXcQ",
  "status": "completed",
  "stems_paths": {
    "vocals": "/path/to/vocals.wav",
    "drums": "/path/to/drums.wav",
    "bass": "/path/to/bass.wav",
    "other": "/path/to/other.wav"
  }
}
```

**Room**: `user_{user_id}`

---

## Routes - Pages

### GET /

Main application page (desktop).

**Auth**: Required

**Response**: HTML template (index.html)

**File**: app.py:723

---

### GET /mobile

Mobile-optimized interface.

**Auth**: Required

**Response**: HTML template (mobile-index.html)

**File**: app.py:740

---

### GET /mixer

Interactive mixer interface (POC engine, fed by the `/poc-mixer/*` routes).

**Auth**: Required

**Query Parameters**:
- `extraction_id`: Extraction to load (e.g. `download_42`)
- `stage` (optional): `lyrics` or `chords` - opens the page as a display-only stage window

**Response**: HTML template (mixer.html). The page receives an `EXTRACTION_INFO` object (chords,
beat grid, `music_start_time`, `structure_data`, ...); `structure-display.js` renders its
`structure_data` in the structure bar.

**File**: routes/pages.py

---

### GET /admin

Admin dashboard.

**Auth**: Required (admin only)

**Response**: HTML template (admin.html)

**Errors**:
- 403: Not admin user

**File**: app.py:782

---

### GET /admin/embedded

Embedded admin panel (for iframe).

**Auth**: Required (admin only)

**Response**: HTML template (admin_embedded.html)

**File**: app.py:788

---

### GET /admin/mobile-settings

Mobile admin settings panel.

**Status**: Unused - the page exists but nothing links to it.

**Auth**: Required (admin only)

**Response**: HTML template

**File**: routes/admin.py

---

## API - Search & Video

### GET /api/search

Search YouTube for videos.

**Auth**: Required

**Query Parameters**:
- `q` (required): Search query

**Request**:
```
GET /api/search?q=test+song
```

**Response** (200 OK):
```json
{
  "results": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "Song Title",
      "author": "Artist Name",
      "duration": "3:45",
      "thumbnails": [
        {
          "url": "https://...",
          "width": 1280,
          "height": 720
        }
      ]
    }
  ]
}
```

**File**: app.py:942

---

### GET /api/video/<video_id>

Get detailed video information.

**Auth**: Required

**Request**:
```
GET /api/video/dQw4w9WgXcQ
```

**Response** (200 OK):
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "Song Title",
  "author": "Artist Name",
  "duration": "3:45",
  "thumbnails": [...],
  "description": "Video description"
}
```

**File**: app.py:958

---

## API - Downloads

### GET /api/downloads

List all downloads accessible to user.

**Auth**: Required

**Response** (200 OK):
```json
{
  "downloads": [
    {
      "id": 1,
      "video_id": "dQw4w9WgXcQ",
      "title": "Song Title",
      "duration": 225,
      "file_path": "/path/to/audio.m4a",
      "file_size": 5242880,
      "download_date": "2025-12-28T10:30:00",
      "has_extraction": true,
      "extraction_id": 10,
      "extraction_status": "completed",
      "stems_available": ["vocals", "drums", "bass", "other"],
      "chords_available": true,
      "lyrics_available": true,
      "structure_available": false
    }
  ]
}
```

**File**: app.py:965

---

### GET /api/downloads/<download_id>

Get specific download details.

**Auth**: Required

**Response** (200 OK):
```json
{
  "id": 1,
  "video_id": "dQw4w9WgXcQ",
  "title": "Song Title",
  "duration": 225,
  "file_path": "/path/to/audio.m4a",
  "file_size": 5242880,
  "bpm": 120,
  "key": "C major",
  "has_extraction": true,
  "extraction": {
    "id": 10,
    "model": "htdemucs",
    "status": "completed",
    "stems": ["vocals", "drums", "bass", "other"]
  }
}
```

**File**: app.py:1071

---

### GET /api/downloads/<video_id>/extraction-status

Check extraction status for a download.

**Auth**: Required

**Response** (200 OK):
```json
{
  "status": "completed",
  "extraction_id": 10,
  "progress": 100,
  "message": "Extraction complete",
  "stems_paths": {
    "vocals": "/path/to/vocals.wav",
    "drums": "/path/to/drums.wav",
    "bass": "/path/to/bass.wav",
    "other": "/path/to/other.wav"
  }
}
```

**Statuses**:
- `not_started`: No extraction initiated
- `extracting`: In progress
- `completed`: Finished successfully
- `failed`: Error occurred

**File**: app.py:1092

---

### POST /api/downloads

Download audio from YouTube.

**Auth**: Required

**Request**:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Either `video_id` or `url` required**

**Response** (200 OK):
```json
{
  "success": true,
  "video_id": "dQw4w9WgXcQ",
  "title": "Song Title",
  "download_started": true,
  "global_download_id": 1
}
```

**Errors**:
- 400: Missing video_id/url
- 500: Download failed

**File**: app.py:1163

---

### DELETE /api/downloads/<download_id>

Delete a download.

**Auth**: Required (admin for global downloads)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Download deleted"
}
```

**File**: app.py:1250

---

### POST /api/downloads/<download_id>/retry

Retry failed download.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Download retry initiated"
}
```

**File**: app.py:1256

---

### DELETE /api/downloads/<download_id>/delete

Force delete download (admin).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_files": 5
}
```

**File**: app.py:1293

---

### DELETE /api/downloads/clear-all

Clear all downloads for current user.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_count": 10
}
```

**File**: app.py:1351

---

## API - Extractions

### GET /api/extractions

List all extractions accessible to user.

**Auth**: Required

**Response** (200 OK):
```json
{
  "extractions": [
    {
      "id": 10,
      "video_id": "dQw4w9WgXcQ",
      "title": "Song Title",
      "model": "htdemucs",
      "status": "completed",
      "stems": ["vocals", "drums", "bass", "other"],
      "extraction_date": "2025-12-28T11:00:00",
      "chords_available": true,
      "lyrics_available": true,
      "structure_available": false
    }
  ]
}
```

**File**: app.py:1418

---

### GET /api/extractions/<extraction_id>

Get specific extraction details.

**Auth**: Required

**Response** (200 OK):
```json
{
  "id": 10,
  "video_id": "dQw4w9WgXcQ",
  "title": "Song Title",
  "model": "htdemucs",
  "status": "completed",
  "stems_paths": {
    "vocals": "/path/to/vocals.wav",
    "drums": "/path/to/drums.wav",
    "bass": "/path/to/bass.wav",
    "other": "/path/to/other.wav"
  },
  "chords": [...],
  "lyrics": {...},
  "structure": [...]
}
```

**File**: app.py:1514

---

### POST /api/extractions

Start stem extraction.

**Auth**: Required

**Request**:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "model_name": "htdemucs",
  "force_reextract": false
}
```

**Models** (`STEM_MODELS` in `core/config.py`):
- `htdemucs`: 4-stem (vocals, drums, bass, other)
- `htdemucs_ft`: 4-stem, fine-tuned
- `htdemucs_6s`: 6-stem (adds guitar, piano)
- `mdx_extra`: 4-stem
- `mdx_extra_q`: 4-stem - unreachable (disabled in both templates, `diffq` not installed)
- `mvsep_mega_fine`: 17 fine stems (engine `msst`, CUDA only, min 6 GB VRAM)

**Re-extraction**: `force_reextract: true` with a different model replaces the previous stems
(`remove_replaced_stems()` in `extensions.py`). After extraction, `warm_prepare()` pre-builds the
mixer artifacts.

**Note**: `structure_data` is filled at download time (MSAF sections labelled A, B, C... by
similarity), not by extraction; see `POST /api/extractions/<extraction_id>/analyze-structure`.

**Response** (200 OK):
```json
{
  "success": true,
  "extraction_id": 10,
  "video_id": "dQw4w9WgXcQ",
  "message": "Extraction started"
}
```

**File**: app.py:1589

---

### DELETE /api/extractions/<extraction_id>

Delete an extraction.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Extraction deleted"
}
```

**File**: app.py:1735

---

### POST /api/extractions/<extraction_id>/retry

Retry failed extraction.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Extraction retry initiated"
}
```

**File**: app.py:1741

---

### DELETE /api/extractions/<extraction_id>/delete

Force delete extraction (admin).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_files": 8
}
```

**File**: app.py:1785

---

### POST /api/extractions/<extraction_id>/create-zip

Create ZIP archive of stems.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "zip_path": "/path/to/stems.zip",
  "download_url": "/api/download-file?path=..."
}
```

**File**: app.py:1821

---

### GET /api/extractions/<extraction_id>/lyrics

Get lyrics for extraction.

**Auth**: Required

**Response** (200 OK):
```json
{
  "lyrics": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "First line of lyrics",
      "words": [
        {"start": 0.0, "end": 0.5, "word": "First"},
        {"start": 0.6, "end": 1.0, "word": "line"}
      ]
    }
  ],
  "available": true
}
```

**File**: app.py:1870

---

### POST /api/extractions/<extraction_id>/chords/regenerate

Regenerate chord detection.

**Auth**: Required

**Request**: No body. There is no backend selection: chord detection is BTC Transformer only
(170 vocab). The `chords_use_madmom` / `chords_use_hybrid` config keys are not read.

**Response** (200 OK):
```json
{
  "success": true,
  "chords": [...],
  "detected_bpm": 120.0,
  "beat_offset": 0.52,
  "beat_times": [0.52, 1.02, ...],
  "beat_positions": [1, 2, 3, 4, ...]
}
```

**Beat grid**: BTC detects no beats, so this route stores only `chords_data` and leaves the beat
grid and Skip Intro (`music_start_time`) untouched. `beat_offset`, `beat_times` and
`beat_positions` in the response are the **stored** values, so clients keep their metronome
alignment.

**File**: routes/media.py

---

### POST /api/extractions/<extraction_id>/beats/regenerate

Regenerate beat and downbeat timestamps with madmom.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "beat_times": [0.52, 1.02, ...],
  "beat_positions": [1, 2, 3, 4, ...],
  "beat_offset": 0.52,
  "beat_count": 412
}
```

Stores the freshly detected beat grid (`beat_times`, `beat_positions`, `beat_offset`) and keeps
Skip Intro (`music_start_time` is not passed, so `COALESCE` preserves it).

**File**: routes/media.py

---

### POST /api/extractions/<extraction_id>/analyze-structure

Detect song sections with MSAF (Foote boundaries + FMC2D labels) and store them as
`structure_data`. Takes ~30 s on a song analyzed for the first time.

**Auth**: Required

**Request**: No body. `extraction_id` may be `download_<id>`, a video ID or a filename prefix.

**Response** (200 OK):
```json
{
  "success": true,
  "structure": {
    "sections": [
      {"start": 0.0, "end": 18.2, "label": "A", "confidence": 1.0},
      {"start": 18.2, "end": 45.6, "label": "B", "confidence": 1.0},
      {"start": 45.6, "end": 71.3, "label": "A", "confidence": 1.0}
    ]
  },
  "sections_count": 3
}
```

Labels are similarity clusters as letters in order of first appearance - sections that sound
alike share a letter. MSAF does not name verses or choruses. `confidence` is a fixed placeholder.
Only `structure_data` is written; all other analysis fields are preserved.

**Errors**: `404` extraction or audio file not found, `400` no video ID, `500` detection failed.

**File**: routes/media.py

---

### POST /api/extractions/<extraction_id>/lyrics/regenerate

Regenerate lyrics: faster-whisper transcription and Musixmatch fetch run in parallel, then merge
(Musixmatch text + Whisper word timestamps). Emits `lyrics_progress` SocketIO events.

**Auth**: Required

**Request** (all optional):
```json
{
  "artist": "Override artist",
  "track": "Override track",
  "force_whisper": false,
  "musixmatch_track_id": 12345
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "lyrics": [...],
  "source": "...",
  "artist": "Artist Name",
  "track": "Song Title",
  "segments_count": 25
}
```

**File**: routes/media.py

---

### POST /api/extractions/<extraction_id>/lyrics/generate

**Deprecated** shim - redirects to `/lyrics/regenerate`. `POST .../lyrics/lrclib` is the same
deprecated shim.

**File**: routes/media.py

---

## API - User Management

### DELETE /api/user/downloads/<video_id>/remove-from-list

Remove download from user's list (not delete file).

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Removed from your list"
}
```

**File**: app.py:2152

---

### DELETE /api/user/extractions/<video_id>/remove-from-list

Remove extraction from user's list.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:2181

---

### POST /api/user/downloads/bulk-remove-from-list

Bulk remove downloads from user's list.

**Auth**: Required

**Request**:
```json
{
  "video_ids": ["video1", "video2", "video3"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "removed_count": 3
}
```

**File**: app.py:2210

---

### POST /api/user/extractions/bulk-remove-from-list

Bulk remove extractions from user's list.

**Auth**: Required

**Request**:
```json
{
  "video_ids": ["video1", "video2"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "removed_count": 2
}
```

**File**: app.py:2253

---

### DELETE /api/user/downloads/<video_id>/force-remove

Force remove download including files (admin).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_files": 10
}
```

**File**: app.py:2297

---

### POST /api/user/cleanup/comprehensive

Comprehensive cleanup of user data.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "removed_downloads": 5,
  "removed_extractions": 3,
  "removed_orphaned_files": 2
}
```

**File**: app.py:2335

---

### GET /api/user/disclaimer-status

Check if user accepted disclaimer.

**Auth**: Required

**Response** (200 OK):
```json
{
  "accepted": true,
  "accepted_at": "2025-12-28T10:00:00"
}
```

**File**: app.py:3044

---

### POST /api/user/accept-disclaimer

Accept usage disclaimer.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:3055

---

## API - Admin

### POST /admin/add_user

Create new user (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "username": "newuser",
  "password": "password123",
  "is_admin": false
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "user_id": 5,
  "username": "newuser"
}
```

**File**: app.py:795

---

### POST /admin/edit_user

Edit existing user (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "user_id": 5,
  "username": "updateduser",
  "is_admin": false
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:812

---

### POST /admin/reset_password

Reset user password (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "user_id": 5,
  "new_password": "newpassword123"
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:829

---

### POST /admin/delete_user

Delete user (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "user_id": 5
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_user": "username"
}
```

**File**: app.py:844

---

### GET /api/admin/cleanup/downloads

List all downloads (admin view).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "downloads": [
    {
      "global_download_id": 1,
      "video_id": "dQw4w9WgXcQ",
      "title": "Song Title",
      "file_size": 5242880,
      "users_with_access": ["user1", "user2"]
    }
  ]
}
```

**File**: app.py:2543

---

### GET /api/admin/cleanup/storage-stats

Get storage statistics (admin only).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "total_downloads": 50,
  "total_extractions": 30,
  "total_size_bytes": 1073741824,
  "total_size_gb": 1.0,
  "downloads_by_user": {
    "user1": 10,
    "user2": 5
  }
}
```

**File**: app.py:2558

---

### DELETE /api/admin/cleanup/downloads/<video_id>

Delete download globally (admin only).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_files": 15
}
```

**File**: app.py:2592

---

### POST /api/admin/cleanup/downloads/<video_id>/reload

Reload download metadata (admin only).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "updated_metadata": {
    "title": "Updated Title",
    "duration": 225
  }
}
```

**File**: app.py:2636

---

### POST /api/admin/cleanup/downloads/<int:global_download_id>/reset-extraction

Reset extraction status (admin only, by global_download_id).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "extraction_id": 10
}
```

**File**: app.py:2730

---

### POST /api/admin/cleanup/downloads/<video_id>/reset-extraction

Reset extraction status (admin only, by video_id).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:2770

---

### POST /api/admin/cleanup/downloads/bulk-delete

Bulk delete downloads (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "video_ids": ["video1", "video2", "video3"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "deleted_count": 3,
  "total_files_deleted": 45
}
```

**File**: app.py:2813

---

### POST /api/admin/cleanup/downloads/bulk-reset

Bulk reset extractions (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "video_ids": ["video1", "video2"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "reset_count": 2
}
```

**File**: app.py:2880

---

## API - Configuration

### GET /api/config

Get application configuration.

**Auth**: Required

**Response** (200 OK):
```json
{
  "theme": "dark",
  "downloads_directory": "/path/to/downloads",
  "max_concurrent_downloads": 3,
  "use_gpu_for_extraction": true,
  "default_stem_model": "htdemucs",
  "ffmpeg_path": "/path/to/ffmpeg",
  "using_gpu": true,
  "mega_available": true
}
```

(Abridged; there is no chord backend setting - chords are BTC only.)

**File**: app.py:2950

---

### POST /api/config

Update configuration (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "default_stem_model": "htdemucs_6s",
  "use_gpu_for_extraction": true
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:2966

---

### GET /api/config/ffmpeg/check

Check FFmpeg installation.

**Auth**: Required

**Response** (200 OK):
```json
{
  "installed": true,
  "version": "4.4.2"
}
```

**File**: app.py:2981

---

### POST /api/config/ffmpeg/download

Download and install FFmpeg (admin only).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "success": true,
  "version": "4.4.2"
}
```

**File**: app.py:2986

---

### GET /api/config/browser-logging

Get browser logging configuration.

**Auth**: Required

**Response** (200 OK):
```json
{
  "enabled": true,
  "log_level": "INFO"
}
```

**File**: app.py:2991

---

### POST /api/config/browser-logging

Update browser logging configuration (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "enabled": false,
  "log_level": "ERROR"
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:3002

---

## API - Files & Storage

### POST /api/open-folder

Open folder in file explorer (localhost only).

**Auth**: Required

**Request**:
```json
{
  "path": "/path/to/folder"
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**Errors**:
- 403: Not localhost

**File**: app.py:3069

---

### POST /api/upload-file

Upload audio file.

**Auth**: Required

**Request**: multipart/form-data
- `file`: Audio file (MP3, WAV, FLAC, etc.)

**Response** (200 OK):
```json
{
  "success": true,
  "video_id": "upload_unique_id",
  "filename": "song.mp3",
  "file_size": 5242880
}
```

**Max Size**: 500 MB (configurable)

**File**: app.py:3102

---

### GET /api/download-file

Download file from server.

**Auth**: Required

**Query Parameters**:
- `path` (required): File path

**Request**:
```
GET /api/download-file?path=/path/to/file.mp3
```

**Response**: File download (binary)

**File**: app.py:3203

---

### GET /api/stream-audio

Stream audio file.

**Auth**: Required

**Query Parameters**:
- `path` (required): File path

**Request**:
```
GET /api/stream-audio?path=/path/to/audio.m4a
```

**Response**: Audio stream (supports range requests)

**File**: app.py:3239

---

### POST /api/list-files

List files in directory.

**Auth**: Required

**Request**:
```json
{
  "path": "/downloads/global/video_id/"
}
```

**Response** (200 OK):
```json
{
  "files": [
    {
      "name": "audio.m4a",
      "path": "/downloads/global/video_id/audio.m4a",
      "size": 5242880,
      "is_directory": false
    },
    {
      "name": "stems",
      "path": "/downloads/global/video_id/stems",
      "is_directory": true
    }
  ]
}
```

**File**: app.py:3275

---

### GET /api/extracted_stems/<extraction_id>/<stem_name>

Stream extracted stem file.

**Auth**: Required

**Methods**: GET, HEAD (for range requests)

**Request**:
```
GET /api/extracted_stems/10/vocals
```

**Response**: Audio stream (WAV format)

**Supports**:
- Range requests (for seeking)
- HEAD requests (for metadata)

**File**: app.py:3313

---

## API - Library

### GET /api/library

Get global library (all downloads).

**Auth**: Required

**Response** (200 OK):
```json
{
  "library": [
    {
      "global_download_id": 1,
      "video_id": "dQw4w9WgXcQ",
      "title": "Song Title",
      "duration": 225,
      "has_extraction": true,
      "user_has_access": false,
      "can_add_to_library": true
    }
  ]
}
```

**File**: app.py:3433

---

### POST /api/library/<int:global_download_id>/add-download

Add download from global library to user library.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Added to your library"
}
```

**File**: app.py:3549

---

### POST /api/library/<int:global_download_id>/add-extraction

Add extraction from global library to user library.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "extraction_id": 10
}
```

**File**: app.py:3588

---

## API - Recordings

### POST /api/recordings

Upload a WAV recording with metadata.

**Auth**: Required

**Content-Type**: `multipart/form-data`

**Form Data**:
- `file` (required): WAV audio file
- `download_id` (required): Extraction/download ID to associate with
- `name` (optional): Recording name (default: "Recording")
- `start_offset` (optional): Timeline position in seconds where recording starts (default: 0)

**Response** (201):
```json
{
  "success": true,
  "id": "a1b2c3d4e5f67890",
  "name": "Recording 1",
  "start_offset": 12.5,
  "filename": "a1b2c3d4e5f67890.wav"
}
```

**File**: routes/recordings.py

---

### POST /api/recordings/convert

Convert a browser recording take that the browser cannot decode into WAV. Fallback used by
`RecordingUtils.decodeAudioBlob()` (`static/js/recording-utils.js`), mostly on iOS. Nothing is
stored.

**Auth**: Required

**Content-Type**: `multipart/form-data`

**Form Data**:
- `audio` (required): the recorded take in any browser recording container (WebM/Opus, MP4/AAC,
  Ogg). The format is detected by ffmpeg from the content, not the filename.

**Response** (200): raw 16-bit PCM WAV bytes, `Content-Type: audio/wav`, `Cache-Control: no-store`

**Errors** (JSON `{"error": "..."}`):
- `400`: no `audio` field, or empty file
- `413`: upload over 64 MB, or WAV result over 512 MB
- `415`: non-audio MIME type (accepted: `audio/*`, `video/webm`, `video/mp4`, `video/quicktime`,
  `video/ogg`, `application/ogg`, `application/octet-stream`, empty)
- `422`: ffmpeg could not decode the file, or it has no audio track
- `500`: ffmpeg could not be run
- `504`: ffmpeg timed out (120 s)

**File**: routes/recordings.py

---

### GET /api/recordings/:download_id

List all recordings for the current user and download.

**Auth**: Required

**Response** (200):
```json
{
  "success": true,
  "recordings": [
    {
      "id": "a1b2c3d4e5f67890",
      "name": "Recording 1",
      "start_offset": 12.5,
      "url": "/api/recordings/a1b2c3d4e5f67890/file",
      "created_at": "2026-02-17 10:30:00"
    }
  ]
}
```

**File**: routes/recordings.py

---

### GET /api/recordings/:recording_id/file

Serve a recording WAV file. Owner-only access with path traversal protection.

**Auth**: Required (owner only)

**Response**: WAV audio file (`audio/wav`)

**File**: routes/recordings.py

---

### PUT /api/recordings/:recording_id

Rename a recording.

**Auth**: Required (owner only)

**Request Body**:
```json
{ "name": "New Name" }
```

**Response** (200):
```json
{ "success": true }
```

**File**: routes/recordings.py

---

### DELETE /api/recordings/:recording_id

Delete a recording and its WAV file from disk.

**Auth**: Required (owner only)

**Response** (200):
```json
{ "success": true }
```

**File**: routes/recordings.py

---

## API - POC Mixer

Bridge between extractions and the POC mixer engine (desktop `templates/mixer.html` and the
mobile PWA via `mobile-poc-engine.js`). `<extraction_id>` is the extraction id (e.g.
`download_<id>`). All routes require login.

### POST /poc-mixer/prepare/<extraction_id>

Start (or reuse, if already running) building the per-user mixer artifacts in a background thread
(beat map, metronome WAVs, waveform peaks, meta). The same preparation runs automatically after
every extraction via `warm_prepare()`.

**Response** (200 OK):
```json
{ "job": "download_42", "cached": false }
```

---

### GET /poc-mixer/progress/<extraction_id>

**Response** (200 OK):
```json
{ "stage": "starting", "pct": 0, "done": false, "error": null }
```

---

### GET /poc-mixer/meta/<extraction_id>

Mixer metadata (duration, beats, waveform peaks, stems...). Gzipped (`Content-Encoding: gzip`)
when the client sends `Accept-Encoding: gzip`; the plain payload is ~1.3 MB.

**Errors**: 404 `not prepared`

---

### GET|HEAD /poc-mixer/audio/<extraction_id>/<stem>

Serve a stem or a metronome track. Metronome WAVs are served as cached MP3 twins (created once
next to the WAV, ~96 kbps mono) to cut transfer size; the WAV stays on disk for baking and export.
Responses use `Cache-Control: no-cache` with ETag/Last-Modified revalidation.

---

### Other POC mixer routes

- `POST /poc-mixer/detect_intro/<extraction_id>` - detect the start and bake the count-in
- `GET /poc-mixer/metro_instruments`, `POST /poc-mixer/set_metro_instrument/<extraction_id>`
- `POST /poc-mixer/export/<extraction_id>`, `GET /poc-mixer/download/<token>/<filename>` - mix export

**File**: routes/poc_mixer.py

---

## API - Logging

### POST /api/logs/browser

Log browser-side events (errors, warnings).

**Auth**: Required

**Request**:
```json
{
  "level": "ERROR",
  "message": "JavaScript error occurred",
  "url": "/mixer",
  "stack": "Error: ...\n  at ..."
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**File**: app.py:2363

---

### GET /api/logs/list

List available log files (admin only).

**Auth**: Required (admin only)

**Response** (200 OK):
```json
{
  "logs": [
    {
      "filename": "app.log",
      "size": 1048576,
      "modified": "2025-12-28T12:00:00"
    }
  ]
}
```

**File**: app.py:2419

---

### GET /api/logs/view/<filename>

View log file contents (admin only).

**Auth**: Required (admin only)

**Query Parameters**:
- `lines` (optional): Number of lines to show (default: 100)

**Request**:
```
GET /api/logs/view/app.log?lines=50
```

**Response** (200 OK):
```json
{
  "filename": "app.log",
  "content": "...",
  "lines_shown": 50
}
```

**File**: app.py:2457

---

### GET /api/logs/download/<filename>

Download log file (admin only).

**Auth**: Required (admin only)

**Request**:
```
GET /api/logs/download/app.log
```

**Response**: File download (text/plain)

**File**: app.py:2515

---

## Known Gaps

**Present but unused**:
- `POST /api/mobile/toggle` (`mobile_routes.py`)
- `GET /admin/mobile-settings` (unlinked)

**Deprecated shims**:
- `POST /api/extractions/<id>/lyrics/generate` and `.../lyrics/lrclib` → `/lyrics/regenerate`

---

## Error Responses

### Common Error Codes

**400 Bad Request**:
```json
{
  "error": "Missing required parameter: video_id"
}
```

**401 Unauthorized**:
```json
{
  "error": "Authentication required"
}
```

**403 Forbidden**:
```json
{
  "error": "Admin access required"
}
```

**404 Not Found**:
```json
{
  "error": "Download not found"
}
```

**500 Internal Server Error**:
```json
{
  "error": "Internal server error",
  "message": "Detailed error message"
}
```

---

## Rate Limiting

**ngrok Free Plan**:
- 40 requests/minute
- Browser logging can contribute to rate limiting
- Disable browser logging if hitting limits

**Local Access**:
- No rate limiting on localhost

---

## WebSocket Usage Example

```javascript
// Connect to WebSocket
const socket = io();

// Listen for download progress
socket.on('download_progress', (data) => {
  console.log(`Download ${data.video_id}: ${data.progress}%`);
  updateProgressBar(data.progress);
});

// Listen for extraction progress
socket.on('extraction_progress', (data) => {
  console.log(`Extraction ${data.extraction_id}: ${data.progress}%`);
});

// Listen for extraction complete
socket.on('extraction_complete', (data) => {
  console.log(`Extraction ${data.extraction_id} complete!`);
  loadMixer(data.extraction_id);
});

// Handle disconnect
socket.on('disconnect', () => {
  console.log('WebSocket disconnected');
});
```

---

## API Usage Example

```javascript
// Download from YouTube
async function downloadVideo(videoId) {
  const response = await fetch('/api/downloads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId })
  });

  const data = await response.json();
  console.log('Download started:', data);
}

// Extract stems
async function extractStems(videoId) {
  const response = await fetch('/api/extractions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_id: videoId,
      model_name: 'htdemucs'
    })
  });

  const data = await response.json();
  console.log('Extraction started:', data);
}

// Get extraction status
async function checkStatus(videoId) {
  const response = await fetch(`/api/downloads/${videoId}/extraction-status`);
  const data = await response.json();

  if (data.status === 'completed') {
    console.log('Extraction complete!', data.stems_paths);
  }
}
```

---

## Next Steps

- [Database Schema](DATABASE-SCHEMA.md) - Database structure
- [Frontend Guide](FRONTEND-GUIDE.md) - JavaScript modules
- [Backend Guide](BACKEND-GUIDE.md) - Python modules
- [Architecture Guide](ARCHITECTURE.md) - System design

---

**API Version**: 2.0+
**Last Updated**: September 2026
**Total Endpoints**: ~115 route decorators (`routes/*.py`, `mobile_routes.py`, `app.py`) + SocketIO events
