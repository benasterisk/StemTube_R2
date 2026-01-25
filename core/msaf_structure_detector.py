"""
MSAF-based Music Structure Detection
Simplified structure segmentation relying directly on the MSAF library.

The goal here is to provide a lightweight, reliable boundary detector
without the previous multi-feature SSM and merging pipeline.
"""

import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


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
        import msaf
    except ImportError as exc:
        logger.error("[MSAF] msaf library is not installed. "
                     "Run `pip install msaf` inside the virtual environment.")
        logger.debug(exc, exc_info=True)
        return None

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

        for idx in range(len(boundaries) - 1):
            start = float(boundaries[idx])
            end = float(boundaries[idx + 1])

            # Some MSAF labelers can output None; fallback to generic section names.
            label_value = labels[idx] if labels is not None and idx < len(labels) else None
            label = label_value if label_value else f"Section {idx + 1}"

            sections.append({
                "start": start,
                "end": end,
                "label": label,
                "confidence": 1.0  # MSAF does not provide confidence scores
            })

        logger.info(f"[MSAF] Detected {len(sections)} sections.")
        return sections

    except Exception as exc:
        logger.error(f"[MSAF] Structure detection failed: {exc}", exc_info=True)
        return None
