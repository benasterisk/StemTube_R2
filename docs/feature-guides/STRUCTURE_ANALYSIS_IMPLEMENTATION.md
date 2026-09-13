# Music Structure Analysis - Simplified MSAF Implementation

**Date:** 2025-10-27  
**Status:** ✅ Working (restored 2026-09-13 after being broken by the SciPy upgrade)  
**Version:** 2.1

---

> ## ✅ Current Status: Structure Analysis Works
>
> Sections are computed for new downloads and have been backfilled for existing songs. The
> desktop mixer's structure bar shows them.
>
> **What the sections are:** MSAF similarity clusters (Foote boundaries + FMC2D labels), labelled
> with **letters in order of first appearance** - e.g. `A B C D E D E D`. Sections that sound alike
> share a letter. MSAF does **not** name sections intro / verse / chorus / bridge.
>
> **How it was restored (`core/msaf_structure_detector.py`):**
> - msaf 0.1.80 uses two names that modern SciPy removed: `scipy.inf` (imported by
>   `msaf/pymf/sivm_search.py`) and `scipy.signal.gaussian` (used by the Foote segmenter). The
>   detector restores both aliases (`numpy.inf`, `scipy.signal.windows.gaussian`) right before
>   `import msaf`.
> - An import failure is now logged with the real error (`[MSAF] msaf could not be imported: ...`)
>   instead of the misleading "msaf library is not installed".
> - Each analysis gets its own temporary feature cache (msaf's `features_tmp_file` points into a
>   per-run temp dir that is deleted afterwards), so no `.features_msaf_tmp.json` is written to the
>   server's working directory and concurrent analyses no longer share one file.
> - Zero-length sections (msaf repeats the final boundary) are dropped (< 0.5 s).
> - FMC2D's numeric cluster ids are mapped to letters (`A` for the first cluster heard).
>
> **Where it runs:**
> - **New downloads**: `core/download_manager.py` calls `detect_song_structure_msaf()` during the
>   audio-analysis phase and stores `structure_data`.
> - **On demand**: `POST /api/extractions/<id>/analyze-structure` (`routes/media.py`) runs detection
>   and stores the result, returning `{success, structure: {sections: [...]}, sections_count}`.
> - **Backfill**: `python utils/analysis/reanalyze_all_structure.py [--force] [--limit N]` fills songs
>   with no `structure_data` (`--force` re-analyzes all). Allow ~30 s per song on first analysis.
> - **Display**: `routes/pages.py` passes `structure_data` to the mixer page (`EXTRACTION_INFO`), where
>   `static/js/mixer/structure-display.js` renders it (desktop mixer only; the mobile PWA has no
>   structure view).
>
> **Still dead code:** `core/structure_detector.py`, `core/llm_structure_analyzer.py`, and
> `utils/analysis/reanalyze_all_structure_advanced.py` (imports `core.advanced_structure_detector`,
> which no longer exists).

---

## 🎯 Goal

Return to **simple and reliable** structure detection using **MSAF (Music Structure Analysis Framework)** only. All prior attempts (multi-feature SSM, multimodal fusion, advanced labeling) were removed to prioritize stability and maintainability.

---

## ✅ Work Completed

### 1. Cleanup

- Removed old experimental modules:
  `core/ssm_structure_detector.py`, `core/multimodal_structure_analyzer.py`, `core/advanced_structure_detector.py`
- Removed associated test scripts:
  `test_ssm_structure.py`, `test_multimodal_structure.py`

### 2. Single new module

`core/msaf_structure_detector.py`

```python
sections = detect_song_structure_msaf(
    audio_path,
    boundaries_id="foote",
    labels_id="fmc2d"
)
```

- Uses `msaf.process` to get boundaries + labels directly.
- Generates sections `{start, end, label, confidence}` (confidence fixed to `1.0`).
- Maps MSAF's cluster ids to letters (`A`, `B`, `C`... in order of first appearance); fallback `Section N` when a labeler returns no label.
- Drops sections shorter than 0.5 s and restores the SciPy aliases msaf needs before importing it.

### 3. Pipeline integration

In `core/download_manager.py`: the *structure* block calls only `detect_song_structure_msaf`. Logs now show `Detecting structure with MSAF...`.

### 4. Dependencies

`setup_dependencies.py` installs `msaf` (unpinned; the current venv has 0.1.80, which needs the SciPy aliases described above).
MSAF manages its dependencies automatically (librosa, scikit-learn, joblib, etc.).

---

## 🧪 Validation

```
source venv/bin/activate
python - <<'PY'
from core.msaf_structure_detector import detect_song_structure_msaf
sections = detect_song_structure_msaf("core/downloads/.../audio/song.mp3")
print(sections)
PY
```

If `msaf` cannot be imported, the real import error is logged (`[MSAF] msaf could not be imported: ...`). If MSAF fails (invalid file, unusual format) or finds no sections, the function returns `None` and `structure_data` is left unchanged (`NULL` for a song never analyzed).

To backfill the library: `python utils/analysis/reanalyze_all_structure.py [--force] [--limit N]`.

---

## 📂 Stored Data

`structure_data` column (table `global_downloads`):
```json
[
  {"start": 0.0, "end": 18.2, "label": "A", "confidence": 1.0},
  {"start": 18.2, "end": 45.6, "label": "B", "confidence": 1.0},
  {"start": 45.6, "end": 71.3, "label": "A", "confidence": 1.0}
]
```

Labels are letters derived from the `labels_id` algorithm's cluster ids; `confidence` is a fixed placeholder (MSAF provides none).

---

## ⚙️ Recommended Parameters

| Parameter       | Default | Description                                 |
|-----------------|---------|---------------------------------------------|
| `boundaries_id` | `foote` | Robust checkerboard kernel boundary detector |
| `labels_id`     | `fmc2d` | Generic repetition/contrast clustering      |

Useful variants:
- `boundaries_id="cnmf"` for highly repetitive tracks.
- `labels_id="olda"` (two-level) to distinguish large sections vs transitions.

---

## 📋 Benefits Summary

1. **Simplicity**: one readable module, zero extra heuristics.
2. **Reliability**: based on a proven and maintained MIR framework.
3. **Easy maintenance**: fewer custom dependencies means less debugging.

---

## 🔜 Next Ideas (optional)

- Add a configurable `label -> friendly name` mapping (e.g., `A` -> `Verse`).
- Provide a `librosa` fallback if MSAF is unavailable.
- Expose a small CLI script (`python tools/print_structure.py <file>`).

---

🎵 **Conclusion**: StemTube structure detection relies solely on MSAF. With the SciPy aliases restored it works again and produces similarity-labelled sections (A, B, C...) - see the status banner at the top of this document.
