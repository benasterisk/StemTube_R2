"""
BTC (Bi-directional Transformer) Chord Detection Integration
Professional-grade chord detection with 170 chord vocabulary using deep learning.
"""

import os
import sys
import json
import numpy as np
from typing import Tuple, Optional, List, Dict

# Add BTC module to path
# BTC is located at external/BTC-ISMIR19 relative to project root
BTC_PATH = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'external', 'BTC-ISMIR19'))
if os.path.exists(BTC_PATH):
    sys.path.insert(0, BTC_PATH)
    BTC_AVAILABLE = True
else:
    BTC_AVAILABLE = False
    print(f"[BTC] Warning: BTC path not found at {BTC_PATH}")

# Try to import BTC wrapper
if BTC_AVAILABLE:
    try:
        from btc_wrapper import BTCChordDetector as BTCWrapper
        print("[BTC] BTC wrapper imported successfully")
    except ImportError as e:
        BTC_AVAILABLE = False
        print(f"[BTC] Warning: Could not import BTC wrapper: {e}")


class BTCChordDetector:
    """
    BTC Transformer chord detector for Stemtube.

    Features:
    - 170 chord vocabulary (major, minor, 7th, maj7, min7, sus, dim, aug, etc.)
    - Bi-directional transformer architecture
    - Professional-grade accuracy for complex music (jazz, rock, etc.)
    - Deep learning-based feature extraction
    """

    def __init__(self, model_path: Optional[str] = None):
        """
        Initialize BTC chord detector.

        Args:
            model_path: Path to BTC-ISMIR19 directory (auto-detected if None)
        """
        if not BTC_AVAILABLE:
            raise ImportError("BTC is not available - check installation path")

        # Determine BTC path
        if model_path and os.path.exists(model_path):
            self.btc_path = model_path
        else:
            self.btc_path = BTC_PATH

        if not os.path.exists(self.btc_path):
            raise FileNotFoundError(f"BTC path not found: {self.btc_path}")

        # Initialize BTC detector with large vocabulary (170 chords)
        print(f"[BTC] Initializing detector from: {self.btc_path}")
        self.detector = BTCWrapper(use_large_vocab=True)
        print("[BTC] ✓ Detector initialized with 170 chord vocabulary")

    def detect_chords(self, audio_file_path: str, bpm: Optional[float] = None) -> Tuple[Optional[str], float]:
        """
        Detect chords in audio file using BTC transformer.

        Args:
            audio_file_path: Path to audio file
            bpm: Known BPM (optional, not used by BTC but kept for API compatibility)

        Returns:
            tuple: (chords_json, beat_offset)
                - chords_json: JSON string of chord detections
                - beat_offset: Time offset to first chord change in seconds
        """
        if not os.path.exists(audio_file_path):
            print(f"[BTC ERROR] File not found: {audio_file_path}")
            return None, 0.0

        print(f"[BTC] Processing: {os.path.basename(audio_file_path)}")

        try:
            # Run BTC chord detection
            # Returns: [(start_time, end_time, chord_label), ...]
            print("[BTC] Running transformer inference...")
            segments = self.detector.detect(audio_file_path, return_format='tuples')

            if not segments:
                print("[BTC WARNING] No chords detected")
                return None, 0.0

            print(f"[BTC] Detected {len(segments)} chord segments")

            # Convert to Stemtube format
            chords_data = self._format_for_stemtube(segments)
            print(f"[BTC] Formatted {len(chords_data)} chord changes for Stemtube")

            # Beat offset is the timestamp of first chord
            beat_offset = chords_data[0]['timestamp'] if chords_data else 0.0

            # Convert to JSON
            chords_json = json.dumps(chords_data)

            print(f"[BTC] ✓ Detection complete: {len(chords_data)} chord changes, offset={beat_offset:.3f}s")

            return chords_json, beat_offset

        except Exception as e:
            print(f"[BTC ERROR] Chord detection failed: {e}")
            import traceback
            traceback.print_exc()
            return None, 0.0

    def _format_for_stemtube(self, segments: List[Tuple[float, float, str]]) -> List[Dict]:
        """
        Convert BTC segments to Stemtube chord timeline format.

        BTC format: [(start, end, "D:min"), (end, next_end, "G:maj"), ...]
        Stemtube format: [{"timestamp": 0.0, "chord": "Dm"}, {"timestamp": 4.5, "chord": "G"}, ...]

        Args:
            segments: List of (start_time, end_time, chord_label) tuples from BTC

        Returns:
            List of chord dictionaries for Stemtube
        """
        chords_data = []

        for start_time, end_time, chord_label in segments:
            # Skip "N" (no chord) segments
            if chord_label == 'N':
                continue

            # Convert BTC chord label to Stemtube format
            chord_name = self._convert_chord_label(chord_label)

            # Add to timeline
            chords_data.append({
                "timestamp": round(float(start_time), 3),
                "chord": chord_name
            })

        # Remove consecutive duplicates (BTC may have repeated chords)
        chords_data = self._merge_duplicates(chords_data)

        return chords_data

    def _convert_chord_label(self, btc_label: str) -> str:
        """
        Convert BTC chord label to Stemtube display format.

        BTC uses colon notation:
        - "C:maj" → "C"
        - "D:min" → "Dm"
        - "E:maj7" → "Emaj7"
        - "G:7" → "G7"
        - "A:sus4" → "Asus4"
        - "F#:dim" → "F#dim"
        - "Bb:aug" → "Bbaug"
        - "D:min7" → "Dm7"

        Args:
            btc_label: BTC chord label (e.g., "D:min")

        Returns:
            Stemtube chord label (e.g., "Dm")
        """
        # Handle simple root notes without quality
        if ':' not in btc_label:
            return btc_label

        # Split into root and quality
        root, quality = btc_label.split(':', 1)

        # Map BTC quality strings to Stemtube format
        quality_map = {
            'maj': '',          # C:maj → C
            'min': 'm',         # D:min → Dm
            'maj7': 'maj7',     # E:maj7 → Emaj7
            'min7': 'm7',       # A:min7 → Am7
            '7': '7',           # G:7 → G7
            'maj6': '6',        # C:maj6 → C6
            'min6': 'm6',       # D:min6 → Dm6
            'sus2': 'sus2',     # G:sus2 → Gsus2
            'sus4': 'sus4',     # A:sus4 → Asus4
            'dim': 'dim',       # F:dim → Fdim
            'aug': 'aug',       # C:aug → Caug
            'dim7': 'dim7',     # B:dim7 → Bdim7
            'hdim7': 'm7b5',    # D:hdim7 → Dm7b5 (half-diminished)
            '9': '9',           # C:9 → C9
            'maj9': 'maj9',     # D:maj9 → Dmaj9
            'min9': 'm9',       # E:min9 → Em9
            '11': '11',         # F:11 → F11
            '13': '13',         # G:13 → G13
        }

        # Convert quality or keep original if not in map
        suffix = quality_map.get(quality, quality)

        return f"{root}{suffix}"

    def _merge_duplicates(self, chords: List[Dict]) -> List[Dict]:
        """
        Merge consecutive duplicate chords to clean up timeline.

        Args:
            chords: List of chord dictionaries

        Returns:
            Filtered list without consecutive duplicates
        """
        if len(chords) <= 1:
            return chords

        merged = [chords[0]]

        for chord in chords[1:]:
            # Skip if same as previous chord
            if chord['chord'] != merged[-1]['chord']:
                merged.append(chord)

        return merged


