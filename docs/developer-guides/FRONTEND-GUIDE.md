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

**Total Lines**: ~10,800 lines of JavaScript

**Module Count**: 24 JavaScript files
- Main app: 1 file (app.js)
- Mixer modules: 23 files

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
└── mixer/                      # Mixer interface modules
    ├── core.js                 # Mixer initialization
    ├── audio-engine.js         # Desktop audio processing
    ├── simple-pitch-tempo.js   # Pitch/tempo controls
    ├── waveform.js             # Waveform visualization
    ├── timeline.js             # Timeline interactions
    ├── track-controls.js       # Stem controls (vol, pan, mute, solo)
    ├── chord-display.js        # Chord timeline
    ├── karaoke-display.js      # Lyrics display
    ├── structure-display.js    # Structure sections
    ├── tab-manager.js          # Tab switching
    ├── mixer-persistence.js    # LocalStorage state
    ├── advanced-controls.js    # Advanced features
    ├── lyrics-popup.js         # Lyrics modal
    ├── soundtouch-engine.js    # SoundTouch integration
    ├── recording-engine.js     # Multi-track recording & playback
    ├── stem-worklet.js         # AudioWorklet processor
    └── mobile-*.js             # Mobile-specific (9 files)
```

### Design Patterns

**1. Module Pattern**:
```javascript
// Each module is self-contained
(function() {
    'use strict';

    // Private variables
    const internalState = {};

    // Public API
    window.MixerModule = {
        init: function() { ... },
        doSomething: function() { ... }
    };
})();
```

**2. Class-Based Modules** (newer modules):
```javascript
class MixerModule {
    constructor(mixer) {
        this.mixer = mixer;
        this.init();
    }

    init() {
        // Setup
    }

    doSomething() {
        // Functionality
    }
}

window.MixerModule = MixerModule;
```

**3. Event-Driven**:
```javascript
// Modules communicate via custom events
document.dispatchEvent(new CustomEvent('mixer:play', { detail: { time: 0 } }));

// Other modules listen
document.addEventListener('mixer:play', (e) => {
    console.log('Play at:', e.detail.time);
});
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

### Core Modules

#### 1. core.js

**Purpose**: Mixer initialization and orchestration

**Size**: ~650 lines

**Responsibilities**:
- Initialize all mixer modules
- Platform detection (mobile vs desktop)
- Load mixer data from API
- Coordinate module lifecycle

**Key Functions**:
```javascript
// Initialize mixer
async function initMixer(downloadId) {
    // 1. Load mixer data
    const data = await fetch(`/api/downloads/${downloadId}`).then(r => r.json());

    // 2. Platform detection
    const isMobile = detectMobile();

    // 3. Initialize audio engine
    if (isMobile) {
        mixer.audioEngine = new MobileAudioEngine();
    } else {
        mixer.audioEngine = new AudioEngine();
    }

    // 4. Initialize all modules
    mixer.waveform = new Waveform(mixer);
    mixer.timeline = new Timeline(mixer);
    mixer.trackControls = new TrackControls(mixer);
    mixer.chordDisplay = new ChordDisplay(mixer);
    // ... more modules

    // 5. Load stems
    await mixer.audioEngine.loadStems(data.stems_paths);

    // 6. Restore saved state
    MixerPersistence.restore(mixer);
}
```

**Platform Detection**:
```javascript
function detectMobile() {
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isSmallScreen = window.innerWidth < 768;

    return isMobileUA || isSmallScreen;
}
```

**File**: static/js/mixer/core.js

---

#### 2. mixer-persistence.js

**Purpose**: State persistence using LocalStorage

**Size**: ~300 lines

**Persisted State**:
- Track volumes, pan, solo, mute
- Pitch shift, tempo
- Current playback position
- Tab selection
- Waveform zoom level

**API**:
```javascript
// Save state
MixerPersistence.save(mixer);

// Restore state
MixerPersistence.restore(mixer);

// Clear state
MixerPersistence.clear(downloadId);
```

