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
    skip_onset_sync: bool = False
) -> Dict:
    """
    Unified lyrics detection: SyncedLyrics (word-level) first, Whisper fallback

    This is the SINGLE entry point for all lyrics detection in the application.

    Flow:
    1. Try syncedlyrics with enhanced=True (word-level timestamps from Musixmatch)
    2. If found, sync with vocal onset detection for precise timing
    3. If not found, fall back to Whisper transcription

    Args:
        audio_path: Path to audio file (preferably vocals.mp3)
        title: Track title for metadata extraction (e.g., "Artist - Song Name")
        model_size: Whisper model size (for fallback)
        use_gpu: Use GPU for Whisper if available
        duration: Track duration in seconds (optional)
        progress_callback: Optional callback(step, message) for progress updates
        override_artist: User-provided artist name (overrides metadata extraction)
        override_track: User-provided track name (overrides metadata extraction)
        force_whisper: Skip Musixmatch and use Whisper directly
        skip_onset_sync: Skip vocal onset synchronization (use Musixmatch timestamps directly)

    Returns:
        Dict with:
            - lyrics: List of segments with word timestamps
            - source: "syncedlyrics" | "whisper" | None
            - artist: Extracted artist name
            - track: Extracted track name
            - alignment_stats: Dict with alignment statistics (if applicable)
    """
    def emit_progress(step, message):
        if progress_callback:
            progress_callback(step, message)

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
        logger.warning("[LYRICS] No model_size provided, using 'medium' as fallback")
        model_size = "medium"

    # Step 1: Extract metadata (or use overrides)
    emit_progress("metadata", "Extracting metadata...")

    if override_artist or override_track:
        # User provided overrides
        artist = override_artist or ''
        track = override_track or title or ''
        logger.info(f"[LYRICS] Using user override: artist='{artist}', track='{track}'")
    else:
        # Extract from file/title
        try:
            from core.metadata_extractor import extract_metadata
            artist, track = extract_metadata(file_path=audio_path, db_title=title)
            logger.info(f"[LYRICS] Metadata: artist='{artist}', track='{track}'")
        except Exception as e:
            logger.warning(f"[LYRICS] Metadata extraction failed: {e}")
            artist, track = None, title

    result["artist"] = artist
    result["track"] = track

    # Step 2: Try SyncedLyrics (word-level timestamps from Musixmatch/etc)
    # Then sync with vocal onset detection for precise timing
    synced_lyrics = None

    # Skip Musixmatch if force_whisper is set
    if force_whisper:
        logger.info("[LYRICS] Skipping Musixmatch (force_whisper=True)")
    elif artist and track:
        emit_progress("syncedlyrics", f"Searching word-level lyrics for: {artist} - {track}")
        try:
            from core.syncedlyrics_client import fetch_lyrics_enhanced
            logger.info(f"[LYRICS] Trying SyncedLyrics for: {artist} - {track}")

            synced_lyrics = fetch_lyrics_enhanced(
                track_name=track,
                artist_name=artist,
                allow_plain=False  # Only accept word-level
            )

            if synced_lyrics:
                total_words = sum(len(s.get('words', [])) for s in synced_lyrics)
                emit_progress("syncedlyrics_found", f"Found {len(synced_lyrics)} lines, {total_words} words")
                logger.info(f"[LYRICS] SyncedLyrics found {len(synced_lyrics)} lines, {total_words} words")

                # Step 2b: Try to sync with vocal onset detection
                # Look for vocals.mp3 stem
                vocals_path = None
                if audio_path:
                    # Check if we're already using vocals stem
                    if 'vocals.mp3' in audio_path:
                        vocals_path = audio_path
                    else:
                        # Try to find vocals stem in stems folder
                        audio_dir = os.path.dirname(audio_path)
                        possible_vocals = os.path.join(audio_dir, "stems", "vocals.mp3")
                        if os.path.exists(possible_vocals):
                            vocals_path = possible_vocals

                # Try vocal onset sync (unless skipped)
                if not skip_onset_sync and vocals_path and os.path.exists(vocals_path):
                    emit_progress("onset_sync", "Synchronizing with vocal track...")
                    logger.info(f"[LYRICS] Syncing with vocal onsets: {vocals_path}")

                    try:
                        from core.vocal_onset_detector import sync_lyrics_with_vocal_onsets

                        synced_lyrics, sync_stats = sync_lyrics_with_vocal_onsets(
                            synced_lyrics,
                            vocals_path,
                            tolerance_ms=200
                        )

                        if sync_stats.get("synced"):
                            emit_progress("onset_sync_done",
                                f"Synced: {sync_stats['matched_words']}/{sync_stats['total_words']} words matched")
                            result["lyrics"] = synced_lyrics
                            result["source"] = "musixmatch+onset"
                            result["alignment_stats"] = sync_stats
                            return result
                        else:
                            logger.warning("[LYRICS] Onset sync failed, using raw Musixmatch")

                    except Exception as sync_error:
                        logger.warning(f"[LYRICS] Onset sync error: {sync_error}")
                        emit_progress("onset_sync_error", f"Sync failed: {str(sync_error)[:30]}")
                elif skip_onset_sync:
                    logger.info("[LYRICS] Skipping onset sync (user requested Musixmatch only)")

                # No vocals, sync failed, or skip requested - use Musixmatch timestamps directly
                logger.info("[LYRICS] Using Musixmatch timestamps (no vocal sync)")
                result["lyrics"] = synced_lyrics
                result["source"] = "musixmatch"
                result["alignment_stats"] = {
                    "total_words": total_words,
                    "matched_words": total_words,
                    "interpolated_words": 0,
                    "match_rate": 100.0,
                    "source": "musixmatch"
                }
                return result
            else:
                emit_progress("syncedlyrics_not_found", "No word-level lyrics found online")
                logger.info("[LYRICS] No word-level lyrics found, will try Whisper")

        except Exception as e:
            emit_progress("syncedlyrics_error", f"SyncedLyrics search failed: {str(e)[:50]}")
            logger.warning(f"[LYRICS] SyncedLyrics fetch failed: {e}")
    else:
        emit_progress("syncedlyrics_skip", "Skipping online search (missing artist/track)")
        logger.info("[LYRICS] Skipping SyncedLyrics (missing artist/track)")

    # Step 3: Fallback to direct Whisper transcription
    gpu_label = "GPU" if use_gpu else "CPU"
    emit_progress("whisper_fallback", f"Falling back to Whisper transcription ({model_size} model, {gpu_label})...")
    logger.info(f"[LYRICS] Falling back to Whisper transcription (model: {model_size})")
    whisper_lyrics = detect_song_lyrics(
        audio_path=audio_path,
        model_size=model_size,
        use_gpu=use_gpu
    )

    if whisper_lyrics:
        result["lyrics"] = whisper_lyrics
        result["source"] = "whisper"
        emit_progress("whisper_done", f"Whisper transcribed {len(whisper_lyrics)} segments")
        logger.info(f"[LYRICS] Success: Whisper transcription ({len(whisper_lyrics)} segments)")
    else:
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
