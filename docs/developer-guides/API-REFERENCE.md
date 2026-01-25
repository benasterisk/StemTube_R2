# StemTube API Reference

Complete documentation of all 69 API endpoints and WebSocket events.

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
- [API - Logging](#api---logging)

---

## Overview

**Base URL**: `http://localhost:5011` (or ngrok HTTPS URL)

**Total Endpoints**: 69
- HTTP Routes: 67
- WebSocket Events: 2

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

Interactive mixer interface.

**Auth**: Required

**Query Parameters**:
- `download_id` (optional): Specific download to load

**Response**: HTML template (mixer.html)

**File**: app.py:863

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

**Auth**: Required (admin only)

**Response**: HTML template

**Files**: app.py:3637, add_mobile_routes.py:37

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
      "structure_available": true
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
      "structure_available": true
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
  "model": "htdemucs",
  "stems": ["vocals", "drums", "bass", "other"],
  "generate_chords": true,
  "generate_lyrics": true,
  "generate_structure": true
}
```

**Models**:
- `htdemucs`: 4-stem (vocals, drums, bass, other)
- `htdemucs_6s`: 6-stem (adds guitar, piano)

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

**Request**:
```json
{
  "backend": "btc"
}
```

**Backends**:
- `btc`: BTC Transformer (170 vocab)
- `madmom`: madmom CRF (24 types)
- `hybrid`: Hybrid detector

**Response** (200 OK):
```json
{
  "success": true,
  "chords_count": 150,
  "backend_used": "btc"
}
```

**File**: app.py:1932

---

### POST /api/extractions/<extraction_id>/lyrics/generate

Generate lyrics transcription.

**Auth**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "lyrics_count": 25,
  "message": "Lyrics generated successfully"
}
```

**File**: app.py:2022

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
  "models": ["htdemucs", "htdemucs_6s"],
  "chord_backends": ["btc", "madmom", "hybrid"],
  "default_model": "htdemucs",
  "default_chord_backend": "btc",
  "gpu_available": true,
  "cuda_version": "12.1"
}
```

**File**: app.py:2950

---

### POST /api/config

Update configuration (admin only).

**Auth**: Required (admin only)

**Request**:
```json
{
  "default_model": "htdemucs_6s",
  "default_chord_backend": "madmom"
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
      model: 'htdemucs',
      stems: ['vocals', 'drums', 'bass', 'other'],
      generate_chords: true,
      generate_lyrics: true
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
**Last Updated**: December 2025
**Total Endpoints**: 69 (67 HTTP + 2 WebSocket)