**Storage Format**:
```javascript
// LocalStorage key: `mixer_state_${downloadId}`
{
    "tracks": {
        "vocals": {
            "volume": 100,
            "pan": 0,
            "solo": false,
            "mute": false
        },
        "drums": { ... }
    },
    "pitch": 0,
    "tempo": 1.0,
    "currentTime": 45.5,
    "activeTab": "chords",
    "waveformZoom": 1.0
}
```

**Automatic Saving**:
```javascript
// Save on every state change
document.addEventListener('mixer:volumeChanged', () => {
    MixerPersistence.save(mixer);
});

document.addEventListener('mixer:pitchChanged', () => {
    MixerPersistence.save(mixer);
});
```

**File**: static/js/mixer/mixer-persistence.js

---

### Audio Processing

#### 3. audio-engine.js

**Purpose**: Desktop audio processing using Web Audio API

**Size**: ~700 lines

**Architecture**:
```
Audio Files
    ↓
AudioBufferSourceNode (for each stem)
    ↓
GainNode (volume)
    ↓
StereoPannerNode (pan)
    ↓
SoundTouch AudioWorklet (pitch/tempo)
    ↓
GainNode (master)
    ↓
AnalyserNode (visualization)
    ↓
AudioDestination (speakers)
```

**Key Features**:
- Load and decode audio files
- Create Web Audio graph
- Solo/mute stem handling
- Synchronized playback across stems
- Real-time pitch/tempo processing

**Loading Stems**:
```javascript
async loadStems(stemsPaths) {
    for (const [name, path] of Object.entries(stemsPaths)) {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this.stems[name] = {
            buffer: audioBuffer,
            source: null,
            gainNode: null,
            panNode: null,
            soundTouchNode: null
        };
    }

    this.duration = this.stems['vocals'].buffer.duration;
}
```

**Playback**:
```javascript
play() {
    const offset = this.currentTime;

    for (const [name, stem] of Object.entries(this.stems)) {
        // Create source node
        const source = this.audioContext.createBufferSource();
        source.buffer = stem.buffer;

        // Create gain node (volume)
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = stem.volume;

        // Create pan node
        const panNode = this.audioContext.createStereoPanner();
        panNode.pan.value = stem.pan;

        // Connect: source → gain → pan → soundTouch → master
        source.connect(gainNode);
        gainNode.connect(panNode);
        panNode.connect(stem.soundTouchNode);

        // Start playback (synchronized)
        source.start(0, offset);

        stem.source = source;
        stem.gainNode = gainNode;
        stem.panNode = panNode;
    }

    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime - offset;
    this.updatePlayhead();
}
```

**File**: static/js/mixer/audio-engine.js

---

#### 4. simple-pitch-tempo.js

**Purpose**: Pitch and tempo controls using SoundTouch

**Size**: ~700 lines

**Features**:
- Independent pitch shifting (-12 to +12 semitones)
- Independent tempo control (0.5x to 2.0x)
- SoundTouch AudioWorklet integration
- Real-time parameter updates

**Architecture**:
```javascript
// Load SoundTouch worklet
await audioContext.audioWorklet.addModule('/static/wasm/soundtouch-worklet.js');

// Create SoundTouch node for each stem
const soundTouchNode = new AudioWorkletNode(audioContext, 'soundtouch-processor');

// Set parameters
soundTouchNode.port.postMessage({
    type: 'setPitch',
    value: 1.0  // No pitch change
});

soundTouchNode.port.postMessage({
    type: 'setTempo',
    value: 1.0  // No tempo change
});
```

**Pitch Control**:
```javascript
function setPitch(semitones) {
    // Convert semitones to pitch factor
    const pitchFactor = Math.pow(2, semitones / 12);

    // Update all stems
    for (const stem of Object.values(mixer.stems)) {
        stem.soundTouchNode.port.postMessage({
            type: 'setPitch',
            value: pitchFactor
        });
    }

    // Save state
    mixer.pitch = semitones;
    MixerPersistence.save(mixer);
}
```

**Tempo Control**:
```javascript
function setTempo(tempo) {
    // tempo: 0.5 to 2.0 (50% to 200%)

    // Update all stems
    for (const stem of Object.values(mixer.stems)) {
        stem.soundTouchNode.port.postMessage({
            type: 'setTempo',
            value: tempo
        });
    }

    // Save state
    mixer.tempo = tempo;
    MixerPersistence.save(mixer);
}
```

