"""
Music Structure Detection using MSAF
Detects musical sections: intro, verse, chorus, bridge, solo, outro
"""

import os
import msaf
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

# Mapping of MSAF labels to English section labels
SECTION_LABELS = {
    # Standard labels
    'intro': 'Intro',
    'verse': 'Verse',
    'chorus': 'Chorus',
    'bridge': 'Bridge',
    'solo': 'Solo',
    'outro': 'Outro',
    'instrumental': 'Instrumental',

    # Possible variations
    'introduction': 'Intro',
    'verse1': 'Verse',
    'verse2': 'Verse',
    'verse3': 'Verse',
    'chorus1': 'Chorus',
    'chorus2': 'Chorus',
    'chorus3': 'Chorus',
    'refrain': 'Chorus',
    'prechorus': 'Pre-Chorus',
    'postchorus': 'Post-Chorus',
    'middle8': 'Bridge',
    'interlude': 'Interlude',
    'breakdown': 'Breakdown',
    'buildup': 'Buildup',
    'drop': 'Drop',
    'ending': 'Outro',
    'coda': 'Outro',
}


class StructureDetector:
    """Musical structure detector using MSAF"""

    def __init__(self, algorithm='cnmf', boundaries_id='foote'):
        """
        Initializes the structure detector

        Args:
            algorithm: MSAF algorithm to use ('cnmf', 'sf', 'olda', etc.)
            boundaries_id: Boundary detection algorithm ('foote', 'scluster', etc.)
        """
        self.algorithm = algorithm
        self.boundaries_id = boundaries_id

    def detect_structure(self, audio_path: str) -> Optional[List[Dict]]:
        """
        Detects musical structure of an audio file

        Args:
            audio_path: Path to the audio file

        Returns:
            List of sections with timestamps and labels, or None if failed
            Format: [{"start": 0.0, "end": 15.5, "label": "Intro"}, ...]
        """
        if not os.path.exists(audio_path):
            logger.error(f"[STRUCTURE] Audio file not found: {audio_path}")
            return None

        try:
            logger.info(f"[STRUCTURE] Analyzing structure with {self.algorithm}...")

            # Structure analysis with MSAF
            boundaries, labels = msaf.process(
                audio_path,
                boundaries_id=self.boundaries_id,
                labels_id=self.algorithm,
                plot=False  # No visualization
            )

            if boundaries is None or len(boundaries) == 0:
                logger.warning("[STRUCTURE] No boundaries detected")
                return None

            # Building the sections list
            sections = []
            for i in range(len(boundaries) - 1):
                start_time = float(boundaries[i])
                end_time = float(boundaries[i + 1])

                # Section label (if available)
                if labels is not None and i < len(labels):
                    raw_label = str(labels[i]).lower().strip()
                    # Mapping to standard labels
                    section_label = SECTION_LABELS.get(raw_label, f"Section {i+1}")
                else:
                    section_label = f"Section {i+1}"

                sections.append({
                    "start": start_time,
                    "end": end_time,
                    "label": section_label
                })

            logger.info(f"[STRUCTURE] Detected {len(sections)} sections")
            return sections

        except Exception as e:
            logger.error(f"[STRUCTURE] Error analyzing structure: {e}", exc_info=True)
            return None

    def detect_with_multiple_algorithms(self, audio_path: str) -> Optional[List[Dict]]:
        """
        Tries multiple MSAF algorithms in sequence

        Args:
            audio_path: Path to the audio file

        Returns:
            Best detection found, or None
        """
        # Algorithms to test in order (from most robust to most experimental)
        algorithms = [
            ('cnmf', 'foote'),      # Convolutive Non-Negative Matrix Factorization
            ('scluster', 'foote'),  # Spectral Clustering
            ('olda', 'foote'),      # Online Latent Dirichlet Allocation
        ]

        for algo, boundaries in algorithms:
            logger.info(f"[STRUCTURE] Trying algorithm: {algo} with {boundaries}")
            detector = StructureDetector(algorithm=algo, boundaries_id=boundaries)
            result = detector.detect_structure(audio_path)

            if result and len(result) >= 2:  # At least 2 sections
                logger.info(f"[STRUCTURE] Success with {algo}")
                return result

        logger.warning("[STRUCTURE] All algorithms failed")
        return None

    @staticmethod
    def enhance_labels_with_heuristics(sections: List[Dict],
                                      total_duration: float) -> List[Dict]:
        """
        Enhances labels with improved musical heuristics

        Args:
            sections: List of detected sections
            total_duration: Total duration of the song

        Returns:
            Sections with enhanced labels
        """
        if not sections or len(sections) == 0:
            return sections

        enhanced = [s.copy() for s in sections]

        # First section is often an intro if short
        if len(enhanced) > 0:
            first_duration = enhanced[0]['end'] - enhanced[0]['start']
            if first_duration < 25 and 'Section' in enhanced[0]['label']:
                enhanced[0]['label'] = 'Intro'

        # Last section is often an outro
        if len(enhanced) > 0:
            last_duration = enhanced[-1]['end'] - enhanced[-1]['start']
            if last_duration < 40 and 'Section' in enhanced[-1]['label']:
                enhanced[0]['label'] = 'Outro'

        # Group sections by similar duration (tolerance ±3 seconds)
        duration_groups = {}
        for i, section in enumerate(enhanced):
            if 'Section' not in section['label']:
                continue  # Skip already labeled sections

            duration = section['end'] - section['start']

            # Find an existing group with similar duration
            found_group = False
            for key_duration in list(duration_groups.keys()):
                if abs(duration - key_duration) <= 3.0:  # 3 second tolerance
                    duration_groups[key_duration].append((i, duration))
                    found_group = True
                    break

            if not found_group:
                duration_groups[duration] = [(i, duration)]

        # Identify repeated patterns (verse/chorus)
        # Sort groups by number of occurrences
        sorted_groups = sorted(duration_groups.items(),
                             key=lambda x: len(x[1]),
                             reverse=True)

        # Most repeated group (>= 2 occurrences) = likely verse or chorus
        for group_duration, indices_durations in sorted_groups:
            indices = [i for i, d in indices_durations]

            if len(indices) >= 2:  # At least 2 repetitions
                # Alternate between Verse and Chorus
                for idx, section_idx in enumerate(sorted(indices)):
                    if 'Section' in enhanced[section_idx]['label']:
                        if idx % 2 == 0:
                            enhanced[section_idx]['label'] = 'Verse'
                        else:
                            enhanced[section_idx]['label'] = 'Chorus'

        # Unidentified middle sections = potentially bridge or solo
        middle_start = len(enhanced) // 3
        middle_end = 2 * len(enhanced) // 3

        for i in range(middle_start, middle_end):
            if 'Section' in enhanced[i]['label']:
                duration = enhanced[i]['end'] - enhanced[i]['start']
                # Short section in middle = probably a bridge
                if duration < 20:
                    enhanced[i]['label'] = 'Bridge'
                # Long section in middle = probably an instrumental solo
                elif duration > 30:
                    enhanced[i]['label'] = 'Solo'

        return enhanced


