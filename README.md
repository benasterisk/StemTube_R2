# StemTube - AI-Powered Music Separation & Analysis

> Professional-grade stem extraction, chord detection, and karaoke system

**🌐 Website: [benasterisk.github.io/StemTube_R2](https://benasterisk.github.io/StemTube_R2/)**

[![Website](https://img.shields.io/badge/website-online-brightgreen.svg)](https://benasterisk.github.io/StemTube_R2/)
[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## ✨ Features

- 🎹 **AI Stem Extraction** - Demucs 4-stem/6-stem separation, plus a 17-stem fine model (GPU accelerated)
- 🥁 **Fine Stems** - lead/backing vocals, kick/snare/toms/cymbals, electric/acoustic guitar, piano, organ, synth, brass, winds, strings (CUDA GPU required)
- 🎸 **Chord Detection** - BTC Transformer, 170-chord vocabulary, with Guitar Hero-style fixed reading focus
- 🥁 **Beat Grid** - madmom downbeat detection driving the metronome, detected once per song
- 🎤 **Karaoke Mode** - LRCLIB lyrics aligned word by word on a faster-whisper transcription in the sung language (GPU-accelerated)
- 🎚️ **Interactive Mixer** - Independent pitch/tempo control (SoundTouch + Web Audio API), audible scrubbing and A/B loops
- 🎙️ **Multi-Track Recording** - DAW-style record-along with latency calibration
- 📁 **File Upload** - Support for MP3, WAV, FLAC, M4A, AAC, OGG, WMA, MP4, AVI, MKV, MOV, WEBM
- 📱 **Mobile PWA** - Installable app with offline mode and audio caching
- 🎵 **Jam Session** - Real-time collaborative playback with shared BPM, precount, and metronome *(dev stage)*
- 👥 **Multi-User** - Authentication + global file deduplication
- 🚀 **GPU Accelerated** - 4-10x faster processing (automatic CUDA detection)
- 🔒 **HTTPS Required** - For pitch/tempo features (ngrok included)

---

## 🚀 Quick Start (5 Minutes)

```bash
# 1. Install system dependencies (Ubuntu/Debian)
sudo apt-get update && sudo apt-get install -y \
  python3.12 python3.12-venv python3-dev build-essential \
  ffmpeg libsndfile1 libatlas-base-dev liblapack-dev git

# 2. Install a JavaScript runtime — required for YouTube downloads
#    (YouTube ships a JS challenge that yt-dlp must solve).
#    Deno is the simplest: one binary, no system packages.
curl -fsSL https://deno.land/install.sh | sh
#    Alternative: Node.js 22 or newer. The "nodejs" package shipped by most
#    distros is 18/20 and is TOO OLD for the solver.

# 3. Clone & setup
git clone https://github.com/Benasterisk/StemTube_R2.git
cd StemTube_R2
python3.12 setup_dependencies.py  # venv, PyTorch, dependencies, models, .env

# 4. Start it
./start_service.sh          # with HTTPS via ngrok
# ...or, for a quick local run:
python app.py               # http://localhost:5011
```

The setup script creates `.env` with a random `FLASK_SECRET_KEY` for you, and
ends with a summary telling you what works and what does not:

```
SETUP SUMMARY
  [OK]   Beat & chord analysis (madmom)
  [OK]   YouTube downloads (JS runtime)
  [OK]   Stem extraction, mixer, lyrics
```

If a line reports `[FAIL]` or `[WARN]`, fix it before extracting anything —
the app still starts, but the affected feature silently produces nothing.

**First login:** an `administrator` account is created on first boot and its
password is printed in the server log. Change it right away.

> **Note on pitch/tempo:** these need a *secure context*. `http://localhost`
> qualifies, a plain `http://<lan-ip>` does not — use HTTPS to reach the app
> from a phone (see [HTTPS Setup](docs/admin-guides/HTTPS-SETUP.md)).

See [Installation Guide](docs/user-guides/01-INSTALLATION.md) for detailed setup.

---

## 📚 Documentation

**For Users:**
- [📖 Quickstart Guide](docs/user-guides/00-QUICKSTART.md) - Get started in 5 minutes
- [⚙️ Installation](docs/user-guides/01-INSTALLATION.md) - Detailed setup instructions
- [🎮 Usage Guide](docs/user-guides/02-USAGE.md) - How to use features
- [📱 Mobile Guide](docs/user-guides/03-MOBILE.md) - Mobile interface
- [🛠️ Troubleshooting](docs/user-guides/05-TROUBLESHOOTING.md) - Common issues

**For Administrators:**
- [🔐 Security Setup](docs/admin-guides/SECURITY_SETUP.md) - Best practices
- [🔒 HTTPS Setup](docs/admin-guides/HTTPS-SETUP.md) - Required for audio features
- [📊 Service Management](docs/admin-guides/SERVICE_COMMANDS.md) - systemd

**For Developers:**
- [🏗️ Architecture](docs/developer-guides/ARCHITECTURE.md) - System design
- [📡 API Reference](docs/developer-guides/API-REFERENCE.md) - REST + SocketIO endpoints
- [🗄️ Database Schema](docs/developer-guides/DATABASE-SCHEMA.md) - Tables & relationships
- [💻 Frontend Guide](docs/developer-guides/FRONTEND-GUIDE.md) - JavaScript modules
- [🐍 Backend Guide](docs/developer-guides/BACKEND-GUIDE.md) - Python modules
- [🤖 AI Guidelines](docs/developer-guides/AGENTS.md) - For AI assistants

**Feature Guides:**
- [🎸 Chord Detection](docs/feature-guides/CHORD-DETECTION.md) - BTC/madmom/hybrid
- [🔄 Processing Flow](docs/PROCESSING_FLOW.md) - Download → analysis → extraction
- [🛠️ Utilities](utils/UTILITIES_GUIDE.md) - Maintenance and analysis scripts

---

## 🔧 System Requirements

**Minimum:**
- Python 3.12+
- Deno, *or* Node.js 22+ — only for YouTube downloads (everything else works without it)
- 4 GB RAM
- 2 GB disk space
- FFmpeg (system package — install it before running the setup)
- **HTTPS or localhost** (required for pitch/tempo features)

**Recommended:**
- NVIDIA GPU with CUDA 11.x-13.x (10x faster processing)
- 8 GB RAM
- 20 GB disk (models + uploads)
- Ngrok tunnel (automatic HTTPS)

**Supported Platforms:**
- Linux (Ubuntu/Debian recommended)
- Windows 10/11
- macOS (Intel/Apple Silicon)

---

## 🎯 Use Cases

- **Musicians**: Practice with isolated stems, change tempo/pitch
- **DJs**: Remix preparation, acapella extraction
- **Educators**: Music theory analysis, transcription
- **Karaoke**: Word-level synchronized lyrics
- **Researchers**: Music information retrieval, chord analysis

---

## 📊 Performance

| Operation | CPU | GPU (CUDA) | Speedup |
|-----------|-----|------------|---------|
| Stem extraction (4 stems, 4 min song) | 3-8 min | 20-60s | **4-8x** |
| Lyrics transcription | 30-120s | 10-30s | **3-5x** |
| Chord detection (BTC) | 15-30s | 15-30s | - |
| Beat grid (madmom) | 20-40s | 20-40s | - |
| Fine stems (17 stems, 4 min song) | not supported | 60-90s | GPU only |

---

## 🎸 Chord & Beat Analysis

Two engines, each with one job:

1. **Chords — BTC Transformer** (170-chord vocabulary), the only chord engine today
   - Weights vendored in `external/BTC-ISMIR19/`
   - Handles complex jazz and extended harmonies

2. **Beats — madmom** downbeat detection
   - Drives the metronome and the chord grid; detected once per song and stored
   - Sits on a pinned stack (numpy 1.26.4, scipy 1.17.1, librosa 0.11.0)

> The older hybrid detector and the `chords_use_madmom` / `chords_use_hybrid`
> settings are no longer wired: madmom no longer produces chords.

> Song structure detection (MSAF) splits each song into sections labelled by similarity
> (`A B C B A…`, sections that sound alike share a letter); it does not name verses or choruses.

See [Chord Detection Guide](docs/feature-guides/CHORD-DETECTION.md) for details.

---

## 📱 Mobile Features

Full-featured mobile interface at `/mobile`:

- **Progressive Web App (PWA)** - Install as native app on iOS/Android home screen
- **Offline playback** - Songs saved from the library play in the mobile mixer without a
  connection (stems, metronome and count-in are cached with the mixer's own URLs)
- **Mobile Settings Tab** - Manage cached audio and storage
- **Responsive Touch Controls** - Optimized for iOS and Android
- **iOS Audio Unlock** - Automatic handling of iOS audio restrictions
- **Timeline Chords** - Compact progression with live playhead
- **SVG Chord Diagrams** - Guitar & piano diagrams from guitar-chords-db-json
- **Focused Karaoke** - Current line + 2 previous for easy reading
- **Shared Transport** - Tempo/pitch/playback synchronized across tabs
- **Zero-Latency Tempo** - Hybrid SoundTouch/playbackRate engine

9 mobile-specific JavaScript modules ensure smooth performance on all devices.

---

## 🎵 Jam Session *(Dev Stage)*

Real-time collaborative playback — multiple musicians can listen and play along together in sync.

> **Status**: Early development. Not yet tested across different platforms (Windows, macOS, mobile browsers) or with more than 2 simultaneous participants. Feedback welcome!

**Use cases:**
- **Replace an absent musician** — Mute the missing instrument's stem and have a real player fill in live
- **Learn a new song** — Practice along with chords and lyrics displayed in real time, no need to memorize the song beforehand
- **Improvise a cover** — Jump into a song on the fly without remembering every detail; StemTube handles the chords, lyrics, and structure for you
- **Rehearse remotely** — Each participant joins from anywhere, no need to be in the same room

**How it works:**
- Host creates a session and shares a join code
- Guests join via `/jam/CODE` — no login required
- Server coordinates transport commands (play/pause/seek) and shared BPM — no audio is streamed through the server

**Per-player independence:**
- Each participant chooses their own active tab (Mixer, Lyrics, Chords) based on what they need
- Each participant mutes/solos stems independently — the guitarist can mute the guitar track while others keep it
- Metronome click can be turned off individually while keeping the visual pulse blinking as a silent guide
- Precount (2, 4, or 8 beats) ensures everyone starts together

**Technical features:**
- **Precount** - Host configures count-in; all participants hear the countdown simultaneously
- **Metronome** - Beat-accurate click track with Web Audio look-ahead scheduling and visual pulse
- **Shared Transport** - Play, pause, and seek synchronized with RTT-based latency compensation
- **Drift Correction** - Periodic sync heartbeats (every 5s) with automatic position correction
- **Guest Auto-Join** - No authentication required; guests get auto-generated names

**Known limitations:**
- Tested primarily on Linux with Chrome/Firefox
- Multi-platform testing (iOS Safari, Windows, macOS) still needed
- Large group sessions (3+ participants) not yet validated
- Network conditions with high latency/jitter may affect sync quality

---

## 🛠️ Troubleshooting the install

These three failures are **silent**: the app starts and looks healthy while one
feature quietly produces nothing. Re-running `setup_dependencies.py` is safe and
reports each of them.

| Symptom | Cause | Fix |
|---------|-------|-----|
| Chords/beats empty on every song; Chords tab blank | madmom is broken — it sits on a pinned stack (numpy 1.26.4, scipy 1.17.1, librosa 0.11.0) and any upgrade kills it | `python patch_madmom.py`, then re-run `setup_dependencies.py` and check the summary says `[OK] Beat & chord analysis` |
| YouTube: "Requested format is not available" | No JS runtime, or Node older than 22 — yt-dlp cannot solve YouTube's challenge | Install Deno: `curl -fsSL https://deno.land/install.sh \| sh` |
| Extraction fails immediately | FFmpeg missing (it is **not** installed by the setup script) | `sudo apt-get install -y ffmpeg` |
| Pitch/tempo controls do nothing on a phone | The page is served over plain `http://<lan-ip>`, which is not a secure context | Use HTTPS — see [HTTPS Setup](docs/admin-guides/HTTPS-SETUP.md) |

⚠️ **Do not upgrade numpy, scipy or librosa** past the pinned versions. madmom
0.16.1 ships a wheel built against numpy 1.x; newer releases break beat and
chord detection without any error at runtime.

More: [Troubleshooting Guide](docs/user-guides/05-TROUBLESHOOTING.md)

---

## 🤝 Contributing

We welcome contributions! Please:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
2. Follow code style (English comments required)
3. Test on CPU and GPU if possible
4. Update documentation for new features

---

## 📄 License

See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

StemTube stands on the work of these open-source projects — thank you to their authors and
maintainers:

**Audio & separation**
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — audio download
- [Demucs](https://github.com/facebookresearch/demucs) (Alexandre Défossez, Meta AI) — stem separation (`htdemucs`, `htdemucs_ft`, `htdemucs_6s`, `mdx_extra`)
- [Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) (ZFTurbo) — BS-Roformer code (vendored in `core/msst/`, MIT) and the MVSep Mega 53-stem model
- [DrumSep](https://github.com/inagoy/drumsep) (inagoy) — kick / snare / toms / cymbals separation
- [FFmpeg](https://ffmpeg.org) ([BtbN builds](https://github.com/BtbN/FFmpeg-Builds)) — audio conversion

**Music analysis**
- [BTC-ISMIR19](https://github.com/jayg996/BTC-ISMIR19) (Jonggwon Park et al.) — chord recognition
- [madmom](https://github.com/CPJKU/madmom) (CPJKU) — beat and downbeat tracking
- [librosa](https://github.com/librosa/librosa) — tempo and key analysis
- [MSAF](https://github.com/urinieto/msaf) (Oriol Nieto) — song structure segmentation

**Lyrics**
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (SYSTRAN) — transcription and word timings
- [LRCLIB](https://lrclib.net) ([source](https://github.com/tranxuanthang/lrclib)) — free synced lyrics database

**Web app & playback**
- [Flask-SocketIO](https://github.com/miguelgrinberg/Flask-SocketIO) (Miguel Grinberg) — real-time progress and jam sessions
- [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) — tempo / pitch processing in the browser
- [lamejs](https://github.com/zhuker/lamejs) — MP3 encoding of mix exports
- [guitar-chords-db-json](https://github.com/tombatossals/guitar-chords-db-json) — chord diagrams

---

**Version**: 3.0.2 (latest tag) — see [CHANGELOG.md](CHANGELOG.md)
**Last Updated**: September 2026
**Status**: Active Development
**GPU Support**: Fully Automated ✨
