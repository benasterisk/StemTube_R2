"""
Hybrid chord detection combining madmom's beat tracking with improved template matching.
Provides better accuracy for folk/acoustic guitar by using key-aware detection.
"""

import os
import json
import numpy as np
import librosa
from typing import Tuple, List, Dict, Optional

# Monkey-patch numpy for madmom compatibility
if not hasattr(np, 'int'):
    np.int = np.int64
if not hasattr(np, 'float'):
    np.float = np.float64
if not hasattr(np, 'bool'):
    np.bool = np.bool_

# Check madmom availability
try:
    from madmom.features import beats as madmom_beats
    MADMOM_AVAILABLE = True
except ImportError:
    MADMOM_AVAILABLE = False


class HybridChordDetector:
    """
    Hybrid chord detector:
    - Madmom RNN for beat tracking (superior timeline sync)
    - Librosa chroma + improved template matching for chords (better for folk/acoustic)
    - Key-aware detection (constrains chords to detected key)
    - Harmonic context post-processing
    """

    # Extended chord templates with better voicings
    CHORD_TEMPLATES = {
        # Major chords
        'C': [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
        'C#': [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
        'D': [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
        'Eb': [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
        'E': [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
        'F': [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
        'F#': [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        'G': [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
        'Ab': [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
        'A': [0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
        'Bb': [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
        'B': [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
        # Minor chords
        'Cm': [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
        'C#m': [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        'Dm': [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0],
        'Ebm': [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
        'Em': [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
        'Fm': [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
        'F#m': [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
        'Gm': [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0],
        'Abm': [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1],
        'Am': [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
        'Bbm': [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
        'Bm': [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        # Dominant 7th chords (X7) - Rock/Blues essential
        'C7': [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        'C#7': [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        'D7': [1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
        'Eb7': [0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
        'E7': [0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1],
        'F7': [1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0],
        'F#7': [0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0],
        'G7': [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1],
        'Ab7': [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
        'A7': [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
        'Bb7': [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0],
        'B7': [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1],
        # Hendrix chords (X7#9) - Purple Haze!
        'C7#9': [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0],
        'C#7#9': [0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1],
        'D7#9': [1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0],
        'Eb7#9': [0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        'E7#9': [0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1],
        'F7#9': [1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0],
        'F#7#9': [0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0],
        'G7#9': [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1],
        'Ab7#9': [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
        'A7#9': [1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
        'Bb7#9': [0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0],
        'B7#9': [0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1],
        # 7b9 chords - Jazz/Blues
        'C7b9': [1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        'C#7b9': [0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        'D7b9': [1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0],
        'Eb7b9': [0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0],
        'E7b9': [0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1],
        'F7b9': [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0],
        'F#7b9': [0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0],
        'G7b9': [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1],
        'Ab7b9': [1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0],
        'A7b9': [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0],
        'Bb7b9': [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1],
        'B7b9': [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1],
        # Major 7th chords (Xmaj7)
        'Cmaj7': [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
        'C#maj7': [1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
        'Dmaj7': [0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
        'Ebmaj7': [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0],
        'Emaj7': [0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1],
        'Fmaj7': [1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0],
        'F#maj7': [0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0],
        'Gmaj7': [0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1],
        'Abmaj7': [1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0],
        'Amaj7': [0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0],
        'Bbmaj7': [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0],
        'Bmaj7': [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1],
        # Minor 7th chords (Xm7)
        'Cm7': [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
        'C#m7': [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
        'Dm7': [1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0],
        'Ebm7': [0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
        'Em7': [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1],
        'Fm7': [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0],
        'F#m7': [0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0],
        'Gm7': [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0],
        'Abm7': [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
        'Am7': [1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
        'Bbm7': [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0],
        'Bm7': [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1],
    }

    # Key chord relationships (common progressions)
    # Major keys: I, ii, iii, IV, V, vi
    # Minor keys: i, III, iv, v, VI, VII
    KEY_CHORDS = {
        # Major keys
        'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
        'C major': ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
        'C#': ['C#', 'Ebm', 'Fm', 'F#', 'Ab', 'Bbm'],
        'C# major': ['C#', 'Ebm', 'Fm', 'F#', 'Ab', 'Bbm'],
        'D': ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
        'D major': ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
        'Eb': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm'],
        'Eb major': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm'],
        'E': ['E', 'F#m', 'Abm', 'A', 'B', 'C#m'],
        'E major': ['E', 'F#m', 'Abm', 'A', 'B', 'C#m'],
        'F': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
        'F major': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
        'F#': ['F#', 'Abm', 'Bbm', 'B', 'C#', 'Ebm'],
        'F# major': ['F#', 'Abm', 'Bbm', 'B', 'C#', 'Ebm'],
        'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
        'G major': ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
        'Ab': ['Ab', 'Bbm', 'Cm', 'C#', 'Eb', 'Fm'],
        'Ab major': ['Ab', 'Bbm', 'Cm', 'C#', 'Eb', 'Fm'],
        'A': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
        'A major': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
        'Bb': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm'],
        'Bb major': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm'],
        'B': ['B', 'C#m', 'Ebm', 'E', 'F#', 'Abm'],
        'B major': ['B', 'C#m', 'Ebm', 'E', 'F#', 'Abm'],
        # Minor keys (natural minor scale chords)
        'Am': ['Am', 'C', 'Dm', 'Em', 'F', 'G'],
        'A minor': ['Am', 'C', 'Dm', 'Em', 'F', 'G'],
        'Bm': ['Bm', 'D', 'Em', 'F#m', 'G', 'A'],
        'B minor': ['Bm', 'D', 'Em', 'F#m', 'G', 'A'],
        'Cm': ['Cm', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb'],
        'C minor': ['Cm', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb'],
        'C#m': ['C#m', 'E', 'F#m', 'Abm', 'A', 'B'],
        'C# minor': ['C#m', 'E', 'F#m', 'Abm', 'A', 'B'],
        'Dm': ['Dm', 'F', 'Gm', 'Am', 'Bb', 'C'],
        'D minor': ['Dm', 'F', 'Gm', 'Am', 'Bb', 'C'],
        'Ebm': ['Ebm', 'F#', 'Abm', 'Bbm', 'B', 'C#'],
        'Eb minor': ['Ebm', 'F#', 'Abm', 'Bbm', 'B', 'C#'],
        'Em': ['Em', 'G', 'Am', 'Bm', 'C', 'D'],
        'E minor': ['Em', 'G', 'Am', 'Bm', 'C', 'D'],
        'Fm': ['Fm', 'Ab', 'Bbm', 'Cm', 'C#', 'Eb'],
        'F minor': ['Fm', 'Ab', 'Bbm', 'Cm', 'C#', 'Eb'],
        'F#m': ['F#m', 'A', 'Bm', 'C#m', 'D', 'E'],
        'F# minor': ['F#m', 'A', 'Bm', 'C#m', 'D', 'E'],
        'Gm': ['Gm', 'Bb', 'Cm', 'Dm', 'Eb', 'F'],
        'G minor': ['Gm', 'Bb', 'Cm', 'Dm', 'Eb', 'F'],
        'Abm': ['Abm', 'B', 'C#m', 'Ebm', 'E', 'F#'],
        'Ab minor': ['Abm', 'B', 'C#m', 'Ebm', 'E', 'F#'],
    }

    def __init__(self):
        """Initialize hybrid detector."""
        if MADMOM_AVAILABLE:
            self.beat_processor = madmom_beats.RNNBeatProcessor()
            self.beat_tracker = madmom_beats.DBNBeatTrackingProcessor(fps=100)
            print("[HYBRID] Initialized with madmom beat tracking")
        else:
            print("[HYBRID] Madmom not available, using basic beat detection")

    def detect_chords(self, audio_file_path: str, bpm: Optional[float] = None, detected_key: Optional[str] = None) -> Tuple[Optional[str], float, List]:
        """
        Detect chords using hybrid approach.

        Args:
            audio_file_path: Path to audio file
            bpm: Known BPM (optional)
            detected_key: Known musical key (optional, improves accuracy)

        Returns:
            tuple: (chords_json, beat_offset, beat_times_list)
        """
        if not os.path.exists(audio_file_path):
            print(f"[HYBRID ERROR] File not found: {audio_file_path}")
            return None, 0.0, []

        print(f"[HYBRID] Processing: {os.path.basename(audio_file_path)}")
        if detected_key:
            print(f"[HYBRID] Key-aware mode: {detected_key}")

        try:
            # Load audio
            y, sr = librosa.load(audio_file_path, sr=22050)

            # Step 1: Beat tracking (madmom if available, else librosa)
            beat_offset, beats = self._detect_beats(audio_file_path, y, sr, bpm)
            print(f"[HYBRID] Beats: offset={beat_offset:.3f}s, count={len(beats)}")

            # Step 2: Extract chroma features with HPSS preprocessing for distorted guitar
            # Separate harmonic and percussive components (helps with distortion)
            y_harmonic, y_percussive = librosa.effects.hpss(y, margin=3.0)

            # Use harmonic component for cleaner chroma (better for distorted rock guitar)
            chroma = librosa.feature.chroma_cqt(
                y=y_harmonic,  # Use only harmonic component
                sr=sr,
                hop_length=2048,
                tuning=0.0,  # Assume standard tuning
                norm=2,  # L2 normalization
                threshold=0.0  # Don't threshold weak notes (important for distortion)
            )
            print(f"[HYBRID] Chroma shape: {chroma.shape} (HPSS-enhanced)")

            # Step 3: Detect chords with template matching
            chords = self._match_chords(chroma, sr, detected_key)
            print(f"[HYBRID] Raw detections: {len(chords)}")

            # Step 4: Post-process with harmonic context
            chords = self._apply_harmonic_context(chords, detected_key)
            print(f"[HYBRID] After harmonic filtering: {len(chords)}")

            # Step 4.5: Consolidate rapid chord changes (avoid clutter)
            chords = self._consolidate_chords(chords, min_duration=1.0)
            print(f"[HYBRID] After consolidation: {len(chords)}")

            # Step 5: Align to beats
            chords = self._align_to_beats(chords, beats, beat_offset)
            print(f"[HYBRID] After beat alignment: {len(chords)}")

            # Convert to JSON
            chords_json = json.dumps(chords)
            beat_times_list = [round(float(b), 4) for b in beats]
            print(f"[HYBRID] ✓ Detection complete: {len(chords)} chord changes, {len(beat_times_list)} beats")

            return chords_json, beat_offset, beat_times_list

        except Exception as e:
            print(f"[HYBRID ERROR] Detection failed: {e}")
            import traceback
            traceback.print_exc()
            return None, 0.0, []

    def _detect_beats(self, audio_file_path: str, y: np.ndarray, sr: int, known_bpm: Optional[float]) -> Tuple[float, np.ndarray]:
        """Detect beats using madmom (preferred) or librosa."""
        if MADMOM_AVAILABLE:
            # Use madmom RNN beat tracker
            beat_activations = self.beat_processor(audio_file_path)
            beats = self.beat_tracker(beat_activations)

            if len(beats) > 0:
                return float(beats[0]), beats
            else:
                return 0.0, np.array([])
        else:
            # Fallback to librosa
            tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, start_bpm=known_bpm or 120)
            beat_times = librosa.frames_to_time(beat_frames, sr=sr)

            if len(beat_times) > 0:
                return float(beat_times[0]), beat_times
            else:
                return 0.0, np.array([])

    def _match_chords(self, chroma: np.ndarray, sr: int, key: Optional[str]) -> List[Dict]:
        """
        Match chroma to chord templates using TWO-PASS detection.

        Pass 1: Try simple chords (maj/min) with standard threshold
        Pass 2: Only if Pass 1 fails, try complex chords with VERY strict threshold

        This prevents false detection of complex chords on distorted music.
        """
        # Separate simple chords from complex chords
        simple_chords = {}  # Major and minor only
        complex_chords = {}  # 7th, 7#9, maj7, etc.

        for name, template in self.CHORD_TEMPLATES.items():
            # Simple = just major or minor triads (3 notes)
            if len([n for n in template if n == 1]) == 3:
                if 'm' in name and name.replace('m', '').replace('#', '').replace('b', '').isalpha():
                    simple_chords[name] = template  # Minor
                elif name.replace('#', '').replace('b', '').isalpha():
                    simple_chords[name] = template  # Major
                else:
                    complex_chords[name] = template
            else:
                complex_chords[name] = template

        print(f"[HYBRID] Two-pass detection: {len(simple_chords)} simple + {len(complex_chords)} complex chords")

        chords = []
        hop_length = 2048
        frame_duration = hop_length / sr

        # Process each frame
        for i in range(chroma.shape[1]):
            frame_chroma = chroma[:, i]

            # Normalize
            if np.sum(frame_chroma) > 0:
                frame_chroma = frame_chroma / np.sum(frame_chroma)

            # PASS 1: Try simple chords first
            best_simple_chord = None
            best_simple_score = 0.0

            for chord_name, template in simple_chords.items():
                template_arr = np.array(template)

                # Standard cosine similarity (no weighting)
                score = np.dot(frame_chroma, template_arr) / (
                    np.linalg.norm(frame_chroma) * np.linalg.norm(template_arr) + 1e-10
                )

                if score > best_simple_score:
                    best_simple_score = score
                    best_simple_chord = chord_name

            # If simple chord is good enough, use it and SKIP complex detection
            if best_simple_score >= 0.65:  # Good match with simple chord
                timestamp = i * frame_duration
                chords.append({
                    'timestamp': round(timestamp, 3),
                    'chord': best_simple_chord,
                    'confidence': round(float(best_simple_score), 3)
                })
                continue

            # PASS 2: Simple chord didn't work well, try complex chords
            # But require VERY high threshold to avoid false positives
            best_complex_chord = None
            best_complex_score = 0.0

            for chord_name, template in complex_chords.items():
                template_arr = np.array(template)
                template_notes = np.where(template_arr > 0)[0]

                # For complex chords, require ALL notes to be somewhat present
                # Check if each required note is present in chroma
                all_notes_present = True
                for note_idx in template_notes:
                    if frame_chroma[note_idx] < 0.03:  # Note must have at least 3% energy
                        all_notes_present = False
                        break

                if not all_notes_present:
                    continue  # Skip this complex chord if any note is missing

                # Standard cosine similarity
                score = np.dot(frame_chroma, template_arr) / (
                    np.linalg.norm(frame_chroma) * np.linalg.norm(template_arr) + 1e-10
                )

                if score > best_complex_score:
                    best_complex_score = score
                    best_complex_chord = chord_name

            # Use complex chord only if score is VERY high
            if best_complex_score >= 0.85:  # VERY strict threshold
                timestamp = i * frame_duration
                chords.append({
                    'timestamp': round(timestamp, 3),
                    'chord': best_complex_chord,
                    'confidence': round(float(best_complex_score), 3)
                })
            elif best_simple_score >= 0.5:  # Fallback to simple chord if decent
                timestamp = i * frame_duration
                chords.append({
                    'timestamp': round(timestamp, 3),
                    'chord': best_simple_chord,
                    'confidence': round(float(best_simple_score), 3)
                })
            # else: skip this frame (too uncertain)

        return chords

    def _consolidate_chords(self, chords: List[Dict], min_duration: float = 1.0) -> List[Dict]:
        """
        Consolidate rapid chord changes to avoid clutter.

        Args:
            chords: List of chord detections
            min_duration: Minimum duration (seconds) to keep a chord change

        Returns:
            Consolidated chord list
        """
        if len(chords) <= 1:
            return chords

        consolidated = []
        i = 0

        while i < len(chords):
            current = chords[i]

            # Look ahead to see if we should skip this chord
            if i < len(chords) - 1:
                next_chord = chords[i + 1]
                duration = next_chord['timestamp'] - current['timestamp']

                # If chord duration is very short (< min_duration), merge with neighbors
                if duration < min_duration:
                    # Check if same as previous chord (keep previous)
                    if consolidated and consolidated[-1]['chord'] == current['chord']:
                        i += 1
                        continue
                    # Check if same as next chord (skip current, keep next)
                    elif next_chord['chord'] == current['chord']:
                        consolidated.append(current)
                        i += 1
                        # Skip identical consecutive chords
                        while i < len(chords) and chords[i]['chord'] == current['chord']:
                            i += 1
                        continue
                    # Different from both - check confidence
                    elif current['confidence'] < next_chord['confidence']:
                        # Skip lower confidence chord
                        i += 1
                        continue

            # Keep this chord
            # Avoid consecutive duplicates
            if not consolidated or consolidated[-1]['chord'] != current['chord']:
                consolidated.append(current)

            i += 1

        return consolidated

    def _apply_harmonic_context(self, chords: List[Dict], key: Optional[str]) -> List[Dict]:
        """Apply harmonic context filtering."""
        if len(chords) < 3:
            return chords

        filtered = []

        for i, chord in enumerate(chords):
            # Get context
            prev_chord = chords[i-1]['chord'] if i > 0 else None
            next_chord = chords[i+1]['chord'] if i < len(chords)-1 else None

            # Check if chord makes harmonic sense
            keep = True

            # Rule 1: Consecutive duplicates with high confidence
            if prev_chord == chord['chord'] and chord['confidence'] > 0.5:
                keep = True
            # Rule 2: Valid progression in key
            elif key and self._is_valid_progression(prev_chord, chord['chord'], next_chord, key):
                keep = True
            # Rule 3: High confidence standalone
            elif chord['confidence'] > 0.6:
                keep = True
            # Rule 4: Low confidence outlier
            elif chord['confidence'] < 0.4:
                keep = False

            if keep:
                filtered.append(chord)

        return filtered

    def _is_valid_progression(self, prev: Optional[str], current: str, next: Optional[str], key: str) -> bool:
        """Check if chord progression is harmonically valid."""
        if key not in self.KEY_CHORDS:
            return True  # Unknown key, accept all

        valid_chords = self.KEY_CHORDS[key]

        # Current chord should be in key
        if current not in valid_chords:
            return False

        # Check common progressions
        if prev and next:
            # All three in key is good
            if prev in valid_chords and next in valid_chords:
                return True

        return True  # Default to accepting

    def _align_to_beats(self, chords: List[Dict], beats: np.ndarray, beat_offset: float) -> List[Dict]:
        """Align chord changes to beat grid and merge nearby changes."""
        if len(beats) == 0 or len(chords) == 0:
            return chords

        aligned = []
        last_chord = None
        min_chord_duration = 0.5  # Minimum time between chord changes (seconds)

        # Snap each chord to nearest beat
        for chord in chords:
            timestamp = chord['timestamp']

            # Find nearest beat
            beat_diffs = np.abs(beats - timestamp)
            nearest_beat_idx = np.argmin(beat_diffs)
            nearest_beat_time = beats[nearest_beat_idx]

            # Only snap if close enough (within 0.3s)
            if beat_diffs[nearest_beat_idx] < 0.3:
                timestamp = nearest_beat_time

            # Skip if same chord or too close to previous
            if last_chord:
                if last_chord['chord'] == chord['chord']:
                    continue  # Same chord, skip
                if timestamp - last_chord['timestamp'] < min_chord_duration:
                    # Too close, keep only if higher confidence
                    if chord['confidence'] > last_chord['confidence']:
                        # Replace last chord with this one
                        aligned[-1] = {
                            'timestamp': round(timestamp, 3),
                            'chord': chord['chord'],
                            'confidence': chord['confidence']
                        }
                        last_chord = aligned[-1]
                    continue

            chord_dict = {
                'timestamp': round(timestamp, 3),
                'chord': chord['chord'],
                'confidence': chord['confidence']
            }
            aligned.append(chord_dict)
            last_chord = chord_dict

        return aligned


def analyze_audio_file(audio_file_path: str, bpm: Optional[float] = None, detected_key: Optional[str] = None) -> Tuple[Optional[str], float, List]:
    """
    Main entry point for hybrid chord detection.

    Args:
        audio_file_path: Path to audio file
        bpm: Known BPM (optional)
        detected_key: Known musical key (optional, improves accuracy significantly)

    Returns:
        tuple: (chords_json, beat_offset, beat_times_list)
    """
    try:
        detector = HybridChordDetector()
        return detector.detect_chords(audio_file_path, bpm, detected_key)
    except Exception as e:
        print(f"[HYBRID] Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return None, 0.0, []
