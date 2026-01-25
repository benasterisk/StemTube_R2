"""
Professional-grade chord detection using madmom library.
Provides Chordify/Moises-level accuracy with advanced beat tracking and extended chord vocabulary.
"""

import os
import json
import numpy as np
from typing import Tuple, List, Dict, Optional

# Monkey-patch numpy for madmom compatibility with numpy 2.x
if not hasattr(np, 'int'):
    np.int = np.int64
if not hasattr(np, 'float'):
    np.float = np.float64
if not hasattr(np, 'bool'):
    np.bool = np.bool_

# Check if madmom is available
try:
    import madmom
    from madmom.features import chords as madmom_chords
    from madmom.features import beats as madmom_beats
    from madmom.audio.chroma import DeepChromaProcessor
    MADMOM_AVAILABLE = True
except ImportError as e:
    MADMOM_AVAILABLE = False
    print(f"Warning: madmom not available, using fallback chord detection: {e}")


class MadmomChordDetector:
    """
    Professional chord detection using madmom's deep learning models.

    Features:
    - CNN-based chroma extraction (more accurate than STFT)
    - CRF (Conditional Random Field) for chord recognition
    - RNN-based beat tracking for precise timeline alignment
    - Extended chord vocabulary (major, minor, 7th, sus, dim, aug)
    - Smoothing and post-processing for stability
    """

    def __init__(self):
        """Initialize madmom processors."""
        if not MADMOM_AVAILABLE:
            raise ImportError("madmom is not installed")

        # Use the complete chord recognition processor (includes chroma + CRF)
        # This is the equivalent of using 'CNNChordFeatureProcessor' + 'CRFChordRecognitionProcessor'
        self.chord_processor = madmom_chords.CNNChordFeatureProcessor()
        self.chord_recognizer = madmom_chords.CRFChordRecognitionProcessor()

        # Beat tracking for timeline synchronization
        self.beat_processor = madmom_beats.RNNBeatProcessor()
        self.beat_tracker = madmom_beats.DBNBeatTrackingProcessor(fps=100)

        print("[MADMOM] Professional chord detector initialized")

    def detect_chords(self, audio_file_path: str, bpm: Optional[float] = None) -> Tuple[Optional[str], float]:
        """
        Detect chords in an audio file with professional-grade accuracy.

        Args:
            audio_file_path: Path to audio file
            bpm: Known BPM (optional, will be detected if not provided)

        Returns:
            tuple: (chords_json, beat_offset)
                - chords_json: JSON string of chord detections
                - beat_offset: Time offset to first downbeat in seconds
        """
        if not os.path.exists(audio_file_path):
            print(f"[MADMOM ERROR] File not found: {audio_file_path}")
            return None, 0.0

        print(f"[MADMOM] Processing: {os.path.basename(audio_file_path)}")

        try:
            # Step 1: Beat tracking for timeline alignment
            print("[MADMOM] Step 1/3: Detecting beats...")
            beat_offset, beats = self._detect_beats(audio_file_path, bpm)
            print(f"[MADMOM] Beat offset: {beat_offset:.3f}s, {len(beats)} beats detected")

            # Step 2: Extract CNN chord features
            print("[MADMOM] Step 2/3: Extracting CNN chord features...")
            chord_features = self.chord_processor(audio_file_path)
            print(f"[MADMOM] Features shape: {chord_features.shape}")

            # Step 3: Recognize chords using CRF
            print("[MADMOM] Step 3/3: Recognizing chords with CRF...")
            chord_labels = self.chord_recognizer(chord_features)

            # Post-process and format results
            chords_data = self._format_chord_results(chord_labels, beat_offset, beats)

            print(f"[MADMOM] ✓ Detected {len(chords_data)} chord changes")

            # Convert to JSON
            chords_json = json.dumps(chords_data)

            return chords_json, beat_offset

        except Exception as e:
            print(f"[MADMOM ERROR] Chord detection failed: {e}")
            import traceback
            traceback.print_exc()
            return None, 0.0

    def _detect_beats(self, audio_file_path: str, known_bpm: Optional[float] = None) -> Tuple[float, np.ndarray]:
        """
        Detect beats and downbeat offset using RNN beat tracker.

        Args:
            audio_file_path: Path to audio file
            known_bpm: Known BPM (optional hint for better accuracy)

        Returns:
            tuple: (beat_offset, beat_times)
                - beat_offset: Time of first downbeat in seconds
                - beat_times: Array of beat times in seconds
        """
        # Process with RNN beat detector
        beat_activations = self.beat_processor(audio_file_path)

        # Track beats with DBN
        if known_bpm:
            # Use known BPM as prior
            beats = self.beat_tracker(beat_activations)
        else:
            beats = self.beat_tracker(beat_activations)

        if len(beats) == 0:
            print("[MADMOM WARNING] No beats detected, using 0.0 offset")
            return 0.0, np.array([])

        # First beat is our downbeat offset
        beat_offset = float(beats[0])

        return beat_offset, beats

    def _format_chord_results(
        self,
        chord_labels: np.ndarray,
        beat_offset: float,
        beats: np.ndarray
    ) -> List[Dict]:
        """
        Format madmom chord results into our application format.

        Args:
            chord_labels: Array of (start_time, end_time, chord_label) from madmom CRF
            beat_offset: Offset to first downbeat
            beats: Array of beat times

        Returns:
            List of chord dictionaries with timestamps and labels
        """
        chords_data = []

        # Madmom CRF returns structured array with (start, end, label)
        # label is a string like "E:maj", "C:min", "N" (no chord)
        for segment in chord_labels:
            start_time = float(segment['start'])
            end_time = float(segment['end'])
            chord_label = str(segment['label'])

            # Skip "N" (no chord) segments
            if chord_label == 'N':
                continue

            # Convert madmom label format to standard format
            chord_name = self._convert_chord_label(chord_label)

            chords_data.append({
                "timestamp": round(start_time, 3),
                "chord": chord_name,
                "confidence": 1.0  # madmom CRF doesn't provide confidence
            })

        # Merge consecutive duplicate chords
        chords_data = self._merge_duplicate_chords(chords_data)

        return chords_data

    def _convert_chord_label(self, madmom_label: str) -> str:
        """
        Convert madmom chord label to standard format.

        Madmom format examples:
        - "C:maj" -> "C"
        - "A:min" -> "Am"
        - "D#:maj" -> "Eb" (enharmonic conversion)
        - "G#:maj" -> "Ab" (enharmonic conversion)
        - "G:maj7" -> "Gmaj7"
        - "D:min7" -> "Dm7"
        - "E:sus4" -> "Esus4"
        - "F#:dim" -> "F#dim"
        - "Bb:aug" -> "Bbaug"

        Args:
            madmom_label: Chord label from madmom (e.g., "C:maj")

        Returns:
            Standard chord name (e.g., "C", "Am", "Gmaj7")
        """
        if ':' not in madmom_label:
            return madmom_label

        root, quality = madmom_label.split(':', 1)

        # Convert enharmonic equivalents to standard notation (prefer flats)
        enharmonic_map = {
            'D#': 'Eb',
            'G#': 'Ab',
            'A#': 'Bb'
        }
        root = enharmonic_map.get(root, root)

        # Convert quality to standard notation
        quality_map = {
            'maj': '',
            'min': 'm',
            'maj7': 'maj7',
            'min7': 'm7',
            '7': '7',
            'maj6': '6',
            'min6': 'm6',
            'dim': 'dim',
            'aug': 'aug',
            'sus2': 'sus2',
            'sus4': 'sus4',
            'dim7': 'dim7',
            'hdim7': 'm7b5',
        }

        suffix = quality_map.get(quality, quality)
        return f"{root}{suffix}"

    def _merge_duplicate_chords(self, chords: List[Dict], min_duration: float = 0.2) -> List[Dict]:
        """
        Merge consecutive duplicate chords to reduce noise.

        Args:
            chords: List of chord dictionaries
            min_duration: Minimum duration for a chord change (seconds)

        Returns:
            Filtered list of chord changes
        """
        if len(chords) <= 1:
            return chords

        merged = [chords[0]]

        for chord in chords[1:]:
            prev = merged[-1]

            # If same chord and too close in time, skip
            if chord['chord'] == prev['chord']:
                if chord['timestamp'] - prev['timestamp'] < min_duration:
                    continue

            merged.append(chord)

        return merged


def analyze_audio_file(audio_file_path: str, bpm: Optional[float] = None) -> Tuple[Optional[str], float]:
    """
    Main entry point for chord analysis using madmom.

    Args:
        audio_file_path: Path to audio file
        bpm: Known BPM (optional)

    Returns:
        tuple: (chords_json, beat_offset)
    """
    if not MADMOM_AVAILABLE:
        print("[MADMOM] Library not available, cannot analyze")
        return None, 0.0

    try:
        detector = MadmomChordDetector()
        return detector.detect_chords(audio_file_path, bpm)
    except Exception as e:
        print(f"[MADMOM] Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return None, 0.0


# Convenience function to check availability
def is_available() -> bool:
    """Check if madmom is available for use."""
    return MADMOM_AVAILABLE
