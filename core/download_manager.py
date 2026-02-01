"""
Download manager for StemTubes application.
Handles downloading YouTube videos and audio using yt-dlp.
"""
import os
import time
import threading
import queue
import re
from typing import Dict, List, Optional, Callable, Any
from dataclasses import dataclass
from enum import Enum

import yt_dlp
import librosa
import numpy as np

from .config import get_setting, update_setting, get_ffmpeg_path, DOWNLOADS_DIR, ensure_valid_downloads_directory

# Path to cookies file (uploaded via admin panel)
COOKIES_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'youtube_cookies.txt')


def get_youtube_cookies_config() -> dict:
    """
    Get the cookies configuration for yt-dlp.
    Uses cookies.txt file uploaded via admin panel.
    Returns dict to merge into ydl_opts.
    """
    if os.path.exists(COOKIES_FILE_PATH) and os.path.getsize(COOKIES_FILE_PATH) > 0:
        print(f"[Cookies] Using cookies file: {COOKIES_FILE_PATH}")
        return {'cookiefile': COOKIES_FILE_PATH}

    print("[Cookies] WARNING: No cookies file found - YouTube may block downloads. Upload cookies via Admin > Settings > YouTube Cookies")
    return {}


class DownloadType(Enum):
    """Enum for download types."""
    AUDIO = "audio"
    VIDEO = "video"


class DownloadStatus(Enum):
    """Enum for download status."""
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass
class DownloadItem:
    """Class representing a download item."""
    video_id: str
    title: str
    thumbnail_url: str
    download_type: DownloadType
    quality: str
    status: DownloadStatus = DownloadStatus.QUEUED
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    file_path: str = ""
    error_message: str = ""
    download_id: str = ""
    cancel_event: threading.Event = None
    # Audio analysis fields
    detected_bpm: Optional[float] = None
    detected_key: Optional[str] = None
    analysis_confidence: Optional[float] = None
    
    def __post_init__(self):
        """Generate a unique download ID if not provided."""
        if not self.download_id:
            self.download_id = f"{self.video_id}_{int(time.time())}"
        if self.cancel_event is None:
            self.cancel_event = threading.Event()


