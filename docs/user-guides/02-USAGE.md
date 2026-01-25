# StemTube Usage Guide

Learn how to use all features of StemTube.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Adding Audio Files](#adding-audio-files)
- [Extracting Stems](#extracting-stems)
- [Using the Mixer](#using-the-mixer)
- [Chord Detection](#chord-detection)
- [Lyrics & Karaoke](#lyrics--karaoke)
- [Structure Analysis](#structure-analysis)
- [Pitch & Tempo Control](#pitch--tempo-control)
- [File Management](#file-management)
- [Admin Features](#admin-features)

---

## Getting Started

### Starting StemTube

```bash
cd StemTube-dev
source venv/bin/activate
python app.py
```

**Access**: http://localhost:5011

**For Remote/Mobile Access** (HTTPS required for pitch/tempo):
```bash
./start_service.sh
```

Access at ngrok URL shown in terminal: `https://your-subdomain.ngrok-free.app`

### First Login

**Default Credentials**:
- Username: `administrator`
- Password: `password`

**⚠️ IMPORTANT**: Change password immediately:
1. Click "Admin Panel" (top-right)
2. Go to "User Management"
3. Click "Change Password" for administrator
4. Enter new secure password

---

## Adding Audio Files

Upload your own audio or video files to process them.

1. **Click "Upload File"** button on main page

2. **Select Audio File**:
   - Supported formats: MP3, WAV, FLAC, M4A, OGG, etc.
   - Max size: 500 MB (configurable in `.env`)
   - Recommended: High-quality files (320kbps MP3, lossless FLAC)

3. **Monitor Upload**:
   - Progress bar shows upload %
   - Large files may take several minutes

4. **Results**:
   - File saved in `downloads/uploads/USERNAME/`
   - Appears in "Your Downloads" list
   - Accessible only to your user account

**Best Practices**:
- Use high-quality source files for best stem separation
- Avoid heavily compressed files (< 128kbps)
- Remove DRM protection if applicable

---

## Extracting Stems

**Stem extraction** separates a song into individual components (vocals, drums, bass, etc.) using AI.

### Basic Extraction

1. **Select File**:
   - Find download in "Your Downloads" list
   - Click "Extract Stems" button

2. **Choose Model**:
   - **htdemucs** (4-stem) - Recommended for most songs
     - Stems: vocals, drums, bass, other
     - Fastest processing
     - Best general-purpose quality

   - **htdemucs_6s** (6-stem) - For instrumental-heavy music
     - Stems: vocals, drums, bass, other, guitar, piano
     - Slower processing (~1.5x longer)
     - Better separation of specific instruments

3. **Select Stems**:
   - ✅ Check stems you want to extract
   - Fewer stems = faster processing
   - Typical: Extract all stems for full control

4. **Click "Extract"**:
   - Processing begins immediately
   - Real-time progress updates via WebSocket
   - Do not close browser during extraction

### Extraction Process

**Processing Time**:
- **CPU Mode**: 3-8 minutes per 4-minute song (htdemucs)
- **GPU Mode**: 20-60 seconds per 4-minute song (4-8x faster)

**Progress Updates**:
```
Extracting... 0% - Initializing Demucs
Extracting... 25% - Separating stems
Extracting... 50% - Processing vocals
Extracting... 75% - Processing drums
Extracting... 100% - Finalizing
✓ Extraction complete!
```

**Results**:
- Individual stem files saved in `downloads/global/VIDEO_ID/stems/htdemucs/`
- Mixer automatically available
- Chords, structure, lyrics analyzed (if selected)

### Advanced Options

**Stem Selection**:
- Extract only specific stems to save time
- Example: Vocals-only for karaoke practice
- Example: Drums+bass for rhythm analysis

**Model Comparison**:

| Feature | htdemucs (4-stem) | htdemucs_6s (6-stem) |
|---------|------------------|---------------------|
| Vocals | ✅ Excellent | ✅ Excellent |
| Drums | ✅ Excellent | ✅ Excellent |
| Bass | ✅ Excellent | ✅ Excellent |
| Guitar | ⚠️ In "other" | ✅ Dedicated stem |
| Piano | ⚠️ In "other" | ✅ Dedicated stem |
| Speed | ⚡ Fast | 🐌 Slower |
| Use Case | General music | Instrumental-heavy |

**Troubleshooting**:
- "Extraction failed": Check logs in `app.log`
- "Out of memory": Reduce model complexity or restart app
- GPU errors: Restart app to auto-configure CUDA
- Slow processing: Enable GPU acceleration (see [GPU Setup](../setup-guides/GPU-SETUP.md))

---

## Using the Mixer

The **interactive mixer** provides full control over extracted stems.

### Opening the Mixer

1. Find extracted download in "Your Downloads"
2. Click "Open Mixer" button
3. Mixer loads with all stems

**Mixer Interface**:
```
┌─────────────────────────────────────────┐
│  Timeline (waveform + chords + structure) │
├─────────────────────────────────────────┤
│  Playback Controls (play/pause/seek)      │
├─────────────────────────────────────────┤
│  Track Controls (vocals, drums, bass...)  │
│    - Volume sliders                       │
│    - Pan controls (L/R)                   │
│    - Solo/Mute buttons                    │
├─────────────────────────────────────────┤
│  Global Controls                          │
│    - Pitch shift (-12 to +12 semitones)   │
│    - Tempo control (0.5x to 2.0x)         │
│    - Master volume                        │
└─────────────────────────────────────────┘
```

### Track Controls

**Volume**:
- Drag slider to adjust track volume (0-100%)
- Supports values > 100% for quiet tracks
- Double-click to reset to 100%

**Pan** (Left/Right):
- -100 (full left) to +100 (full right)
- 0 = center (default)
- Create stereo separation effects

**Solo**:
- Click "S" button to solo a track
- Mutes all other tracks
- Click again to un-solo

**Mute**:
- Click "M" button to mute track
- Muted tracks shown with strikethrough
- Click again to unmute

**Reset**:
- Click "Reset" button on track to restore defaults
- Volume: 100%, Pan: 0, Solo: off, Mute: off

### Playback Controls

**Play/Pause**:
- Spacebar or click play button
- Resumes from current position

**Seek**:
- Click anywhere on timeline
- Drag playhead
- Use keyboard:
  - `←` Left arrow: -5 seconds
  - `→` Right arrow: +5 seconds

**Time Display**:
- Shows current time / total duration
- Format: `MM:SS / MM:SS`

### Timeline Features

**Waveform**:
- Visual representation of audio
- Color-coded by stem
- Click to seek

**Chords**:
- Detected chords shown above waveform
- Synchronized with playback
- Hover for chord name
- See [Chord Detection](#chord-detection)

**Structure Sections**:
- Color-coded sections (intro, verse, chorus, etc.)
- Labels at section boundaries
- See [Structure Analysis](#structure-analysis)

### State Persistence

**Automatic Saving**:
- Mixer settings saved to browser LocalStorage
- Preserved between sessions
- Per-download settings (not shared across downloads)

**Saved Settings**:
- Track volumes, pan, solo, mute
- Pitch shift, tempo
- Current playback position

**Reset All**:
- Click "Reset All" to restore factory defaults
- Refreshing page reloads last saved state

---

## Chord Detection

StemTube detects chords automatically using **3 different backends**.

### Chord Detection Backends

**1. BTC Transformer** (Default when available)
- **Vocabulary**: 170 chord types
- **Accuracy**: Highest
- **Speed**: 15-30 seconds per song
- **Genres**: All genres, especially jazz/complex harmonies
- **Requirement**: External dependency `../essentiatest/BTC-ISMIR19`
- **Best for**: Accurate transcription, music theory analysis

**2. madmom CRF** (Built-in fallback)
- **Vocabulary**: 24 chord types (maj, min, dim, aug, 7, maj7, min7)
- **Accuracy**: Professional-grade (Chordify/Moises level)
- **Speed**: 20-40 seconds per song
- **Genres**: Pop, rock, folk, country
- **Requirement**: Built-in, no external dependencies
- **Best for**: Most popular music, quick transcription

**3. Hybrid Detector** (Automatic fallback)
- **Combines**: Multiple backends for best results
- **Accuracy**: Varies by song
- **Speed**: Similar to individual backends
- **Fallback**: Activated when BTC unavailable
- **Best for**: Ensuring chord detection always works

### Using Chord Detection

**Automatic Detection**:
1. Extract stems from a download
2. Chords automatically detected during extraction
3. Results shown in mixer timeline

**Manual Re-Analysis**:
```bash
source venv/bin/activate
python utils/analysis/reanalyze_all_chords.py
```

**Viewing Chords**:
- Open mixer
- Chords displayed above waveform
- Color-coded by type:
  - Major chords: Blue
  - Minor chords: Green
  - Dominant 7th: Orange
  - Other: Purple

**Chord Display**:
- Format: `C:maj`, `Am`, `G7`, `Dmaj7`, etc.
- Updates in real-time during playback
- Synchronized precisely with audio

**Exporting Chords**:
- Download chord progression as text file
- Click "Export Chords" in mixer (if available)
- Or access JSON data via API: `/api/download/<id>/chords`

### Chord Accuracy Tips

**For Best Results**:
- Use high-quality source audio
- Songs with clear harmonic content
- Avoid heavily distorted or noisy recordings

**Genre Recommendations**:
- **Pop/Rock/Folk**: madmom CRF or BTC
- **Jazz/Classical**: BTC Transformer (170 vocab required)
- **Electronic/Ambient**: May have mixed results (less harmonic content)

**Troubleshooting**:
- Incorrect chords: Try different backend (see [Chord Detection Guide](../feature-guides/CHORD-DETECTION.md))
- No chords detected: Check that extraction completed successfully
- BTC unavailable: Install external dependency (see [BTC Setup](../setup-guides/BTC-SETUP.md))

---

## Lyrics & Karaoke

**Automatic lyrics transcription** with word-level timing using faster-whisper.

### Lyrics Transcription

**Automatic Detection**:
1. Extract stems from a song
2. Lyrics automatically transcribed during extraction
3. Uses isolated vocals stem for best accuracy

**Processing**:
- **CPU Mode**: 30-120 seconds per song
- **GPU Mode**: 10-30 seconds per song (3-5x faster)
- Runs in parallel with stem extraction

**Accuracy**:
- 90-95% word accuracy for clear vocals
- English: Best supported
- Other languages: Supported but may vary
- Instrumental sections: Detected and skipped

### Karaoke Mode

**Viewing Karaoke**:
1. Open mixer for a song with lyrics
2. Lyrics panel appears below timeline
3. Synchronized word-by-word highlighting

**Display Modes**:

**Desktop**:
```
Current line highlighted
Previous 2 lines shown in gray
Upcoming lines shown below
```

**Mobile**:
```
Focused view - current line + 2 previous
Compact for easier reading on small screens
```

**Features**:
- **Word-level highlighting**: Current word highlighted in real-time
- **Auto-scroll**: Follows playback automatically
- **Manual scroll**: Scroll ahead to preview upcoming lyrics
- **Click to seek**: Click on any word to jump to that position

### Using Karaoke Mode

**Typical Workflow**:
1. Extract stems (vocals, drums, bass, other)
2. Open mixer
3. Adjust track volumes:
   - **Vocals**: 0% (muted) - sing yourself
   - **Drums**: 100% - keep rhythm
   - **Bass**: 100%
   - **Other**: 50-80% - background instruments
4. Follow highlighted lyrics
5. Pitch shift if needed (change key to match your vocal range)

**Practice Mode**:
- Solo vocals to hear reference vocal
- Mute vocals to practice singing
- Slow tempo (0.7x-0.9x) to learn difficult sections
- Pitch shift to comfortable key

**Troubleshooting**:
- No lyrics: Ensure song has vocals (not instrumental)
- Wrong lyrics: Try re-running extraction or edit manually
- Timing off: faster-whisper provides best available timing
- Language issues: English most accurate, other languages may vary

---

## Structure Analysis

**Automatic song structure detection** using MSAF (Music Structure Analysis Framework).

### Structure Detection

**Automatic Analysis**:
1. Extract stems from a song
2. Structure automatically analyzed during extraction
3. Results shown in mixer timeline

**Detected Sections**:
- **Intro**: Opening section
- **Verse**: Verse sections (Verse 1, Verse 2, etc.)
- **Chorus**: Chorus/Refrain sections
- **Bridge**: Bridge sections
- **Outro**: Ending section
- **Instrumental**: Instrumental breaks
- **Other**: Unclassified sections

### Using Structure Information

**In Mixer Timeline**:
- Color-coded sections
- Section labels at boundaries
- Click to jump to section

**Navigation**:
- Quickly jump between song sections
- Loop specific sections (verse, chorus, etc.)
- Identify song form (ABABCB, etc.)

**Color Scheme**:
- Intro: Light blue
- Verse: Green
- Chorus: Yellow
- Bridge: Orange
- Outro: Red
- Instrumental: Purple
- Other: Gray

**Manual Re-Analysis**:
```bash
source venv/bin/activate
python utils/analysis/reanalyze_all_structure.py
```

**Accuracy**:
- 70-90% accuracy for pop/rock music
- Best with clear verse/chorus structure
- May struggle with through-composed or classical music

**Troubleshooting**:
- Incorrect sections: MSAF uses algorithmic detection (may not match human perception)
- No structure detected: Check that extraction completed successfully
- Too many sections: MSAF may over-segment some songs

---

## Pitch & Tempo Control

**Real-time pitch and tempo adjustment** using SoundTouch + Web Audio API.

**⚠️ HTTPS REQUIREMENT**: Pitch/tempo control requires HTTPS or localhost due to SharedArrayBuffer restrictions.

### Enabling HTTPS

**Option 1: Use ngrok** (Recommended):
```bash
./start_service.sh
```

Access via ngrok URL: `https://your-subdomain.ngrok-free.app`

**Option 2: Local Access**:
Access via `http://localhost:5011` (HTTPS not required for localhost)

**Option 3: Custom SSL Certificate**:
See [HTTPS Setup Guide](../admin-guides/HTTPS-SETUP.md)

### Pitch Control

**Pitch Shift Range**: -12 to +12 semitones

**Common Uses**:
- **Transpose to your vocal range**: Shift up/down to comfortable key
- **Instrument tuning**: Match alternate tunings
- **Creative effects**: Chipmunk (+12) or deep (-12) effects

**How to Use**:
1. Open mixer
2. Find "Pitch" control (global controls section)
3. Drag slider or enter value (-12 to +12)
4. Pitch changes applied in real-time

**Examples**:
- Original key: C major
- +2 semitones: D major
- -3 semitones: A major
- +12 semitones: C major (one octave higher)

**Quality**:
- Minimal artifacts for ±5 semitones
- Noticeable quality loss beyond ±7 semitones
- Uses time-domain WSOLA algorithm (SoundTouch)

### Tempo Control

**Tempo Range**: 0.5x to 2.0x (50% to 200%)

**Common Uses**:
- **Practice slow**: 0.7x-0.9x for learning difficult passages
- **Speed up**: 1.1x-1.3x for faster listening
- **Half/double time**: 0.5x or 2.0x for rhythm experiments

**How to Use**:
1. Open mixer
2. Find "Tempo" control (global controls section)
3. Drag slider or enter value (0.5 to 2.0)
4. Tempo changes applied in real-time

**Examples**:
- 1.0x: Original tempo (120 BPM → 120 BPM)
- 0.8x: 20% slower (120 BPM → 96 BPM)
- 1.25x: 25% faster (120 BPM → 150 BPM)
- 0.5x: Half speed (120 BPM → 60 BPM)

**Quality**:
- Excellent quality 0.7x-1.3x
- Good quality 0.5x-0.7x and 1.3x-1.5x
- Noticeable artifacts beyond 1.5x or below 0.5x

### Independent Pitch & Tempo

**Pitch without tempo change**:
- Change pitch slider only
- Tempo remains at 1.0x
- Example: Transpose up 3 semitones at original speed

**Tempo without pitch change**:
- Change tempo slider only
- Pitch remains at 0 semitones
- Example: Slow to 0.8x without changing key

**Combined**:
- Adjust both independently
- Example: +2 semitones, 0.9x tempo
- No crosstalk between pitch and tempo

### Hybrid Engine

StemTube uses a **hybrid pitch/tempo engine**:
- **SoundTouch**: Offline time-stretch (AudioWorklet)
- **playbackRate**: Real-time fine-tuning (Web Audio API)
- **Combination**: Best quality with zero latency

**Troubleshooting**:
- "Pitch/tempo not working": Check HTTPS enabled or using localhost
- Browser compatibility: Chrome 90+, Firefox 88+, Safari 14+
- Artifacts/glitches: Extreme pitch/tempo values (reduce range)
- Latency: Should be zero - reload mixer if experiencing delays

---

## File Management

### Your Downloads List

**View All Downloads**:
- Main page shows "Your Downloads"
- Sorted by newest first
- Filter by status (processing, completed, failed)

**Download Information**:
- Title
- Duration
- File size
- Upload/download date
- Processing status
- Available actions

**Actions**:
- **Extract Stems**: Start stem extraction
- **Re-analyze**: Re-run chord/structure/lyrics detection
- **Open Mixer**: Open interactive mixer
- **Download**: Download original audio file
- **Delete**: Remove from your library (admin only for global downloads)

### Storage Management

**View Storage Usage**:
1. Admin Panel → Storage Statistics
2. See breakdown by:
   - Total size
   - Global downloads
   - User uploads
   - Extracted stems

**Cleanup Options**:

**Remove Orphaned Files**:
```bash
source venv/bin/activate
python utils/database/cleanup_orphaned_files.py
```

**Delete Specific Download**:
1. Find download in list
2. Click "Delete" button
3. Confirm deletion
4. Files removed from disk and database

**Bulk Delete** (Admin):
1. Admin Panel → Storage Management
2. Select multiple downloads
3. Click "Delete Selected"
4. Confirm bulk deletion

### Global File Deduplication

**How It Works**:
- YouTube videos downloaded once globally
- Stored in `downloads/global/VIDEO_ID/`
- All users can access same files
- Saves disk space and processing time

**Access Control**:
- Admin grants access to global downloads
- Users see only downloads they have access to
- File sharing controlled via database

**Benefits**:
- Reduced storage usage
- Faster access (no re-download)
- Consistent stem extraction across users

---

## Admin Features

**Admin Panel** (accessible only to admin users).

### User Management

**View All Users**:
- Admin Panel → User Management
- List of all registered users
- User roles (admin, regular user)

**Add User**:
1. Click "Add User"
2. Enter username and password
3. Select role (admin or user)
4. Click "Create"

**Change Password**:
1. Find user in list
2. Click "Change Password"
3. Enter new password
4. Confirm change

**Delete User**:
1. Find user in list
2. Click "Delete User"
3. Confirm deletion
4. User removed from database

### Download Management

**Grant Access**:
1. Admin Panel → Download Management
2. Select global download
3. Choose users to grant access
4. Click "Grant Access"

**Revoke Access**:
1. Find download
2. Select users to revoke
3. Click "Revoke Access"

**Bulk Operations**:
- Delete multiple downloads
- Grant access to multiple users
- Re-analyze multiple downloads

### System Logs

**View Logs**:
1. Admin Panel → Logs
2. Filter by:
   - Log level (INFO, WARNING, ERROR)
   - Date range
   - Module

**Browser Logs**:
- Frontend errors logged to `/api/logs/browser`
- Helps debug client-side issues
- Accessible only to admins

**Download Logs**:
```bash
tail -f app.log
```

**Search Logs**:
```bash
grep ERROR app.log
grep "download_id" app.log
```

### Storage Statistics

**View Statistics**:
1. Admin Panel → Storage
2. See:
   - Total disk usage
   - Downloads by user
   - Stems storage
   - Largest downloads

**Cleanup Recommendations**:
- Orphaned files
- Failed extractions
- Duplicate uploads
- Old downloads

---

## Next Steps

**Learn More**:
- [Mobile Guide](03-MOBILE.md) - Use StemTube on mobile devices
- [Troubleshooting](05-TROUBLESHOOTING.md) - Common issues and solutions
- [Feature Guides](../feature-guides/) - Deep dives into specific features

**Advanced Usage**:
- [Chord Detection Guide](../feature-guides/CHORD-DETECTION.md) - BTC/madmom/hybrid backends
- [Pitch/Tempo Guide](../feature-guides/PITCH-TEMPO-CONTROL.md) - Advanced techniques
- [Mobile Architecture](../feature-guides/MOBILE-ARCHITECTURE.md) - Mobile-specific features

**For Administrators**:
- [Security Setup](../admin-guides/SECURITY_SETUP.md) - Production security
- [Deployment Guide](../admin-guides/DEPLOYMENT.md) - Deploy to production

---

**Enjoy using StemTube!** 🎉

Extract stems, practice karaoke, and explore music like never before.
