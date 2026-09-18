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
- **Method:** Autocorrelation on spectral flux for BPM, chroma template matching for key
- **Output:** `detected_bpm`, `detected_key`, `analysis_confidence`

### 2.2 Chord Detection
- **Library:** BTC-ISMIR19 Transformer only (170-chord vocabulary, weights in `external/BTC-ISMIR19/test/btc_model_large_voca.pt`)
- **No fallback:** if BTC is unavailable or fails, `chords_data` stays empty. madmom is NOT used for chords; `core/hybrid_chord_detector.py` is dead code and the `chords_use_madmom` / `chords_use_hybrid` settings are inert.
- **Input:** Full audio
- **Output:** `chords_data` (beats are detected later, in Phase 4)

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

### 4.3 Mixer Pre-Build
- Metronome WAVs, waveform peaks and `meta.json` are prepared so the first mixer open is fast.

---

## Fallback Chains

### Chord Detection
1. BTC Transformer (170 chord vocabulary) - no fallback. madmom CRF and the hybrid detector are no longer wired in.

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
| BPM/Key | librosa, scipy | Spectral analysis, template matching |
| Chords | BTC-ISMIR19 | Chord recognition |
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
| Chord Detection | `core/chord_detector.py`, `core/btc_chord_detector.py` |
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
   - Currently uses full audio
   - Could potentially use instrumental stem for better accuracy (future optimization)
   - Regenerating chords leaves the stored beat grid and Skip Intro untouched; regenerating beats stores the new grid and keeps Skip Intro

3. **Structure Analysis:**
   - Runs on the full mix at download time (~30 s per song on first analysis, see Phase 2.3)
