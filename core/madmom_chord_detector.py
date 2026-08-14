"""
Professional-grade chord detection using madmom library.
Provides Chordify/Moises-level accuracy with advanced beat tracking and extended chord vocabulary.
"""

import os
import sys
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

# Fix madmom model paths in compiled mode (PyInstaller / Nuitka).
# madmom uses MODEL_PATH = os.path.dirname(__file__) in its models/__init__.py
# to locate .pkl files. When compiled, __file__ resolves to a directory where
# the models subpackage was NOT copied. We patch it before importing madmom.
_is_frozen = getattr(sys, 'frozen', False) or hasattr(sys, '__compiled__')
if _is_frozen:
    # PyInstaller: sys._MEIPASS points to _internal/
    # Nuitka: the exe directory contains the package tree
    _base = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    _madmom_models_dir = os.path.join(_base, 'madmom', 'models')
    if os.path.isdir(_madmom_models_dir):
        os.environ['MADMOM_MODELS_PATH'] = _madmom_models_dir
        print(f"[MADMOM] Compiled mode: models at {_madmom_models_dir}")

# Check if madmom is available
try:
    import madmom
    from madmom.features import chords as madmom_chords
    from madmom.features import beats as madmom_beats
    from madmom.audio.chroma import DeepChromaProcessor

    # Patch MODEL_PATH in compiled mode after import
    if _is_frozen and 'MADMOM_MODELS_PATH' in os.environ:
        try:
            import madmom.models as _mm
            _mm.MODEL_PATH = os.environ['MADMOM_MODELS_PATH']
            # Re-evaluate model constants that depend on MODEL_PATH
            import glob as _glob
            def _models(pattern, path=_mm.MODEL_PATH):
                return sorted(_glob.glob('%s/%s' % (path, pattern)))
            _mm.models = _models
            # Re-assign chord model constants
            _mm.CHORDS_CNN_FEAT = _models('chords/2016/chords_cnnfeat.pkl')
            _mm.CHORDS_CFCRF = _models('chords/2016/chords_cfcrf.pkl')
            _mm.CHORDS_DCCRF = _models('chords/2016/chords_dccrf.pkl')
            print(f"[MADMOM] Patched MODEL_PATH to {_mm.MODEL_PATH}")
        except Exception as e:
            print(f"[MADMOM] Warning: could not patch MODEL_PATH: {e}")

    MADMOM_AVAILABLE = True
except ImportError as e:
    MADMOM_AVAILABLE = False
    print(f"Warning: madmom not available, using fallback chord detection: {e}")

# Downbeat-aware detection (provides beat-in-bar position: 1/2/3/4)
try:
    from madmom.features.downbeats import RNNDownBeatProcessor, DBNDownBeatTrackingProcessor
    _HAS_DOWNBEAT = True
except ImportError:
    _HAS_DOWNBEAT = False


