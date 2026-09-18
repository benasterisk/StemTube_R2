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
cd StemTube_R2
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

   - **htdemucs_ft** (4-stem) - Fine-tuned HTDemucs
     - Stems: vocals, drums, bass, other
     - Slightly better quality, slower

   - **htdemucs_6s** (6-stem) - For instrumental-heavy music
     - Stems: vocals, drums, bass, other, guitar, piano
     - Slower processing (~1.5x longer)
     - Better separation of specific instruments

   - **mdx_extra** (4-stem) - Vocal focus
     - Stems: vocals, drums, bass, other

   - **MVSep Mega (fine stems)** - `mvsep_mega_fine`, 17 stems
     - **Requires a CUDA GPU** (~6 GB VRAM); ~1-2 minutes per song
     - Lead vocals and backing vocals as separate stems
     - Drum kit split into kick, snare, toms and cymbals (hi-hat is inside cymbals), plus a
       "drums" stem with the rest of the kit
     - Bass, electric guitar vs acoustic guitar, piano, organ, synth, brass, winds, strings
     - "Other" holds whatever is left (and any stem you uncheck)
     - The stems always add up to the original mix
     - The option is hidden in the extraction dialog when the server has no suitable CUDA GPU

   - **mdx_extra_q** is shown disabled: it needs the `diffq` package, which is not installed

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
- Lyrics transcribed from the vocals stem and beats detected (chords were already analyzed after download)

### Re-extracting With Another Model

- Click the small **↻** button next to "Open Mixer" on an extracted song
- Pick another model (e.g. go from htdemucs to MVSep Mega) and extract
- The new stems **replace** the previous ones for that song

### Advanced Options

**Stem Selection**:
- Extract only specific stems to save time
- Example: Vocals-only for karaoke practice
- Example: Drums+bass for rhythm analysis

**Model Comparison**:

| Feature | htdemucs (4-stem) | htdemucs_6s (6-stem) | MVSep Mega (17-stem) |
|---------|------------------|---------------------|---------------------|
| Vocals | ✅ Excellent | ✅ Excellent | ✅ Lead + backing split |
| Drums | ✅ Excellent | ✅ Excellent | ✅ Kick / snare / toms / cymbals + rest |
| Bass | ✅ Excellent | ✅ Excellent | ✅ Dedicated stem |
| Guitar | ⚠️ In "other" | ✅ Dedicated stem | ✅ Electric vs acoustic |
| Piano | ⚠️ In "other" | ✅ Dedicated stem | ✅ Piano, organ, synth |
| Brass / winds / strings | ⚠️ In "other" | ⚠️ In "other" | ✅ Dedicated stems |
| Speed | ⚡ Fast | 🐌 Slower | ⚡ ~1-2 min on GPU |
| Hardware | CPU or GPU | CPU or GPU | CUDA GPU only |
| Use Case | General music | Instrumental-heavy | Detailed arrangement work |

**Troubleshooting**:
- "Extraction failed" with MVSep Mega: this model only runs on a CUDA GPU with ~6 GB VRAM
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
3. Mixer loads progressively: all tracks and their waveforms appear right away, and each
   stem's audio fills in as it finishes loading (useful with 17-stem extractions)

**Mixer Interface**:
```
┌──────────────────────────────────────────────────────────────────────┐
│ Tabs: Mixer · Chords · Lyrics                                          │
├──────────────────────────────────────────────────────────────────────┤
│ Transport: ▶ play · ⚑ from Start · ■ stop · 🔁 loop [start → end] ✕    │
│            ● record · ＋ add track · Detect intro · Precount ·          │
│            Stop metronome · BPM −/value/+ ↺ · Key −/+ · time ·          │
│            Focus · 🧲 Snap · scroll mode · zoom H/V · Export            │
├──────────────────────┬───────────────────────────────────────────────┤
│ Track controls        │ Timeline ruler (drag = scrub, Shift+drag = loop) │
│  name · M · S · ●     │ Waveform lanes, beat grid, playhead,             │
│  volume · pan L/R     │ loop band, Start/Stop markers                    │
└──────────────────────┴───────────────────────────────────────────────┘
```
Tempo ranges from 0.5× to 2.0× and pitch from -12 to +12 semitones (BPM and Key groups).
There is no master volume control.

### Track Controls

**Volume**:
- Drag the slider: 0 to 150% (the metronome goes up to 300% so the click cuts through)
- Double-click to return to 0 dB (unity)

