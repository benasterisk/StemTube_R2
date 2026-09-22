# StemTube Processing Flow

## Overview

This document describes the complete flow from download to extraction, including all analysis operations.

---

## Phase 1: Download

**Trigger:** POST `/api/downloads`

**Operations:**
1. Check global_downloads table (multi-user deduplication)
2. Create DownloadItem, add to queue
3. yt-dlp downloads from YouTube (iOS client fallback for 403 errors)
4. Convert to MP3 (192kbps, 44.1kHz stereo)
5. Save to `/downloads/{title}/audio/{title}.mp3`

**Files Created:**
```
/downloads/{title}/audio/{title}.mp3
```

---

## Phase 2: Audio Analysis (During Download)

**Trigger:** Download complete callback (only for AUDIO downloads)

**Operations (in order):**

### 2.1 Tempo/Key Detection
- **Library:** librosa + scipy.signal STFT
- **Method:** Autocorrelation on spectral flux for BPM; for the key, a dedicated 16384-point STFT restricted to 65–2100 Hz folded into a chroma and correlated with the Krumhansl-Kessler key profiles
- **Output:** `detected_bpm`, a **provisional** `detected_key`, `analysis_confidence`
- **Provisional key:** approximate (often a fifth or a relative off); it is replaced by the key derived from the chords after extraction (Phase 4.3). It used to read "F major" on almost every song: the chroma was built from the tempo STFT (2048-point window at 44.1 kHz = 21.5 Hz bins, all multiples of a low F and wider than a semitone below 370 Hz) and the key was "loudest pitch class + compare triads".

### 2.2 Chord Detection - not at download
- Chords are **no longer detected at download**. They are only shown in the mixer (carousel, grid popup, live prompter / stage window, desktop and mobile), which needs the stems anyway, so detection runs after extraction on the harmonic stems - see Phase 4.3.
- `chords_data` stays empty until the song is extracted.

### 2.3 Structure Detection
- **Library:** MSAF (Music Structure Analysis Framework) - Foote boundaries + FMC2D labels, via `core/msaf_structure_detector.py` (restores the `scipy.inf` / `scipy.signal.gaussian` aliases msaf 0.1.80 needs before importing it)
- **Input:** Full audio
- **Output:** `structure_data` - sections labelled by similarity cluster with letters in order of first appearance (e.g. `A B C D E D E D`); MSAF does not name verses or choruses. Zero-length sections are dropped. See [STRUCTURE_ANALYSIS_IMPLEMENTATION.md](feature-guides/STRUCTURE_ANALYSIS_IMPLEMENTATION.md).
- **Re-run:** `POST /api/extractions/<id>/analyze-structure`, or `python utils/analysis/reanalyze_all_structure.py [--force] [--limit N]` for the whole library

