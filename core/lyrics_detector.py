"""
Lyrics Detection using Faster-Whisper
Transcribes audio to text with precise timestamps for karaoke display
"""

import os
import sys
import logging
from typing import List, Dict, Optional, Tuple, Any

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

    def __init__(self, model_size: str = "medium", device: str = "cuda", compute_type: str = "int8_float16"):
        """
        Initialize Whisper model

        Args:
            model_size: Whisper model size/path (tiny, base, small, medium, large, large-v3)
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
            return "medium", False
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
    model_size: str = "medium",
    language: Optional[str] = None,
    use_gpu: bool = True
) -> Optional[List[Dict]]:
    """
    Main function to detect lyrics from audio

    Args:
        audio_path: Path to audio file
        model_size: Whisper model size (tiny, base, small, medium, large, large-v3)
        language: Language code (None for auto-detection)
        use_gpu: Use GPU if available

    Returns:
        List of lyrics segments with timestamps or None
    """
    requested_model = model_size or "medium"
    device = "cuda" if use_gpu else "cpu"
    compute_type = "int8_float16" if use_gpu else "int8"

    # Respect admin model choice - no auto-upgrade
    logger = logging.getLogger(__name__)
    logger.info(f"[LYRICS] Model: {requested_model}, Device: {device}")

    detector = LyricsDetector(
        model_size=requested_model,
        device=device,
        compute_type=compute_type
    )

    return detector.detect_lyrics(audio_path, language=language)


def detect_lyrics_unified(
    audio_path: str,
    title: str = None,
    model_size: str = None,
    use_gpu: bool = True,
    duration: float = None,
    progress_callback: callable = None,
    override_artist: str = None,
    override_track: str = None,
    force_whisper: bool = False,
    skip_onset_sync: bool = False,
    musixmatch_track_id: int = None
) -> Dict:
    """
    Unified lyrics detection: Whisper + Musixmatch in PARALLEL, then merge.

    Flow:
    1. Extract metadata (artist/track)
    2. Launch Whisper transcription AND Musixmatch fetch in parallel threads
    3. When both complete, merge: Musixmatch text + Whisper timestamps
    4. Fallbacks: Whisper-only if no Musixmatch, Musixmatch-only if Whisper fails

    Args:
        audio_path: Path to audio file (preferably vocals.mp3)
        title: Track title for metadata extraction
        model_size: Whisper model size
        use_gpu: Use GPU for Whisper if available
        duration: Track duration in seconds (optional)
        progress_callback: Optional callback(step, message) for progress updates
        override_artist: User-provided artist name
        override_track: User-provided track name
        force_whisper: Skip Musixmatch entirely
        skip_onset_sync: Legacy param (ignored — onset sync replaced by Whisper merge)
        musixmatch_track_id: Specific Musixmatch track ID to fetch

    Returns:
        Dict with lyrics, source, artist, track, alignment_stats
    """
    import threading

    def emit_progress(step, message):
        if progress_callback:
            try:
                progress_callback(step, message)
            except Exception:
                pass

    result = {
        "lyrics": None,
        "source": None,
        "artist": None,
        "track": None,
        "alignment_stats": None
    }

    if not audio_path or not os.path.exists(audio_path):
        logger.error(f"[LYRICS] Audio file not found: {audio_path}")
        return result

    if not model_size:
        model_size = "medium"

    # Step 1: Extract metadata
    emit_progress("metadata", "Extracting metadata...")

    if override_artist or override_track:
        artist = override_artist or ''
        track = override_track or title or ''
        logger.info(f"[LYRICS] Using user override: artist='{artist}', track='{track}'")
    else:
        try:
            from core.metadata_extractor import extract_metadata
            artist, track = extract_metadata(file_path=audio_path, db_title=title)
            logger.info(f"[LYRICS] Metadata: artist='{artist}', track='{track}'")
        except Exception as e:
            logger.warning(f"[LYRICS] Metadata extraction failed: {e}")
            artist, track = None, title

    result["artist"] = artist
    result["track"] = track

    # Step 2: Launch Whisper and Musixmatch in PARALLEL
    whisper_result = [None]
    whisper_error = [None]
    musixmatch_result = [None]
    musixmatch_error = [None]

    def run_whisper():
        try:
            gpu_label = "GPU" if use_gpu else "CPU"
            emit_progress("whisper", f"Transcribing with Whisper ({model_size}, {gpu_label})...")
            logger.info(f"[LYRICS] Starting Whisper transcription ({model_size}, {gpu_label})")
            whisper_result[0] = detect_song_lyrics(
                audio_path=audio_path,
                model_size=model_size,
                use_gpu=use_gpu
            )
            if whisper_result[0]:
                emit_progress("whisper_done", f"Whisper: {len(whisper_result[0])} segments")
                logger.info(f"[LYRICS] Whisper done: {len(whisper_result[0])} segments")
            else:
                logger.warning("[LYRICS] Whisper returned no results")
        except Exception as e:
            whisper_error[0] = e
            logger.error(f"[LYRICS] Whisper error: {e}")

    def run_musixmatch():
        try:
            if musixmatch_track_id:
                emit_progress("musixmatch", f"Fetching Musixmatch track #{musixmatch_track_id}...")
                logger.info(f"[LYRICS] Fetching Musixmatch track_id={musixmatch_track_id}")
                from core.musixmatch_client import fetch_lyrics_by_track_id
                musixmatch_result[0] = fetch_lyrics_by_track_id(musixmatch_track_id)
            elif artist and track:
                emit_progress("musixmatch", f"Fetching Musixmatch: {artist} - {track}")
                logger.info(f"[LYRICS] Fetching Musixmatch: {artist} - {track}")
                from core.syncedlyrics_client import fetch_lyrics_enhanced
                musixmatch_result[0] = fetch_lyrics_enhanced(
                    track_name=track,
                    artist_name=artist,
                    allow_plain=False
                )
            else:
                logger.info("[LYRICS] Skipping Musixmatch (no artist/track)")
                return

            if musixmatch_result[0]:
                total_words = sum(len(s.get('words', [])) for s in musixmatch_result[0])
                emit_progress("musixmatch_done", f"Musixmatch: {len(musixmatch_result[0])} lines, {total_words} words")
                logger.info(f"[LYRICS] Musixmatch done: {len(musixmatch_result[0])} lines, {total_words} words")
            else:
                emit_progress("musixmatch_not_found", "No Musixmatch lyrics found")
                logger.info("[LYRICS] No Musixmatch lyrics found")
        except Exception as e:
            musixmatch_error[0] = e
            logger.warning(f"[LYRICS] Musixmatch error: {e}")

    # Start both threads
    t_whisper = threading.Thread(target=run_whisper, daemon=True)

    if force_whisper:
        logger.info("[LYRICS] force_whisper=True, skipping Musixmatch")
        t_whisper.start()
        t_whisper.join(timeout=300)
    else:
        t_musixmatch = threading.Thread(target=run_musixmatch, daemon=True)
        t_whisper.start()
        t_musixmatch.start()

        # Wait for both (Musixmatch is fast ~2-5s, Whisper is slow ~30-120s)
        t_musixmatch.join(timeout=30)
        t_whisper.join(timeout=300)

    # Step 3: Merge results
    has_musixmatch = musixmatch_result[0] is not None
    has_whisper = whisper_result[0] is not None

    if has_musixmatch and has_whisper:
        # BEST CASE: Merge Musixmatch text + Whisper timestamps
        emit_progress("merging", "Merging Musixmatch text with Whisper timestamps...")
        logger.info("[LYRICS] Merging Musixmatch text with Whisper timestamps")

        try:
            from core.lyrics_merger import merge_lyrics
            merged, stats = merge_lyrics(musixmatch_result[0], whisper_result[0])

            result["lyrics"] = merged
            result["source"] = "musixmatch+whisper"
            result["alignment_stats"] = stats
            emit_progress("merge_done", f"Merged: {stats['matched_words']}/{stats['total_words']} words matched ({stats['match_rate']}%)")
            logger.info(f"[LYRICS] Merge complete: {stats['match_rate']}% match rate")
            return result
        except Exception as merge_error:
            logger.error(f"[LYRICS] Merge failed: {merge_error}", exc_info=True)
            emit_progress("merge_error", f"Merge failed: {str(merge_error)[:50]}")
            # Fall through to use best available single source

    if has_whisper:
        # Whisper-only (good timestamps, possibly wrong words)
        result["lyrics"] = whisper_result[0]
        result["source"] = "whisper"
        emit_progress("done", f"Using Whisper transcription ({len(whisper_result[0])} segments)")
        logger.info(f"[LYRICS] Using Whisper-only: {len(whisper_result[0])} segments")
        return result

    if has_musixmatch:
        # Musixmatch-only (correct text, potentially early timestamps)
        result["lyrics"] = musixmatch_result[0]
        result["source"] = "musixmatch"
        total_words = sum(len(s.get('words', [])) for s in musixmatch_result[0])
        result["alignment_stats"] = {
            "source": "musixmatch",
            "total_words": total_words,
            "matched_words": total_words,
            "match_rate": 100.0
        }
        emit_progress("done", f"Using Musixmatch lyrics ({len(musixmatch_result[0])} lines)")
        logger.info(f"[LYRICS] Using Musixmatch-only: {len(musixmatch_result[0])} lines")
        return result

    # Both failed
    emit_progress("failed", "All methods failed - no lyrics detected")
    logger.error("[LYRICS] All methods failed - no lyrics detected")
    return result


# Test if run directly
if __name__ == "__main__":
    import sys
    import json

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python lyrics_detector.py <audio_file> [title]")
        print("Example: python lyrics_detector.py song.mp3 'Artist - Song Name'")
        sys.exit(1)

    audio_file = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else None

    # Test unified function
    print("\n=== Testing Unified Lyrics Detection ===\n")
    result = detect_lyrics_unified(
        audio_path=audio_file,
        title=title,
        model_size="medium",
        use_gpu=True
    )

    print(f"\nSource: {result['source']}")
    print(f"Artist: {result['artist']}")
    print(f"Track: {result['track']}")

    if result['lyrics']:
        print(f"Total segments: {len(result['lyrics'])}\n")

        for i, segment in enumerate(result['lyrics'][:10], 1):
            start_min = int(segment['start'] // 60)
            start_sec = int(segment['start'] % 60)
            print(f"[{i}] {start_min:02d}:{start_sec:02d} {segment['text'][:60]}")

        # Save to JSON file
        output_file = audio_file.replace('.mp3', '_lyrics.json')
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\n✅ Lyrics saved to: {output_file}")
    else:
        print("❌ Failed to detect lyrics")
