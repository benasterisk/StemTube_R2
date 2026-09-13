# StemTube Frontend Guide

Complete guide to the JavaScript frontend architecture and modules.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Main Application](#main-application)
- [Mixer Modules](#mixer-modules)
  - [Core Modules](#core-modules)
  - [Audio Processing](#audio-processing)
  - [Display Modules](#display-modules)
  - [Mobile Modules](#mobile-modules)
- [Module Dependencies](#module-dependencies)
- [Web Audio API](#web-audio-api)
- [State Management](#state-management)

---

## Overview

**Module Count**:
- Main app: `app.js` (+ `app-*.js` helpers)
- Desktop mixer: POC engine in `static/js/poc/` (15 files loaded by `templates/mixer.html`)
  plus 7 live files from `static/js/mixer/`
- Mobile mixer: the same POC engine via `static/js/mixer/mobile-poc-engine.js`
- 20 files in `static/js/mixer/` are orphaned (loaded by no template) - see
  [Orphaned Modules](#orphaned-modules)

**Technology Stack**:
- Vanilla JavaScript ES6+
- Web Audio API + AudioWorklet
- SoundTouch (pitch/tempo processing)
- SocketIO (real-time communication)
- LocalStorage (state persistence)

**Browser Support**:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

## Architecture

### Module Organization

```
static/js/
├── app.js                      # Main application (downloads, extractions)
├── poc/                        # Desktop mixer engine (POC) - loaded by templates/mixer.html
│   ├── api.js                  # All /poc-mixer/* server calls
│   ├── audio.js                # Multi-stem Web Audio engine + SoundTouch worklet
│   ├── state.js                # Per-song session persistence (localStorage "poc_state")
│   ├── timeline.js             # Ruler, waveforms, beat grid, playhead, zoom
│   ├── mixer.js                # Track rows (controls left, waveform lanes right)
│   ├── tempo.js                # BPM (time-stretch) + pitch (semitones)
│   ├── precount.js             # Detect Intro + baked count-in
│   ├── snap.js                 # Shared snap-to-beat toggle
│   ├── scrub.js                # Playhead scrubbing with audible slices
│   ├── loop.js                 # A/B loop: draggable bounds + numeric fields
│   ├── loader.js               # Prepare / poll / load an extraction
│   ├── main.js                 # Transport, zoom, render loop (glue)
│   ├── export.js               # Server-side mix export modal
│   ├── mixer-compat.js         # window.mixer shim for the display components
│   └── recording-ui.js         # Recording lanes on the POC mixer
└── mixer/                      # Desktop mixer loads only the first 7 below:
    ├── stage-window.js         # Chords grid / lyrics focus in a real browser window
    ├── chord-display.js        # Chord timeline
    ├── karaoke-display.js      # Lyrics display
    ├── structure-display.js    # Structure sections (MSAF, A/B/C labels)
    ├── lyrics-popup.js         # Lyrics modal
    ├── recording-effects.js    # Per-recording-track effects chain
    ├── recording-engine.js     # Multi-track recording & playback
    ├── mobile-poc-engine.js    # POC engine bridge for the mobile PWA (loaded by the mobile page)
    └── (20 orphaned files)     # Pre-POC design, loaded by no template
```

### Design Patterns

**1. Object-Literal Singletons** (POC engine modules):
```javascript
// static/js/poc/*.js - one global object per concern, wired by main.js
const LoopSel = {
    engine: null, view: null,
    init(engine, view) { this.engine = engine; this.view = view; this._wire(); },
    _wire() { /* DOM handlers */ }
};
```

**2. Class-Based Modules** (`AudioEngine`, display components, `RecordingEngine`):
```javascript
class KaraokeDisplay {
    constructor(containerSelector, extractionId) {
        this.init();
    }

    sync(currentTime) {
        // Called during playback
    }
}

window.KaraokeDisplay = KaraokeDisplay;
```

**3. Shared Globals, No Event Bus**:
```javascript
// Modules talk through globals (engine, View, TempoPitch, PreCount, LoopSel, Snap).
// Display components written for the pre-POC mixer reach the engine through the
// window.mixer shim built by mixer-compat.js:
window.mixer.audioEngine.seek(42.0);

// Stage windows (stage-window.js) mirror the main mixer over a BroadcastChannel.
```

---

## Main Application

### app.js

**Purpose**: Main application for downloads and extractions

**Size**: ~1,200 lines

**Key Features**:
- YouTube search integration
- Download management (YouTube + file upload)
- Extraction initiation and monitoring
- WebSocket real-time updates
- Admin panel integration

**Major Functions**:

**1. YouTube Search**:
```javascript
async function searchYouTube(query) {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    displaySearchResults(data.results);
}
```

**2. Download Audio**:
```javascript
async function downloadAudio(videoId) {
    const response = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId })
    });

    const data = await response.json();
    if (data.success) {
        showNotification('Download started!');
    }
}
```

**3. Extract Stems**:
```javascript
async function extractStems(videoId, model, stems) {
    const response = await fetch('/api/extractions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            video_id: videoId,
            model: model,
            stems: stems,
            generate_chords: true,
            generate_lyrics: true
        })
    });

    const data = await response.json();
    pollExtractionStatus(data.extraction_id);
}
```

**4. WebSocket Integration**:
```javascript
// Initialize SocketIO
const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
});

// Listen for download progress
socket.on('download_progress', (data) => {
    updateProgressBar(data.video_id, data.progress);
});

// Listen for extraction complete
socket.on('extraction_complete', (data) => {
    showNotification('Extraction complete!');
    refreshDownloadsList();
});
```

**5. Local/Remote Detection**:
```javascript
// Determine if user is local or remote
function isLocalUser() {
    const hostname = window.location.hostname;
    return hostname === 'localhost' ||
           hostname === '127.0.0.1' ||
           hostname.startsWith('192.168.') ||
           hostname.startsWith('10.') ||
           hostname.startsWith('172.');
}

// Show "Open Folder" button only for local users
if (isLocalUser()) {
    showOpenFolderButton();
}
```

**File**: static/js/app.js

---

## Mixer Modules

The desktop mixer (`templates/mixer.html`) runs the **POC engine** from `static/js/poc/`,
served by the `/poc-mixer/*` bridge in `routes/poc_mixer.py`. Only 7 files from
`static/js/mixer/` are loaded alongside it. The pre-POC architecture (`core.js` coordinator,
`audio-engine.js`, `waveform.js`, `timeline.js`, `track-controls.js`, `simple-pitch-tempo.js`,
`soundtouch-engine.js`) is no longer loaded - see [Orphaned Modules](#orphaned-modules).

### Core Modules

#### 1. main.js / loader.js / api.js

**Purpose**: Wiring, load flow and server calls

- `main.js` - creates the `AudioEngine`, wires transport, zoom and the render loop (glue only)
- `loader.js` - the page is opened with `window.EXTRACTION_ID`; the loader asks the bridge to
  prepare the extraction's mixer artifacts, polls progress, then loads stems + metadata
- `api.js` - every `/poc-mixer/*` call in one place (`prepare`, `progress`, `meta`, `audio`, ...)

**Load Flow**:
```javascript
// loader.js
await API.prepare(extractionId);      // POST /poc-mixer/prepare/<id>
// poll GET /poc-mixer/progress/<id> until ready
const meta = await API.meta(extractionId);   // GET /poc-mixer/meta/<id> (gzipped)
// stems and metronome WAVs stream from GET /poc-mixer/audio/<id>/<stem>
```

After every extraction the backend already runs `warm_prepare()`, so the first open is usually
instant.

**Files**: static/js/poc/main.js, static/js/poc/loader.js, static/js/poc/api.js

---

#### 2. state.js

**Purpose**: Per-song UI session persistence using LocalStorage

**Persisted State** (key `poc_state`, one entry per extraction):
- Per-track mute, solo, volume, pan
- Zoom (`pxPerSec`, `zoomV`) and scroll mode
- Playhead position
- Tempo target, base BPM, pitch semitones
- Metronome resolution, Start/Stop markers, precount beats
- A/B loop bounds and enabled flag
- Snap-to-beat toggle

**File**: static/js/poc/state.js

---

### Audio Processing

#### 3. audio.js

**Purpose**: Sample-accurate multi-stem playback engine (Web Audio) with SoundTouch
time-stretch and pitch-shift

**Architecture** (per stem):
```
AudioBufferSourceNode (playbackRate)
    ↓
SoundTouch AudioWorkletNode (tempo, pitch)
    ↓
GainNode (volume / mute / solo)
    ↓
StereoPannerNode (pan)
    ↓
Master GainNode → DynamicsCompressor (brick-wall limiter) → destination
```

**Key Features**:
- Hybrid tempo: speed-up uses native `playbackRate`, slow-down uses SoundTouch tempo
- Metronome follows tempo but is never pitch-shifted
- Metronome and count-in are server-rendered WAVs played as ordinary stems (sample-locked)
- Native loop points for seamless A/B looping

**File**: static/js/poc/audio.js

---

#### 4. tempo.js

**Purpose**: BPM (time-stretch) and pitch (semitones) controller

**Features**:
- Base BPM = median inter-beat interval of the detected beats
- Sliding-window local BPM readout during playback
- Tempo ratio 0.5x to 2.0x

**File**: static/js/poc/tempo.js

---

#### 5. precount.js

**Purpose**: "Detect Intro" and count-in

The count-in is baked into the metronome WAVs server-side, so it stays sample-locked to the
stems at any tempo. The Off/2/4/8 toggle chooses how many baked beats are heard before the
Start marker.

**File**: static/js/poc/precount.js

---

#### 6. stage-window.js

**Purpose**: Chords grid view / lyrics focus in a real browser window (`window.open`)

The stage window loads the same mixer page with `?stage=lyrics|chords` as a display mirror: no
audio, clock driven by the main mixer over a BroadcastChannel, transport commands sent back.

**File**: static/js/mixer/stage-window.js

---

### Display Modules

#### 7. timeline.js

**Purpose**: Timeline ruler, waveforms, beat grid, playhead and zoom

All lanes share one time→px mapping (`pxPerSec`), so they stay aligned at any zoom. Waveform
peaks come precomputed in `/poc-mixer/meta`.

**File**: static/js/poc/timeline.js

---

#### 8. mixer.js

**Purpose**: Track rows - fixed controls on the left, waveform lanes on the right

- Stem order covers 4-stem, 6-stem and `mvsep_mega_fine` names; unknown stems are appended
- Volume shown in dB, pan, mute, solo per track
- The small per-track record dot button in the lane header is a stub ("coming soon"); recording itself is live (see
  [Recording Modules](#16-recording-modules))

**File**: static/js/poc/mixer.js

---

#### 9. snap.js

**Purpose**: One snap-to-beat setting shared by every surface

Loop bounds (dragged on a waveform or on the timeline) and the Start/Stop markers call
`Snap.toBeat(t, view)`. Holding Alt ignores the grid for one drag. Beats come from madmom.

**File**: static/js/poc/snap.js

---

#### 10. scrub.js

**Purpose**: Playhead scrubbing with audible slices

Dragging the ruler moves the playhead and plays short slices (~140 ms, throttled) through
throwaway `AudioBufferSourceNode`s straight into the master gain, bypassing SoundTouch. A single
seek lands the real transport when the drag ends.

**File**: static/js/poc/scrub.js

---

#### 11. loop.js

**Purpose**: A/B loop selection

- Drag across any waveform to define a region; bounds are draggable afterwards
- Two numeric fields accept a timecode (`1:23.45`) or a bar (`b17`, `b17.3` = bar 17 beat 3)
- Bounds snap to beats when snap is on

**File**: static/js/poc/loop.js

---

#### 12. chord-display.js

**Purpose**: Chord timeline visualization

**Size**: ~2,000 lines (largest module)

**Features**:
- Timeline chord progression display
- Color-coded chord types (major, minor, 7th, etc.)
- Synchronized playhead
- Click to seek
- SVG chord diagrams (guitar, piano)

**Chord Timeline Rendering**:
```javascript
function drawChordTimeline(chords, duration) {
    const canvas = document.getElementById('chord-timeline');
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each chord
    for (const chord of chords) {
        const x = (chord.timestamp / duration) * canvas.width;
        const width = 80;  // Fixed width per chord

        // Color by chord type
        const color = getChordColor(chord.chord);

        // Draw chord box
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, width, canvas.height);

        // Draw chord label
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(chord.chord, x + width / 2, canvas.height / 2);
    }
}
```

**Chord Color Coding**:
```javascript
function getChordColor(chord) {
    if (chord.includes(':maj')) return '#4a9eff';  // Blue
    if (chord.includes(':min')) return '#5fe37d';  // Green
    if (chord.includes(':7')) return '#ff9f43';    // Orange
    if (chord.includes(':dim')) return '#ee5a6f';  // Red
    if (chord.includes(':aug')) return '#a55eea';  // Purple
    return '#95afc0';  // Gray (unknown)
}
```

**File**: static/js/mixer/chord-display.js

---

#### 13. karaoke-display.js

**Purpose**: Synchronized lyrics display

**Size**: ~490 lines

**Features**:
- Word-level highlighting
- Auto-scroll to current line
- Click to seek
- Mobile-optimized (focused view)

**Lyrics Rendering**:
```javascript
function displayLyrics(lyricsData) {
    const container = document.getElementById('lyrics');

    for (const line of lyricsData) {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'lyrics-line';
        lineDiv.dataset.start = line.start;
        lineDiv.dataset.end = line.end;

        for (const word of line.words) {
            const wordSpan = document.createElement('span');
            wordSpan.className = 'lyrics-word';
            wordSpan.dataset.start = word.start;
            wordSpan.dataset.end = word.end;
            wordSpan.textContent = word.word + ' ';

            lineDiv.appendChild(wordSpan);
        }

        container.appendChild(lineDiv);
    }
}
```

**Karaoke Highlighting**:
```javascript
function updateKaraoke(currentTime) {
    const words = document.querySelectorAll('.lyrics-word');

    for (const word of words) {
        const start = parseFloat(word.dataset.start);
        const end = parseFloat(word.dataset.end);

        if (currentTime >= start && currentTime < end) {
            word.classList.add('active');  // Highlight current word
        } else {
            word.classList.remove('active');
        }
    }

    // Auto-scroll to current line
    const activeLine = document.querySelector('.lyrics-line.active');
    if (activeLine) {
        activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
```

**File**: static/js/mixer/karaoke-display.js

---

#### 14. structure-display.js

**Purpose**: Song structure visualization

> **Data source:** `routes/pages.py` passes `structure_data` to the mixer page in
> `EXTRACTION_INFO`; `loadStructureFromExtractionInfo()` renders it on init. The component's
> `analyzeStructure()` calls `POST /api/extractions/<id>/analyze-structure` (`routes/media.py`),
> but no UI control invokes it. Sections come from `core/msaf_structure_detector.py`: similarity
> clusters labelled `A`, `B`, `C`... in order of first appearance - never verse/chorus names.
> Desktop mixer only (the mobile PWA has no structure view).

**Size**: ~620 lines

**Structure Sections**:
- Numbered blocks; the tooltip shows the MSAF letter label (`Section 3 (B)`) and timing
- Color-coded by chord similarity between sections (label-based grouping without chords)
- Click to jump to section, double-click to loop it

**Rendering**:
```javascript
function drawStructure(structureData, duration) {
    const canvas = document.getElementById('structure');
    const ctx = canvas.getContext('2d');

    for (const section of structureData) {
        const x1 = (section.start / duration) * canvas.width;
        const x2 = (section.end / duration) * canvas.width;
        const width = x2 - x1;

        // Color by section type
        const color = getSectionColor(section.label);

        // Draw section
        ctx.fillStyle = color;
        ctx.fillRect(x1, 0, width, canvas.height);

        // Draw label
        ctx.fillStyle = '#000000';
        ctx.font = '14px Arial';
        ctx.fillText(section.label, x1 + 5, canvas.height / 2);
    }
}
```

**File**: static/js/mixer/structure-display.js

---

#### 15. mixer-compat.js / export.js / lyrics-popup.js

- `mixer-compat.js` - thin `window.mixer` object (currentTime, maxDuration, isPlaying,
  `audioEngine.seek()`, ...) so the chord/lyrics/structure components drive off the POC engine
- `export.js` - modal that POSTs the current mix state to `/poc-mixer/export` (MP3/WAV, optional
  metronome, original tempo)
- `lyrics-popup.js` - lyrics modal

**Files**: static/js/poc/mixer-compat.js, static/js/poc/export.js, static/js/mixer/lyrics-popup.js

---

#### 16. Recording Modules

**Purpose**: Multi-track recording on the desktop mixer (live)

- `recording-engine.js` - `RecordingEngine`: capture, latency compensation, playback, upload to
  `/api/recordings` (see `routes/recordings.py`)
- `recording-effects.js` - per-track chain: HPF → EQ → compressor → reverb send
- `recording-ui.js` - builds recording control blocks and lanes in the POC layout

**Files**: static/js/mixer/recording-engine.js, static/js/mixer/recording-effects.js,
static/js/poc/recording-ui.js

---

### Mobile Modules

#### 17. mobile-poc-engine.js

**Purpose**: Runs the POC `AudioEngine` (`static/js/poc/audio.js`) inside the mobile PWA

`mobile-app.js` keeps its UI and orchestration (track widgets, jam broadcast, recording hooks,
wake lock, lyrics scroll); only the audio primitives are delegated:

```javascript
loadAll(job, names, meta)          // engine.setStems (metronome included)
startAll(pos) / stopAll() / seek(t) / pos() / playing
setVol / setPan / setMute / setSolo(name, v)
applyTempoPitch(ratio, semi)
```

Metronome and count-in are the same server-rendered WAVs as on desktop.

**File**: static/js/mixer/mobile-poc-engine.js

---

### Orphaned Modules

These files in `static/js/mixer/` are loaded by **no template**. They are the pre-POC mixer and
the old mobile engine and its patches; do not document or extend them as live code:

`advanced-controls.js`, `audio-engine.js`, `core.js`, `export-handler.js`,
`mixer-persistence.js`, `mobile-audio-engine.js`, `mobile-audio-fixes.js`,
`mobile-audio-patch.js`, `mobile-debug-fix.js`, `mobile-direct-fix.js`,
`mobile-playhead-fix.js`, `mobile-simple-fixes.js`, `mobile-touch-fix.js`,
`simple-pitch-tempo.js`, `soundtouch-engine.js`, `stem-worklet.js`, `tab-manager.js`,
`timeline.js`, `track-controls.js`, `waveform.js`

`static/css/mixer/mixer.css` (the `@import` aggregator) is likewise loaded by no template.

---

## Module Dependencies

### Dependency Graph

```
main.js
  ├── audio.js (AudioEngine)
  ├── timeline.js (View)
  ├── mixer.js
  ├── state.js
  ├── tempo.js
  ├── precount.js
  ├── snap.js ← loop.js, precount.js
  ├── scrub.js
  ├── loop.js
  ├── loader.js → api.js
  └── export.js
mixer-compat.js (window.mixer shim)
  ├── chord-display.js
  ├── structure-display.js
  ├── karaoke-display.js
  ├── lyrics-popup.js
  └── recording-ui.js → recording-engine.js → recording-effects.js
stage-window.js (BroadcastChannel mirror)
```

### Load Order

**Mixer page** (`templates/mixer.html`):
```html
<!-- POC engine -->
<script src="/static/js/poc/api.js"></script>
<script src="/static/js/poc/audio.js"></script>
<script src="/static/js/poc/state.js"></script>
<script src="/static/js/poc/timeline.js"></script>
<script src="/static/js/poc/mixer.js"></script>
<script src="/static/js/poc/tempo.js"></script>
<script src="/static/js/poc/precount.js"></script>
<script src="/static/js/poc/snap.js"></script>
<script src="/static/js/poc/scrub.js"></script>
<script src="/static/js/poc/loop.js"></script>
<script src="/static/js/poc/loader.js"></script>
<script src="/static/js/poc/main.js"></script>
<script src="/static/js/mixer/stage-window.js"></script>
<script src="/static/js/poc/export.js"></script>

<!-- Display components + compat shim -->
<script src="/static/js/mixer/chord-display.js"></script>
<script src="/static/js/mixer/structure-display.js"></script>
<script src="/static/js/mixer/karaoke-display.js"></script>
<script src="/static/js/mixer/lyrics-popup.js"></script>
<script src="/static/js/poc/mixer-compat.js"></script>

<!-- Recording -->
<script src="/static/js/mixer/recording-effects.js"></script>
<script src="/static/js/mixer/recording-engine.js"></script>
<script src="/static/js/poc/recording-ui.js"></script>
```

**Mixer CSS**: `css/mixer/{chords,karaoke,export,structure,lyrics-popup}.css` are linked
directly; themes are inline CSS in `mixer.html`.

---

## Web Audio API

### AudioContext

**Creation**:
```javascript
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioContext();
```

**Sample Rate**: 48000 Hz (typical)

**State**: `suspended`, `running`, `closed`

**Resume** (required after user interaction):
```javascript
audioContext.resume().then(() => {
    console.log('AudioContext running');
});
```

### Audio Graph

**POC Mixer Graph** (`static/js/poc/audio.js`):
```
AudioBufferSourceNode (vocals, playbackRate)
    ↓
AudioWorkletNode (SoundTouch: tempo, pitch)
    ↓
GainNode (volume: 0.8)
    ↓
StereoPannerNode (pan: -0.5)
    ↓
GainNode (master: 1.0)
    ↓
DynamicsCompressorNode (brick-wall limiter)
    ↓
AudioDestinationNode (speakers)
```

**Parallel Stems**:
```
[metronome] → [soundtouch] → [gain] → [pan] ─┐
[vocals]    → [soundtouch] → [gain] → [pan] ─┤
[drums]     → [soundtouch] → [gain] → [pan] ─┼→ [master gain] → [limiter] → [destination]
[bass]      → [soundtouch] → [gain] → [pan] ─┤
[other]     → [soundtouch] → [gain] → [pan] ─┘
```

### AudioWorklet

**Why AudioWorklet**:
- Runs in separate thread (non-blocking)
- Low latency
- Precise audio processing

**Example** (as in `audio.js`):
```javascript
// Load worklet module once (needs a secure context: localhost/HTTPS)
await audioContext.audioWorklet.addModule('/static/wasm/soundtouch-worklet.js');

// Create one worklet node per stem source
const st = new AudioWorkletNode(audioContext, 'soundtouch-processor');

// Parameters are AudioParams
st.parameters.get('tempo').value = 1.0;
st.parameters.get('pitch').value = 1.0;
st.parameters.get('rate').value = 1.0;
```

---

## State Management

### LocalStorage

**Key**: `poc_state` (one object, entries keyed by extraction id, plus `_lastJob`)

**Saved State** (per extraction):
```javascript
{
    "label": "Song Title",
    "pxPerSec": 40,
    "zoomV": 1,
    "scrollMode": "center",
    "snapEnabled": true,
    "pos": 42.5,
    "bpmBase": 120.3,
    "bpmTarget": 110,
    "pitchSemitones": 0,
    "metroRes": "1",
    "startTime": 3.2,
    "precountBeats": 4,
    "precountActive": true,
    "stopTime": null,
    "loopA": 30.0,
    "loopB": 45.0,
    "loopEnabled": false,
    "tracks": {
        "vocals": { "muted": false, "solo": false, "vol": 1.0, "pan": 0 },
        "drums":  { "muted": false, "solo": false, "vol": 0.8, "pan": 0 }
    }
}
```

**Save / Restore**:
```javascript
SessionState.save(job, view, engine);
SessionState.apply(job, view, engine);
```

### Cross-Module Updates

There is no `mixer:*` custom-event bus in the live mixer. Modules call each other through
globals (`engine`, `View`, `TempoPitch`, `PreCount`, `LoopSel`, `Snap`); the legacy display
components use the `window.mixer` shim and are driven by `sync(currentTime)` from the render
loop. Stage windows receive `{pos, playing, rate, bpm, semi}` over a BroadcastChannel.

---

## Best Practices

### 1. Use Async/Await

```javascript
// GOOD
async function loadAudio() {
    const response = await fetch('/api/audio');
    const data = await response.json();
    return data;
}

// BAD
function loadAudio() {
    return fetch('/api/audio')
        .then(r => r.json())
        .then(data => data);
}
```

### 2. Use const/let (not var)

```javascript
// GOOD
const API_BASE = '/api';
let currentTime = 0;

// BAD
var API_BASE = '/api';
var currentTime = 0;
```

### 3. Use Template Literals

```javascript
// GOOD
const message = `Loading ${fileName}...`;

// BAD
const message = 'Loading ' + fileName + '...';
```

### 4. Use Arrow Functions

```javascript
// GOOD
items.forEach(item => {
    processItem(item);
});

// BAD
items.forEach(function(item) {
    processItem(item);
});
```

### 5. Handle Errors

```javascript
try {
    const data = await loadAudio();
    processData(data);
} catch (error) {
    console.error('Failed to load audio:', error);
    showError('Audio loading failed');
}
```

---

## Next Steps

- [API Reference](API-REFERENCE.md) - All endpoints
- [Backend Guide](BACKEND-GUIDE.md) - Python modules
- [Database Schema](DATABASE-SCHEMA.md) - Database structure
- [Architecture Guide](ARCHITECTURE.md) - System design

---

**Frontend Version**: 2.0
**Last Updated**: September 2026
**Desktop Mixer**: POC engine (`static/js/poc/`) + 7 live files in `static/js/mixer/`