### 2.4 Lyrics Preview (LRCLIB Only)
- **Metadata:** the yt-dlp metadata (artist, track, language, uploader, tags, duration) is stored as JSON in `media_metadata` (`core/media_metadata.py`); `resolve_artist_track()` picks the artist/track used for the lookup
- **Library:** [LRCLIB](https://lrclib.net) (free, no account) via `core/lrclib_client.py` - artist and track must both match (≥0.6 similarity), line-synced records preferred, closest duration wins
- **Note:** API call only, NO Whisper (done after extraction). Plain-text records need Whisper timing, so they wait for extraction
- **Output:** `lyrics_data` - a line-timed preview, only when LRCLIB has line-synced lyrics

**Database Update:** All results saved to `global_downloads` table

---

## Phase 3: Stem Extraction

**Trigger:** Manual - POST `/api/extractions` (user clicks "Extract Stems")

**Operations:**
1. Check global extraction (deduplication)
2. Reserve extraction slot (prevent race conditions)
3. Load the separation model (auto GPU detection)
4. Separate stems (see models below)
5. Detect silent stems (RMS energy analysis)
6. Copy to output directory
7. Create ZIP archive

**Models:**

| Model | Stems | Notes |
|-------|-------|-------|
| `htdemucs` | 4: vocals, drums, bass, other | Default |
| `htdemucs_ft` | 4 | Fine-tuned HTDemucs |
| `htdemucs_6s` | 6: + guitar, piano | |
| `mdx_extra` | 4 | Vocal focus |
| `mvsep_mega_fine` | 17 | CUDA GPU only (~6 GB VRAM), ~1-2 min per song. 3-stage hybrid run by `core/msst/separate.py`: `htdemucs_6s` → DrumSep on drums → MVSep Mega BS-Roformer heads |

`mdx_extra_q` is disabled (the `diffq` package is not installed). Re-extracting a song with another model replaces its stems.

**Files Created:**
```
/downloads/{title}/audio/stems/
├── vocals.mp3
├── drums.mp3
├── bass.mp3
├── other.mp3
├── guitar.mp3 (htdemucs_6s only)
├── piano.mp3 (htdemucs_6s only)
└── {title}_stems.zip
```

With `mvsep_mega_fine` the stems are `vocals` (lead), `backing_vocals`, `drums` (kit remainder), `kick`, `snare`, `toms`, `cymbals`, `bass`, `electric_guitar`, `acoustic_guitar`, `piano`, `organ`, `synth`, `brass`, `winds`, `strings` and `other`, plus `drums_full.mp3` (the full Demucs drums, used for beat detection, not a mixer track). The stems always sum to the original mix.

---

## Phase 4: Post-Extraction Auto-Detection

**Trigger:** Extraction complete callback

**Operations:**

### 4.1 Lyrics Detection (Full)
- **Condition:** Only if `vocals.mp3` exists
- **Entry point:** `detect_lyrics_unified()` in `core/lyrics_detector.py`
- **Method:** the full pipeline (the same one Regenerate uses): artist/track resolved from `media_metadata` → LRCLIB lookup → faster-whisper in the sung language (Whisper `detect_language` on voiced parts; ≥0.7 probability wins, else the YouTube-declared language) → `align_lines_with_whisper()` in `core/lyrics_merger.py` puts the LRCLIB words on the Whisper word timings (source `lrclib+whisper`, with `alignment_stats`). Whisper credit hallucinations ("thanks for watching", Amara.org, ...) are dropped.
- **Input:** vocals.mp3 (better quality than full audio)
- **Output:** Updates `lyrics_data` in database
- **Progress:** `lyrics_progress` steps `metadata`, `lyrics_search`, `lyrics_found` / `lyrics_not_found`, `whisper`, `whisper_done`, `aligning`, `aligned` / `align_rejected`, `done` / `failed` (extraction progress 49-72 %)

**Note:** This REPLACES the LRCLIB preview stored during the download phase

### 4.2 Beat / Downbeat Detection
- **Library:** madmom (beat and downbeat tracking only - never chords)
- **Output:** `beat_offset`, `beat_times`, `beat_positions` (metronome grid)

### 4.3 Chord & Key Detection
- **Entry point:** `update_song_chords(video_id, stems_paths=None, fallback_audio=None)` in `core/chord_refiner.py` - reads stems, beat grid and BPM from the database and writes ONLY `chords_data`, `detected_key` and `analysis_confidence`
- **Progress message:** "Detecting chords..." (after the beat grid, before the mixer pre-build)
- **Library:** BTC-ISMIR19 Transformer only (170-chord vocabulary, weights in `external/BTC-ISMIR19/test/btc_model_large_voca.pt`), through `detect_segments()` in `core/btc_chord_detector.py`
- **No fallback engine:** if BTC is unavailable or fails, `chords_data` stays empty. madmom is NOT used for chords; `core/hybrid_chord_detector.py` is dead code and the `chords_use_madmom` / `chords_use_hybrid` settings are inert.
- **Input:** the harmonic stems only - every stem whose name does not match `vocal|drum|kick|snare|tom|cymbal|hihat|metronome|click` (bass + other for 4-stem models, bass + guitar + piano + other for `htdemucs_6s`, every non-vocal non-drum stem for `mvsep_mega_fine`; `drums_full.mp3` excluded), mixed to one temporary mono 22.05 kHz file with ffmpeg. No harmonic stem on disk → the full mix (`source` `mix` instead of `stems`).
- **Decoding:** raw BTC boundaries are snapped to the beat grid, a Viterbi pass over beats on triads removes flicker (a change is cheapest on a downbeat), major/minor doubts are settled with the key, one-beat chords are absorbed, then each segment takes the richest raw label that agrees with its triad. Details in [CHORD-DETECTION.md](feature-guides/CHORD-DETECTION.md).
- **Output:** `chords_data` = `[{"timestamp": 19.705, "chord": "Em7", "simple": "Em"}, ...]` (timestamps on beats, "N" passages omitted), `detected_key` scored from the chords (replaces the provisional key of Phase 2.1), `analysis_confidence` = margin over the runner-up key
- **Cost:** ~5-10 s per song on CPU
- **Re-run:** `POST /api/extractions/<id>/chords/regenerate`, automatically after `POST /api/extractions/<id>/beats/regenerate` (chords re-decoded on the new grid), or `python utils/analysis/reanalyze_all_chords.py [--limit N] [--video-id ID]` for songs extracted before this pipeline

### 4.4 Mixer Pre-Build
- Metronome WAVs, waveform peaks and `meta.json` are prepared so the first mixer open is fast.

---

## Fallback Chains

### Chord Detection
1. BTC Transformer (170 chord vocabulary) - no fallback engine. madmom CRF and the hybrid detector are no longer wired in.
2. Input: harmonic stems; the full mix only when no harmonic stem is on disk. No stored beat grid → a steady grid built from the BPM.

### Lyrics Detection
1. LRCLIB words aligned on the Whisper word timings (`lrclib+whisper`)
2. Below 30 % matched words the alignment is rejected: a line-synced record keeps its own line timing (`lrclib`), a plain-text record falls back to Whisper alone
3. Whisper alone (`whisper`) if the song is not on LRCLIB

Musixmatch was removed: its unofficial desktop API stopped serving anonymous clients around April 2026.

### Structure Analysis
MSAF only - no fallback. If detection fails, `structure_data` is left unchanged.

---

## Libraries Used

| Analysis | Library | Purpose |
|----------|---------|---------|
| BPM / provisional key | librosa, scipy | Spectral analysis, Krumhansl-Kessler key profiles |
| Chords / key | BTC-ISMIR19 + `core/chord_refiner.py` | Chord recognition on the harmonic stems, beat-grid decoding, key from the chords |
| Beats | madmom | Beat/downbeat grid for the metronome |
| Structure | MSAF | Section segmentation (A/B/C similarity labels) |
| Lyrics (text) | LRCLIB | Lyrics lookup (line-synced or plain text) |
| Lyrics (ASR) | faster-whisper | Speech-to-text, word timings |
| Stem Separation | Demucs, MSST (BS-Roformer), DrumSep | Source separation |

---

## Key Files

| Component | File |
|-----------|------|
| Download Management | `core/download_manager.py` |
| Stem Extraction | `core/stems_extractor.py`, `core/msst/separate.py` (fine stems) |
| Chord Detection | `core/chord_refiner.py` (pipeline), `core/btc_chord_detector.py` (BTC model) |
| Beat Detection | `core/madmom_chord_detector.py` (beats only), called from `extensions.py` |
| Lyrics Detection | `core/lyrics_detector.py`, `core/lyrics_merger.py`, `core/lrclib_client.py`, `core/media_metadata.py` |
| Structure Analysis | `core/msaf_structure_detector.py` |
| Database | `core/downloads_db.py` → `core/db/` |
| Main Routes | `routes/` blueprints, post-extraction chain in `extensions.py` |

---

## Optimization Notes

1. **Lyrics Detection Optimized:**
   - During download: Only LRCLIB (fast API call, line-synced preview)
   - After extraction: LRCLIB + Whisper, aligned (using vocals.mp3)
   - Avoids redundant Whisper processing on full audio

2. **Chord Detection:**
   - Runs after extraction on the harmonic stems (no vocals, no drums) instead of the full mix at download
   - Decoded on the beat grid: chord count roughly halved on the test library, no sub-beat chords
   - Regenerating chords leaves the stored beat grid and Skip Intro untouched; regenerating beats stores the new grid and keeps Skip Intro

3. **Structure Analysis:**
   - Runs on the full mix at download time (~30 s per song on first analysis, see Phase 2.3)