**HTTPS Requirement**:
```javascript
// Check if SharedArrayBuffer is available (requires HTTPS)
if (typeof SharedArrayBuffer === 'undefined') {
    console.warn('SoundTouch requires HTTPS or localhost');
    showHTTPSWarning();
}
```

**File**: static/js/mixer/simple-pitch-tempo.js

---

#### 5. soundtouch-engine.js

**Purpose**: SoundTouch integration layer

**Size**: ~460 lines

**SoundTouch Configuration**:
```javascript
{
    pitch: 1.0,           // 1.0 = no change, 2.0 = octave up
    tempo: 1.0,           // 1.0 = no change, 2.0 = double speed
    rate: 1.0,            // Combined pitch+tempo
    sampleRate: 48000,    // Audio sample rate
    channels: 2           // Stereo
}
```

**Processing Pipeline**:
```
Input Audio Buffer
    ↓
SoundTouch Processor (C++ via WASM)
    ↓
    - Time-Domain WSOLA algorithm
    - Pitch shifting
    - Time stretching
    ↓
Output Audio Buffer (modified)
```

**File**: static/js/mixer/soundtouch-engine.js

---

#### 6. stem-worklet.js

**Purpose**: AudioWorklet processor for stem mixing

**Size**: ~250 lines

**AudioWorklet** (runs in separate thread):
```javascript
class StemProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.volume = 1.0;
        this.muted = false;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        for (let channel = 0; channel < output.length; ++channel) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];

            for (let i = 0; i < outputChannel.length; ++i) {
                outputChannel[i] = inputChannel[i] * (this.muted ? 0 : this.volume);
            }
        }

        return true;  // Keep processor alive
    }
}

registerProcessor('stem-processor', StemProcessor);
```

**File**: static/js/mixer/stem-worklet.js

---

### Display Modules

#### 7. waveform.js

**Purpose**: Waveform visualization

**Size**: ~270 lines

**Rendering**:
```javascript
function drawWaveform(audioBuffer) {
    const canvas = document.getElementById('waveform');
    const ctx = canvas.getContext('2d');

    const data = audioBuffer.getChannelData(0);  // Left channel
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1;

    for (let i = 0; i < canvas.width; i++) {
        const min = data.slice(i * step, (i + 1) * step).reduce((a, b) => Math.min(a, b), 1);
        const max = data.slice(i * step, (i + 1) * step).reduce((a, b) => Math.max(a, b), -1);

        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }

    ctx.stroke();
}
```

**Optimization**:
- Simplified waveform on mobile (lower resolution)
- Canvas caching to avoid re-drawing
- Offscreen canvas for better performance

**File**: static/js/mixer/waveform.js

---

#### 8. timeline.js

**Purpose**: Timeline interactions (seeking, playhead)

**Size**: ~220 lines

**Seeking**:
```javascript
function handleClick(event) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;

    // Calculate time from click position
    const time = (x / canvas.width) * mixer.duration;

    // Seek to time
    mixer.audioEngine.seek(time);
}
```

**Playhead Drawing**:
```javascript
function drawPlayhead(currentTime) {
    const canvas = document.getElementById('timeline');
    const ctx = canvas.getContext('2d');

    // Calculate playhead position
    const x = (currentTime / mixer.duration) * canvas.width;

    // Draw vertical line
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
}
```

**File**: static/js/mixer/timeline.js

---

#### 9. track-controls.js

**Purpose**: Stem controls (volume, pan, mute, solo)

**Size**: ~330 lines