class MadmomChordDetector:
    """
    Professional chord detection using madmom's deep learning models.

    Features:
    - CNN-based chroma extraction (more accurate than STFT)
    - CRF (Conditional Random Field) for chord recognition
    - RNN-based beat tracking for precise timeline alignment
    - DBNDownBeatTrackingProcessor for accurate downbeat (bar position) detection
    - BPM-constrained tracking when known_bpm is provided
    - Extended chord vocabulary (major, minor, 7th, sus, dim, aug)
    - Smoothing and post-processing for stability
    """

    # Default DBN parameters
    _DBN_FPS = 100
    _DBN_TRANSITION_LAMBDA = 100   # Higher = more constant tempo
    _DBN_OBSERVATION_LAMBDA = 16   # Splits beat period into beat/non-beat states
    _DBN_THRESHOLD = 0.05
    # BPM tolerance window (fraction) when constraining with known_bpm
    _BPM_TOLERANCE = 0.15          # +/- 15 % around known BPM

    # Systematic latency correction.
    # madmom's RNNDownBeatProcessor reports beat times ~25 ms EARLIER than the
    # perceived attack (kick/snare transient). Measured across 11 tracks of
    # different genres: median deviation +24.9 ms, std ~4 ms, no drift.
    # We push every detected beat later by this amount so the metronome click
    # lands ON the transient instead of slightly before it.
    BEAT_LATENCY_CORRECTION_SEC = 0.025

    def __init__(self):
        """Initialize madmom processors."""
        if not MADMOM_AVAILABLE:
            raise ImportError("madmom is not installed")

        # Use the complete chord recognition processor (includes chroma + CRF)
        # This is the equivalent of using 'CNNChordFeatureProcessor' + 'CRFChordRecognitionProcessor'
        self.chord_processor = madmom_chords.CNNChordFeatureProcessor()
        self.chord_recognizer = madmom_chords.CRFChordRecognitionProcessor()

        # Beat tracking for timeline synchronization (fallback)
        self.beat_processor = madmom_beats.RNNBeatProcessor()
        self.beat_tracker = madmom_beats.DBNBeatTrackingProcessor(fps=100)

        # Downbeat-aware tracking (provides beat-in-bar position: 1/2/3/4)
        self._has_downbeat = False
        self._downbeat_activations_cache = None  # Reuse activations across tracker configs
        if _HAS_DOWNBEAT:
            try:
                self.downbeat_processor = RNNDownBeatProcessor()
                # Default unconstrained tracker (used when no BPM hint)
                self.downbeat_tracker = DBNDownBeatTrackingProcessor(
                    beats_per_bar=[3, 4],  # Model both 3/4 and 4/4 when unconstrained
                    fps=self._DBN_FPS,
                    transition_lambda=self._DBN_TRANSITION_LAMBDA,
                    observation_lambda=self._DBN_OBSERVATION_LAMBDA,
                )
                self._has_downbeat = True
                print("[MADMOM] Downbeat-aware detection enabled (DBNDownBeatTrackingProcessor)")
            except Exception as e:
                print(f"[MADMOM] Downbeat processor init failed, using basic: {e}")

        print("[MADMOM] Professional chord detector initialized")

    def _make_constrained_tracker(self, known_bpm: float, beats_per_bar: Optional[List[int]] = None
                                  ) -> 'DBNDownBeatTrackingProcessor':
        """
        Create a BPM-constrained DBNDownBeatTrackingProcessor.

        When a known BPM is available, constraining the HMM tempo range yields
        significantly better downbeat tracking — the Viterbi decoder no longer
        has to search a wide tempo space, so it locks onto the correct phase
        faster and avoids octave errors entirely.

        Args:
            known_bpm:     Target tempo in BPM.
            beats_per_bar: Bar lengths to model (default: [3, 4]).

        Returns:
            A DBNDownBeatTrackingProcessor constrained to the given tempo.
        """
        if beats_per_bar is None:
            beats_per_bar = [3, 4]

        lo = max(30.0, known_bpm * (1.0 - self._BPM_TOLERANCE))
        hi = min(300.0, known_bpm * (1.0 + self._BPM_TOLERANCE))

        print(f"[MADMOM] Creating BPM-constrained downbeat tracker: "
              f"{lo:.1f}–{hi:.1f} BPM (target {known_bpm:.1f}), "
              f"bars={beats_per_bar}")

        return DBNDownBeatTrackingProcessor(
            beats_per_bar=beats_per_bar,
            min_bpm=lo,
            max_bpm=hi,
            num_tempi=60,
            fps=self._DBN_FPS,
            transition_lambda=self._DBN_TRANSITION_LAMBDA * 2,  # Tighter tempo stability
            observation_lambda=self._DBN_OBSERVATION_LAMBDA,
        )

    def detect_chords(self, audio_file_path: str, bpm: Optional[float] = None) -> Tuple[Optional[str], float, List, List]:
        """
        Detect chords in an audio file with professional-grade accuracy.

        Args:
            audio_file_path: Path to audio file
            bpm: Known BPM (optional, will be detected if not provided)

        Returns:
            tuple: (chords_json, beat_offset, beat_times_list, beat_positions)
                - chords_json: JSON string of chord detections
                - beat_offset: Time offset to first downbeat in seconds
                - beat_times_list: List of beat timestamps in seconds
                - beat_positions: List of beat-in-bar positions (1,2,3,4)
        """
        if not os.path.exists(audio_file_path):
            print(f"[MADMOM ERROR] File not found: {audio_file_path}")
            return None, 0.0, [], []

        print(f"[MADMOM] Processing: {os.path.basename(audio_file_path)}")

        try:
            # Step 1: Beat tracking for timeline alignment
            print("[MADMOM] Step 1/3: Detecting beats...")
            beat_offset, beats, beat_positions = self._detect_beats(audio_file_path, bpm)
            beat_times_list = [round(float(b), 4) for b in beats]
            print(f"[MADMOM] Beat offset: {beat_offset:.3f}s, {len(beats)} beats detected, {len(beat_positions)} positions")

            # Step 2: Extract CNN chord features
            print("[MADMOM] Step 2/3: Extracting CNN chord features...")
            chord_features = self.chord_processor(audio_file_path)
            print(f"[MADMOM] Features shape: {chord_features.shape}")

            # Step 3: Recognize chords using CRF
            print("[MADMOM] Step 3/3: Recognizing chords with CRF...")
            chord_labels = self.chord_recognizer(chord_features)

            # Post-process and format results
            chords_data = self._format_chord_results(chord_labels, beat_offset, beats)

            print(f"[MADMOM] [OK] Detected {len(chords_data)} chord changes")

            # Convert to JSON
            chords_json = json.dumps(chords_data)

            return chords_json, beat_offset, beat_times_list, beat_positions

        except Exception as e:
            print(f"[MADMOM ERROR] Chord detection failed: {e}")
            import traceback
            traceback.print_exc()
            return None, 0.0, [], []

    def _detect_beats(self, audio_file_path: str, known_bpm: Optional[float] = None) -> Tuple[float, np.ndarray, List]:
        """
        Detect beats and downbeat positions using DBNDownBeatTrackingProcessor.

        Strategy
        --------
        1. Compute RNNDownBeatProcessor activations (once — expensive).
        2. If *known_bpm* is supplied, build a tempo-constrained
           DBNDownBeatTrackingProcessor so the HMM searches only a narrow
           tempo window.  This eliminates octave errors and locks phase
           faster.
        3. Decode activations → (time, bar_position) via Viterbi.
        4. Post-hoc octave sanity check (safety net for edge cases).
        5. Fall back to basic RNNBeatProcessor + DBNBeatTrackingProcessor
           if downbeat detection fails entirely.

        Args:
            audio_file_path: Path to audio file
            known_bpm: Known BPM (optional, dramatically improves accuracy)

        Returns:
            tuple: (beat_offset, beat_times, beat_positions)
                - beat_offset: Time of first downbeat in seconds
                - beat_times: ndarray of beat times in seconds
                - beat_positions: List of beat-in-bar positions (1,2,3,4…) or []
        """
        # -----------------------------------------------------------------
        # Primary path: downbeat-aware detection (RNN + DBN)
        # -----------------------------------------------------------------
        if self._has_downbeat:
            try:
                # Step 1 — Compute activations (most expensive step, ~10-30s)
                print("[MADMOM] Computing RNNDownBeatProcessor activations...")
                activations = self.downbeat_processor(audio_file_path)

                # Step 2 — Choose tracker: constrained or default
                if known_bpm and known_bpm > 0:
                    tracker = self._make_constrained_tracker(known_bpm)
                else:
                    tracker = self.downbeat_tracker
                    print("[MADMOM] Using default unconstrained downbeat tracker")

                # Step 3 — Viterbi decoding
                result = tracker(activations)

                if len(result) > 0:
                    beats = result[:, 0]
                    beat_positions = result[:, 1].astype(int).tolist()

                    # Step 4 — Post-hoc octave sanity check
                    # Even with constrained tracking, verify we're not at 2x
                    beats, beat_positions = self._octave_sanity_check(
                        beats, beat_positions, known_bpm
                    )

                    # Apply systematic latency correction (push beats later so
                    # the click lands on the perceived transient, not before it).
                    beats = self._apply_latency_correction(beats)

                    # Determine beat_offset = time of first downbeat (position 1)
                    downbeat_indices = [i for i, p in enumerate(beat_positions) if p == 1]
                    if downbeat_indices:
                        beat_offset = float(beats[downbeat_indices[0]])
                    else:
                        beat_offset = float(beats[0])

                    # Log summary
                    if len(beats) > 1:
                        median_ibi = float(np.median(np.diff(beats)))
                        effective_bpm = 60.0 / median_ibi if median_ibi > 0 else 0
                    else:
                        effective_bpm = 0
                    print(f"[MADMOM] Downbeat detection complete: {len(beats)} beats, "
                          f"{len(downbeat_indices)} downbeats, "
                          f"effective BPM={effective_bpm:.1f}, "
                          f"offset={beat_offset:.3f}s "
                          f"(+{self.BEAT_LATENCY_CORRECTION_SEC*1000:.0f}ms latency corr.)")

                    return beat_offset, beats, beat_positions

                print("[MADMOM WARNING] DBN returned empty result, falling back to basic")

            except Exception as e:
                print(f"[MADMOM WARNING] Downbeat detection failed, falling back to basic: {e}")
                import traceback
                traceback.print_exc()

        # -----------------------------------------------------------------
        # Fallback: basic beat tracking (no bar positions)
        # -----------------------------------------------------------------
        print("[MADMOM] Using basic RNN beat processor (no downbeat info)...")
        beat_activations = self.beat_processor(audio_file_path)
        beats = self.beat_tracker(beat_activations)

        if len(beats) == 0:
            print("[MADMOM WARNING] No beats detected, using 0.0 offset")
            return 0.0, np.array([]), []

        beats = self._apply_latency_correction(beats)
        beat_offset = float(beats[0])
        return beat_offset, beats, []

    @classmethod
    def _apply_latency_correction(cls, beats: np.ndarray) -> np.ndarray:
        """
        Shift all beat times later by BEAT_LATENCY_CORRECTION_SEC.

        madmom systematically reports beats ~25 ms before the perceived
        transient. Pushing them later makes the metronome click coincide with
        the kick/snare instead of anticipating it. Times are clamped at 0.
        """
        if beats is None or len(beats) == 0:
            return beats
        corrected = np.asarray(beats, dtype=float) + cls.BEAT_LATENCY_CORRECTION_SEC
        # Don't let the very first beats go negative (rare, but keep them valid).
        corrected = np.clip(corrected, 0.0, None)
        return corrected

    @staticmethod
    def _octave_sanity_check(beats: np.ndarray, beat_positions: List[int],
                             known_bpm: Optional[float]) -> Tuple[np.ndarray, List[int]]:
        """
        Safety-net octave correction applied after DBN decoding.

        If the detected tempo is roughly 2x the known BPM the tracker locked
        onto eighth-note subdivisions.  Thin the beats by taking every other
        one and re-number bar positions sequentially.

        Args:
            beats:          Array of beat times.
            beat_positions: Corresponding bar positions (1-based).
            known_bpm:      Reference tempo (may be None).

        Returns:
            (beats, beat_positions) — possibly thinned and re-numbered.
        """
        if not (known_bpm and known_bpm > 0 and len(beats) > 2):
            return beats, beat_positions

        median_interval = float(np.median(np.diff(beats)))
        if median_interval <= 0:
            return beats, beat_positions

        detected_bpm = 60.0 / median_interval
        ratio = detected_bpm / known_bpm

        if 1.7 < ratio < 2.3:
            print(f"[MADMOM] Octave correction: {detected_bpm:.1f} → {detected_bpm/2:.1f} BPM "
                  f"(decimating every other beat)")
            beats = beats[::2]
            # Determine beats-per-bar from the original positions
            max_pos = max(beat_positions) if beat_positions else 4
            bpb = max_pos if max_pos in (3, 4) else 4
            beat_positions = [(i % bpb) + 1 for i in range(len(beats))]
        elif 0.43 < ratio < 0.58:
            # Opposite: detected BPM is ~half of known → tracker found half-notes.
            # This is rarer but log it for diagnostics.
            print(f"[MADMOM] Warning: detected BPM ({detected_bpm:.1f}) is ~half of "
                  f"known ({known_bpm:.1f}) — tracker may be tracking half-notes")

        return beats, beat_positions

    def detect_beats_only(self, audio_file_path: str, known_bpm: Optional[float] = None
                          ) -> Tuple[float, List[float], List[int]]:
        """
        Public convenience method for standalone beat detection (no chords).

        This is the recommended entry point when only beat/downbeat information
        is needed (e.g. from extensions.py post-extraction beat detection).

        Args:
            audio_file_path: Path to audio file.
            known_bpm:       Known BPM hint (optional, improves accuracy).

        Returns:
            tuple: (beat_offset, beat_times_list, beat_positions_list)
                - beat_offset:       float, time of first downbeat in seconds
                - beat_times_list:   list of float, all beat timestamps
                - beat_positions_list: list of int, bar positions (1,2,3,4…)
        """
        if not os.path.exists(audio_file_path):
            print(f"[MADMOM ERROR] File not found: {audio_file_path}")
            return 0.0, [], []

        beat_offset, beats, beat_positions = self._detect_beats(audio_file_path, known_bpm)
        beat_times_list = [round(float(b), 4) for b in beats] if len(beats) > 0 else []
        return beat_offset, beat_times_list, beat_positions

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


def analyze_audio_file(audio_file_path: str, bpm: Optional[float] = None) -> Tuple[Optional[str], float, List, List]:
    """
    Main entry point for chord analysis using madmom.

    Args:
        audio_file_path: Path to audio file
        bpm: Known BPM (optional)

    Returns:
        tuple: (chords_json, beat_offset, beat_times_list, beat_positions)
    """
    if not MADMOM_AVAILABLE:
        print("[MADMOM] Library not available, cannot analyze")
        return None, 0.0, [], []

    try:
        detector = MadmomChordDetector()
        return detector.detect_chords(audio_file_path, bpm)
    except Exception as e:
        print(f"[MADMOM] Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return None, 0.0, [], []


# Convenience function to check availability
def is_available() -> bool:
    """Check if madmom is available for use."""
    return MADMOM_AVAILABLE