**Pan** (Left/Right):
- Slider from full left (L) to full right (R), centred by default
- Double-click to re-centre

**Solo**:
- Click "S" to solo a track; only soloed tracks stay audible
- Click again to un-solo

**Mute**:
- Click "M" to mute a track (the button lights up)
- Click again to unmute
- A muted track wins over solo

**Metronome Track**:
- The metronome track starts **muted** - unmute it to hear the click

### Recording (Multi-Track)

Record yourself playing along with stems. Recordings are positioned on the timeline and included in mix exports.

**Adding a Track**:
- Click **Add track** (＋) in the transport bar
- Each track has its own input device selector (for multiple mics/instruments)
- The small dot button on each stem lane is a placeholder and does nothing yet - use Add track

**Recording**:
1. Click the **R** button on a track to arm it (turns red when armed)
2. Click the global **Record** button (red circle in transport bar)
3. Latency is calibrated automatically, then playback starts — record along with the stems
4. Click **Record** again to stop
5. Waveform appears on the track after processing

**Punch In/Out** (DAW-style):
- During an active recording session, arm additional tracks to punch in
- Disarm a track to punch out (stops recording on that track only)
- The global session continues for other armed tracks

**Per-Track Controls**:
- **R** (Arm) — Enable track for recording
- **S** (Solo) / **M** (Mute) — Same behavior as stem tracks
- **Volume** / **Pan** — Independent per track
- **Expand** (chevron) — Shows device selector, input level meter, monitor volume, FX preset, Delete button

**Saving**:
- Takes are saved to the server automatically when you stop recording
- Saved recordings turn green and are restored when you reload the mixer

**Latency Calibration**:
- Runs automatically before each take (loopback test)
- Plays a test click through speakers, records it via mic, measures round-trip delay
- The compensated latency is shown next to the transport buttons

### Playback Controls

**Play/Pause**:
- Click the play button; playback resumes from the current position
- There are no keyboard transport shortcuts (Enter only commits the BPM and loop fields)

**Seek**:
- Click anywhere on the timeline ruler or on a waveform

**Scrub**:
- Drag on the timeline ruler: the playhead follows the mouse and you hear short slices of the
  mix, so you can find a spot by ear
- Scrubbing is silent while playback is running (the playhead still moves)

**Time Display**:
- Shows current time / total duration
- Format: `MM:SS / MM:SS`

### Loops, Snap and Markers (Desktop Mixer)

**A/B Loop**:
- **Shift+drag** on the ruler or on any waveform to set a loop region
- Drag the loop's start or end bound to adjust it
- Toggle the **Loop** button (🔁) to enable looping
- Or type the bounds in the **Loop** start/end fields in the toolbar: a timecode (`1:23.45`)
  or a bar number (`b17`, `b17.3` for bar 17, beat 3)
- Click **✕** next to the fields to clear the loop

**Snap to Beat**:
- The **Snap** toggle (🧲 magnet) makes loop bounds and markers land on the nearest beat
- Hold **Alt** while dragging to ignore snap for that one drag

**Markers**:
- **Alt+click** on a waveform lane sets the count-in **Start** marker
- **Ctrl+click** (Cmd+click on macOS) on a waveform lane sets the metronome **Stop** marker - the click stops
  there, the tracks keep playing

**Horizontal Scroll Mode**:
- The scroll mode button cycles Manual → Page → Center; it defaults to **Center** (the view
  follows the playhead)
- Only a choice made with the button is remembered for next time

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
- Desktop mixer: the structure bar shows the song's sections, synced to playback
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

StemTube detects chords automatically using the **BTC Transformer** (BTC-ISMIR19).

### Chord Detection Backend

**BTC Transformer** (the only chord backend)
- **Vocabulary**: 170 chord types
- **Speed**: 15-30 seconds per song
- **Genres**: All genres, including jazz/complex harmonies
- **Requirement**: Model weights at `external/BTC-ISMIR19/test/btc_model_large_voca.pt`
- **No fallback**: if BTC is missing or fails, the song simply has no chords

**madmom** is used only for beat and downbeat detection (the metronome grid), never for chords.
The `chords_use_madmom` and `chords_use_hybrid` settings in `core/config.json` have no effect.

### Using Chord Detection

**Automatic Detection**:
1. Download or upload a song
2. Chords are detected automatically right after the download (beats are detected after stem extraction)
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