def analyze_audio_file(audio_file_path: str, bpm: Optional[float] = None) -> Tuple[Optional[str], float]:
    """
    Main entry point for BTC chord detection (matches Stemtube API).

    Args:
        audio_file_path: Path to audio file
        bpm: Known BPM (optional, not used by BTC)

    Returns:
        tuple: (chords_json, beat_offset)
    """
    if not BTC_AVAILABLE:
        print("[BTC] BTC not available, cannot analyze")
        return None, 0.0

    try:
        detector = BTCChordDetector()
        return detector.detect_chords(audio_file_path, bpm)
    except Exception as e:
        print(f"[BTC] Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return None, 0.0


def is_available() -> bool:
    """Check if BTC is available for use."""
    return BTC_AVAILABLE


# Test mode
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python btc_chord_detector.py <audio_file>")
        sys.exit(1)

    audio_file = sys.argv[1]

    if not is_available():
        print("BTC is not available. Check installation.")
        sys.exit(1)

    # Test detection
    chords_json, beat_offset = analyze_audio_file(audio_file)

    if chords_json:
        chords = json.loads(chords_json)
        print(f"\n✓ Detected {len(chords)} chord changes:")
        print(f"Beat offset: {beat_offset:.3f}s\n")

        for i, chord_data in enumerate(chords[:20]):
            print(f"  {chord_data['timestamp']:6.2f}s: {chord_data['chord']}")

        if len(chords) > 20:
            print(f"  ... and {len(chords) - 20} more")
    else:
        print("Detection failed.")
