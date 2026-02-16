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
- **Library:** BTC Transformer → madmom CRF → hybrid (fallback chain)
- **Input:** Full audio + detected BPM/key for beat grid alignment
- **Output:** `chords_data`, `beat_offset`

### 2.3 Structure Detection
- **Library:** MSAF (Music Structure Analysis Framework)
- **Algorithm:** CNMF + Foote boundaries
- **Output:** `structure_data` (sections: Intro, Verse, Chorus, etc.)

### 2.4 Lyrics Detection (Musixmatch Only)
- **Library:** syncedlyrics API (Musixmatch)
- **Note:** Only API call, NO Whisper fallback (will be done after extraction)
- **Output:** `lyrics_data` (if found on Musixmatch)

**Database Update:** All results saved to `global_downloads` table

---

## Phase 3: Stem Extraction

**Trigger:** Manual - POST `/api/extractions` (user clicks "Extract Stems")

**Operations:**
1. Check global extraction (deduplication)
2. Reserve extraction slot (prevent race conditions)
3. Load Demucs model (auto GPU detection)
4. Separate stems: vocals, drums, bass, other (+ guitar, piano for 6-stem)
5. Detect silent stems (RMS energy analysis)
6. Copy to output directory
7. Create ZIP archive

**Files Created:**
```
/downloads/{title}/audio/stems/
├── vocals.mp3
├── drums.mp3
├── bass.mp3
├── other.mp3
├── guitar.mp3 (6-stem only)
├── piano.mp3 (6-stem only)
└── {title}_stems.zip
```

---

## Phase 4: Post-Extraction Auto-Detection

**Trigger:** Extraction complete callback

**Operations:**

### 4.1 Lyrics Detection (Full)
- **Condition:** Only if `vocals.mp3` exists
- **Library:** SyncedLyrics (Musixmatch) → faster-whisper (fallback)
- **Input:** vocals.mp3 (better quality than full audio)
- **Sync:** vocal_onset_detector for precise timing
- **Output:** Updates `lyrics_data` in database

**Note:** This REPLACES any lyrics found during download phase (uses better source)

---

## Fallback Chains

### Chord Detection
1. BTC Transformer (professional, 170 chord vocabulary)
2. madmom CRF (works on all genres)
3. Hybrid (madmom beats + key-aware templates)

### Lyrics Detection
1. Musixmatch via SyncedLyrics (word-level timestamps)
2. faster-whisper (speech-to-text transcription)
3. vocal_onset_detector (align with vocal peaks)

### Structure Analysis
1. CNMF + Foote boundaries
2. Spectral Clustering (scluster)
3. Online LDA (olda)

---

## Libraries Used

| Analysis | Library | Purpose |
|----------|---------|---------|
| BPM/Key | librosa, scipy | Spectral analysis, template matching |
| Chords | BTC, madmom | Chord recognition |
| Structure | MSAF | Section segmentation |
| Lyrics (sync) | syncedlyrics | Musixmatch API |
| Lyrics (ASR) | faster-whisper | Speech-to-text |
| Onset Detection | librosa | Vocal onset alignment |
| Stem Separation | Demucs | Source separation |

---

## Key Files

| Component | File |
|-----------|------|
| Download Management | `core/download_manager.py` |
| Stem Extraction | `core/stems_extractor.py` |
| Chord Detection | `core/chord_detector.py`, `core/btc_chord_detector.py`, `core/madmom_chord_detector.py` |
| Lyrics Detection | `core/lyrics_detector.py`, `core/syncedlyrics_client.py` |
| Vocal Sync | `core/vocal_onset_detector.py` |
| Structure Analysis | `core/msaf_structure_detector.py` |
| Database | `core/downloads_db.py` |
| Main Routes | `app.py` |

---

## Optimization Notes

1. **Lyrics Detection Optimized:**
   - During download: Only Musixmatch (fast API call)
   - After extraction: Musixmatch + Whisper fallback (using vocals.mp3)
   - Avoids redundant Whisper processing on full audio

2. **Chord Detection:**
   - Currently uses full audio
   - Could potentially use instrumental stem for better accuracy (future optimization)

3. **Structure Analysis:**
   - Only during download phase
   - Could be re-run on instrumental stems (future optimization)
