"""
Lyrics Detection using Faster-Whisper
Transcribes audio to text with precise timestamps for karaoke display
"""

import os
import sys
import logging
from typing import List, Dict, Optional, Tuple

# Set up CUDA library paths for faster-whisper
# This ensures the bundled CUDA libraries in the venv are found
def setup_cuda_libs():
    """Add NVIDIA CUDA library paths from venv to LD_LIBRARY_PATH"""
    try:
        # Get the site-packages directory
        site_packages = None
        for path in sys.path:
            if 'site-packages' in path:
                site_packages = path
                break

        if site_packages:
            nvidia_base = os.path.join(site_packages, 'nvidia')
            if os.path.exists(nvidia_base):
                # Find all lib directories under nvidia packages
                lib_paths = []
                for package in os.listdir(nvidia_base):
                    lib_dir = os.path.join(nvidia_base, package, 'lib')
                    if os.path.isdir(lib_dir):
                        lib_paths.append(lib_dir)

                if lib_paths:
                    # Add to LD_LIBRARY_PATH
                    current_ld_path = os.environ.get('LD_LIBRARY_PATH', '')
                    new_paths = ':'.join(lib_paths)
                    if current_ld_path:
                        os.environ['LD_LIBRARY_PATH'] = f"{new_paths}:{current_ld_path}"
                    else:
                        os.environ['LD_LIBRARY_PATH'] = new_paths
    except Exception as e:
        # Silently continue if setup fails - will fall back to CPU
        pass

setup_cuda_libs()

from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)


class LyricsDetector:
    """
    Detects and transcribes lyrics from audio using Faster-Whisper
    """

    def __init__(self, model_size: str = "large-v3-int8", device: str = "cuda", compute_type: str = "int8_float16"):
        """
        Initialize Whisper model

        Args:
            model_size: Whisper model size/path (tiny, base, small, medium, large-v3-int8)
            device: Device to use (cuda, cpu)
            compute_type: Computation type (int8_float16 for GPU, int8 for CPU)
        """
        self.requested_model_size = model_size
        self.model_size, self.is_quantized = self._normalize_model_name(model_size)
        self.device = device
        self.compute_type = compute_type
        self.model = None

    def _normalize_model_name(self, name: str) -> Tuple[str, bool]:
        """
        Normalize shorthand aliases (e.g., large-v3-int8) and signal quantized intent.
        """
        if not name:
            return "large-v3", False
        normalized = name.strip()
        if normalized.endswith("-int8"):
            normalized = normalized[:-5]
            return normalized, True
        return normalized, False

    def _load_model(self):
        """Load Whisper model lazily"""
        if self.model is None:
            if self.is_quantized:
                desired_compute = "int8_float16" if self.device == "cuda" else "int8"
                if self.compute_type != desired_compute:
                    logger.info(f"[LYRICS] Adjusting compute type for quantized model: {self.requested_model_size} -> {desired_compute}")
                    self.compute_type = desired_compute

            log_name = self.requested_model_size or self.model_size
            logger.info(f"[LYRICS] Loading Whisper model: {log_name} -> {self.model_size} on {self.device} ({self.compute_type})")
            try:
                self.model = WhisperModel(
                    self.model_size,
                    device=self.device,
                    compute_type=self.compute_type
                )
                logger.info("[LYRICS] Whisper model loaded successfully")
            except Exception as e:
                logger.error(f"[LYRICS] Failed to load on GPU, falling back to CPU: {e}")
                # Fallback to CPU with int8
                self.device = "cpu"
                self.compute_type = "int8"
                self.model_size, self.is_quantized = self._normalize_model_name(self.requested_model_size)
                self.model = WhisperModel(
                    self.model_size,
                    device=self.device,
                    compute_type=self.compute_type
                )

    def detect_lyrics(
        self,
        audio_path: str,
        language: Optional[str] = None,
        word_timestamps: bool = True
    ) -> Optional[List[Dict]]:
        """
        Detect and transcribe lyrics with timestamps

        Args:
            audio_path: Path to audio file
            language: Language code (None for auto-detection)
            word_timestamps: Include word-level timestamps

        Returns:
            List of lyrics segments with timestamps:
            [
                {
                    "start": 0.0,
                    "end": 2.5,
                    "text": "Segment text",
                    "words": [
                        {"start": 0.0, "end": 0.5, "word": "Word1"},
                        {"start": 0.6, "end": 1.2, "word": "Word2"}
                    ]
                }
            ]
        """
        if not os.path.exists(audio_path):
            logger.error(f"[LYRICS] Audio file not found: {audio_path}")
            return None

        try:
            # Load model if needed
            self._load_model()

            logger.info(f"[LYRICS] Transcribing audio: {audio_path}")

            # Transcribe with faster-whisper
            # VAD disabled to capture entire song including instrumental sections
            try:
                segments, info = self.model.transcribe(
                    audio_path,
                    language=language,
                    word_timestamps=word_timestamps,
                    vad_filter=False  # Disabled: Don't stop at silence/instrumental sections
                )
            except RuntimeError as transcribe_error:
                if "libcublas" in str(transcribe_error) or "CUDA" in str(transcribe_error):
                    logger.warning(f"[LYRICS] GPU transcription failed ({transcribe_error}), retrying with CPU...")
                    # Reload model on CPU
                    self.device = "cpu"
                    self.compute_type = "int8"
                    self.model = None
                    self._load_model()

                    # Retry transcription with CPU
                    segments, info = self.model.transcribe(
                        audio_path,
                        language=language,
                        word_timestamps=word_timestamps,
                        vad_filter=False
                    )
                else:
                    raise

            logger.info(f"[LYRICS] Detected language: {info.language} (probability: {info.language_probability:.2f})")

            # Convert segments to list of dicts
            lyrics_data = []
            for segment in segments:
                segment_dict = {
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": segment.text.strip()
                }

                # Add word-level timestamps if available
                if word_timestamps and hasattr(segment, 'words') and segment.words:
                    segment_dict["words"] = [
                        {
                            "start": round(word.start, 2),
                            "end": round(word.end, 2),
                            "word": word.word.strip()
                        }
                        for word in segment.words
                    ]

                lyrics_data.append(segment_dict)

            logger.info(f"[LYRICS] Transcription complete: {len(lyrics_data)} segments")

            # Log first few segments for debugging
            if lyrics_data:
                logger.info("[LYRICS] Sample segments:")
                for seg in lyrics_data[:3]:
                    logger.info(f"   {seg['start']:.1f}s - {seg['end']:.1f}s: {seg['text'][:50]}...")

            return lyrics_data

        except Exception as e:
            logger.error(f"[LYRICS] Error during transcription: {e}", exc_info=True)
            return None

    def get_lyrics_at_time(self, lyrics_data: List[Dict], time: float) -> Optional[Dict]:
        """
        Get the lyrics segment at a specific time

        Args:
            lyrics_data: List of lyrics segments
            time: Time in seconds

        Returns:
            Lyrics segment dict or None
        """
        if not lyrics_data:
            return None

        for segment in lyrics_data:
            if segment['start'] <= time <= segment['end']:
                return segment

        return None


