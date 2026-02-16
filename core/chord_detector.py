"""
Chord detection module using librosa and music theory analysis.
Analyzes audio files and returns timestamped chord progressions.
"""
import os
import json
import librosa
import numpy as np
from pathlib import Path

try:
    from pychord import Chord as PyChord
    PYCHORD_AVAILABLE = True
except ImportError:
    PYCHORD_AVAILABLE = False
    print("Warning: pychord not available, chord names will be simplified")


class ChordDetector:
    """Detects chords in audio files and returns timestamped chord progressions."""

    def __init__(self):
        """Initialize chord detection processor."""
        # Note names in chromatic order
        self.note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

        # Major and minor chord templates (triad intervals)
        self.major_template = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0])  # Root, major 3rd, 5th
        self.minor_template = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0])  # Root, minor 3rd, 5th

    def detect_chords(self, audio_file_path, hop_length=2048, bpm=None):
        """
        Detect chords in an audio file using librosa chroma analysis.

        Args:
            audio_file_path: Path to the audio file
            hop_length: Number of samples between frames (affects time resolution)
            bpm: Optional BPM for beat grid alignment (if not provided, will estimate)

        Returns:
            List of dicts with {timestamp: float, chord: str}
            Returns empty list if detection fails
        """
        if not os.path.exists(audio_file_path):
            print(f"Audio file not found: {audio_file_path}")
            return []

        try:
            print(f"Analyzing chords in: {audio_file_path}")

            # Load audio file (limit to first 3 minutes for performance)
            # Use soundfile directly to avoid numba/llvmlite issues on Windows
            import soundfile as sf

            y, sr = sf.read(audio_file_path, dtype='float32')

            # Convert to mono if stereo
            if len(y.shape) > 1:
                y = np.mean(y, axis=1)

            # Limit to 3 minutes (180 seconds)
            max_samples = int(sr * 180)
            if len(y) > max_samples:
                y = y[:max_samples]

            # Resample to 22050 Hz if needed for consistency
            if sr != 22050:
                # Simple decimation/interpolation for resampling
                target_length = int(len(y) * 22050 / sr)
                y = np.interp(
                    np.linspace(0, len(y), target_length),
                    np.arange(len(y)),
                    y
                )
                sr = 22050

            # Detect beat grid and first downbeat using BPM-based approach
            beat_offset = self._detect_downbeat_with_bpm(y, sr, bpm)
            self.last_beat_offset = beat_offset  # Store for later retrieval
            print(f"First downbeat detected at: {beat_offset:.3f}s")

            # Calculate beat period for quantization
            seconds_per_beat = 60.0 / bpm if bpm else 0.5

            # Compute chromagram using STFT (avoids numba dependency)
            # Use scipy for STFT to avoid librosa's numba requirements
            from scipy import signal

            # Compute Short-Time Fourier Transform
            f, t, Zxx = signal.stft(y, fs=sr, nperseg=4096, noverlap=4096-hop_length)

            # Convert magnitude spectrogram to power
            magnitude = np.abs(Zxx)

            # Map frequency bins to pitch classes (12-note chromagram)
            chroma = self._compute_chroma_from_stft(magnitude, f, sr)

            # Compute frame times manually (avoid librosa.frames_to_time which uses numba)
            frame_times = np.arange(chroma.shape[1]) * hop_length / sr

            # Detect chords for each frame
            chord_timeline = []
            current_chord = None
            current_start_time = 0

            for i, frame_time in enumerate(frame_times):

                # Get chroma vector for this frame
                chroma_frame = chroma[:, i]

                # Detect chord from chroma
                detected_chord = self._detect_chord_from_chroma(chroma_frame)

                # Only add to timeline if chord changed
                if detected_chord != current_chord:
                    # Filter out very short chord segments (< 0.5 seconds)
                    if current_chord is not None and (frame_time - current_start_time) >= 0.5:
                        # Quantize timestamp to nearest beat (Chordify/Moises style)
                        quantized_time = self._quantize_to_beat_grid(
                            current_start_time,
                            beat_offset,
                            seconds_per_beat
                        )

                        chord_timeline.append({
                            'timestamp': round(quantized_time, 2),
                            'chord': current_chord
                        })

                    current_chord = detected_chord
                    current_start_time = frame_time

            # Add the last chord (quantized)
            if current_chord is not None:
                quantized_time = self._quantize_to_beat_grid(
                    current_start_time,
                    beat_offset,
                    seconds_per_beat
                )
                chord_timeline.append({
                    'timestamp': round(quantized_time, 2),
                    'chord': current_chord
                })

            print(f"Detected {len(chord_timeline)} chord changes (quantized to beat grid)")
            return chord_timeline

        except Exception as e:
            print(f"Error detecting chords: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _quantize_to_beat_grid(self, timestamp, beat_offset, seconds_per_beat):
        """
        Quantize a timestamp to the nearest beat in the beat grid.
        This is how Chordify/Moises align chords to beats.

        Args:
            timestamp: Original timestamp in seconds
            beat_offset: Time of first downbeat in seconds
            seconds_per_beat: Duration of one beat in seconds

        Returns:
            float: Quantized timestamp aligned to nearest beat
        """
        # Calculate time relative to first downbeat
        relative_time = timestamp - beat_offset

        # Find nearest beat number
        beat_number = round(relative_time / seconds_per_beat)

        # Convert back to absolute time
        quantized_time = beat_offset + (beat_number * seconds_per_beat)

        return quantized_time

    def _detect_downbeat_with_bpm(self, y, sr, bpm=None):
        """
        Detect the first downbeat using beat grid alignment with BPM.
        This creates a beat grid and finds the offset that best aligns with onsets.

        Args:
            y: Audio signal
            sr: Sample rate
            bpm: Tempo in BPM (if None, will estimate)

        Returns:
            float: Time in seconds of first downbeat
        """
        try:
            from scipy import signal

            # Estimate BPM if not provided
            if bpm is None:
                bpm = self._estimate_bpm(y, sr)
                print(f"Estimated BPM for beat grid: {bpm:.1f}")

            # Compute onset envelope
            hop_length = 512
            n_fft = 2048

            f, t, Zxx = signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft-hop_length)
            magnitude = np.abs(Zxx)

            # Onset strength (spectral flux)
            onset_env = np.sum(np.diff(magnitude, axis=1, prepend=0), axis=0)
            onset_env = np.maximum(0, onset_env)

            # Normalize onset envelope
            if np.max(onset_env) > 0:
                onset_env = onset_env / np.max(onset_env)

            # Frame times
            frame_times = np.arange(len(onset_env)) * hop_length / sr

            # Beat period in seconds
            beat_period = 60.0 / bpm

            # Try different phase offsets to find best alignment
            # Test offsets from 0 to one beat period
            num_test_offsets = 50
            test_offsets = np.linspace(0, beat_period, num_test_offsets)

            best_score = -1
            best_offset = 0

            for offset in test_offsets:
                # Create beat grid with this offset
                beat_times = np.arange(offset, frame_times[-1], beat_period)

                # Score: sum of onset strengths near beat times
                score = 0
                tolerance = 0.05  # 50ms tolerance window

                for beat_time in beat_times:
                    # Find frames within tolerance of this beat
                    nearby_frames = np.where(np.abs(frame_times - beat_time) < tolerance)[0]
                    if len(nearby_frames) > 0:
                        # Add max onset strength in this window
                        score += np.max(onset_env[nearby_frames])

                if score > best_score:
                    best_score = score
                    best_offset = offset

            print(f"Beat grid alignment score: {best_score:.2f}, offset: {best_offset:.3f}s")
            return best_offset

        except Exception as e:
            print(f"Error detecting downbeat with BPM: {e}")
            import traceback
            traceback.print_exc()
            return 0.0

    def _estimate_bpm(self, y, sr):
        """Quick BPM estimation using autocorrelation."""
        from scipy import signal

        hop_length = 512
        n_fft = 2048

        # Compute onset envelope
        f, t, Zxx = signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft-hop_length)
        magnitude = np.abs(Zxx)
        onset_env = np.sum(np.diff(magnitude, axis=1, prepend=0), axis=0)
        onset_env = np.maximum(0, onset_env)

        # Autocorrelation
        autocorr = np.correlate(onset_env, onset_env, mode='full')
        autocorr = autocorr[len(autocorr)//2:]

        # Find peak in 60-200 BPM range
        min_lag = int(sr / hop_length * 60 / 200)
        max_lag = int(sr / hop_length * 60 / 60)

        if max_lag < len(autocorr):
            peak_lag = np.argmax(autocorr[min_lag:max_lag]) + min_lag
            tempo_period = peak_lag * hop_length / sr
            bpm = 60.0 / tempo_period if tempo_period > 0 else 120.0
            return np.clip(bpm, 60, 200)

        return 120.0  # Default

    def _detect_chord_from_chroma(self, chroma_frame):
        """
        Detect chord from a chroma feature vector.

        Args:
            chroma_frame: 12-dimensional chroma vector

        Returns:
            str: Chord name (e.g., "C", "Am", "G7")
        """
        # Normalize chroma
        if np.sum(chroma_frame) > 0:
            chroma_frame = chroma_frame / np.sum(chroma_frame)
        else:
            return "N"  # No chord

        # Find root note (highest energy pitch class)
        root_note = int(np.argmax(chroma_frame))

        # Try to match major or minor chord by rotating templates
        best_match = None
        best_score = 0
        best_quality = "maj"

        for root in range(12):
            # Rotate templates to match root
            major_rotated = np.roll(self.major_template, root)
            minor_rotated = np.roll(self.minor_template, root)

            # Calculate correlation with chroma
            major_score = np.dot(chroma_frame, major_rotated)
            minor_score = np.dot(chroma_frame, minor_rotated)

            if major_score > best_score:
                best_score = major_score
                best_match = root
                best_quality = ""  # Major (no suffix)

            if minor_score > best_score:
                best_score = minor_score
                best_match = root
                best_quality = "m"  # Minor

        # If no good match, return N (no chord)
        # Lower threshold to 0.2 for better chord detection
        if best_score < 0.2:
            return "N"

        # Build chord name
        chord_name = self.note_names[best_match] + best_quality

        return chord_name

    def _compute_chroma_from_stft(self, magnitude, frequencies, sr):
        """
        Compute 12-dimensional chroma features from STFT magnitude spectrogram.

        Args:
            magnitude: STFT magnitude spectrogram (freq_bins x time_frames)
            frequencies: Frequency values for each bin
            sr: Sample rate

        Returns:
            12 x time_frames chroma matrix
        """
        # Initialize chroma matrix
        n_frames = magnitude.shape[1]
        chroma = np.zeros((12, n_frames))

        # Reference frequency for A4 (MIDI note 69)
        A4_freq = 440.0

        # Map each frequency bin to a pitch class (0-11)
        for i, freq in enumerate(frequencies):
            if freq > 0:
                # Convert frequency to MIDI note number
                midi_note = 69 + 12 * np.log2(freq / A4_freq)

                # Get pitch class (C=0, C#=1, ..., B=11)
                pitch_class = int(round(midi_note)) % 12

                # Add magnitude to corresponding pitch class
                chroma[pitch_class, :] += magnitude[i, :]

        # Normalize each frame
        for j in range(n_frames):
            if np.sum(chroma[:, j]) > 0:
                chroma[:, j] /= np.sum(chroma[:, j])

        return chroma

    def _simplify_chord_name(self, chord_name):
        """
        Simplify chord names for better readability.

        Args:
            chord_name: Original chord name

        Returns:
            Simplified chord name
        """
        # Handle 'N' (no chord) or empty
        if not chord_name or chord_name == 'N':
            return 'N'

        # Already simplified in our detection
        return chord_name

    def format_for_database(self, chord_timeline):
        """
        Format chord timeline for database storage.

        Args:
            chord_timeline: List of {timestamp, chord} dicts

        Returns:
            JSON string ready for database storage
        """
        if not chord_timeline:
            return None

        return json.dumps(chord_timeline)

    def parse_from_database(self, chords_json):
        """
        Parse chord data from database JSON.

        Args:
            chords_json: JSON string from database

        Returns:
            List of {timestamp, chord} dicts or empty list
        """
        if not chords_json:
            return []

        try:
            return json.loads(chords_json)
        except Exception as e:
            print(f"Error parsing chord data: {e}")
            return []

    def get_chord_at_time(self, chord_timeline, time_seconds):
        """
        Get the chord playing at a specific time.

        Args:
            chord_timeline: List of {timestamp, chord} dicts
            time_seconds: Time in seconds

        Returns:
            Dict with {past: str, current: str, next: str} or None
        """
        if not chord_timeline:
            return None

        # Find current chord (last chord before or at current time)
        current_idx = None
        for i, chord_data in enumerate(chord_timeline):
            if chord_data['timestamp'] <= time_seconds:
                current_idx = i
            else:
                break

        if current_idx is None:
            # Before first chord
            return {
                'past': None,
                'current': chord_timeline[0]['chord'],
                'next': chord_timeline[1]['chord'] if len(chord_timeline) > 1 else None
            }

        # Get past, current, next
        past_chord = chord_timeline[current_idx - 1]['chord'] if current_idx > 0 else None
        current_chord = chord_timeline[current_idx]['chord']
        next_chord = chord_timeline[current_idx + 1]['chord'] if current_idx < len(chord_timeline) - 1 else None

        return {
            'past': past_chord,
            'current': current_chord,
            'next': next_chord
        }


def analyze_audio_file(audio_file_path, bpm=None, detected_key=None, use_btc=True, use_hybrid=False, use_madmom=True):
    """
    Main function to analyze an audio file for chords.

    Detection priority:
    1. BTC Transformer (default) - Professional transformer model with 170 chord vocabulary
    2. Madmom CRF - Professional deep learning model, works on ALL music genres
    3. Hybrid (madmom beats + templates + key-aware) - Good for clean folk/acoustic
    4. Basic STFT (fallback)

    Args:
        audio_file_path: Path to the audio file
        bpm: Optional BPM for beat grid alignment (if not provided, will estimate)
        detected_key: Optional musical key (e.g., "D", "G") - improves hybrid but not BTC/madmom
        use_btc: Whether to use BTC transformer (default: True - RECOMMENDED for best accuracy)
        use_hybrid: Whether to try hybrid detector (default: False)
        use_madmom: Whether to use pure madmom CRF (default: True)

    Returns:
        tuple: (chords_json, beat_offset, beat_times) or (None, 0.0, []) if failed
        chords_json: JSON string of chord timeline
        beat_offset: float, time offset to first downbeat in seconds
        beat_times: list of beat timestamps in seconds
    """
    # Try BTC transformer first (professional, 170 chord vocabulary, best for complex music)
    if use_btc:
        try:
            from core.btc_chord_detector import analyze_audio_file as btc_analyze, is_available

            if is_available():
                print("[CHORD DETECTION] Using BTC Transformer (170 chord vocabulary, professional accuracy)...")
                chords_json, beat_offset, beat_times = btc_analyze(audio_file_path, bpm)

                if chords_json:
                    print("[CHORD DETECTION] ✓ BTC Transformer detection successful")
                    return chords_json, beat_offset, beat_times
                else:
                    print("[CHORD DETECTION] BTC returned no results, trying madmom...")
            else:
                print("[CHORD DETECTION] BTC not available, trying madmom...")
        except Exception as e:
            print(f"[CHORD DETECTION] BTC error: {e}, trying madmom...")

    # Try pure madmom CRF (professional, works on all genres)
    if use_madmom:
        try:
            from core.madmom_chord_detector import analyze_audio_file as madmom_analyze, is_available

            if is_available():
                print("[CHORD DETECTION] Using professional madmom CRF engine (works on all genres)...")
                chords_json, beat_offset, beat_times = madmom_analyze(audio_file_path, bpm)

                if chords_json:
                    print("[CHORD DETECTION] ✓ Madmom CRF detection successful")
                    return chords_json, beat_offset, beat_times
                else:
                    print("[CHORD DETECTION] Madmom returned no results, trying hybrid...")
            else:
                print("[CHORD DETECTION] Madmom not available, trying hybrid...")
        except Exception as e:
            print(f"[CHORD DETECTION] Madmom error: {e}, trying hybrid...")

    # Try hybrid detector (good for acoustic/folk with clean audio)
    if use_hybrid:
        try:
            from core.hybrid_chord_detector import analyze_audio_file as hybrid_analyze

            print("[CHORD DETECTION] Using hybrid engine (madmom beats + key-aware templates)...")
            chords_json, beat_offset, beat_times = hybrid_analyze(audio_file_path, bpm, detected_key)

            if chords_json:
                print("[CHORD DETECTION] ✓ Hybrid detection successful")
                return chords_json, beat_offset, beat_times
            else:
                print("[CHORD DETECTION] Hybrid returned no results, falling back...")
        except Exception as e:
            print(f"[CHORD DETECTION] Hybrid error: {e}, falling back...")

    # Fallback to basic detector (no beat tracking)
    print("[CHORD DETECTION] Using basic STFT-based detector...")
    detector = ChordDetector()
    chord_timeline = detector.detect_chords(audio_file_path, bpm=bpm)

    chords_json = detector.format_for_database(chord_timeline)
    beat_offset = getattr(detector, 'last_beat_offset', 0.0)

    return chords_json, beat_offset, []


if __name__ == "__main__":
    # Test the chord detector
    import sys

    if len(sys.argv) < 2:
        print("Usage: python chord_detector.py <audio_file>")
        sys.exit(1)

    audio_file = sys.argv[1]
    detector = ChordDetector()
    chords = detector.detect_chords(audio_file)

    if chords:
        print(f"\nDetected {len(chords)} chord changes:")
        for chord_data in chords[:20]:  # Show first 20
            print(f"  {chord_data['timestamp']:6.2f}s: {chord_data['chord']}")

        if len(chords) > 20:
            print(f"  ... and {len(chords) - 20} more")

        # Test getting chord at specific time
        print("\nTesting chord lookup at 30 seconds:")
        result = detector.get_chord_at_time(chords, 30.0)
        if result:
            print(f"  Past: {result['past']}, Current: {result['current']}, Next: {result['next']}")
    else:
        print("No chords detected or error occurred")