def detect_song_structure(audio_path: str,
                         use_heuristics: bool = True) -> Optional[List[Dict]]:
    """
    Main function to detect the structure of a song

    Args:
        audio_path: Path to the audio file
        use_heuristics: Use heuristics to enhance labels

    Returns:
        List of sections or None
    """
    import soundfile as sf

    # Get total duration
    try:
        info = sf.info(audio_path)
        total_duration = info.duration
    except Exception as e:
        logger.error(f"[STRUCTURE] Cannot read audio info: {e}")
        return None

    # Detection with multiple algorithms
    detector = StructureDetector()
    sections = detector.detect_with_multiple_algorithms(audio_path)

    if sections and use_heuristics:
        sections = StructureDetector.enhance_labels_with_heuristics(sections, total_duration)

    return sections


# Simple test if executed directly
if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python structure_detector.py <audio_file>")
        sys.exit(1)

    audio_file = sys.argv[1]
    sections = detect_song_structure(audio_file)

    if sections:
        print("\n=== Detected Structure ===")
        for i, section in enumerate(sections):
            start_min = int(section['start'] // 60)
            start_sec = int(section['start'] % 60)
            end_min = int(section['end'] // 60)
            end_sec = int(section['end'] % 60)
            duration = section['end'] - section['start']

            print(f"{i+1}. {section['label']}: "
                  f"{start_min:02d}:{start_sec:02d} - {end_min:02d}:{end_sec:02d} "
                  f"({duration:.1f}s)")
    else:
        print("Structure detection failed")
