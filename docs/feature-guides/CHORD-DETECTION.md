# Chord Detection Guide

Complete guide to StemTube's chord detection system (BTC Transformer on the harmonic stems, decoded on the beat grid).

---

## Table of Contents

- [Overview](#overview)
- [BTC Transformer](#btc-transformer)
- [What madmom Does (Beats Only)](#what-madmom-does-beats-only)
- [Pipeline](#pipeline) (steps, key detection, measured results)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

StemTube uses a **single chord detection backend**: the **BTC-ISMIR19 Transformer** (170-chord vocabulary).

There is **no fallback**. If BTC is unavailable or fails, the song simply has no chord data.

Chords are detected **after stem extraction**, not at download. They are only shown in the mixer
(carousel, grid popup, live prompter / stage window, desktop and mobile), which needs the stems
anyway. `core/chord_refiner.py` runs BTC on the **harmonic stems only** (no vocals, no drums), then
decodes the raw result on the madmom **beat grid**, so chord changes land on beats, one-beat flicker
disappears and the song **key** is derived from the chords. See [Pipeline](#pipeline).

> **History**: earlier versions shipped a 3-backend chain (BTC → madmom CRF → hybrid detector).
> That chain is gone. `core/hybrid_chord_detector.py` is dead code, madmom is no longer used for
> chords, and the `chords_use_madmom` / `chords_use_hybrid` keys in `core/config.json` are inert.

**Detection Features**:
- Automatic chord recognition from the harmonic stems
- Two names per chord - detailed (`Em7`) and simple (`Em`) - with a Simple / Detailed toggle
- Key derived from the chords
- Synchronized with mixer playback
- Timeline visualization with fixed reading focus
- Linear scroll view (Guitar Hero-style)
- Grid popup view with measure organization
- Click-to-seek functionality

---

## BTC Transformer

**Full Name**: Bi-directional Transformer for Chord recognition - ISMIR 2019

**Vocabulary**: 170 chord types

**Model**: Deep learning Transformer architecture

**Location**: `external/BTC-ISMIR19/` (inside the project, weights tracked in git)
- Weights: `external/BTC-ISMIR19/test/btc_model_large_voca.pt`
- Wrapper: `external/BTC-ISMIR19/btc_wrapper.py`
- StemTube integration: `core/btc_chord_detector.py` (`detect_segments()` returns the raw `(start, end, label)` segments, "N" kept), called by `core/chord_refiner.py`

**Chord Types**:
- Major / minor triads (12 roots each)
- Dominant 7th, major 7th, minor 7th
- Major 6th, minor 6th
- Suspended (sus2, sus4)
- Diminished, diminished 7th, half-diminished (m7b5)
- Augmented
- Extended (9, maj9, m9, 11, 13)
- No chord: N

**Total**: 170 unique chord labels

**Performance**:
- Speed: about 5-10 seconds per song for the whole chord pass (stem mix + BTC + decoding)
- Device: CPU (`btc_wrapper.py` defaults to `torch.device("cpu")`; no GPU needed)

**Limitations** (of the raw model - the [pipeline](#pipeline) below is there to absorb them):
- May over-fit complex chords on simple music (C → Cmaj7)
- Can confuse sus4 with major chords
- Incorrect extensions (C9 vs C11)
- Raw output flickers (A-B-A within a beat or two) and its boundaries ignore the beat grid

**Label Conversion**: BTC outputs colon notation (`D:min`, `G:7`, `D:hdim7`), which
`_convert_chord_label()` turns into display labels (`Dm`, `G7`, `Dm7b5`).

**Example Output** (`chords_data`, after the pipeline):
```json
[
  {"timestamp": 19.705, "chord": "Em7", "simple": "Em"},
  {"timestamp": 21.592, "chord": "A7", "simple": "A"},
  {"timestamp": 23.481, "chord": "Bm7", "simple": "Bm"},
  {"timestamp": 27.256, "chord": "F#maj7", "simple": "F#"}
]
```

- `chord` - detailed name (shown in **Detailed** mode), `simple` - its triad, root + major/minor (shown in **Simple** mode)
- Timestamps sit on beats of the grid; "N" (no chord) passages are omitted, so the previous chord stays on screen
- Songs analysed before this pipeline have no `simple` field; run Reanalyze or the backfill script

---

## What madmom Does (Beats Only)

madmom is still installed, but **only for beat and downbeat tracking**:
- Runs after stem extraction (`extensions.py`, via `MadmomChordDetector._detect_beats()`)
- Produces `beat_times`, `beat_positions` (downbeats) and `beat_offset`
- Feeds the metronome grid, the beat/measure layout of the chord views, and the chord decoding
  (chords are detected right after the beat grid, see [Pipeline](#pipeline))

Despite its name, `core/madmom_chord_detector.py` is not used to recognise chords.

---

## Pipeline

```
Download complete
    ↓
BPM, provisional key, Skip Intro, structure, LRCLIB lyrics preview   (NO chords)

Stem extraction complete
    ↓
Lyrics (LRCLIB + Whisper)
    ↓
madmom beat/downbeat detection → beat_times, beat_positions, beat_offset
    ↓
core/chord_refiner.py: update_song_chords(video_id)        "Detecting chords..."
    ↓
BTC available? ── no ──→ no chords ("[CHORDS] BTC is not available")
    ↓ yes
harmonic stems → BTC → beat-grid decoding → chords + key
    ↓
chords_data, detected_key, analysis_confidence saved to global_downloads
    ↓
Mixer pre-build (warm_prepare)
```

**Single entry point**: `update_song_chords(video_id, stems_paths=None, fallback_audio=None)` in
`core/chord_refiner.py`. It reads the stems, the beat grid and the BPM from the database and writes
**only** `chords_data`, `detected_key` and `analysis_confidence` - the beat grid, Skip Intro, lyrics
and structure are left untouched. It is called:
- after stem extraction (`extensions.py`, after the madmom beat grid, before the mixer pre-build)
- by `POST /api/extractions/<extraction_id>/chords/regenerate` (the **Reanalyze** button)
- after `POST /api/extractions/<extraction_id>/beats/regenerate` - the chords are re-decoded on the
  new grid and returned in the response as `chords`
- by `utils/analysis/reanalyze_all_chords.py` (backfill)

### Steps (`analyze_stems()` → `refine()`)

1. **Harmonic stems only.** Every stem whose name does not match
   `vocal|drum|kick|snare|tom|cymbal|hihat|metronome|click` is kept: bass + other for the 4-stem
   models, bass + guitar + piano + other for `htdemucs_6s`, every non-vocal non-drum stem for
   `mvsep_mega_fine` (`drums_full.mp3` is excluded). They are mixed to one temporary mono
   22.05 kHz file with ffmpeg `amix` (`normalize=0`). No harmonic stem on disk → the full mix is
   used instead (result `source` is `mix` instead of `stems`).
2. **BTC** runs on that file; `detect_segments()` returns the raw `(start, end, label)` segments
   with "N" kept.
3. **Beat grid prepared internally** (the stored grid is not modified): intervals of about twice
   the median beat period or more are subdivided - the beat tracker sometimes drops to half tempo
   for a section (seen on Jamiroquai "Virtual Insanity") - and the grid is extended to 0 and to the
   end of the song. No stored grid → a steady grid built from the BPM.
4. **Snap to beats.** Every raw boundary moves onto the grid: to the start of the beat it falls
   in, or to the **next** beat when it is 40 % or more into the beat - musicians often push a chord
   an eighth note early, never late. Segments squeezed to nothing (sub-beat blips) vanish.
5. **Viterbi decoding over beats, on triads** (root + major/minor). A chord change costs 0.35 on a
   downbeat, 0.55 mid-bar and 0.85 elsewhere (in beats of evidence), which removes A-B-A flicker
   while keeping real two-beat changes. When the chord changes pile up on another bar position
   than 1 - downbeat tracker out of phase, e.g. "It's Probably Me" (76 of 97 changes on beat 3) or
   "Walking On Sunshine" (on 2 and 4) - the costs follow that position. This is internal only;
   the stored downbeats are not touched.
6. **Major/minor doubts settled with the key.** A chord outside the key whose parallel is in the
   key becomes that parallel when it touches it (an E between two Em), unless the audio's third
   clearly disagrees (2x or more), or when the thirds in the harmonic chroma lean to the parallel.
7. **One-beat chords** between two others are absorbed - by the neighbour with the same root, else
   by the longer neighbour.
8. **Names.** Each segment takes the richest raw label that agrees with its triad when that label
   covers at least 50 % of the segment (`Bm7`, `A7`, `F#maj7`), else the plain triad. Both are
   stored: `chord` (detailed) and `simple` (triad). The chord changes are the same in both modes.

### Key Detection

The key is the best of the 24 major/minor keys, scored on:
- time spent on the key's chords (diatonic triads; bVII in major, and major IV and V in minor,
  count partially)
- time on the tonic, counted ×0.5 extra
- dominant resolutions onto the tonic (a major chord falling a fifth; a dominant 7th counts 1.0,
  a plain triad 0.3; ×1.5)
- +0.10 when the last chord is the tonic, +0.05 when the first one is
- +0.35 × the Krumhansl-Kessler correlation of the harmonic mix chroma (librosa `chroma_cqt`)

`detected_key` keeps sharp spelling (`A# major`, `D# minor`); `analysis_confidence` is the margin
over the runner-up key (0-1). This key **replaces the provisional key** computed at download, which
is only a chroma estimate on the full mix (often a fifth or a relative off).

### Measured Results

On the 18 songs of the test library with stems on disk:

| Song | Chords before → after |
|------|----------------------|
| It's Probably Me | 166 → 86 |
| Lose Yourself to Dance | 111 → 53 |
| Virtual Insanity | 262 → 121 |
| Sam Sauvage | 167 → 31 |
| Walking On Sunshine | 203 → 173 (it really changes every 2 beats) |

- Chord count roughly halved, zero sub-beat chords
- Keys: E minor (It's Probably Me), A# major (Walking On Sunshine), B major (The Lazy Song),
  D minor (You Know I'm No Good), D# minor (Virtual Insanity), A# minor (Lose Yourself to Dance)
- Known ambiguity: "Walking On The Moon" comes out C major instead of D minor (a Dm-C vamp)
- About 5-10 s per song on CPU

**Regeneration** (from the mixer): `POST /api/extractions/<extraction_id>/chords/regenerate`
re-runs the whole pipeline above. It takes no parameter and writes nothing about beats.
Beats have their own endpoint: `POST /api/extractions/<extraction_id>/beats/regenerate`, which
stores the new grid and then re-decodes the chords on it.

---

## Usage Examples

### Basic Detection

```python
from core.chord_refiner import update_song_chords

# Re-detects and stores the chords and key of an extracted song (stems, beat grid and BPM
# are read from the database). Returns None when nothing could be detected.
result = update_song_chords('<video_id>')

if result:
    print(result['key'], result['key_confidence'], result['source'])   # e.g. E minor 0.21 stems
    for chord in result['chords']:
        print(f"{chord['timestamp']:.2f}s: {chord['chord']} ({chord['simple']})")

# Output:
# 19.70s: Em7 (Em)
# 21.59s: A7 (A)
# 23.48s: Bm7 (Bm)
```

Raw BTC output, without the beat-grid decoding:

```python
from core.btc_chord_detector import detect_segments

for start, end, label in detect_segments('harmonic_mix.wav'):
    print(f"{start:.2f}-{end:.2f}s: {label}")   # "N" = no chord
```

### Check BTC Availability

```python
from core.btc_chord_detector import is_available
print(f"BTC available: {is_available()}")
```

### Filter by Chord Type

```python
chords = result['chords']   # or json.loads(row['chords_data']) from the database

minor_chords = [c for c in chords if c['chord'].endswith('m') or 'm7' in c['chord']]
seventh_chords = [c for c in chords if '7' in c['chord']]

print(f"Minor: {len(minor_chords)}")
print(f"7th: {len(seventh_chords)}")
```

### Export to Text

```python
def export_chords_to_txt(chords, output_path):
    """Export chords to human-readable text file."""
    with open(output_path, 'w') as f:
        for chord in chords:
            timestamp = chord['timestamp']
            minutes = int(timestamp // 60)
            seconds = int(timestamp % 60)
            f.write(f"[{minutes}:{seconds:02d}] {chord['chord']}\n")

export_chords_to_txt(result['chords'], 'chords.txt')
```

**Output** (`chords.txt`):
```
[0:00] C
[0:02] Am
[0:05] F
[0:07] G
[0:10] C
```

### Re-analyze All Songs

```bash
python utils/analysis/reanalyze_all_chords.py [--limit N] [--video-id ID]
```

Backfill for songs extracted before this pipeline (they still carry raw full-mix chords and the
old key). Extracted songs only; songs whose stems are not on disk (e.g. an unmounted drive) are
skipped. It calls `update_song_chords()`, so only `chords_data`, `detected_key` and
`analysis_confidence` are written - the beat grid, `beat_offset`, Skip Intro, lyrics and structure
are untouched. About 5-10 s per song on CPU.

---

## Configuration

There is currently **no working chord configuration**:
- BTC is always used when `external/BTC-ISMIR19` and its weights are present
- `chords_use_madmom` and `chords_use_hybrid` exist in `core/config.json` but nothing reads them
- Chord detection cannot be switched off per extraction
- The decoding constants (snap threshold, change costs) live at the top of `core/chord_refiner.py`
- The only user-facing option is the display one: **Simple / Detailed** chord names, stored per
  browser in `localStorage` (`stemtube_chord_detail`, default simple)

---

## Troubleshooting

### BTC Unavailable

**Symptom**: `[BTC] Warning: BTC path not found` or `[CHORDS] BTC is not available` in the logs; extracted songs have no chords

**Cause**: `external/BTC-ISMIR19` is missing, its weights are missing, or `btc_wrapper` fails to import

**Solution**:
```bash
# Check the model files
ls external/BTC-ISMIR19/test/btc_model_large_voca.pt
ls external/BTC-ISMIR19/btc_wrapper.py

# Verify the integration
python -c "from core.btc_chord_detector import is_available; print(is_available())"
```

See [BTC Setup Guide](../setup-guides/BTC-SETUP.md).

**No fallback**: StemTube does not switch to another detector - fix BTC, then regenerate chords.

---

### Incorrect Chords

**Symptom**: Detected chords don't match song

**Possible Causes**:
1. The song was extracted before the stems + beat-grid pipeline (raw full-mix chords)
2. Low-quality audio
3. Complex/ambiguous harmonies
4. BTC over-fitting extended chords on simple music
5. A wrong beat grid - the chords are decoded on it

**Solutions**:

**1. Regenerate** (the **Reanalyze** button of the Chords tab, desktop and mobile):
```bash
curl -X POST http://localhost:5011/api/extractions/<id>/chords/regenerate
```
(There is no alternative backend to switch to.)

**2. Switch to Simple names** if the extensions (`7`, `maj7`, `9`...) look wrong: the triads are
more reliable than the extensions.

**3. Regenerate the beats** if the grid itself is off; the chords are re-decoded on the new grid.

**4. Use High-Quality Audio**:
- Download best quality from YouTube
- Use lossless formats for uploads
- Avoid heavily compressed audio (< 128kbps)

---

### Too Many Chords / Chords Changing Off the Beat

**Symptom**: A chord change every beat or less, A-B-A flicker, chords that do not line up with the grid

**Cause**: The song was analysed before chords were decoded on the beat grid (raw BTC output on the
full mix, stored at download).

**Solution**: Click **Reanalyze** in the Chords tab, or backfill the whole library:
```bash
python utils/analysis/reanalyze_all_chords.py
```
A song that really changes every two beats ("Walking On Sunshine") keeps those changes.

---

### Wrong Key

**Symptom**: The key shown for the song is wrong ("F major" on almost every song, or a fifth / a
relative away from the real key)

**Causes**:
- The song is **not extracted yet**: the key shown is the provisional one computed at download,
  an approximate chroma estimate on the full mix. The final key comes with the chords, after
  extraction.
- The song was downloaded before the provisional key was fixed (the old estimate said "F major"
  for almost everything) and extracted before the key was derived from the chords.
- Genuinely ambiguous songs: a two-chord vamp such as Dm-C ("Walking On The Moon") can come out as
  C major instead of D minor. `analysis_confidence` (margin over the runner-up key) is low then.

**Solution**: Extract the song, or for an already extracted one click **Reanalyze** / run
`python utils/analysis/reanalyze_all_chords.py`.

---

### Slow Detection

**Symptom**: Chord detection takes > 60 seconds

**Causes**:
- Long song (> 10 minutes)
- Low-end hardware (BTC always runs on CPU)
- CPU shared with a running stem extraction or Whisper transcription

**Solutions**:

**1. Let other jobs finish**: chord detection competes for CPU with extraction and lyrics

**2. Check the logs** for repeated BTC initialisation or errors

---

### No Chords Detected

**Symptom**: Empty chord list or all "N" (no chord)

**Causes**:
- Song downloaded but not extracted yet (chords are detected after stem extraction)
- BTC unavailable or crashed (check logs first)
- Instrumental without clear harmonies
- Heavy distortion/noise
- Percussion-only track

**Solutions**:

**1. Check the song is extracted** - there are no chords before stem extraction

**2. Check the logs** for `[CHORDS]` / `[BTC]` lines

**3. Check Audio Content**:
- Chords require harmonic instruments (guitar, piano, etc.)

**4. Manual Verification**:
```bash
# Play audio file
ffplay audio.mp3

# If no chords audible, detection is correct
```

---

## API Integration

### Regenerate Chords via API

```bash
# Re-run the chord pipeline on the song (no request body needed)
curl -X POST http://localhost:5011/api/extractions/<extraction_id>/chords/regenerate
```

**Response**:
```json
{
  "success": true,
  "chords": [{"timestamp": 19.705, "chord": "Em7", "simple": "Em"}],
  "detected_key": "E minor",
  "key_confidence": 0.21,
  "source": "stems",
  "detected_bpm": 96.0,
  "beat_offset": 0.35,
  "beat_times": [0.35, 0.975],
  "beat_positions": [1, 2]
}
```
`source` is `stems` or `mix`. The beat fields echo the stored grid - nothing about beats is
written. `POST /api/extractions/<extraction_id>/beats/regenerate` re-decodes the chords on the new
grid and also returns them as `chords`.

The mixer reads chords and key through `GET /poc-mixer/meta/<id>`, which overlays `chords`, `key`,
`key_tonic`, `key_mode` and `key_confidence` from the database on every request (the cached
`meta.json` stays valid for the audio artifacts only), so a regeneration shows up without
rebuilding the mixer cache.

### Get Chords from Mixer

```javascript
// In mixer JavaScript
async function loadChords(extractionId) {
    const response = await fetch(`/api/extractions/${extractionId}`);
    const data = await response.json();

    if (data.chords_data) {
        const chords = typeof data.chords_data === 'string'
            ? JSON.parse(data.chords_data) : data.chords_data;
        displayChords(chords);
    }
}
```

---

---

## Chord Display Interface

### Overview

StemTube provides **two visualization modes** for chord playback:

1. **Linear View** - Horizontal scrolling with fixed reading focus (similar to Guitar Hero or Chordify)
2. **Grid View** - Popup with all chords organized by measures

Both views feature synchronized playback, tempo adaptation, and chord transposition support.

**Simple / Detailed names**: the Chords tab header has a **Simple / Detailed** toggle - triads
(`Em`, `A`) or the detailed names (`Em7`, `A7`). The chord changes are the same either way; only
the names differ. The choice is stored per browser (`localStorage` key `stemtube_chord_detail`,
default simple). Desktop: `setChords()` / `applyChordDetail()` in
`static/js/mixer/chord-display.js`; mobile: the `#mobileChordDetailBtn` button next to Reanalyze /
Grid View, applied in `setChordList()` in `static/js/mobile-app.js`. The live prompter / stage
window follows, since it mirrors the chord display.

**Reanalyze**: `#regenerateChordsBtn` in the desktop Chords tab header (and its mobile
counterpart) calls the regenerate endpoint above.

---

### Linear View (Default)

**Design Philosophy**: Content scrolls horizontally while the reading focus stays fixed at a specific position on the left side of the viewport.

**Key Features**:
- ✅ Horizontal auto-scroll synchronized with playback
- ✅ Fixed reading focus position (Desktop: 4th beat, Mobile: 2nd beat)
- ✅ Beat-by-beat highlighting including empty slots ("-")
- ✅ Tempo-independent positioning
- ✅ Lyrics displayed below each measure
- ✅ Click any beat to seek to that position

**Reading Focus Position**:
- **Desktop**: 4th beat from left edge (300px)
- **Mobile**: 2nd beat from left edge (80px) - Better anticipation on smaller screens

**Why Fixed Focus?**
- Musicians can keep their eyes on one spot while playing
- Upcoming chords arrive from the right, allowing anticipation
- Similar UX to Guitar Hero, Rocksmith, Chordify, and Moises AI
- No need to track a moving cursor across the screen

**Technical Implementation**:

```javascript
// Desktop: chord-display.js
syncChordPlayhead(force = false) {
    // Find current beat based on playback time
    const beatIdx = this.getBeatIndexForTime(currentTime);

    // Highlight the beat
    this.highlightBeat(beatIdx);

    // Scroll to keep highlighted beat in 4th position
    const activeBeat = this.beatElements[beatIdx];
    const beatLeft = activeBeat.offsetLeft; // Actual DOM position
    const fixedPlayheadPos = 3 * 100; // 4th beat (0-indexed)

    // Scroll so active beat appears at fixed position
    const targetScroll = beatLeft - fixedPlayheadPos;
    this.chordScrollContainer.scrollTo({ left: targetScroll, behavior: 'auto' });
}
```

**Mobile Variation**:
```javascript
// Mobile: mobile-app.js (2nd beat position)
const fixedPlayheadPos = 1 * 80; // 2nd beat for better anticipation
```

**Beat Structure**:
- Each measure divided into beats based on time signature (4/4 = 4 beats)
- Empty beats display "—" but are still highlighted to maintain rhythm
- Each beat stores the current active chord (even if empty)
- Overfilled measures automatically simplified to downbeats

**Tempo Handling**:
- Beat positions use actual DOM `offsetLeft` values, not mathematical calculations
- Works correctly at any tempo (50% - 200%)
- No tempo adjustment needed for highlighting
- Scroll position based on real element positions

**Scroll Behavior**:
- Instant scroll (`behavior: 'auto'`) to prevent interference from vertical scrolling
- Manual horizontal scroll blocked to maintain fixed focus
- Vertical scroll allowed for viewing chord diagrams below

---

### Grid View (Popup)

**Access**: Click "Grid View" button in chord controls

**Features**:
- All chords displayed in a grid organized by measures
- Measure numbers shown on the left
- Synchronized highlighting during playback
- Auto-scroll keeps active measure on the second visible row
- Click any beat to seek to that position

**Layout**:
- Each measure shows all beats in a horizontal row
- Beat width: 100px (desktop), 80px (mobile)
- Responsive grid: Adapts to viewport width
- Empty beats show "—" with timestamp

**Second Row Focus**:
```javascript
highlightGridBeat(beatIndex) {
    // Find active measure
    const parentMeasure = activeBeat.closest('.chord-grid-measure');

    // Get first measure height for row calculation
    const measureHeight = firstMeasure.offsetHeight;

    // Scroll to position active measure on second row
    const targetScroll = Math.max(0, relativeTop - measureHeight);

    popupBody.scrollTo({ top: targetScroll, behavior: 'smooth' });
}
```

**Why Second Row?**
- First row provides context of previous measures
- Active measure clearly visible
- Upcoming measures visible below for anticipation
- Prevents excessive scrolling

---

### Beat-Based Highlighting

**Concept**: Every beat (time division) is individually highlighted, even empty ones.

**Why Highlight Empty Beats?**
- Maintains visual rhythm and timing
- Shows when to continue holding current chord
- Helps musicians anticipate changes
- Consistent with musical notation (empty beats = hold)

**Implementation**:

```javascript
// Each beat stores the current active chord
if (beatChord) {
    lastActiveChord = beatChord.chord;
    measure.beats.push({
        chord: beatChord.chord,
        timestamp: beatChord.timestamp,
        empty: false
    });
} else {
    measure.beats.push({
        empty: true,
        currentChord: lastActiveChord // Carry forward the current chord
    });
}
```

**Beat Finding**:
```javascript
getBeatIndexForTime(time) {
    // Search through beat elements for the one containing current time
    for (let i = 0; i < this.beatElements.length; i++) {
        const beatTime = parseFloat(beatEl.dataset.beatTime);
        const nextBeatTime = parseFloat(this.beatElements[i + 1].dataset.beatTime);

        if (time >= beatTime && time < nextBeatTime) {
            return i; // Found the beat containing this time
        }
    }
    return this.beatElements.length - 1; // Last beat
}
```

---

### Tempo Independence

**Challenge**: When tempo changes (50% - 200%), positions must remain accurate.

**Solution**: Use actual DOM positions instead of mathematical calculations.

**Before (Broken)**:
```javascript
// Mathematical calculation based on BPM/tempo
const measureWidth = 100 * beatsPerBar;
const currentPosInTrack = (currentMeasure * measureWidth) + offset;
// ❌ Breaks when tempo changes or BPM calculations are off
```

**After (Robust)**:
```javascript
// Use actual element position in DOM
const activeBeat = this.beatElements[beatIdx];
const beatLeft = activeBeat.offsetLeft; // Real position
const targetScroll = beatLeft - fixedPlayheadPos;
// ✅ Always accurate, works at any tempo
```

**Why This Works**:
- Beat elements are already positioned correctly in the DOM
- `offsetLeft` gives actual pixel position
- No need for tempo rate adjustments
- Works with any song structure or BPM

---

### Chord Diagram Synchronization

**Display**: Chord diagram updates in real-time with highlighted beat

```javascript
highlightBeat(beatIndex) {
    const active = this.beatElements[beatIndex];

    // Get current chord for this beat (handles empty beats)
    const currentChordName = active.dataset.currentChord || '';

    if (currentChordName) {
        const transposedChord = this.transposeChord(currentChordName, this.currentPitchShift);
        this.renderChordDiagram(transposedChord); // Update diagram
    }
}
```

**Features**:
- Shows guitar fingering for current chord
- Updates on every beat change
- Supports chord transposition
- Works for both filled and empty beats

---

### Preventing Manual Scroll Interference

**Problem**: User scrolling vertically to view diagrams could interfere with horizontal auto-scroll.

**Solution**: Block manual horizontal scroll while allowing programmatic scroll.

```javascript
preventManualHorizontalScroll(scrollContainer) {
    // Block horizontal wheel scroll (shift+wheel, trackpad swipe)
    scrollContainer.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault(); // Block horizontal scroll
        }
    }, { passive: false });

    // Block horizontal touch swipe
    scrollContainer.addEventListener('touchmove', (e) => {
        const deltaX = Math.abs(touchX - touchStartX);
        const deltaY = Math.abs(touchY - touchStartY);

        if (deltaX > deltaY && deltaX > 10) {
            e.preventDefault(); // Block horizontal swipe
        }
    }, { passive: false });
}
```

**Result**:
- User can scroll vertically to view chord diagrams
- Horizontal scroll only controlled by playback (via `scrollTo()`)
- Fixed reading focus never lost

---

### Usage Examples

**Desktop Linear View**:
```javascript
// Chords automatically display in linear view
// Focus stays on 4th beat from left
// Scroll to view upcoming chords on the right
```

**Mobile Linear View**:
```javascript
// Same as desktop but focus on 2nd beat
// Better anticipation on smaller screens
```

**Grid View**:
```javascript
// Click "Grid View" button in controls
// See all measures at once
// Active measure scrolls to second row
// Click any beat to jump to that position
```

**Tempo Changes**:
```javascript
// Change tempo in mixer (50% - 200%)
// Chord positions automatically adjust
// Fixed focus maintained at all tempos
```

---

## Next Steps

- [Usage Guide](../user-guides/02-USAGE.md) - Stem extraction models, lyrics, mixer
- [Structure Analysis](STRUCTURE_ANALYSIS_IMPLEMENTATION.md) - MSAF sections (A/B/C similarity labels)
- [BTC Setup Guide](../setup-guides/BTC-SETUP.md) - BTC detector setup

---

**Chord Detection Version**: 2.1
**Last Updated**: September 2026
**Backends**: 1 (BTC Transformer on the harmonic stems, decoded on the madmom beat grid by `core/chord_refiner.py`)
**Vocabulary**: Up to 170 chord types (BTC)
**UI**: Linear + Grid views with fixed reading focus, Simple / Detailed names