**Volume Control**:
```javascript
function setVolume(stemName, volume) {
    // Update audio engine
    mixer.audioEngine.setVolume(stemName, volume / 100);

    // Update UI
    const slider = document.querySelector(`#volume-${stemName}`);
    slider.value = volume;

    // Update display
    const display = document.querySelector(`#volume-${stemName}-value`);
    display.textContent = `${volume}%`;

    // Save state
    MixerPersistence.save(mixer);
}
```

**Mute/Solo Logic**:
```javascript
function handleSolo(stemName) {
    // If this stem is already solo, un-solo it
    if (mixer.stems[stemName].solo) {
        mixer.stems[stemName].solo = false;

        // Unmute all other stems
        for (const name of Object.keys(mixer.stems)) {
            mixer.audioEngine.setMute(name, false);
        }
    } else {
        // Solo this stem, mute all others
        for (const name of Object.keys(mixer.stems)) {
            if (name === stemName) {
                mixer.stems[name].solo = true;
                mixer.audioEngine.setMute(name, false);
            } else {
                mixer.stems[name].solo = false;
                mixer.audioEngine.setMute(name, true);
            }
        }
    }

    updateSoloButtons();
}
```

**File**: static/js/mixer/track-controls.js

---

#### 10. chord-display.js

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

#### 11. karaoke-display.js

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

#### 12. structure-display.js

**Purpose**: Song structure visualization

**Size**: ~530 lines

**Structure Sections**:
- Intro, Verse, Chorus, Bridge, Outro
- Color-coded sections
- Click to jump to section

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

#### 13. tab-manager.js

**Purpose**: Tab switching (Mix, Chords, Lyrics, Structure)

**Size**: ~270 lines

**Tab Switching**:
```javascript
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');

    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`${tabName}-btn`).classList.add('active');

    // Save state
    mixer.activeTab = tabName;
    MixerPersistence.save(mixer);
}
```

**File**: static/js/mixer/tab-manager.js

---

### Mobile Modules

**9 mobile-specific modules** for iOS and Android compatibility:

#### 14. mobile-audio-engine.js

**Purpose**: HTML5 Audio Elements engine for mobile

**Size**: ~360 lines

**Why HTML5 instead of Web Audio API**:
- Better battery life on mobile
- More consistent behavior across browsers
- Simpler iOS audio unlock mechanism

**Architecture**:
```javascript
class MobileAudioEngine {
    constructor() {
        this.audioElements = {};  // HTML5 <audio> elements
        this.isPlaying = false;
        this.currentTime = 0;
    }

    async loadStems(stemsPaths) {
        for (const [name, path] of Object.entries(stemsPaths)) {
            const audio = new Audio(path);
            audio.preload = 'auto';
            this.audioElements[name] = audio;
        }
    }

    play() {
        for (const audio of Object.values(this.audioElements)) {
            audio.currentTime = this.currentTime;
            audio.play();
        }
        this.isPlaying = true;
    }

    pause() {
        for (const audio of Object.values(this.audioElements)) {
            audio.pause();
        }
        this.isPlaying = false;
    }
}
```

**File**: static/js/mixer/mobile-audio-engine.js

---

#### 15-23. Other Mobile Modules

**mobile-touch-fix.js** (~220 lines):
- Fix touch event handling
- Prevent accidental zoom
- Improve slider responsiveness

**mobile-debug-fix.js** (~340 lines):
- Android-style controls
- iOS debugging helpers

**mobile-playhead-fix.js** (~105 lines):
- Missing playhead methods for mobile engine

**mobile-audio-fixes.js** (~240 lines):
- iOS audio unlock mechanism
- Android playhead sync

**mobile-direct-fix.js** (~265 lines):
- Direct and simple mobile fixes

**mobile-audio-patch.js** (~30 lines):
- iOS variables patch

**mobile-simple-fixes.js** (~195 lines):
- Simple mobile compatibility fixes

**advanced-controls.js** (~350 lines):
- Advanced mixer features (EQ, effects)

**lyrics-popup.js** (~100 lines):
- Lyrics modal popup

---

## Module Dependencies

### Dependency Graph

```
core.js
  ├── audio-engine.js
  │     └── soundtouch-engine.js
  │           └── stem-worklet.js
  ├── mobile-audio-engine.js
  ├── simple-pitch-tempo.js
  ├── waveform.js
  ├── timeline.js
  ├── track-controls.js
  ├── chord-display.js
  ├── karaoke-display.js
  ├── structure-display.js
  ├── tab-manager.js
  ├── mixer-persistence.js
  └── advanced-controls.js
```

### Load Order

**Mixer page**:
```html
<!-- Core first -->
<script src="/static/js/mixer/core.js"></script>

