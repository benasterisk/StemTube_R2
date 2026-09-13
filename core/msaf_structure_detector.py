"""
MSAF-based Music Structure Detection
Simplified structure segmentation relying directly on the MSAF library.

The goal here is to provide a lightweight, reliable boundary detector
without the previous multi-feature SSM and merging pipeline.
"""

import os
import logging
import shutil
import tempfile
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

# msaf repeats the final boundary, which yields a zero-length last section.
MIN_SECTION_SEC = 0.5


def _patch_scipy_for_msaf() -> None:
    """Restore the SciPy names msaf 0.1.80 still uses.

    SciPy 1.12/1.13 removed ``scipy.inf`` (imported by msaf/pymf/sivm_search.py) and
    ``scipy.signal.gaussian`` (used by the Foote segmenter). Without these aliases msaf
    fails to import, and structure analysis silently produced nothing for every song.
    """
    import numpy as np
    import scipy
    import scipy.signal
    if not hasattr(scipy, "inf"):
        scipy.inf = np.inf
    if not hasattr(scipy.signal, "gaussian"):
        from scipy.signal import windows
        scipy.signal.gaussian = windows.gaussian


def detect_song_structure_msaf(
    audio_path: str,
    boundaries_id: str = "foote",
    labels_id: str = "fmc2d"
) -> Optional[List[Dict]]:
    """
    Detect song structure using MSAF.

    Args:
        audio_path: Path to the audio file to analyze.
        boundaries_id: MSAF boundaries algorithm identifier.
        labels_id: MSAF labeling algorithm identifier.

    Returns:
        List of sections with start/end times, labels, and placeholder confidence,
        or None if detection failed.
    """
    if not os.path.exists(audio_path):
        logger.error(f"[MSAF] Audio file not found: {audio_path}")
        return None

    try:
        _patch_scipy_for_msaf()
        import msaf
    except ImportError as exc:
        # Report the real cause: this used to say "not installed" when msaf WAS installed
        # but broke on a SciPy API it relies on.
        logger.error(f"[MSAF] msaf could not be imported: {exc}")
        return None

    # msaf caches features in ./.features_msaf_tmp.json by default, i.e. in the server's
    # working directory, shared by every concurrent analysis. Give each run its own.
    work_dir = tempfile.mkdtemp(prefix="msaf_")
    previous_tmp = msaf.config.features_tmp_file
    msaf.config.features_tmp_file = os.path.join(work_dir, "features.json")

    try:
        logger.info(f"[MSAF] Running structure analysis with boundaries_id={boundaries_id}, "
                    f"labels_id={labels_id}")

        boundaries, labels = msaf.process(
            audio_path,
            boundaries_id=boundaries_id,
            labels_id=labels_id,
            plot=False
        )

        if boundaries is None or len(boundaries) < 2:
            logger.warning("[MSAF] Not enough boundaries detected.")
            return None

        sections: List[Dict] = []
        # fmc2d labels are similarity-cluster ids (0, 1, 2...), not "verse"/"chorus":
        # sections that sound alike share an id. Show them as letters, A for the first
        # cluster heard, so repeats read naturally (A B C B A...).
        letters: Dict[int, str] = {}

        for idx in range(len(boundaries) - 1):
            start = float(boundaries[idx])
            end = float(boundaries[idx + 1])
            if end - start < MIN_SECTION_SEC:
                continue

            raw = labels[idx] if labels is not None and idx < len(labels) else None
            if raw is None:
                label = f"Section {len(sections) + 1}"
            else:
                cluster = int(raw)
                if cluster not in letters:
                    letters[cluster] = chr(ord("A") + len(letters) % 26)
                label = letters[cluster]

            sections.append({
                "start": start,
                "end": end,
                "label": label,
                "confidence": 1.0  # MSAF does not provide confidence scores
            })

        logger.info(f"[MSAF] Detected {len(sections)} sections.")
        return sections or None

    except Exception as exc:
        logger.error(f"[MSAF] Structure detection failed: {exc}", exc_info=True)
        return None
    finally:
        msaf.config.features_tmp_file = previous_tmp
        shutil.rmtree(work_dir, ignore_errors=True)
