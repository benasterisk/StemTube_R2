# Music Structure Analysis - Simplified MSAF Implementation

**Date:** 2025-10-27  
**Status:** ✅ Active  
**Version:** 2.0

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

If `msaf` is missing, an explicit log message is emitted (`pip install msaf`). If MSAF fails (invalid file, unusual format), `structure_data` remains `NULL`.

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

🎵 **Conclusion**: StemTube structure detection now relies solely on MSAF, delivering predictable behavior and consistent results without the complexity of earlier approaches.