def detect_song_lyrics(
    audio_path: str,
    model_size: str = "large-v3-int8",
    language: Optional[str] = None,
    use_gpu: bool = True
) -> Optional[List[Dict]]:
    """
    Main function to detect lyrics from audio

    Args:
        audio_path: Path to audio file
        model_size: Whisper model size/path (tiny, base, small, medium, large-v3-int8)
        language: Language code (None for auto-detection)
        use_gpu: Use GPU if available

    Returns:
        List of lyrics segments with timestamps or None
    """
    requested_model = model_size or "large-v3-int8"
    device = "cuda" if use_gpu else "cpu"
    compute_type = "int8_float16" if use_gpu else "int8"

    # Prefer the full precision large model when a GPU is available
    if use_gpu and requested_model.endswith("-int8"):
        logger = logging.getLogger(__name__)
        logger.info(f"[LYRICS] GPU detected – upgrading {requested_model} to large-v3 for maximum accuracy.")
        requested_model = "large-v3"

    detector = LyricsDetector(
        model_size=requested_model,
        device=device,
        compute_type=compute_type
    )

    return detector.detect_lyrics(audio_path, language=language)


# Test if run directly
if __name__ == "__main__":
    import sys
    import json

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python lyrics_detector.py <audio_file> [language]")
        sys.exit(1)

    audio_file = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else None

    lyrics = detect_song_lyrics(audio_file, language=language)

    if lyrics:
        print("\n=== Detected Lyrics ===")
        print(f"Total segments: {len(lyrics)}\n")

        for i, segment in enumerate(lyrics[:10], 1):  # Show first 10
            start_min = int(segment['start'] // 60)
            start_sec = int(segment['start'] % 60)
            end_min = int(segment['end'] // 60)
            end_sec = int(segment['end'] % 60)

            print(f"[{i}] {start_min:02d}:{start_sec:02d} - {end_min:02d}:{end_sec:02d}")
            print(f"    {segment['text']}")

            if 'words' in segment and segment['words']:
                print(f"    Words: {len(segment['words'])} words")

            print()

        # Save to JSON file
        output_file = audio_file.replace('.mp3', '_lyrics.json')
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        print(f"✅ Lyrics saved to: {output_file}")
    else:
        print("❌ Failed to detect lyrics")