**Genre Notes**:
- **Pop/Rock/Folk**: Generally reliable
- **Jazz/Classical**: Benefits from the 170-chord vocabulary
- **Electronic/Ambient**: May have mixed results (less harmonic content)

**Troubleshooting**:
- Incorrect chords: Regenerate chords from the mixer (there is no alternative backend to switch to)
- No chords detected: Check the logs for `[CHORDS] BTC not available` or `BTC error`
- BTC unavailable: Check the model weights (see [BTC Setup](../setup-guides/BTC-SETUP.md))
- Regenerating chords or beats keeps **Skip Intro** and the metronome alignment

---

## Lyrics & Karaoke

**Automatic synced lyrics** with word-level timing: the lyrics text comes from [LRCLIB](https://lrclib.net) (free, no account) and is aligned on the word timings of a faster-whisper transcription.

### Lyrics Transcription

**Automatic Detection**:
1. After download, StemTube keeps the YouTube metadata (artist, track, language) and looks the
   song up on LRCLIB (quick API call); if LRCLIB has line-synced lyrics, they are shown right
   away with line timing
2. After stem extraction, faster-whisper transcribes the isolated vocals stem in the language
   actually sung (detected on the voiced parts; the YouTube language is used when unsure)
3. The LRCLIB words are aligned on the Whisper word timings (source `lrclib+whisper`)
4. If fewer than 30 % of the words match, the alignment is rejected: line-synced LRCLIB lyrics
   keep their own line timing, text-only lyrics give way to the Whisper transcription. Songs
   not found on LRCLIB use the Whisper transcription alone

**Processing**:
- **CPU Mode**: 30-120 seconds per song
- **GPU Mode**: 10-30 seconds per song (3-5x faster)
- Runs right after stem extraction finishes

**Accuracy**:
- 90-95% word accuracy for clear vocals
- English: Best supported
- Other languages: Supported but may vary
- Instrumental sections: Detected and skipped

### Regenerating Lyrics

The **Regenerate lyrics (LRCLIB + Whisper)** button in the mixer (also on mobile) opens a dialog:

- **Search LRCLIB**: edit the artist/track and search; each result shows a badge **L**
  (line-synced) or **T** (text only, timed by Whisper) and its duration
- Pick a result, then **LRCLIB timing** (line-synced results only, no Whisper run) or
  **LRCLIB + Whisper sync** (word timing from Whisper)
- **Whisper Only**: skip LRCLIB and transcribe the vocals
- The success message shows the source, the language and how many words matched

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
- Wrong lyrics: Regenerate lyrics, fix the artist/track and pick the right LRCLIB result
- Timing off: word timings come from faster-whisper; regenerate with **LRCLIB + Whisper sync**,
  or **LRCLIB timing** for a line-synced result
- Language issues: the sung language is detected on the vocals; see
  [Troubleshooting](05-TROUBLESHOOTING.md) if lyrics come out in the wrong language

---

## Structure Analysis

**Automatic song sections** detected with MSAF when a song is downloaded.

- Sections are grouped **by similarity**: parts that sound alike share a letter, assigned in order
  of first appearance (e.g. `A B C D E D E D`)
- MSAF does **not** name sections intro / verse / chorus / bridge - a repeated letter is a hint
  (a returning chorus often shows up as the same letter), not a label
- Shown in the **desktop mixer's** structure bar, synced to playback (hover a section for its
  letter and timing); the mobile interface has no structure view
- Songs added before structure analysis was restored can be filled in by an admin with
  `python utils/analysis/reanalyze_all_structure.py` (~30 s per song)

Technical details:
[Structure Analysis Implementation](../feature-guides/STRUCTURE_ANALYSIS_IMPLEMENTATION.md).

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
- **Re-analyze**: Re-run chord/lyrics detection
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
- [Chord Detection Guide](../feature-guides/CHORD-DETECTION.md) - BTC Transformer chord detection
- [Frontend Guide](../developer-guides/FRONTEND-GUIDE.md) - Mixer engine, tempo/pitch and the mobile PWA

**For Administrators**:
- [Security Setup](../admin-guides/SECURITY_SETUP.md) - Production security
- [Service Management](../admin-guides/SERVICE_COMMANDS.md) - systemd service and production start

---

**Enjoy using StemTube!** 🎉

Extract stems, practice karaoke, and explore music like never before.
