# Music Structure Analysis - Simplified MSAF Implementation

**Date:** 2025-10-27  
**Status:** ❌ NOT functional (broken since the SciPy upgrade) - kept as historical reference  
**Version:** 2.0

---

> ## ⚠️ Current Status: Structure Analysis Does Not Work
>
> **Verse/chorus section detection is dead in the current codebase.** Nothing below describes
> working behavior; it is kept only as design notes for a future revival.
>
> **What happens today:**
> - `msaf` is installed in the venv but **cannot be imported**: it does `from scipy import inf`,
>   which was removed in modern SciPy releases.
> - `core/msaf_structure_detector.py` catches the resulting `ImportError`, logs the misleading
>   message `[MSAF] msaf library is not installed`, and returns `None`.
> - `structure_data` is therefore `NULL` for **every** song in `global_downloads`.
> - The desktop mixer's `static/js/mixer/structure-display.js` calls
>   `/api/extractions/<id>/analyze-structure`, an endpoint that **does not exist** on the server.
>   The mixer's structure bar never fills.
> - The reanalysis scripts are broken too: `utils/analysis/reanalyze_all_structure.py` depends on
>   the same unimportable `msaf`, and `utils/analysis/reanalyze_all_structure_advanced.py` imports
>   `core.advanced_structure_detector`, a module that no longer exists.
>
> **What reviving it would take:**
> 1. Make MSAF importable again: patch `from scipy import inf` to `from numpy import inf` in the
>    installed package (similar to `utils/setup/patch_madmom.py`), pin an older SciPy, or replace
>    MSAF with a maintained segmenter (e.g. a librosa-based Foote/checkerboard implementation).
> 2. Fix the log message in `core/msaf_structure_detector.py` so an import failure is reported as
>    such instead of "not installed".
> 3. Add the missing `POST /api/extractions/<id>/analyze-structure` route (e.g. in
>    `routes/media.py`) that runs detection and persists `structure_data`, or change
>    `structure-display.js` to read `structure_data` from the extraction payload.
> 4. Repair or delete the two `reanalyze_all_structure*.py` scripts, then backfill existing songs.
> 5. Verify on both desktop (`/`) and mobile (`/mobile`).

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
- Keeps MSAF labels when available, fallback `Section N` otherwise.

### 3. Pipeline integration

In `core/download_manager.py`: the *structure* block calls only `detect_song_structure_msaf`. Logs now show `Detecting structure with MSAF...`.

### 4. Dependencies

`requirements.txt`:
```text
msaf>=0.1.90
```
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

If `msaf` cannot be imported, a log message is emitted (`pip install msaf`) - note that today this message also appears when msaf *is* installed but fails to import (SciPy incompatibility, see the status banner). If MSAF fails (invalid file, unusual format), `structure_data` remains `NULL`.

---

## 📂 Stored Data

`structure_data` column (table `global_downloads`):
```json
[
  {"start": 0.0, "end": 18.2, "label": "Intro", "confidence": 1.0},
  {"start": 18.2, "end": 45.6, "label": "A", "confidence": 1.0}
]
```

Exact labels come from the chosen `labels_id` algorithm.

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

🎵 **Conclusion (historical)**: This design made StemTube structure detection rely solely on MSAF. Because MSAF no longer imports with modern SciPy, structure detection currently produces no results - see the status banner at the top of this document.