<!-- Audio engine -->
<script src="/static/js/mixer/audio-engine.js"></script>
<script src="/static/js/mixer/mobile-audio-engine.js"></script>
<script src="/static/js/mixer/soundtouch-engine.js"></script>

<!-- UI modules -->
<script src="/static/js/mixer/waveform.js"></script>
<script src="/static/js/mixer/timeline.js"></script>
<script src="/static/js/mixer/track-controls.js"></script>
<script src="/static/js/mixer/chord-display.js"></script>
<script src="/static/js/mixer/karaoke-display.js"></script>
<script src="/static/js/mixer/structure-display.js"></script>

<!-- Utilities -->
<script src="/static/js/mixer/mixer-persistence.js"></script>
<script src="/static/js/mixer/tab-manager.js"></script>

<!-- Mobile fixes (conditional) -->
<script src="/static/js/mixer/mobile-touch-fix.js"></script>
<script src="/static/js/mixer/mobile-audio-fixes.js"></script>
<!-- ... more mobile modules -->
```

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

**Typical Mixer Graph**:
```
AudioBufferSourceNode (vocals)
    ↓
GainNode (volume: 0.8)
    ↓
StereoPannerNode (pan: -0.5)
    ↓
AudioWorkletNode (SoundTouch)
    ↓
GainNode (master: 1.0)
    ↓
AnalyserNode (for visualization)
    ↓
AudioDestinationNode (speakers)
```

**Parallel Stems**:
```
[vocals] → [gain] → [pan] → [soundtouch] ─┐
[drums]  → [gain] → [pan] → [soundtouch] ─┤
[bass]   → [gain] → [pan] → [soundtouch] ─┼→ [master gain] → [destination]
[other]  → [gain] → [pan] → [soundtouch] ─┘
```

### AudioWorklet

**Why AudioWorklet**:
- Runs in separate thread (non-blocking)
- Low latency
- Precise audio processing

**Example**:
```javascript
// Load worklet module
await audioContext.audioWorklet.addModule('/static/wasm/soundtouch-worklet.js');

// Create worklet node
const workletNode = new AudioWorkletNode(audioContext, 'soundtouch-processor');

// Send messages to worklet
workletNode.port.postMessage({
    type: 'setPitch',
    value: 1.0
});

// Receive messages from worklet
workletNode.port.onmessage = (event) => {
    console.log('Worklet says:', event.data);
};
```

---

## State Management

### LocalStorage

**Namespace**: `mixer_state_${downloadId}`

**Saved State**:
```javascript
{
    "version": "2.0",
    "downloadId": "dQw4w9WgXcQ",
    "tracks": {
        "vocals": { "volume": 100, "pan": 0, "solo": false, "mute": false },
        "drums": { "volume": 80, "pan": 0, "solo": false, "mute": false },
        "bass": { "volume": 90, "pan": 0, "solo": false, "mute": false },
        "other": { "volume": 70, "pan": 0, "solo": false, "mute": false }
    },
    "pitch": 0,
    "tempo": 1.0,
    "currentTime": 0,
    "activeTab": "mix",
    "waveformZoom": 1.0
}
```

**Save**:
```javascript
localStorage.setItem(`mixer_state_${downloadId}`, JSON.stringify(state));
```

**Restore**:
```javascript
const state = JSON.parse(localStorage.getItem(`mixer_state_${downloadId}`));
```

### Event-Driven Updates

**Custom Events**:
```javascript
// Dispatch
document.dispatchEvent(new CustomEvent('mixer:volumeChanged', {
    detail: { stem: 'vocals', volume: 80 }
}));

// Listen
document.addEventListener('mixer:volumeChanged', (e) => {
    console.log(`${e.detail.stem} volume: ${e.detail.volume}`);
});
```

**Common Events**:
- `mixer:play`
- `mixer:pause`
- `mixer:seek`
- `mixer:volumeChanged`
- `mixer:pitchChanged`
- `mixer:tempoChanged`
- `mixer:stemLoaded`
- `mixer:ready`

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
**Last Updated**: December 2025
**Total Modules**: 24 JavaScript files
**Total Lines**: ~10,800 lines
