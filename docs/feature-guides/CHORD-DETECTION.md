# Chord Detection Guide

Complete guide to StemTube's chord detection system (BTC Transformer).

---

## Table of Contents

- [Overview](#overview)
- [BTC Transformer](#btc-transformer)
- [What madmom Does (Beats Only)](#what-madmom-does-beats-only)
- [Pipeline](#pipeline)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

StemTube uses a **single chord detection backend**: the **BTC-ISMIR19 Transformer** (170-chord vocabulary).

There is **no fallback**. If BTC is unavailable or fails, the song simply has no chord data.

> **History**: earlier versions shipped a 3-backend chain (BTC → madmom CRF → hybrid detector).
> That chain is gone. `core/hybrid_chord_detector.py` is dead code, madmom is no longer used for
> chords, and the `chords_use_madmom` / `chords_use_hybrid` keys in `core/config.json` are inert.

**Detection Features**:
- Automatic chord recognition from audio
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
- StemTube integration: `core/btc_chord_detector.py`, called by `core/chord_detector.py`

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
- Speed: 15-30 seconds per song
- Device: CPU (`btc_wrapper.py` defaults to `torch.device("cpu")`; no GPU needed)

**Limitations**:
- May over-fit complex chords on simple music (C → Cmaj7)
- Can confuse sus4 with major chords
- Incorrect extensions (C9 vs C11)

**Label Conversion**: BTC outputs colon notation (`D:min`, `G:7`, `D:hdim7`), which
`_convert_chord_label()` turns into display labels (`Dm`, `G7`, `Dm7b5`). Consecutive identical
chords are merged.

**Example Output** (`chords_data`):
```json
[
  {"timestamp": 0.0, "chord": "Cmaj7"},
  {"timestamp": 2.5, "chord": "Am9"},
  {"timestamp": 5.0, "chord": "Dm7b5"},
  {"timestamp": 7.5, "chord": "G13"}
]
```

---

## What madmom Does (Beats Only)

madmom is still installed, but **only for beat and downbeat tracking**:
- Runs after stem extraction (`extensions.py`, via `MadmomChordDetector._detect_beats()`)
- Produces `beat_times`, `beat_positions` (downbeats) and `beat_offset`
- Feeds the metronome grid and the beat/measure layout of the chord views

Despite its name, `core/madmom_chord_detector.py` is not used to recognise chords.

---

## Pipeline

```
Download complete
    ↓
core/chord_detector.py: analyze_audio_file()
    ↓
BTC available? ── no ──→ no chords ("[CHORDS] BTC not available")
    ↓ yes
BTC detection ── fails ──→ no chords ("[CHORDS] BTC error: ...")
    ↓ success
chords_data saved to global_downloads

Stem extraction complete
    ↓
madmom beat/downbeat detection → beat_times, beat_positions, beat_offset
```

**Regeneration** (from the mixer): `POST /api/extractions/<extraction_id>/chords/regenerate`
re-runs BTC on the full audio. It takes no backend parameter.
Beats have their own endpoint: `POST /api/extractions/<extraction_id>/beats/regenerate`.

---

## Usage Examples

### Basic Detection

```python
from core.chord_detector import analyze_audio_file
import json

# Returns (chords_json, beat_offset, beat_times, beat_positions).
# Only chords_json is meaningful here: beats are detected post-extraction by madmom.
chords_json, _, _, _ = analyze_audio_file('audio.mp3')

if chords_json:
    for chord in json.loads(chords_json):
        print(f"{chord['timestamp']:.2f}s: {chord['chord']}")

# Output:
# 0.00s: C
# 2.50s: Am
# 5.00s: F
# 7.50s: G
```

### Check BTC Availability

```python
from core.btc_chord_detector import is_available
print(f"BTC available: {is_available()}")
```

### Filter by Chord Type

```python
chords = json.loads(chords_json)

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

export_chords_to_txt(json.loads(chords_json), 'chords.txt')
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
python utils/analysis/reanalyze_all_chords.py
```

⚠️ Skip Intro is preserved, but the script still passes BTC's placeholder beat offset (`0.0`) to
`update_download_analysis()`, so the stored `beat_offset` becomes 0 for every song it touches
(BTC detects no beats). The mixer's chord regenerate route does not have this side effect.

---

## Configuration

There is currently **no working chord configuration**:
- BTC is always used when `external/BTC-ISMIR19` and its weights are present
- `chords_use_madmom` and `chords_use_hybrid` exist in `core/config.json` (and are still read by
  the regenerate route) but have no effect on detection
- Chord detection cannot be switched off per extraction

---

## Troubleshooting

### BTC Unavailable

**Symptom**: `[BTC] Warning: BTC path not found` or `[CHORDS] BTC not available` in the logs; songs have no chords

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
1. Low-quality audio
2. Complex/ambiguous harmonies
3. BTC over-fitting extended chords on simple music

**Solutions**:

**1. Regenerate**:
```bash
curl -X POST http://localhost:5011/api/extractions/<id>/chords/regenerate
```
(There is no alternative backend to switch to.)

**2. Use High-Quality Audio**:
- Download best quality from YouTube
- Use lossless formats for uploads
- Avoid heavily compressed audio (< 128kbps)

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
- BTC unavailable or crashed (check logs first)
- Instrumental without clear harmonies
- Heavy distortion/noise
- Percussion-only track

**Solutions**:

**1. Check the logs** for `[CHORDS]` / `[BTC]` lines

**2. Check Audio Content**:
- Chords require harmonic instruments (guitar, piano, etc.)

**3. Manual Verification**:
```bash
# Play audio file
ffplay audio.mp3

# If no chords audible, detection is correct
```

---

## API Integration

### Regenerate Chords via API

```bash
# Re-run BTC on the song (no request body needed)
curl -X POST http://localhost:5011/api/extractions/<extraction_id>/chords/regenerate
```

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
**Backends**: 1 (BTC Transformer; madmom used for beats only)
**Vocabulary**: Up to 170 chord types (BTC)
**UI**: Linear + Grid views with fixed reading focus
