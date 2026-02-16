# StemTube Database Schema

Complete documentation of the SQLite database structure.

---

## Table of Contents

- [Overview](#overview)
- [Database File](#database-file)
- [Tables](#tables)
  - [users](#users)
  - [global_downloads](#global_downloads)
  - [user_downloads](#user_downloads)
  - [recordings](#recordings)
- [Relationships](#relationships)
- [Indexes](#indexes)
- [Data Types](#data-types)
- [Migration Scripts](#migration-scripts)

---

## Overview

**Database Engine**: SQLite 3

**Database File**: `stemtubes.db` (in project root)

**Total Tables**: 4

**Architecture**:
- **Global deduplication**: Files stored once in `global_downloads`
- **User access control**: Users get access via `user_downloads`
- **Session-based auth**: Flask-Login with `users` table

**Key Features**:
- Global file deduplication (saves disk space)
- Per-user access control
- Extraction metadata (stems, chords, lyrics, structure)
- Audio analysis results (BPM, key, confidence)

---

## Database File

**Location**: `/home/michael/Documents/Dev/stemtube_dev_v1.2/stemtubes.db`

**Access**:
```python
from core.downloads_db import _conn
from core.auth_db import get_db_connection

# Downloads database
with _conn() as conn:
    cursor = conn.execute("SELECT * FROM global_downloads")

# Auth database (same file, different module)
conn = get_db_connection()
```

**Configuration**:
```python
# In core/downloads_db.py
DB_PATH = Path(__file__).parent.parent / "stemtubes.db"

# In core/auth_db.py
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'stemtubes.db')
```

**Row Factory**: `sqlite3.Row` (dict-like access)

---

## Tables

### users

User authentication and management.

**Purpose**: Store user credentials and permissions

**Schema**:
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    is_admin BOOLEAN DEFAULT 0,
    disclaimer_accepted BOOLEAN DEFAULT 0,
    disclaimer_accepted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTO | Primary key, user ID |
| `username` | TEXT | NO | - | Unique username for login |
| `password_hash` | TEXT | NO | - | Werkzeug hashed password |
| `email` | TEXT | YES | NULL | User email (optional) |
| `is_admin` | BOOLEAN | NO | 0 | Admin privileges (1=admin, 0=regular) |
| `disclaimer_accepted` | BOOLEAN | NO | 0 | Whether user accepted disclaimer |
| `disclaimer_accepted_at` | TIMESTAMP | YES | NULL | When disclaimer was accepted |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | Account creation date |

**Constraints**:
- `PRIMARY KEY (id)`
- `UNIQUE (username)`

**Default Data**:
```sql
-- Created on init_db()
INSERT INTO users (username, password_hash, is_admin)
VALUES ('administrator', '<hashed>', 1);
```

**Password Hashing**:
- Method: `werkzeug.security.generate_password_hash()`
- Verification: `werkzeug.security.check_password_hash()`

**Example**:
```python
from core.auth_db import create_user, authenticate_user

# Create user
create_user('newuser', 'password123', email='user@example.com', is_admin=False)

# Authenticate
user = authenticate_user('newuser', 'password123')
if user:
    print(f"Authenticated: {user['username']}, Admin: {user['is_admin']}")
```

**File**: core/auth_db.py

---

### global_downloads

Global file storage with deduplication.

**Purpose**: Store downloaded files once, accessible to multiple users

**Schema**:
```sql
CREATE TABLE global_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    title TEXT,
    thumbnail TEXT,
    file_path TEXT,
    media_type TEXT,
    quality TEXT,
    file_size INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extracted BOOLEAN DEFAULT 0,
    extraction_model TEXT,
    stems_paths TEXT,
    stems_zip_path TEXT,
    extracted_at TIMESTAMP,
    extracting BOOLEAN DEFAULT 0,
    detected_bpm REAL,
    detected_key TEXT,
    analysis_confidence REAL,
    chords_data TEXT,
    beat_offset REAL DEFAULT 0.0,
    structure_data TEXT,
    lyrics_data TEXT,
    UNIQUE(video_id, media_type, quality)
)
```

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTO | Primary key, global download ID |
| `video_id` | TEXT | NO | - | YouTube video ID or upload ID |
| `title` | TEXT | YES | NULL | Song/video title |
| `thumbnail` | TEXT | YES | NULL | Thumbnail URL |
| `file_path` | TEXT | YES | NULL | Path to audio file |
| `media_type` | TEXT | YES | NULL | Type: "audio" or "video" |
| `quality` | TEXT | YES | NULL | Quality identifier |
| `file_size` | INTEGER | YES | NULL | File size in bytes |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | Download date |
| `extracted` | BOOLEAN | NO | 0 | Extraction complete? |
| `extraction_model` | TEXT | YES | NULL | Demucs model used (htdemucs, htdemucs_6s) |
| `stems_paths` | TEXT | YES | NULL | JSON: {"vocals": "path", "drums": "path", ...} |
| `stems_zip_path` | TEXT | YES | NULL | Path to ZIP archive of stems |
| `extracted_at` | TIMESTAMP | YES | NULL | Extraction completion date |
| `extracting` | BOOLEAN | NO | 0 | Extraction in progress? |
| `detected_bpm` | REAL | YES | NULL | Detected tempo (BPM) |
| `detected_key` | TEXT | YES | NULL | Detected musical key (e.g., "C major") |
| `analysis_confidence` | REAL | YES | NULL | BPM/key detection confidence (0.0-1.0) |
| `chords_data` | TEXT | YES | NULL | JSON: [{"timestamp": 0.0, "chord": "C:maj"}, ...] |
| `beat_offset` | REAL | NO | 0.0 | Time offset to first downbeat (seconds) |
| `structure_data` | TEXT | YES | NULL | JSON: [{"start": 0.0, "end": 30.0, "label": "intro"}, ...] |
| `lyrics_data` | TEXT | YES | NULL | JSON: [{"start": 0.0, "end": 2.5, "text": "...", "words": [...]}, ...] |

**Constraints**:
- `PRIMARY KEY (id)`
- `UNIQUE (video_id, media_type, quality)` - Prevents duplicate downloads

**JSON Fields**:

**stems_paths** (dict):
```json
{
  "vocals": "/path/to/vocals.wav",
  "drums": "/path/to/drums.wav",
  "bass": "/path/to/bass.wav",
  "other": "/path/to/other.wav",
  "guitar": "/path/to/guitar.wav",  // htdemucs_6s only
  "piano": "/path/to/piano.wav"     // htdemucs_6s only
}
```

**chords_data** (array):
```json
[
  {"timestamp": 0.0, "chord": "C:maj"},
  {"timestamp": 2.5, "chord": "Am"},
  {"timestamp": 5.0, "chord": "F:maj7"}
]
```

**structure_data** (array):
```json
[
  {"start": 0.0, "end": 8.0, "label": "intro"},
  {"start": 8.0, "end": 32.0, "label": "verse"},
  {"start": 32.0, "end": 56.0, "label": "chorus"}
]
```

**lyrics_data** (array):
```json
[
  {
    "start": 0.0,
    "end": 2.5,
    "text": "First line of lyrics",
    "words": [
      {"start": 0.0, "end": 0.5, "word": "First"},
      {"start": 0.6, "end": 1.0, "word": "line"},
      {"start": 1.1, "end": 1.8, "word": "of"},
      {"start": 1.9, "end": 2.5, "word": "lyrics"}
    ]
  }
]
```

**Example**:
```python
from core.downloads_db import find_global_download

# Find download by video_id
download = find_global_download('dQw4w9WgXcQ')
print(f"Title: {download['title']}")
print(f"BPM: {download['detected_bpm']}")
print(f"Key: {download['detected_key']}")

# Parse JSON fields
import json
if download['stems_paths']:
    stems = json.loads(download['stems_paths'])
    print(f"Vocals: {stems['vocals']}")
```

**File**: core/downloads_db.py

---

### user_downloads

Per-user access to global downloads.

**Purpose**: Track which users have access to which downloads

**Schema**:
```sql
CREATE TABLE user_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    global_download_id INTEGER NOT NULL,
    video_id TEXT NOT NULL,
    title TEXT,
    thumbnail TEXT,
    file_path TEXT,
    media_type TEXT,
    quality TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extracted BOOLEAN DEFAULT 0,
    extraction_model TEXT,
    stems_paths TEXT,
    stems_zip_path TEXT,
    extracted_at TIMESTAMP,
    extracting BOOLEAN DEFAULT 0,
    FOREIGN KEY (global_download_id) REFERENCES global_downloads(id),
    UNIQUE(user_id, video_id, media_type)
)
```

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTO | Primary key, user download ID |
| `user_id` | INTEGER | NO | - | Foreign key to users.id |
| `global_download_id` | INTEGER | NO | - | Foreign key to global_downloads.id |
| `video_id` | TEXT | NO | - | YouTube video ID (denormalized) |
| `title` | TEXT | YES | NULL | Song title (denormalized) |
| `thumbnail` | TEXT | YES | NULL | Thumbnail URL (denormalized) |
| `file_path` | TEXT | YES | NULL | Path to audio file (denormalized) |
| `media_type` | TEXT | YES | NULL | "audio" or "video" (denormalized) |
| `quality` | TEXT | YES | NULL | Quality identifier (denormalized) |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | When user gained access |
| `extracted` | BOOLEAN | NO | 0 | Extraction complete? (denormalized) |
| `extraction_model` | TEXT | YES | NULL | Demucs model (denormalized) |
| `stems_paths` | TEXT | YES | NULL | JSON stems paths (denormalized) |
| `stems_zip_path` | TEXT | YES | NULL | ZIP path (denormalized) |
| `extracted_at` | TIMESTAMP | YES | NULL | Extraction date (denormalized) |
| `extracting` | BOOLEAN | NO | 0 | Extraction in progress? (denormalized) |

**Constraints**:
- `PRIMARY KEY (id)`
- `FOREIGN KEY (global_download_id) REFERENCES global_downloads(id)`
- `UNIQUE (user_id, video_id, media_type)` - One access per user per file

**Denormalization**:
- Most fields copied from `global_downloads` for faster queries
- Single query returns all user downloads without JOIN
- Trade-off: Data redundancy for query performance

**Example**:
```python
from core.downloads_db import all_downloads_for_user

# Get all downloads for user
user_id = 1
downloads = all_downloads_for_user(user_id)

for dl in downloads:
    print(f"{dl['title']} - {dl['video_id']}")
    print(f"  Extracted: {dl['extracted']}")
    print(f"  Model: {dl['extraction_model']}")
```

**File**: core/downloads_db.py

---

### recordings

User recordings stored alongside extracted stems.

**Purpose**: Store user-recorded audio takes with timeline position metadata

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    download_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_offset REAL NOT NULL DEFAULT 0.0,
    filename TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (download_id) REFERENCES global_downloads(id)
)
```

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | TEXT | NO | - | Primary key, UUID hex (16 chars) |
| `user_id` | TEXT | NO | - | Owner user ID |
| `download_id` | TEXT | NO | - | Associated download/extraction ID |
| `name` | TEXT | NO | - | Display name (e.g., "Recording 1") |
| `start_offset` | REAL | NO | 0.0 | Timeline position where recording starts (seconds) |
| `filename` | TEXT | NO | - | Absolute path to WAV file on disk |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | Creation date |

**Constraints**:
- `PRIMARY KEY (id)`
- `FOREIGN KEY (download_id) REFERENCES global_downloads(id)`

**Storage**: Files saved as `<download_dir>/recordings/<id>.wav`

**File**: core/db/recordings.py

---

## Relationships

### Entity Relationship Diagram

```
┌─────────────┐
│   users     │
│             │
│ id (PK)     │
│ username    │
│ password    │
│ is_admin    │
└──────┬──────┘
       │
       │ 1
       │
       │ N
       ▼
┌─────────────────────┐         ┌──────────────────────┐
│  user_downloads     │    N:1  │  global_downloads    │
│                     │◄────────┤                      │
│ id (PK)             │         │ id (PK)              │
│ user_id (FK)        │         │ video_id (UNIQUE)    │
│ global_download_id  │         │ title                │
│   (FK)              │         │ file_path            │
│ video_id            │         │ stems_paths          │
│ title               │         │ chords_data          │
│ ... (denormalized)  │         │ lyrics_data          │
└─────────────────────┘         │ structure_data       │
                                │ detected_bpm         │
                                │ detected_key         │
                                └──────────────────────┘
```

### Relationship Details

**users → user_downloads** (1:N)
- One user can have access to many downloads
- `user_downloads.user_id` references `users.id`
- Cascade delete: Not implemented (manual cleanup required)

**global_downloads → user_downloads** (1:N)
- One global download can be accessed by many users
- `user_downloads.global_download_id` references `global_downloads.id`
- Cascade delete: Not implemented (manual cleanup required)

### Access Control Flow

```python
# 1. User downloads from YouTube
video_id = "dQw4w9WgXcQ"
user_id = 1

# 2. Check if file exists globally
global_dl = find_global_download(video_id)

if global_dl:
    # File already downloaded - just grant access
    global_download_id = global_dl['id']
else:
    # Download file - creates global_downloads entry
    global_download_id = create_global_download(meta)

# 3. Grant user access - creates user_downloads entry
grant_user_access(user_id, global_download_id, video_id)
```

---

## Indexes

### Implicit Indexes

**Primary Keys** (auto-indexed):
- `users.id`
- `global_downloads.id`
- `user_downloads.id`

**Unique Constraints** (auto-indexed):
- `users.username`
- `global_downloads(video_id, media_type, quality)`
- `user_downloads(user_id, video_id, media_type)`

### Recommended Additional Indexes

**For Performance**:
```sql
-- Speed up user download queries
CREATE INDEX idx_user_downloads_user_id
ON user_downloads(user_id);

-- Speed up global download lookups
CREATE INDEX idx_global_downloads_video_id
ON global_downloads(video_id);

-- Speed up extraction status checks
CREATE INDEX idx_global_downloads_extracted
ON global_downloads(extracted);

-- Speed up user-specific extraction queries
CREATE INDEX idx_user_downloads_user_extracted
ON user_downloads(user_id, extracted);
```

**Note**: Not currently implemented, but would improve query performance for large databases.

---

## Data Types

### SQLite Type Affinity

**INTEGER**:
- `id`, `user_id`, `global_download_id`, `file_size`
- Stored as: Variable-length integer (1, 2, 3, 4, 6, or 8 bytes)

**TEXT**:
- `username`, `video_id`, `title`, `file_path`, `chords_data`, etc.
- Stored as: UTF-8 string
- JSON stored as TEXT (parsed by application)

**REAL**:
- `detected_bpm`, `analysis_confidence`, `beat_offset`
- Stored as: 8-byte IEEE floating point

**BOOLEAN**:
- `is_admin`, `extracted`, `extracting`, `disclaimer_accepted`
- Stored as: INTEGER (0 = false, 1 = true)
- Python: Returns as int, cast to bool in application

**TIMESTAMP**:
- `created_at`, `extracted_at`, `disclaimer_accepted_at`
- Stored as: TEXT in ISO 8601 format: `YYYY-MM-DD HH:MM:SS`
- Default: `CURRENT_TIMESTAMP` (UTC)

### NULL vs Empty String

**Preferred**: Use `NULL` for missing data

**Example**:
```python
# GOOD
thumbnail = meta.get("thumbnail_url") or None  # NULL if missing

# BAD
thumbnail = meta.get("thumbnail_url", "")  # Empty string
```

**Why**:
- NULL clearly indicates "no value"
- Empty string ambiguous ("no value" vs "empty value")
- NULL saves space in SQLite

---

## Migration Scripts

### Adding New Columns

**Automatic Migration** (on app startup):
```python
def _add_extraction_fields_if_missing(conn):
    """Add extraction fields to existing tables if they don't exist."""
    extraction_fields = [
        ("extracted", "BOOLEAN DEFAULT 0"),
        ("extraction_model", "TEXT"),
        ("stems_paths", "TEXT"),
        ("chords_data", "TEXT"),
        ("lyrics_data", "TEXT"),
        ("structure_data", "TEXT"),
        ("detected_bpm", "REAL"),
        ("detected_key", "TEXT"),
        ("beat_offset", "REAL DEFAULT 0.0"),
    ]

    for table_name in ["global_downloads", "user_downloads"]:
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        existing_columns = {row[1] for row in cursor.fetchall()}

        for field_name, field_type in extraction_fields:
            if field_name not in existing_columns:
                conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {field_name} {field_type}")
```

**Called by**: `init_table()` in core/downloads_db.py

### Manual Migration Scripts

**Location**: `utils/database/`

**Add Structure Column**:
```bash
python utils/database/add_structure_column.py
```

**Add Lyrics Column**:
```bash
python utils/database/add_lyrics_column.py
```

**Reset Database** (⚠️ DESTRUCTIVE):
```bash
python utils/database/clear_database.py
```

### Checking Schema

**View Tables**:
```sql
SELECT name FROM sqlite_master WHERE type='table';
```

**View Columns**:
```sql
PRAGMA table_info(users);
PRAGMA table_info(global_downloads);
PRAGMA table_info(user_downloads);
```

**Python Script**:
```bash
python utils/database/debug_db.py
```

---

## Query Examples

### Common Queries

**1. Get User's Downloads**:
```sql
SELECT * FROM user_downloads
WHERE user_id = ?
ORDER BY created_at DESC;
```

**2. Find Global Download**:
```sql
SELECT * FROM global_downloads
WHERE video_id = ? AND media_type = 'audio';
```

**3. Check Extraction Status**:
```sql
SELECT extracted, extracting, extraction_model, stems_paths
FROM global_downloads
WHERE video_id = ?;
```

**4. Get All Users with Access**:
```sql
SELECT u.username
FROM user_downloads ud
JOIN users u ON ud.user_id = u.id
WHERE ud.global_download_id = ?;
```

**5. Storage Statistics**:
```sql
SELECT
    COUNT(*) as total_downloads,
    SUM(file_size) as total_bytes
FROM global_downloads;
```

**6. User's Extracted Downloads**:
```sql
SELECT * FROM user_downloads
WHERE user_id = ? AND extracted = 1
ORDER BY extracted_at DESC;
```

---

## Database Utilities

### Inspection

**debug_db.py**:
```bash
python utils/database/debug_db.py
# Shows: All tables, row counts, sample data
```

**SQLite Command Line**:
```bash
sqlite3 stemtubes.db
.tables
.schema users
SELECT * FROM users;
.quit
```

### Maintenance

**Cleanup Orphaned Files**:
```bash
python utils/database/cleanup_orphaned_files.py
# Removes files without DB entries
# Removes DB entries without files
```

**Vacuum Database** (compact):
```bash
sqlite3 stemtubes.db "VACUUM;"
```

**Backup Database**:
```bash
cp stemtubes.db stemtubes.db.backup
# Or
sqlite3 stemtubes.db ".backup stemtubes.db.backup"
```

---

## Best Practices

### 1. Use Transactions

```python
with _conn() as conn:
    # Automatic transaction
    conn.execute("INSERT INTO ...")
    conn.execute("UPDATE ...")
    conn.commit()  # Commits all or rollback on error
```

### 2. Use Parameterized Queries

```python
# GOOD - Prevents SQL injection
conn.execute("SELECT * FROM users WHERE username = ?", (username,))

# BAD - SQL injection risk
conn.execute(f"SELECT * FROM users WHERE username = '{username}'")
```

### 3. Close Connections

```python
# GOOD - Context manager auto-closes
with _conn() as conn:
    cursor = conn.execute("...")

# OKAY - Manual close
conn = _conn()
try:
    cursor = conn.execute("...")
finally:
    conn.close()
```

### 4. Handle NULL Values

```python
# Check for NULL
if row['thumbnail'] is None:
    thumbnail = "/static/default.jpg"

# Or use get() with default
thumbnail = row.get('thumbnail') or "/static/default.jpg"
```

### 5. Parse JSON Fields

```python
import json

# Parse stems_paths
if record['stems_paths']:
    stems = json.loads(record['stems_paths'])
    vocals_path = stems['vocals']

# Parse chords_data
if record['chords_data']:
    chords = json.loads(record['chords_data'])
    first_chord = chords[0]['chord']
```

---

## Schema Evolution

### Version History

**v1.0** (September 2025):
- Initial schema: users, global_downloads, user_downloads
- Basic fields: video_id, title, file_path

**v1.1** (October 2025):
- Added: extracted, extraction_model, stems_paths
- Added: detected_bpm, detected_key, chords_data

**v1.2** (November 2025):
- Added: structure_data, lyrics_data, beat_offset
- Added: disclaimer_accepted fields to users

**v2.0** (December 2025):
- No schema changes (documentation and code updates only)

**v2.1** (February 2026):
- Added: `recordings` table for multi-track recording feature

### Future Considerations

**Potential Additions**:
- Playcount tracking
- User favorites/playlists
- Download ratings
- Processing queue table
- Error log table

**Performance Optimizations**:
- Add indexes on frequently queried columns
- Separate metadata table for large JSON fields
- Implement database connection pooling

---

## Next Steps

- [API Reference](API-REFERENCE.md) - All endpoints
- [Frontend Guide](FRONTEND-GUIDE.md) - JavaScript modules
- [Backend Guide](BACKEND-GUIDE.md) - Python modules
- [Architecture Guide](ARCHITECTURE.md) - System design

---

**Database Version**: 2.1
**Last Updated**: February 2026
**Schema Complexity**: 4 tables, 55+ columns