class DownloadManager:
    """Manager for handling YouTube downloads."""
    
    def __init__(self):
        """Initialize the download manager."""
        self.download_queue = queue.Queue()
        self.active_downloads: Dict[str, DownloadItem] = {}
        self.completed_downloads: Dict[str, DownloadItem] = {}
        self.failed_downloads: Dict[str, DownloadItem] = {}
        self.queued_downloads: Dict[str, DownloadItem] = {}
        
        self.max_concurrent_downloads = get_setting("max_concurrent_downloads", 3)
        
        # Use the safe downloads directory validation function
        self.downloads_directory = ensure_valid_downloads_directory()
        
        # Create downloads directory if it doesn't exist
        os.makedirs(self.downloads_directory, exist_ok=True)
        
        # Start download worker thread
        self.worker_thread = threading.Thread(target=self._download_worker, daemon=True)
        self.worker_thread.start()
        
        # Callbacks
        self.on_download_progress: Optional[Callable[[str, float, str, str], None]] = None
        self.on_download_complete: Optional[Callable[[str, str, str, Optional["DownloadItem"]], None]] = None
        self.on_download_error: Optional[Callable[[str, str], None]] = None
        self.on_download_start: Optional[Callable[[str], None]] = None
    
    def add_download(self, item: DownloadItem) -> str:
        """Add a download to the queue.
        
        Args:
            item: Download item to add.
            
        Returns:
            Download ID.
        """
        self.download_queue.put(item)
        self.queued_downloads[item.download_id] = item
        return item.download_id
    
    def cancel_download(self, download_id: str) -> bool:
        """Cancel a download.
        
        Args:
            download_id: ID of the download to cancel.
            
        Returns:
            True if the download was cancelled, False otherwise.
        """
        print(f"Attempting to cancel download: {download_id}")
        
        # Check if the download is active
        if download_id in self.active_downloads:
            item = self.active_downloads[download_id]
            item.status = DownloadStatus.CANCELLED
            
            # Signal cancellation to the download thread
            if item.cancel_event:
                item.cancel_event.set()
            
            # Move from active to failed
            del self.active_downloads[download_id]
            self.failed_downloads[download_id] = item
            
            # Notify of cancellation
            if self.on_download_error:
                self.on_download_error(download_id, "Download cancelled by user")
                
            print(f"Cancelled active download: {download_id}")
            return True
        
        # Check if the download is in the queue
        if download_id in self.queued_downloads:
            item = self.queued_downloads[download_id]
            item.status = DownloadStatus.CANCELLED
            
            # Signal cancellation
            if item.cancel_event:
                item.cancel_event.set()
            
            # Move from queue to failed
            del self.queued_downloads[download_id]
            self.failed_downloads[download_id] = item
            
            # Notify of cancellation
            if self.on_download_error:
                self.on_download_error(download_id, "Download cancelled by user")
                
            print(f"Cancelled queued download: {download_id}")
            return True
        
        # Check if the download is already completed
        if download_id in self.completed_downloads:
            print(f"Cannot cancel completed download: {download_id}")
            return False
            
        # Check if the download is already failed
        if download_id in self.failed_downloads:
            print(f"Cannot cancel failed download: {download_id}")
            return False
        
        print(f"Download not found for cancellation: {download_id}")
        return False
    
    def get_download_status(self, download_id: str) -> Optional[DownloadItem]:
        """Get the status of a download.
        
        Args:
            download_id: ID of the download.
            
        Returns:
            Download item or None if not found.
        """
        # Check active downloads
        if download_id in self.active_downloads:
            return self.active_downloads[download_id]
        
        # Check completed downloads
        if download_id in self.completed_downloads:
            return self.completed_downloads[download_id]
        
        # Check failed downloads
        if download_id in self.failed_downloads:
            return self.failed_downloads[download_id]
        
        # Check queued downloads
        if download_id in self.queued_downloads:
            return self.queued_downloads[download_id]
        
        return None
    
    def get_all_downloads(self) -> Dict[str, List[DownloadItem]]:
        """Get all downloads.
        
        Returns:
            Dictionary with active, queued, completed, and failed downloads.
        """
        return {
            "active": list(self.active_downloads.values()),
            "queued": list(self.queued_downloads.values()),
            "completed": list(self.completed_downloads.values()),
            "failed": list(self.failed_downloads.values())
        }

    def remove_download_by_video_id(self, video_id: str) -> bool:
        """Remove a download from all internal dictionaries by video_id.

        Used when admin deletes a download to clear it from active sessions.

        Args:
            video_id: The YouTube video ID to remove.

        Returns:
            True if any downloads were removed, False otherwise.
        """
        removed = False
        dicts = {
            'active': self.active_downloads,
            'completed': self.completed_downloads,
            'failed': self.failed_downloads,
            'queued': self.queued_downloads
        }
        for name, d in dicts.items():
            keys_to_remove = [k for k, v in d.items() if v.video_id == video_id]
            for k in keys_to_remove:
                print(f"[CLEANUP] Removing {video_id} from {name} downloads (key={k})")
                del d[k]
                removed = True
        return removed

    def analyze_audio_with_librosa(self, audio_path: str) -> dict:
        """Analyzes audio file to detect BPM and key (Windows-compatible)."""
        try:
            print(f"🎵 [DOWNLOAD] Audio analysis of: {audio_path}")

            # Load audio with soundfile (avoids DLL issues with librosa/numba)
            import soundfile as sf
            from scipy import signal

            y, sr = sf.read(audio_path, dtype='float32')

            # Convert to mono if stereo
            if len(y.shape) > 1:
                y = np.mean(y, axis=1)

            # Limit to 60 seconds for performance
            max_samples = int(sr * 60)
            if len(y) > max_samples:
                y = y[:max_samples]

            print(f"   📊 [DOWNLOAD] Audio loaded: {len(y)} samples at {sr} Hz")

            # === BPM DETECTION ===
            print("   🥁 [DOWNLOAD] BPM Detection...")

            # Simple autocorrelation-based tempo detection
            # Compute onset strength envelope using spectral flux
            hop_length = 512
            n_fft = 2048

            # Compute STFT
            f, t, Zxx = signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft-hop_length)
            magnitude = np.abs(Zxx)

            # Compute spectral flux (onset strength)
            onset_env = np.sum(np.diff(magnitude, axis=1, prepend=0), axis=0)
            onset_env = np.maximum(0, onset_env)  # Half-wave rectification

            # Autocorrelation to find tempo
            autocorr = np.correlate(onset_env, onset_env, mode='full')
            autocorr = autocorr[len(autocorr)//2:]

            # Look for peaks in autocorrelation (60-200 BPM range)
            min_lag = int(sr / hop_length * 60 / 200)  # 200 BPM
            max_lag = int(sr / hop_length * 60 / 60)   # 60 BPM

            if max_lag < len(autocorr):
                autocorr_region = autocorr[min_lag:max_lag]
                peak_lag = np.argmax(autocorr_region) + min_lag

                # Convert lag to BPM
                tempo_period = peak_lag * hop_length / sr  # seconds per beat
                detected_tempo = 60.0 / tempo_period if tempo_period > 0 else 120.0

                # Fix octave errors: Check if half/double BPM has similar strength
                # Most music is 80-140 BPM, so prefer this range
                candidate_tempos = [detected_tempo]

                # Check half tempo (if detected > 140, maybe it's double)
                if detected_tempo > 140:
                    half_tempo = detected_tempo / 2
                    if half_tempo >= 60:
                        candidate_tempos.append(half_tempo)

                # Check double tempo (if detected < 90, maybe it's half)
                if detected_tempo < 90:
                    double_tempo = detected_tempo * 2
                    if double_tempo <= 200:
                        candidate_tempos.append(double_tempo)

                # Prefer tempo in 80-140 range (most common for pop/rock/folk)
                preferred_tempos = [t for t in candidate_tempos if 80 <= t <= 140]
                if preferred_tempos:
                    final_tempo = preferred_tempos[0]
                else:
                    final_tempo = detected_tempo

                # Clamp to reasonable range
                final_tempo = np.clip(final_tempo, 60, 200)
            else:
                final_tempo = 120.0  # Default

            print(f"   ✅ [DOWNLOAD] BPM detected: {float(final_tempo):.1f}")

            # === KEY DETECTION ===
            print("   🎹 [DOWNLOAD] Key Detection...")

            # Compute chroma from STFT (same as chord detector)
            chroma = self._compute_chroma_from_stft(magnitude, f, sr)

            # Average chroma over time
            chroma_mean = np.mean(chroma, axis=1)

            # Find dominant note (index with highest energy)
            dominant_note_idx = int(np.argmax(chroma_mean))

            # Note names (C=0, C#=1, D=2, etc.)
            note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            dominant_note = note_names[dominant_note_idx]

            # Major/minor detection based on chord patterns
            # Intervals for major and minor chords
            major_intervals = [0, 4, 7]  # Root, major third, perfect fifth
            minor_intervals = [0, 3, 7]  # Root, minor third, perfect fifth

            # Calculate strength for major vs minor
            major_strength = sum(chroma_mean[(dominant_note_idx + interval) % 12] for interval in major_intervals)
            minor_strength = sum(chroma_mean[(dominant_note_idx + interval) % 12] for interval in minor_intervals)

            mode = "major" if major_strength > minor_strength else "minor"
            confidence = float(max(major_strength, minor_strength) / np.sum(chroma_mean))

            detected_key = f"{dominant_note} {mode}"

            print(f"   ✅ [DOWNLOAD] Key detected: {detected_key} (confidence: {confidence:.2f})")

            return {
                'bpm': round(float(final_tempo), 1),
                'key': detected_key,
                'confidence': round(float(confidence), 2)
            }

        except Exception as e:
            print(f"   ❌ [DOWNLOAD] Error during analysis: {e}")
            import traceback
            traceback.print_exc()
            return {
                'bpm': None,
                'key': None,
                'confidence': None
            }

    def _compute_chroma_from_stft(self, magnitude, frequencies, sr):
        """Compute 12-dimensional chroma features from STFT magnitude spectrogram."""
        n_frames = magnitude.shape[1]
        chroma = np.zeros((12, n_frames))

        A4_freq = 440.0

        for i, freq in enumerate(frequencies):
            if freq > 0:
                midi_note = 69 + 12 * np.log2(freq / A4_freq)
                pitch_class = int(round(midi_note)) % 12
                chroma[pitch_class, :] += magnitude[i, :]

        # Normalize each frame
        for j in range(n_frames):
            if np.sum(chroma[:, j]) > 0:
                chroma[:, j] /= np.sum(chroma[:, j])

        return chroma
    
    def _download_worker(self):
        """Worker thread for processing downloads."""
        while True:
            # Check if we can start a new download
            if len(self.active_downloads) >= self.max_concurrent_downloads:
                time.sleep(1)
                continue
            
            try:
                # Get the next download item
                item = self.download_queue.get(block=False)
                
                # Check if the download was cancelled
                if item.status == DownloadStatus.CANCELLED:
                    self.failed_downloads[item.download_id] = item
                    del self.queued_downloads[item.download_id]
                    self.download_queue.task_done()
                    continue
                
                # Start the download
                self._start_download(item)
                
            except queue.Empty:
                # No downloads in the queue
                time.sleep(1)
    
    def _start_download(self, item: DownloadItem):
        """Start a download.
        
        Args:
            item: Download item to start.
        """
        # Update status
        item.status = DownloadStatus.DOWNLOADING
        self.active_downloads[item.download_id] = item
        del self.queued_downloads[item.download_id]
        
        # Notify download start
        if self.on_download_start:
            self.on_download_start(item.download_id)
        
        # Create individual directory for this YouTube video
        # Enhanced sanitization for Windows compatibility
        safe_title = self._sanitize_filename(item.title)
        video_dir = os.path.join(self.downloads_directory, safe_title)

        # Create subdirectory for the content type (audio, video, stems)
        output_dir = os.path.join(video_dir, item.download_type.value)

        # Enhanced directory creation with proper error handling
        try:
            os.makedirs(output_dir, exist_ok=True)
            # Verify write access by creating a test file
            test_file = os.path.join(output_dir, ".write_test")
            with open(test_file, 'w') as f:
                f.write("test")
            os.remove(test_file)
        except (OSError, PermissionError, IOError) as e:
            error_msg = f"Cannot create download directory: {e}"
            print(f"Directory creation failed: {error_msg}")
            item.status = DownloadStatus.ERROR
            item.error_message = error_msg

            # Move to failed downloads
            if item.download_id in self.active_downloads:
                del self.active_downloads[item.download_id]
            self.failed_downloads[item.download_id] = item

            # Notify error immediately
            if self.on_download_error:
                self.on_download_error(item.download_id, error_msg)
            return
        
        # Configure yt-dlp options with enhanced Windows support
        ydl_opts = {
            'format': self._get_format_string(item),
            'outtmpl': {'default': os.path.join(output_dir, '%(title)s.%(ext)s')},
            'progress_hooks': [lambda d: self._progress_hook(d, item)],
            'ffmpeg_location': get_ffmpeg_path(),
            'ignoreerrors': False,  # Don't ignore errors - we want to catch them
            'quiet': True,
            'no_warnings': False,  # Enable warnings for debugging
            # Enhanced Windows support
            'windowsfilenames': True,  # Use Windows-safe filenames
            'restrictfilenames': True,  # Restrict to ASCII characters
            # Network resilience
            'retries': 3,
            'fragment_retries': 3,
            'extractor_retries': 3,
            'http_chunk_size': 10485760,  # 10MB chunks
            # Rate limiting prevention
            'sleep_interval': 2,
            'max_sleep_interval': 5,
            'sleep_interval_requests': 1,
            # YouTube 403 Fix: Use iOS client to bypass SABR streaming blocks (Jan 2026)
            'extractor_args': {
                'youtube': {
                    'player_client': ['ios', 'web']
                }
            },
            # Cookies config added below
        }

        # Add cookies configuration (file or browser, with fallback)
        ydl_opts.update(get_youtube_cookies_config())
        
        # Add postprocessors for audio downloads
        if item.download_type == DownloadType.AUDIO:
            # Use flexible format to handle iOS client where only combined formats exist
            # 'bestaudio' alone fails when only format 18 (mp4 with video+audio) is available
            ydl_opts['format'] = 'bestaudio/best[acodec!=none]'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }, {
                # Add metadata postprocessor
                'key': 'FFmpegMetadata',
                'add_metadata': True,
            }]
            # Ensure FFmpeg is used with correct parameters
            ydl_opts['postprocessor_args'] = [
                '-ar', '44100',  # Set audio sample rate to 44.1kHz
                '-ac', '2',      # Set audio channels to stereo
                '-b:a', '192k',  # Set audio bitrate explicitly
            ]
        
        # Start download in a separate thread
        download_thread = threading.Thread(
            target=self._download_thread,
            args=(f"https://www.youtube.com/watch?v={item.video_id}", ydl_opts, item),
            daemon=True
        )
        download_thread.start()
    
    def _download_thread(self, url: str, ydl_opts: Dict[str, Any], item: DownloadItem):
        """Thread for downloading a video.
        
        Args:
            url: YouTube URL.
            ydl_opts: yt-dlp options.
            item: Download item.
        """
        try:
            # Check if download was cancelled before starting
            if item.cancel_event and item.cancel_event.is_set():
                print(f"Download {item.download_id} was cancelled before starting")
                return
            
            # Add a progress hook that checks for cancellation
            def cancellation_hook(d):
                if item.cancel_event and item.cancel_event.is_set():
                    raise yt_dlp.DownloadError("Download cancelled by user")
            
            # Add the cancellation hook to existing hooks
            existing_hooks = ydl_opts.get('progress_hooks', [])
            ydl_opts['progress_hooks'] = existing_hooks + [cancellation_hook]
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                
                # Get the downloaded file path
                if info:
                    if 'entries' in info:
                        # Playlist
                        info = info['entries'][0]
                    
                    # Get file extension
                    ext = 'mp3' if item.download_type == DownloadType.AUDIO else info.get('ext', 'mp4')
                    
                    # Get file path - outtmpl is now a dictionary
                    file_path = ydl_opts.get('outtmpl', {}).get('default')
                    if file_path:
                        # Replace placeholders with actual values
                        filename = ydl.prepare_filename(info)
                        
                        if item.download_type == DownloadType.AUDIO:
                            # For audio, yt-dlp changes the extension to mp3
                            filename = os.path.splitext(filename)[0] + '.mp3'
                            
                            # Verify MP3 file exists
                            if not os.path.exists(filename):
                                # If MP3 file doesn't exist, try to find a file with same name but different extension
                                base_filename = os.path.splitext(filename)[0]
                                for possible_ext in ['.webm', '.m4a', '.opus']:
                                    possible_file = base_filename + possible_ext
                                    if os.path.exists(possible_file):
                                        # Manually convert to MP3 if necessary
                                        mp3_file = base_filename + '.mp3'
                                        self._convert_to_mp3(possible_file, mp3_file)
                                        filename = mp3_file
                                        break
                    
                        # Validate file exists and has content before marking complete
                        if os.path.exists(filename) and os.path.getsize(filename) > 1024:  # At least 1KB
                            item.file_path = filename
                            item.status = DownloadStatus.COMPLETED
                            item.progress = 100.0
                        else:
                            # File doesn't exist or is too small - treat as error
                            error_msg = f"Downloaded file is missing or too small: {filename}"
                            item.status = DownloadStatus.ERROR
                            item.error_message = error_msg
                            item.file_path = ""

                            # Move to failed downloads
                            if item.download_id in self.active_downloads:
                                del self.active_downloads[item.download_id]
                            self.failed_downloads[item.download_id] = item

                            # Notify error
                            if self.on_download_error:
                                self.on_download_error(item.download_id, error_msg)
                            return
                    
                    # Ensure progress reaches 100% in the interface
                    if self.on_download_progress:
                        self.on_download_progress(
                            item.download_id,
                            100.0,  # Force 100%
                            "",     # No speed to display once completed
                            ""      # No ETA to display once completed
                        )

                    # Wait a brief moment for 100% update to be visible
                    time.sleep(0.2)

                    # Move from active to completed
                    if item.download_id in self.active_downloads:
                        del self.active_downloads[item.download_id]
                    self.completed_downloads[item.download_id] = item

                    # Notify completion FIRST - this saves download to database
                    if self.on_download_complete:
                        self.on_download_complete(
                            item.download_id,
                            item.title,
                            item.file_path,
                            item
                        )

                    # Wait a moment for database save to complete
                    time.sleep(0.3)

                    # NOW run analysis - database entry exists for UPDATE
                    if item.download_type == DownloadType.AUDIO and item.file_path and os.path.exists(item.file_path):
                        print(f"🎵 [DOWNLOAD] Starting audio analysis for: {item.title}")
                        analysis_results = self.analyze_audio_with_librosa(item.file_path)

                        # Store results in item
                        item.detected_bpm = analysis_results.get('bpm')
                        item.detected_key = analysis_results.get('key')
                        item.analysis_confidence = analysis_results.get('confidence')

                        print(f"📊 [DOWNLOAD] Analysis complete: BPM={item.detected_bpm}, Key={item.detected_key}")

                        # Detect chords (pass BPM for beat grid alignment)
                        chords_data = None
                        beat_offset = 0.0
                        try:
                            from .chord_detector import analyze_audio_file
                            print(f"🎸 [DOWNLOAD] Starting chord detection for: {item.title} (BPM: {item.detected_bpm}, Key: {item.detected_key})")
                            # Pass detected BPM and key to chord analyzer for better accuracy
                            chords_data, beat_offset = analyze_audio_file(
                                item.file_path,
                                bpm=item.detected_bpm,
                                detected_key=item.detected_key,
                                use_madmom=True  # Use professional madmom CRF for all genres
                            )
                            if chords_data:
                                print(f"🎸 [DOWNLOAD] Chord detection complete (beat offset: {beat_offset:.3f}s)")
                            else:
                                print(f"⚠️ [DOWNLOAD] No chords detected")
                        except Exception as e:
                            print(f"⚠️ [DOWNLOAD] Error chord detection: {e}")
                            # Fallback if analyze_audio_file returns old format
                            if isinstance(e, ValueError):
                                chords_data = None
                                beat_offset = 0.0

                        # Detect song structure using simple MSAF segmentation
                        structure_data = None
                        try:
                            from .msaf_structure_detector import detect_song_structure_msaf
                            print(f"🎭 [DOWNLOAD] Starting structure detection with MSAF for: {item.title}")

                            structure_data = detect_song_structure_msaf(item.file_path)

                            if structure_data:
                                print(f"🎭 [DOWNLOAD] Structure detected: {len(structure_data)} sections")
                                for section in structure_data:
                                    print(f"   - {section['label']}: {section['start']:.1f}s - {section['end']:.1f}s")
                            else:
                                print(f"⚠️ [DOWNLOAD] No detected structure (MSAF)")
                        except Exception as e:
                            print(f"⚠️ [DOWNLOAD] Error MSAF structure: {e}")
                            structure_data = None

                        # Detect lyrics: Only try Musixmatch during download (fast API call)
                        # Whisper fallback will be done AFTER extraction with vocals.mp3 (better quality)
                        lyrics_data = None
                        try:
                            from .metadata_extractor import extract_metadata
                            from .syncedlyrics_client import fetch_lyrics_enhanced

                            print(f"🎤 [DOWNLOAD] Searching Musixmatch lyrics for: {item.title}")

                            # Extract artist/track from title
                            artist, track = extract_metadata(db_title=item.title)

                            if artist and track:
                                # Only try Musixmatch (fast API call, no local processing)
                                synced_lyrics = fetch_lyrics_enhanced(
                                    track_name=track,
                                    artist_name=artist,
                                    allow_plain=False  # Only word-level
                                )

                                if synced_lyrics:
                                    lyrics_data = synced_lyrics
                                    print(f"🎤 [DOWNLOAD] Musixmatch found: {len(lyrics_data)} segments")
                                else:
                                    print(f"ℹ️ [DOWNLOAD] No Musixmatch lyrics - will use Whisper after extraction")
                            else:
                                print(f"ℹ️ [DOWNLOAD] Cannot search Musixmatch (missing artist/track) - will use Whisper after extraction")
                        except Exception as e:
                            print(f"⚠️ [DOWNLOAD] Musixmatch search error: {e}")
                            lyrics_data = None

                        # Update database with analysis results
                        try:
                            from .downloads_db import update_download_analysis
                            update_download_analysis(
                                item.video_id,
                                item.detected_bpm,
                                item.detected_key,
                                item.analysis_confidence,
                                chords_data,
                                beat_offset,
                                structure_data,
                                lyrics_data
                            )
                        except Exception as e:
                            print(f"⚠️ [DOWNLOAD] Error updating database analysis: {e}")
                        
                    print(f"Download completed: {item.title}")
                    return
                
            # If we get here, the download failed
            item.status = DownloadStatus.ERROR
            item.error_message = "Failed to download video"
            
            # Move from active to failed
            if item.download_id in self.active_downloads:
                del self.active_downloads[item.download_id]
            self.failed_downloads[item.download_id] = item
            
            # Notify error
            if self.on_download_error:
                self.on_download_error(
                    item.download_id,
                    "Failed to download video"
                )
                
        except Exception as e:
            # Enhanced error handling with specific error detection
            error_message = str(e)
            print(f"Download error: {error_message}")

            # Categorize error types for better user feedback
            if "cancelled by user" in error_message.lower() or (item.cancel_event and item.cancel_event.is_set()):
                item.status = DownloadStatus.CANCELLED
                item.error_message = "Download cancelled by user"
                print(f"Download {item.download_id} was cancelled")
            elif "sign in" in error_message.lower() or "confirm you" in error_message.lower():
                item.status = DownloadStatus.ERROR
                item.error_message = "YouTube bot detection - Upload fresh cookies in Admin > Settings > YouTube Cookies"
                print(f"Download {item.download_id} blocked by YouTube bot detection - cookies need refresh")
            elif "403" in error_message or "Forbidden" in error_message:
                item.status = DownloadStatus.ERROR
                item.error_message = "Access forbidden - Video may be private, age-restricted, or geo-blocked"
                print(f"Download {item.download_id} failed with 403 Forbidden")
            elif "404" in error_message or "Not Found" in error_message:
                item.status = DownloadStatus.ERROR
                item.error_message = "Video not found - It may have been deleted or made private"
            elif "429" in error_message or "rate limit" in error_message.lower():
                item.status = DownloadStatus.ERROR
                item.error_message = "Rate limited - Too many requests. Please try again later"
            elif "network" in error_message.lower() or "connection" in error_message.lower():
                item.status = DownloadStatus.ERROR
                item.error_message = "Network error - Check your internet connection"
            elif "permission" in error_message.lower() or "access" in error_message.lower():
                item.status = DownloadStatus.ERROR
                item.error_message = "File permission error - Check download directory permissions"
            else:
                item.status = DownloadStatus.ERROR
                # Truncate very long error messages for UI display
                if len(error_message) > 200:
                    item.error_message = error_message[:200] + "..."
                else:
                    item.error_message = error_message

            # Move from active to failed
            if item.download_id in self.active_downloads:
                del self.active_downloads[item.download_id]
            self.failed_downloads[item.download_id] = item

            # Notify error with enhanced message
            if self.on_download_error:
                self.on_download_error(
                    item.download_id,
                    item.error_message
                )
    
    def _convert_to_mp3(self, input_file: str, output_file: str):
        """Convert an audio file to MP3 using FFmpeg.

        Args:
            input_file: Path to the input file.
            output_file: Path to the output MP3 file.
        """
        try:
            import subprocess
            ffmpeg_path = get_ffmpeg_path()

            # FFmpeg command to convert to MP3
            cmd = [
                ffmpeg_path,
                '-i', input_file,
                '-vn',  # No video
                '-ar', '44100',  # Sample rate
                '-ac', '2',  # Stereo
                '-b:a', '192k',  # Bitrate
                '-f', 'mp3',  # Format
                output_file
            ]

            # Execute FFmpeg
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            # Remove original file if conversion was successful
            if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
                try:
                    os.remove(input_file)
                except:
                    pass  # Ignore deletion errors
                    
            return True
        except Exception as e:
            print(f"Error converting file to MP3: {e}")
            return False
    
    def _progress_hook(self, d: Dict[str, Any], item: DownloadItem):
        """Progress hook for yt-dlp.
        
        Args:
            d: Progress information from yt-dlp.
            item: Download item.
        """
        if d['status'] == 'downloading':
            # Calculate progress
            if 'total_bytes' in d:
                total = d['total_bytes']
                downloaded = d.get('downloaded_bytes', 0)
                item.progress = (downloaded / total) * 100 if total else 0
            elif 'total_bytes_estimate' in d:
                total = d['total_bytes_estimate']
                downloaded = d.get('downloaded_bytes', 0)
                item.progress = (downloaded / total) * 100 if total else 0
            
            # Update speed and ETA
            item.speed = self._clean_ansi_codes(d.get('_speed_str', ''))
            item.eta = self._clean_ansi_codes(d.get('_eta_str', ''))
            
            # Notify progress - always call the callback to ensure UI updates
            if self.on_download_progress:
                # Ensure item is in active_downloads
                if item.download_id not in self.active_downloads and item.status != DownloadStatus.CANCELLED:
                    self.active_downloads[item.download_id] = item

                # Send progress update
                self.on_download_progress(
                    item.download_id,
                    item.progress,
                    item.speed,
                    item.eta
                )
        
        elif d['status'] == 'finished':
            # Download finished, now processing
            item.progress = 99.0
            item.speed = "Processing..."
            item.eta = ""
            
            # Notify progress
            if self.on_download_progress:
                self.on_download_progress(
                    item.download_id,
                    item.progress,
                    item.speed,
                    item.eta
                )
        
        elif d['status'] == 'error':
            # Download error
            item.status = DownloadStatus.ERROR
            item.error_message = d.get('error', 'Unknown error')
            
            # Move from active to failed
            del self.active_downloads[item.download_id]
            self.failed_downloads[item.download_id] = item
            
            # Notify download error
            if self.on_download_error:
                self.on_download_error(item.download_id, item.error_message)
    
    def _sanitize_filename(self, filename: str) -> str:
        """Enhanced filename sanitization for cross-platform compatibility.

        Args:
            filename: Raw filename from video title.

        Returns:
            Sanitized filename safe for use on Windows, Linux, and macOS.
        """
        if not filename:
            return "unknown_video"

        # Windows reserved names
        reserved_names = {'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
                         'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2',
                         'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'}

        # Characters invalid on Windows
        invalid_chars = '<>:"/\\|?*'

        # Remove or replace invalid characters
        safe_name = ""
        for char in filename:
            if char in invalid_chars:
                safe_name += "_"
            elif ord(char) < 32:  # Control characters
                safe_name += "_"
            else:
                safe_name += char

        # Trim whitespace and dots (Windows doesn't like trailing dots)
        safe_name = safe_name.strip(' .')

        # Handle reserved names
        if safe_name.upper() in reserved_names:
            safe_name = f"video_{safe_name}"

        # Ensure reasonable length (Windows has 260 char path limit)
        if len(safe_name) > 100:
            safe_name = safe_name[:100]

        # Fallback if empty
        if not safe_name:
            safe_name = f"video_{int(time.time())}"

        return safe_name

    def _clean_ansi_codes(self, text: str) -> str:
        """Clean up ANSI codes from a string.

        Args:
            text: Text potentially containing ANSI codes.

        Returns:
            Cleaned text without ANSI codes.
        """
        if not text:
            return ""
            
        # Regex pattern to detect ANSI codes
        ansi_pattern = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        return ansi_pattern.sub('', text)
    
    def _get_format_string(self, item: DownloadItem) -> str:
        """Get the format string for yt-dlp.
        
        Args:
            item: Download item.
            
        Returns:
            Format string for yt-dlp.
        """
        if item.download_type == DownloadType.AUDIO:
            # Flexible format: try audio-only first, fallback to any format with audio
            return "bestaudio/best[acodec!=none]"
        
        # Video format
        if item.quality == "best":
            return "bestvideo+bestaudio/best"
        elif item.quality == "4K":
            return "bestvideo[height<=2160]+bestaudio/best[height<=2160]"
        elif item.quality == "1080p":
            return "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
        elif item.quality == "720p":
            return "bestvideo[height<=720]+bestaudio/best[height<=720]"
        elif item.quality == "480p":
            return "bestvideo[height<=480]+bestaudio/best[height<=480]"
        elif item.quality == "360p":
            return "bestvideo[height<=360]+bestaudio/best[height<=360]"
        else:
            return "bestvideo+bestaudio/best"
    
    def set_max_concurrent_downloads(self, max_downloads: int):
        """Set the maximum number of concurrent downloads.
        
        Args:
            max_downloads: Maximum number of concurrent downloads.
        """
        self.max_concurrent_downloads = max(1, max_downloads)
        update_setting("max_concurrent_downloads", self.max_concurrent_downloads)
    
    def set_downloads_directory(self, directory: str) -> bool:
        """Set the downloads directory.
        
        Args:
            directory: Directory to use for downloads.
            
        Returns:
            True if successful, False otherwise.
        """
        if os.path.isdir(directory):
            self.downloads_directory = directory
            
            # Create base directory
            os.makedirs(directory, exist_ok=True)
            
            update_setting("downloads_directory", directory)
            
            return True
        
        return False


# Create a singleton instance
_download_manager = None

def get_download_manager() -> DownloadManager:
    """Get the download manager singleton instance."""
    global _download_manager
    if _download_manager is None:
        _download_manager = DownloadManager()
    return _download_manager
