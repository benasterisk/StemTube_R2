"""
Lyrics detection for karaoke display.

detect_lyrics_unified() is the single pipeline (download analysis, post-extraction and the
Regenerate button):
  1. artist/track from YouTube metadata, the title or the file tags (core/media_metadata.py)
  2. LRCLIB lookup (core/lrclib_client.py): line-synced or plain lyrics text
  3. faster-whisper on the vocals stem, in the language actually sung
  4. lyrics found  -> LRCLIB text aligned on Whisper word timings (core/lyrics_merger.py)
     nothing found -> Whisper transcription alone
"""

import os
import re
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
        self.language = None  # language used by the last transcription

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

    def _load_audio(self, audio_path: str):
        from faster_whisper import decode_audio
        return decode_audio(audio_path, sampling_rate=16000)

    def detect_language(self, audio) -> Tuple[Optional[str], float]:
        """
        Sung language, detected on the voiced parts only.

        Whisper's default looks at the first 30 s, which on a vocals stem is often an
        instrumental intro: a French song then came out as English (or Norwegian).
        """
        self._load_model()
        try:
            language, probability, _ = self.model.detect_language(
                audio, vad_filter=True, language_detection_segments=LANGUAGE_DETECTION_SEGMENTS)
            return language, float(probability)
        except Exception as e:
            logger.warning(f"[LYRICS] Language detection failed: {e}")
            return None, 0.0

    def detect_lyrics(
        self,
        audio_path: str,
        language: Optional[str] = None,
        word_timestamps: bool = True,
        language_hint: Optional[str] = None,
    ) -> Optional[List[Dict]]:
        """
        Transcribe lyrics with segment and word timestamps.

        Args:
            audio_path: Path to audio file (preferably the vocals stem)
            language: Force this language code
            word_timestamps: Include word-level timestamps
            language_hint: Language declared by the source (YouTube), used when the
                audio detection is not confident

        Returns:
            [{"start", "end", "text", "words": [{"start", "end", "word"}]}] or None
        """
        if not os.path.exists(audio_path):
            logger.error(f"[LYRICS] Audio file not found: {audio_path}")
            return None

        try:
            self._load_model()
            audio = self._load_audio(audio_path)
            if not language:
                detected, probability = self.detect_language(audio)
                language = choose_language(detected, probability, language_hint)
            self.language = language

            logger.info(f"[LYRICS] Transcribing audio: {audio_path} (language: {language})")

            # VAD disabled to capture the entire song including instrumental sections
            try:
                segments, info = self.model.transcribe(
                    audio, language=language, word_timestamps=word_timestamps, vad_filter=False)
            except RuntimeError as transcribe_error:
                if "libcublas" in str(transcribe_error) or "CUDA" in str(transcribe_error):
                    logger.warning(f"[LYRICS] GPU transcription failed ({transcribe_error}), retrying with CPU...")
                    self.device = "cpu"
                    self.compute_type = "int8"
                    self.model = None
                    self._load_model()
                    segments, info = self.model.transcribe(
                        audio, language=language, word_timestamps=word_timestamps, vad_filter=False)
                else:
                    raise

            lyrics_data = []
            for segment in segments:
                if is_hallucination(segment.text):
                    logger.info(f"[LYRICS] Dropped hallucinated segment at {segment.start:.1f}s: {segment.text.strip()}")
                    continue
                segment_dict = {
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": segment.text.strip()
                }
                if word_timestamps and getattr(segment, 'words', None):
                    segment_dict["words"] = [
                        {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
                        for w in segment.words
                    ]
                lyrics_data.append(segment_dict)

            logger.info(f"[LYRICS] Transcription complete: {len(lyrics_data)} segments")
            return lyrics_data

        except Exception as e:
            logger.error(f"[LYRICS] Error during transcription: {e}", exc_info=True)
            return None

    def get_lyrics_at_time(self, lyrics_data: List[Dict], time: float) -> Optional[Dict]:
        """Lyrics segment playing at a given time, or None."""
        for segment in lyrics_data or []:
            if segment['start'] <= time <= segment['end']:
                return segment
        return None


# Number of 30 s voiced windows the language detection averages.
LANGUAGE_DETECTION_SEGMENTS = 3
# Audio detection at or above this probability overrides the declared language.
CONFIDENT_LANGUAGE = 0.7
# Below this share of lyrics words found by Whisper, lyrics and audio disagree
# (wrong song, other version, other language).
MIN_ALIGNMENT_MATCH_RATE = 30.0


# Credits Whisper learned from subtitled videos and "hears" over instrumental passages.
HALLUCINATION_PATTERNS = [re.compile(p, re.IGNORECASE) for p in (
    r"sous-titr(age|es|é)",
    r"amara\.org",
    r"merci d'avoir regardé",
    r"thanks? (you )?for watching",
    r"subtitles? (by|made)",
    r"please subscribe|abonnez-vous",
    r"untertitel (im auftrag|von|der)",
    r"subtítulos (realizados|por)",
)]


def is_hallucination(text: str) -> bool:
    return any(p.search(text or "") for p in HALLUCINATION_PATTERNS)


def choose_language(detected: Optional[str], probability: float, hint: Optional[str]) -> Optional[str]:
    """Confident audio detection first, then the declared language, then the weak guess."""
    if detected and probability >= CONFIDENT_LANGUAGE:
        chosen = detected
    else:
        chosen = hint or detected
    logger.info(f"[LYRICS] Language: detected={detected} ({probability:.2f}), declared={hint} -> {chosen}")
    return chosen


def detect_song_lyrics(
    audio_path: str,
    model_size: str = "medium",
    language: Optional[str] = None,
    use_gpu: bool = True,
    language_hint: Optional[str] = None,
) -> Optional[List[Dict]]:
    """Transcribe a song with Whisper (see LyricsDetector.detect_lyrics)."""
    requested_model = model_size or "medium"
    device = "cuda" if use_gpu else "cpu"
    compute_type = "int8_float16" if use_gpu else "int8"
    logger.info(f"[LYRICS] Model: {requested_model}, Device: {device}")

    detector = LyricsDetector(model_size=requested_model, device=device, compute_type=compute_type)
    return detector.detect_lyrics(audio_path, language=language, language_hint=language_hint)


def lookup_lyrics_lines(artist: str, track: str, duration: Optional[float] = None,
                        record_id: Optional[int] = None) -> Tuple[List[Dict], Optional[str], Optional[Dict]]:
    """LRCLIB lines for a song: (lines, level 'line'|'text'|None, record)."""
    from core import lrclib_client
    try:
        record = (lrclib_client.get_record(record_id) if record_id
                  else lrclib_client.find_best_record(artist, track, duration))
    except Exception as e:
        logger.warning(f"[LYRICS] LRCLIB lookup failed: {e}")
        return [], None, None
    lines, level = lrclib_client.record_to_lines(record)
    return lines, level, record


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
    lrclib_id: int = None,
    sync_with_whisper: bool = True,
    media_metadata: Dict = None,
    file_path: str = None,
) -> Dict:
    """
    Lyrics for a song: LRCLIB text aligned on Whisper word timings, Whisper alone otherwise.

    Args:
        audio_path: Audio to transcribe (the vocals stem when available)
        title: Song title (YouTube title) for the artist/track lookup
        model_size: Whisper model size
        use_gpu: Run Whisper on the GPU
        duration: Song duration in seconds, ranks LRCLIB candidates
        progress_callback: callback(step, message)
        override_artist / override_track: user-provided search terms
        force_whisper: skip LRCLIB
        lrclib_id: use this LRCLIB record instead of searching
        sync_with_whisper: False keeps LRCLIB's own line timing (synced records only)
        media_metadata: stored YouTube metadata (artist, track, language, tags...)
        file_path: original download, for its ID3 tags

    Returns:
        {lyrics, source ('lrclib+whisper' | 'lrclib' | 'whisper'), artist, track,
         language, lrclib_id, alignment_stats}
    """
    from core.media_metadata import resolve_artist_track

    def emit_progress(step, message):
        if progress_callback:
            try:
                progress_callback(step, message)
            except Exception:
                pass

    meta = media_metadata or {}
    result = {"lyrics": None, "source": None, "artist": None, "track": None,
              "language": None, "lrclib_id": None, "alignment_stats": None}

    if not audio_path or not os.path.exists(audio_path):
        logger.error(f"[LYRICS] Audio file not found: {audio_path}")
        return result
    model_size = model_size or "medium"
    duration = duration or meta.get('duration')

    # 1. Artist / track
    emit_progress("metadata", "Reading song metadata...")
    artist, track = resolve_artist_track(title=title, file_path=file_path, meta=meta,
                                         override_artist=override_artist, override_track=override_track)
    result.update(artist=artist, track=track)
    logger.info(f"[LYRICS] Metadata: artist='{artist}', track='{track}', "
                f"declared language={meta.get('language')}")

    # 2. LRCLIB
    lines, level = [], None
    if not force_whisper:
        if lrclib_id or (artist and track):
            emit_progress("lyrics_search", f"Searching LRCLIB: {artist} - {track}" if not lrclib_id
                          else f"Fetching LRCLIB lyrics #{lrclib_id}...")
            lines, level, record = lookup_lyrics_lines(artist, track, duration, lrclib_id)
            if lines:
                result["lrclib_id"] = record.get("id")
                kind = "line-synced" if level == "line" else "text only"
                emit_progress("lyrics_found", f"LRCLIB: {len(lines)} lines ({kind})")
            else:
                emit_progress("lyrics_not_found", "No lyrics on LRCLIB, transcribing with Whisper")
        else:
            emit_progress("lyrics_not_found", "No artist/track to search, transcribing with Whisper")

    if lines and level == "line" and not sync_with_whisper:
        from core.lrclib_client import spread_words
        result.update(lyrics=spread_words(lines), source="lrclib")
        emit_progress("done", f"Using LRCLIB line timing ({len(lines)} lines)")
        return result

    # 3. Whisper, in the sung language
    gpu_label = "GPU" if use_gpu else "CPU"
    emit_progress("whisper", f"Transcribing with Whisper ({model_size}, {gpu_label})...")
    device = "cuda" if use_gpu else "cpu"
    detector = LyricsDetector(model_size=model_size, device=device,
                              compute_type="int8_float16" if use_gpu else "int8")
    whisper_segments = detector.detect_lyrics(audio_path, language_hint=meta.get('language'))
    result["language"] = getattr(detector, 'language', None)
    if whisper_segments:
        emit_progress("whisper_done", f"Whisper: {len(whisper_segments)} segments ({result['language']})")

    # 4. Alignment or fallbacks
    if lines and whisper_segments:
        from core.lyrics_merger import align_lines_with_whisper
        emit_progress("aligning", "Aligning LRCLIB lyrics on Whisper word timings...")
        aligned, stats = align_lines_with_whisper(lines, whisper_segments)
        if stats["match_rate"] >= MIN_ALIGNMENT_MATCH_RATE:
            result.update(lyrics=aligned, source="lrclib+whisper", alignment_stats=stats)
            emit_progress("aligned", f"Aligned: {stats['matched_words']}/{stats['total_words']} words "
                                     f"matched ({stats['match_rate']}%)")
            return result
        logger.warning(f"[LYRICS] LRCLIB lyrics and audio disagree ({stats['match_rate']}% matched)")
        emit_progress("align_rejected", f"LRCLIB lyrics do not match the audio ({stats['match_rate']}% words)")
        if level == "line":
            # The text is probably right but for another version: keep its own line timing.
            from core.lrclib_client import spread_words
            result.update(lyrics=spread_words(lines), source="lrclib", alignment_stats=stats)
            emit_progress("done", f"Using LRCLIB line timing ({len(lines)} lines)")
            return result

    if whisper_segments:
        result.update(lyrics=whisper_segments, source="whisper")
        emit_progress("done", f"Using Whisper transcription ({len(whisper_segments)} segments)")
        return result

    if lines and level == "line":
        from core.lrclib_client import spread_words
        result.update(lyrics=spread_words(lines), source="lrclib")
        emit_progress("done", f"Whisper failed, using LRCLIB line timing ({len(lines)} lines)")
        return result

    emit_progress("failed", "No lyrics detected")
    logger.error("[LYRICS] All methods failed - no lyrics detected")
    return result


if __name__ == "__main__":
    import json

    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2:
        print("Usage: python -m core.lyrics_detector <vocals.mp3> ['Artist - Title'] [youtube_video_id]")
        sys.exit(1)

    meta = {}
    if len(sys.argv) > 3:
        from core.media_metadata import fetch_youtube_metadata
        meta = fetch_youtube_metadata(sys.argv[3])
    res = detect_lyrics_unified(audio_path=sys.argv[1], title=sys.argv[2] if len(sys.argv) > 2 else None,
                                model_size="large-v3", use_gpu=True, media_metadata=meta,
                                progress_callback=lambda step, msg: print(f"  [{step}] {msg}"))
    print(json.dumps({k: v for k, v in res.items() if k != "lyrics"}, ensure_ascii=False, indent=2))
    for seg in (res["lyrics"] or [])[:12]:
        print(f"{seg['start']:7.2f} {seg['text']}")
