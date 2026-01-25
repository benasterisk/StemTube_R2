"""
Stems extractor for StemTubes application.
Handles extraction of audio stems using Demucs models.
"""
import os
import time
import threading
import queue
from typing import Dict, List, Optional, Callable, Any, Tuple
from dataclasses import dataclass
from enum import Enum
import tempfile
import subprocess
import shutil
import platform
import sys

import torch
import torchaudio
from demucs.pretrained import get_model
from demucs.apply import apply_model
from demucs.separate import load_track
import librosa
import numpy as np

from .config import get_setting, STEM_MODELS, MODELS_DIR, get_ffmpeg_path, ensure_valid_downloads_directory, get_compatible_models, get_fallback_model


class ExtractionStatus(Enum):
    """Enum for extraction status."""
    QUEUED = "queued"
    EXTRACTING = "extracting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ExtractionItem:
    """Class representing an extraction item."""
    audio_path: str
    model_name: str
    output_dir: str
    selected_stems: List[str]
    two_stem_mode: bool = False
    primary_stem: str = "vocals"
    status: ExtractionStatus = ExtractionStatus.QUEUED
    progress: float = 0.0
    extraction_id: str = ""
    error_message: str = ""
    output_paths: Dict[str, str] = None
    zip_path: str = None
    video_id: str = ""  # Add video_id for deduplication and persistence
    title: str = ""     # Add title for better database records
    
    def __post_init__(self):
        """Generate a unique extraction ID if not provided and initialize output_paths."""
        if not self.extraction_id:
            self.extraction_id = f"{os.path.basename(self.audio_path)}_{int(time.time())}"
        
        if self.output_paths is None:
            self.output_paths = {}


class StemsExtractor:
    """Manager for handling audio stem extraction."""
    
    def __init__(self):
        """Initialize the stems extractor."""
        self.extraction_queue = queue.Queue()
        self.queued_extractions: Dict[str, ExtractionItem] = {}
        self.active_extractions: Dict[str, ExtractionItem] = {}
        self.completed_extractions: Dict[str, ExtractionItem] = {}
        self.failed_extractions: Dict[str, ExtractionItem] = {}
        self.running_processes: Dict[str, subprocess.Popen] = {}  # Track running subprocesses

        # Check if GPU is available
        self.device = torch.device("cuda" if torch.cuda.is_available() and
                                  get_setting("use_gpu_for_extraction", True) else "cpu")
        self.using_gpu = self.device.type == "cuda"

        # Create models directory if it doesn't exist
        os.makedirs(MODELS_DIR, exist_ok=True)

        # Ensure we have a valid downloads directory for default outputs
        self.default_output_dir = ensure_valid_downloads_directory()

        # Preloaded models
        self.models = {}

        # Start extraction worker thread
        self.worker_thread = threading.Thread(target=self._extraction_worker, daemon=True)
        self.worker_thread.start()

        # Callbacks
        self.on_extraction_progress: Optional[Callable[[str, float, str], None]] = None
        self.on_extraction_complete: Optional[Callable[[str], None]] = None
        self.on_extraction_error: Optional[Callable[[str, str, str], None]] = None  # extraction_id, error, video_id
        self.on_extraction_start: Optional[Callable[[str], None]] = None

    def _analyze_audio_content(self, audio_path: str, threshold_db: float = -40.0, min_duration_ratio: float = 0.05) -> bool:
        """
        Analyze audio file to determine if it contains meaningful content.

        Args:
            audio_path: Path to the audio file to analyze
            threshold_db: dB threshold below which audio is considered silent (default: -40dB)
            min_duration_ratio: Minimum ratio of non-silent duration to total duration (default: 5%)

        Returns:
            True if audio contains meaningful content, False if mostly silent/empty
        """
        try:
            # Load audio file with librosa
            y, sr = librosa.load(audio_path, sr=None)

            # Convert threshold from dB to amplitude
            threshold_amplitude = 10 ** (threshold_db / 20)

            # Calculate RMS energy for each frame
            frame_length = int(0.1 * sr)  # 100ms frames
            hop_length = frame_length // 4
            rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

            # Count frames above threshold
            active_frames = np.sum(rms > threshold_amplitude)
            total_frames = len(rms)

            if total_frames == 0:
                return False

            # Calculate ratio of active content
            active_ratio = active_frames / total_frames

            # Also check overall RMS level
            overall_rms = np.sqrt(np.mean(y**2))
            overall_db = 20 * np.log10(overall_rms + 1e-10)  # Add small epsilon to avoid log(0)

            # Consider content meaningful if:
            # 1. More than min_duration_ratio of frames are above threshold, OR
            # 2. Overall RMS is significantly above threshold (for sustained quiet instruments)
            has_meaningful_content = (
                active_ratio > min_duration_ratio or
                overall_db > (threshold_db + 10)  # Overall level within 10dB of threshold
            )

            print(f"Audio analysis for {os.path.basename(audio_path)}: "
                  f"Active ratio: {active_ratio:.3f}, Overall dB: {overall_db:.1f}, "
                  f"Meaningful: {has_meaningful_content}")

            return has_meaningful_content

        except Exception as e:
            print(f"Error analyzing audio content for {audio_path}: {e}")
            # If analysis fails, assume content is meaningful to be safe
            return True
    
    def add_extraction(self, item: ExtractionItem) -> str:
        """Add an extraction to the queue.
        
        Args:
            item: Extraction item to add.
            
        Returns:
            Extraction ID.
        """
        # Validate output directory
        try:
            os.makedirs(item.output_dir, exist_ok=True)
            # Test write access
            test_file = os.path.join(item.output_dir, ".write_test")
            with open(test_file, 'w') as f:
                f.write("test")
            os.remove(test_file)
        except (IOError, OSError, PermissionError) as e:
            print(f"Warning: Configured output directory is not accessible: {e}")
            print(f"Falling back to default directory: {self.default_output_dir}")
            item.output_dir = self.default_output_dir
        
        self.queued_extractions[item.extraction_id] = item
        self.extraction_queue.put(item)
        return item.extraction_id
    
    def cancel_extraction(self, extraction_id: str) -> bool:
        """Cancel an extraction.
        
        Args:
            extraction_id: ID of the extraction to cancel.
            
        Returns:
            True if the extraction was cancelled, False otherwise.
        """
        # Check if the extraction is active
        if extraction_id in self.active_extractions:
            item = self.active_extractions[extraction_id]
            item.status = ExtractionStatus.CANCELLED
            
            # Terminate the running subprocess if it exists
            if extraction_id in self.running_processes:
                process = self.running_processes[extraction_id]
                try:
                    process.terminate()
                    # Give it a moment to terminate gracefully
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        # Force kill if it doesn't terminate gracefully
                        process.kill()
                        process.wait()
                except (ProcessLookupError, OSError):
                    # Process already terminated
                    pass
                finally:
                    # Remove from running processes
                    self.running_processes.pop(extraction_id, None)
            
            # Move from active to failed so retry/delete can find it
            del self.active_extractions[extraction_id]
            self.failed_extractions[extraction_id] = item
            
            return True
        
        # Check if the extraction is in the queue
        if extraction_id in self.queued_extractions:
            item = self.queued_extractions[extraction_id]
            item.status = ExtractionStatus.CANCELLED
            del self.queued_extractions[extraction_id]
            self.failed_extractions[extraction_id] = item
            # Remove from queue as well
            temp_items = []
            for _ in range(self.extraction_queue.qsize()):
                queued_item = self.extraction_queue.get()
                if queued_item.extraction_id != extraction_id:
                    temp_items.append(queued_item)
            for queued_item in temp_items:
                self.extraction_queue.put(queued_item)
            return True
        
        return False
    
    def get_extraction_status(self, extraction_id: str) -> Optional[ExtractionItem]:
        """Get the status of an extraction.
        
        Args:
            extraction_id: ID of the extraction.
            
        Returns:
            Extraction item or None if not found.
        """
        # Check active extractions
        if extraction_id in self.active_extractions:
            return self.active_extractions[extraction_id]
        
        # Check completed extractions
        if extraction_id in self.completed_extractions:
            return self.completed_extractions[extraction_id]
        
        # Check failed extractions
        if extraction_id in self.failed_extractions:
            return self.failed_extractions[extraction_id]
        
        # Check queued extractions
        if extraction_id in self.queued_extractions:
            return self.queued_extractions[extraction_id]
        
        return None
    
    def get_all_extractions(self) -> Dict[str, List[ExtractionItem]]:
        """Get all extractions.
        
        Returns:
            Dictionary with active, queued, completed, and failed extractions.
        """
        return {
            "active": list(self.active_extractions.values()),
            "queued": list(self.queued_extractions.values()),
            "completed": list(self.completed_extractions.values()),
            "failed": list(self.failed_extractions.values())
        }
    
    def get_current_extraction(self) -> Optional[Dict[str, Any]]:
        """Get the currently active extraction.
        
        Returns:
            Dictionary containing extraction information or None if no active extraction.
        """
        # Check if there's an active extraction
        if self.active_extractions:
            # Get the most recent active extraction
            extraction_id = list(self.active_extractions.keys())[0]
            item = self.active_extractions[extraction_id]
            return {
                "extraction_id": extraction_id,
                "progress": item.progress,
                "status": "Extracting stems",
                "model_name": item.model_name,
                "audio_path": item.audio_path
            }
        
        # No active extraction
        return None
        
    def _extraction_worker(self):
        """Worker thread for processing extractions."""
        while True:
            # Check if we can start a new extraction
            if len(self.active_extractions) >= 1 and not self.using_gpu:
                # Only allow one extraction at a time on CPU
                time.sleep(1)
                continue
            
            try:
                # Get the next extraction item
                item = self.extraction_queue.get(block=False)
                
                # Remove from queued extractions
                if item.extraction_id in self.queued_extractions:
                    del self.queued_extractions[item.extraction_id]
                
                # Check if the extraction was cancelled
                if item.status == ExtractionStatus.CANCELLED:
                    self.failed_extractions[item.extraction_id] = item
                    self.extraction_queue.task_done()
                    continue
                
                # Start the extraction
                self._start_extraction(item)
                
            except queue.Empty:
                # No extractions in the queue
                time.sleep(1)
    
    def _start_extraction(self, item: ExtractionItem):
        """Start an extraction.
        
        Args:
            item: Extraction item to start.
        """
        # Update status
        item.status = ExtractionStatus.EXTRACTING
        self.active_extractions[item.extraction_id] = item
        
        # Notify extraction start
        if self.on_extraction_start:
            self.on_extraction_start(item.extraction_id)
        
        # Create output directory if it doesn't exist
        os.makedirs(item.output_dir, exist_ok=True)
        
        # Start extraction in a separate thread
        extraction_thread = threading.Thread(
            target=self._extraction_thread,
            args=(item,),
            daemon=True
        )
        extraction_thread.start()
    
    def _on_extraction_progress(self, extraction_id: str, progress: float, status_message: str = None):
        """Handle extraction progress update from worker thread.

        Args:
            extraction_id: Extraction ID.
            progress: Extraction progress.
            status_message: Optional status message.
        """
        # Find extraction item
        item = self.active_extractions.get(extraction_id)
        if not item:
            return

        # Update progress
        item.progress = progress

        # Notify progress listeners - pass item data to avoid lookup issues in background threads
        if self.on_extraction_progress:
            status = status_message if status_message else "Extracting stems"
            # Pass video_id and title directly so callback doesn't need to look up the item
            self.on_extraction_progress(extraction_id, progress, status, item.video_id, item.title)
    
    def _extraction_thread(self, item: ExtractionItem):
        """Thread for extracting stems.
        
        Args:
            item: Extraction item.
        """
        try:
            # Create temporary directory for extraction outside Flask's watch directories
            # Use system temp directory to avoid Flask auto-reload issues
            system_temp_dir = tempfile.gettempdir()
            temp_dir = tempfile.mkdtemp(prefix="demucs_extraction_", dir=system_temp_dir)

            try:
                # Get FFmpeg path for setting environment variables
                ffmpeg_path = get_ffmpeg_path()
                ffmpeg_dir = os.path.dirname(ffmpeg_path)
                
                # Ensure we have the correct ffmpeg path with ffmpeg.exe at the end on Windows
                if platform.system() == "Windows" and not ffmpeg_path.endswith("ffmpeg.exe"):
                    ffmpeg_path = os.path.join(ffmpeg_path, "ffmpeg.exe")
                    
                # Print FFmpeg information before setting up environment
                print(f"FFmpeg path: {ffmpeg_path}")
                print(f"FFmpeg exists: {os.path.exists(ffmpeg_path)}")

                # Configure environment variables for FFmpeg
                env = os.environ.copy()
                
                # Add FFmpeg directory to PATH and set FFMPEG_PATH
                if os.path.exists(ffmpeg_dir):
                    # On Windows, PATH separator is semicolon
                    if platform.system() == "Windows":
                        env["PATH"] = ffmpeg_dir + ";" + env.get("PATH", "")
                    else:
                        # On Unix-like systems, PATH separator is colon
                        env["PATH"] = ffmpeg_dir + ":" + env.get("PATH", "")
                    
                    # Set explicit FFMPEG_PATH environment variable directly to the ffmpeg executable
                    env["FFMPEG_PATH"] = ffmpeg_path
                    print(f"Using FFmpeg at: {ffmpeg_path}")
                    print(f"PATH environment: {env['PATH']}")
                    
                    # Verify FFmpeg is accessible
                    try:
                        result = subprocess.run(
                            [ffmpeg_path, "-version"],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True,
                            env=env,
                            check=False
                        )
                        if result.returncode == 0:
                            print(f"FFmpeg verification successful: {result.stdout.splitlines()[0]}")
                        else:
                            print(f"FFmpeg verification failed: {result.stderr}")
                    except Exception as e:
                        print(f"Error verifying FFmpeg: {e}")
                else:
                    print(f"FFmpeg directory not found: {ffmpeg_dir}")
                
                # Instead of running demucs directly, use our wrapper script
                # to ensure environment variables are correctly set
                cmd = [
                    sys.executable,
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrap_demucs.py"),
                    ffmpeg_path,  # First arg to wrapper is FFmpeg path
                    '--mp3',                  # Output as MP3
                    '--mp3-bitrate', '320',   # High quality MP3
                    '-v',                     # Verbose output for progress tracking
                    '-n', item.model_name,    # Model name
                    '-o', temp_dir            # Output to temp directory
                ]
                
                # Add device (GPU or CPU)
                if self.device.type == 'cuda':
                    cmd.extend(['-d', 'cuda'])
                else:
                    cmd.extend(['-d', 'cpu'])
                
                # Add two stem mode if needed
                if item.two_stem_mode and item.primary_stem:
                    cmd.extend(['--two-stems', item.primary_stem])
                
                # Add audio file at the end (use the temporary file if available)
                temp_audio_path = None
                try:
                    # Get the extension of the original file
                    _, ext = os.path.splitext(item.audio_path)
                    
                    # Create a temporary file with a simple name
                    temp_audio_path = os.path.join(temp_dir, f"input{ext}")
                    
                    # Verify that the source directory exists
                    if not os.path.exists(item.audio_path):
                        raise FileNotFoundError(f"Source audio file not found: {item.audio_path}")
                    
                    # Copy the audio file to the temporary file
                    print(f"Copying audio file to temporary location: {temp_audio_path}")
                    shutil.copy2(item.audio_path, temp_audio_path)
                    
                    # Use the temporary file for extraction
                    audio_path_for_extraction = temp_audio_path
                    print(f"Using temporary audio file: {audio_path_for_extraction}")
                except Exception as e:
                    print(f"Error creating temporary audio file: {e}")
                    # In case of error, use the original file but with quotes
                    audio_path_for_extraction = item.audio_path
                    print(f"Falling back to original audio file: {audio_path_for_extraction}")
                
                # Add audio file to the command
                if temp_audio_path and os.path.exists(temp_audio_path):
                    cmd.append(temp_audio_path)
                else:
                    cmd.append(audio_path_for_extraction)
                
                # Print the command for debugging
                print(f"Running command: {' '.join(cmd)}")
                
                # Run demucs.separate as a subprocess
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True,
                    env=env  # Use the environment with FFmpeg configured
                )
                
                # Store the process reference for cancellation
                self.running_processes[item.extraction_id] = process
                
                # Store output lines for error reporting
                output_lines = []
                
                # Process output to update progress with timeout safeguards
                import time
                import select
                last_progress_time = time.time()

                # Get configurable timeouts with model-specific adjustments
                base_progress_timeout = get_setting("extraction_progress_timeout_minutes", 5)
                base_extraction_timeout = get_setting("extraction_timeout_minutes", 30)

                # Adjust timeouts based on model complexity
                if item.model_name == "htdemucs_6s":
                    # 6-stem model takes longer
                    progress_timeout = base_progress_timeout * 2 * 60  # Double timeout for 6-stem
                    max_extraction_time = base_extraction_timeout * 1.5 * 60  # 50% more time
                elif "ft" in item.model_name.lower():
                    # Fine-tuned models may be slower
                    progress_timeout = base_progress_timeout * 1.5 * 60  # 50% more time for progress
                    max_extraction_time = base_extraction_timeout * 1.2 * 60  # 20% more total time
                else:
                    # Standard timeouts for basic models
                    progress_timeout = base_progress_timeout * 60
                    max_extraction_time = base_extraction_timeout * 60

                print(f"🕐 Extraction timeouts for {item.model_name}: {max_extraction_time/60:.1f}min total, {progress_timeout/60:.1f}min progress")

                extraction_start_time = time.time()
                last_progress_value = 0
                stuck_progress_count = 0

                while True:
                    # Check timeouts
                    current_time = time.time()

                    # Check total extraction timeout
                    if current_time - extraction_start_time > max_extraction_time:
                        print(f"❌ Extraction timeout after {max_extraction_time} seconds")
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                        raise TimeoutError(f"Extraction timed out after {max_extraction_time} seconds")

                    # Check if extraction was cancelled
                    if item.status == ExtractionStatus.CANCELLED:
                        print(f"Extraction {item.extraction_id} was cancelled, terminating process")
                        try:
                            process.terminate()
                            process.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                        except (ProcessLookupError, OSError):
                            pass
                        break

                    # Check if process has finished
                    if process.poll() is not None:
                        # Read any remaining output
                        remaining_output = process.stdout.read()
                        if remaining_output:
                            output_lines.extend(remaining_output.split('\n'))
                        break

                    # Read output with timeout
                    try:
                        line = process.stdout.readline()
                        if not line:
                            # No more output, but process still running - check progress timeout
                            if current_time - last_progress_time > progress_timeout:
                                print(f"❌ No progress for {progress_timeout} seconds, terminating")
                                process.terminate()
                                try:
                                    process.wait(timeout=5)
                                except subprocess.TimeoutExpired:
                                    process.kill()
                                    process.wait()
                                raise TimeoutError(f"No progress for {progress_timeout} seconds")
                            time.sleep(0.1)  # Small delay before checking again
                            continue

                        output_line = line.strip()
                        if output_line:
                            print(f"Demucs output: {output_line}")
                            output_lines.append(output_line)

                        # Update progress based on output
                        if '%' in line:
                            try:
                                # Try to parse progress percentage
                                percent_str = line.split('%')[0].split('|')[-1].strip()
                                if ':' in percent_str:
                                    percent_str = percent_str.split(':')[-1].strip()

                                # Don't cap at 90% - allow full progress
                                progress_value = float(percent_str)

                                # Check for stuck progress
                                if abs(progress_value - last_progress_value) < 0.1:
                                    stuck_progress_count += 1
                                    if stuck_progress_count > 50:  # Same progress 50 times
                                        print(f"⚠️ Progress appears stuck at {progress_value}%")
                                        # Continue but don't timeout yet - Demucs can be slow
                                else:
                                    stuck_progress_count = 0
                                    last_progress_time = current_time
                                    last_progress_value = progress_value

                                item.progress = min(progress_value, 99.0)  # Cap at 99% until completion

                                # Notify progress
                                self._on_extraction_progress(item.extraction_id, item.progress)
                            except (ValueError, IndexError):
                                pass

                    except Exception as e:
                        print(f"Error reading process output: {e}")
                        break
                
                # Wait for process to complete
                return_code = process.wait()

                # Update progress to completion if successful
                if return_code == 0 and item.status != ExtractionStatus.CANCELLED:
                    item.progress = 95.0  # Set to 95% before file operations
                    self._on_extraction_progress(item.extraction_id, item.progress)
                
                # Clean up process reference
                self.running_processes.pop(item.extraction_id, None)
                
                # Check if extraction was cancelled
                if item.status == ExtractionStatus.CANCELLED:
                    print(f"Extraction {item.extraction_id} was cancelled")
                    # Move to failed extractions (only if not already moved)
                    if item.extraction_id in self.active_extractions:
                        del self.active_extractions[item.extraction_id]
                        self.failed_extractions[item.extraction_id] = item
                    # Ensure it's in failed_extractions
                    elif item.extraction_id not in self.failed_extractions:
                        self.failed_extractions[item.extraction_id] = item
                    # Notify cancellation
                    if self.on_extraction_error:
                        self.on_extraction_error(item.extraction_id, "Extraction cancelled by user", item.video_id)
                    return
                
                if return_code != 0:
                    # Join the last 20 lines of output for error reporting
                    error_output = "\n".join(output_lines[-20:]) if output_lines else "No output captured"
                    raise Exception(f"Demucs exited with code {return_code}. Output:\n{error_output}")
                
                # Indicate that we are now in finalization phase
                item.progress = 90.0
                self._on_extraction_progress(item.extraction_id, item.progress, "Finalization in progress...")
                
                # Copy extracted stems from temp directory to final destination
                model_dir = os.path.join(temp_dir, item.model_name)
                if not os.path.exists(model_dir):
                    raise FileNotFoundError(f"Expected output directory not found: {model_dir}")
                
                # Find track directory (should be only one)
                track_dirs = [d for d in os.listdir(model_dir) if os.path.isdir(os.path.join(model_dir, d))]
                if not track_dirs:
                    raise FileNotFoundError(f"No track directories found in {model_dir}")
                
                track_dir = os.path.join(model_dir, track_dirs[0])
                
                # Create output directory if it doesn't exist
                os.makedirs(item.output_dir, exist_ok=True)
                
                # Copy each stem file to final destination
                stem_files = {}

                # Determine expected stems based on model
                if item.model_name == "htdemucs_6s":
                    default_stems = ["vocals", "drums", "bass", "guitar", "piano", "other"]
                else:
                    default_stems = ["vocals", "drums", "bass", "other"]

                stems_to_process = item.selected_stems if item.selected_stems else default_stems
                total_stems = len(stems_to_process)

                for i, stem in enumerate(stems_to_process):
                    # Update progress during file copying (from 90% to 99%)
                    progress = 90.0 + (i / total_stems) * 9.0
                    item.progress = progress
                    self._on_extraction_progress(item.extraction_id, progress, f"Copying {stem}...")
                    
                    # Check if the stem is selected or if all stems are selected
                    if not item.selected_stems or stem in item.selected_stems:
                        stem_file_mp3 = os.path.join(track_dir, f"{stem}.mp3")
                        stem_file_wav = os.path.join(track_dir, f"{stem}.wav")
                        
                        if os.path.exists(stem_file_mp3):
                            output_file = os.path.join(item.output_dir, f"{stem}.mp3")
                            shutil.copy2(stem_file_mp3, output_file)

                            # Analyze audio content to determine if it's meaningful (if feature is enabled)
                            if get_setting("enable_silent_stem_detection", True):
                                threshold_db = get_setting("silent_stem_threshold_db", -40.0)
                                min_duration_ratio = get_setting("silent_stem_min_duration_ratio", 0.05)
                                has_meaningful_content = self._analyze_audio_content(output_file, threshold_db, min_duration_ratio)
                            else:
                                # If analysis is disabled, include all stems
                                has_meaningful_content = True

                            if has_meaningful_content:
                                # Only include stems with meaningful content
                                stem_files[stem] = output_file
                                print(f"✓ Stem '{stem}' added to mixer (has meaningful content)")
                            else:
                                # Keep the file on disk for debugging but don't include in mixer
                                print(f"✗ Stem '{stem}' excluded from mixer (mostly silent/empty)")

                        elif os.path.exists(stem_file_wav):
                            output_file = os.path.join(item.output_dir, f"{stem}.wav")
                            shutil.copy2(stem_file_wav, output_file)

                            # Analyze audio content to determine if it's meaningful (if feature is enabled)
                            if get_setting("enable_silent_stem_detection", True):
                                threshold_db = get_setting("silent_stem_threshold_db", -40.0)
                                min_duration_ratio = get_setting("silent_stem_min_duration_ratio", 0.05)
                                has_meaningful_content = self._analyze_audio_content(output_file, threshold_db, min_duration_ratio)
                            else:
                                # If analysis is disabled, include all stems
                                has_meaningful_content = True

                            if has_meaningful_content:
                                # Only include stems with meaningful content
                                stem_files[stem] = output_file
                                print(f"✓ Stem '{stem}' added to mixer (has meaningful content)")
                            else:
                                # Keep the file on disk for debugging but don't include in mixer
                                print(f"✗ Stem '{stem}' excluded from mixer (mostly silent/empty)")
                
                # Maintain progress at 99% during finalization
                item.progress = 99.0
                self._on_extraction_progress(item.extraction_id, 99.0, "Finalizing...")

                # Log stem analysis results
                if get_setting("enable_silent_stem_detection", True):
                    print(f"Stem analysis complete: {len(stem_files)}/{total_stems} stems have meaningful content")
                else:
                    print(f"Silent stem detection disabled - all {len(stem_files)} stems included")

                # Save stem file paths
                item.output_paths = stem_files
                
                # Create ZIP archive of all stems
                zip_path = self._create_zip_archive(item, os.path.splitext(os.path.basename(item.audio_path))[0])
                if zip_path:
                    item.zip_path = zip_path
                
                # Update status
                item.status = ExtractionStatus.COMPLETED
                item.progress = 100.0
                
                # Send explicit notification that we have reached 100%
                self._on_extraction_progress(item.extraction_id, 100.0, "Extraction completed")
                
                # Move from active to completed
                del self.active_extractions[item.extraction_id]
                self.completed_extractions[item.extraction_id] = item
                
                # Notify extraction complete
                if self.on_extraction_complete:
                    # Pass the complete item data to avoid retrieval issues
                    self.on_extraction_complete(item.extraction_id, item.title, item.video_id, item)
            
            finally:
                # Clean up temporary directory
                try:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                except:
                    pass

        except Exception as e:
            # Clean up process reference
            self.running_processes.pop(item.extraction_id, None)

            # Update status
            item.status = ExtractionStatus.FAILED
            item.error_message = str(e)

            # Move from active to failed
            del self.active_extractions[item.extraction_id]
            self.failed_extractions[item.extraction_id] = item

            # Notify extraction error
            if self.on_extraction_error:
                self.on_extraction_error(item.extraction_id, str(e), item.video_id)

        finally:
            # Mark the task as done
            self.extraction_queue.task_done()
    
    def _validate_and_get_model(self, model_name: str) -> str:
        """Validate model compatibility and return working model name.

        Args:
            model_name: Requested model name.

        Returns:
            Valid model name (may be fallback if original is incompatible).
        """
        # Check if requested model is compatible
        if model_name in STEM_MODELS:
            model_info = STEM_MODELS[model_name]
            if model_info.get("requires_diffq", False) and not model_info.get("compatible", True):
                print(f"⚠️ Model '{model_name}' requires diffq which is not available.")
                print(f"🔄 Falling back to compatible model: {get_fallback_model()}")
                return get_fallback_model()

        # Special handling for htdemucs_ft - always fallback to htdemucs to prevent infinite loops
        if model_name == "htdemucs_ft":
            print(f"htdemucs_ft requested - using htdemucs instead to prevent infinite restart loops")
            print(f"This is a known compatibility issue with htdemucs_ft model")
            return "htdemucs"

        # Check if model exists in compatible models
        compatible_models = get_compatible_models()
        if model_name not in compatible_models:
            print(f"⚠️ Model '{model_name}' not found or incompatible.")
            print(f"🔄 Falling back to compatible model: {get_fallback_model()}")
            return get_fallback_model()

        return model_name

    def _load_model(self, model_name: str):
        """Load a Demucs model with compatibility checking.

        Args:
            model_name: Name of the model to load.

        Returns:
            Loaded model.
        """
        # Validate and get compatible model
        validated_model = self._validate_and_get_model(model_name)

        if validated_model in self.models:
            return self.models[validated_model]

        # Check if model exists in STEM_MODELS
        if validated_model not in STEM_MODELS:
            raise ValueError(f"Model '{validated_model}' not found")

        try:
            # Load model
            model = get_model(validated_model)
            model.to(self.device)

            # Cache model
            self.models[validated_model] = model

            return model
        except Exception as e:
            if "diffq" in str(e).lower():
                print(f"❌ Model '{validated_model}' failed due to missing diffq dependency")
                print(f"🔄 Falling back to: {get_fallback_model()}")
                fallback_model = get_fallback_model()
                if fallback_model != validated_model:
                    return self._load_model(fallback_model)
            raise e
    
    def _load_audio(self, audio_path: str) -> Tuple[torch.Tensor, int]:
        """Load audio from file.
        
        Args:
            audio_path: Path to audio file.
            
        Returns:
            Tuple of audio tensor and sample rate.
        """
        # Check file extension
        file_ext = os.path.splitext(audio_path)[1].lower()
        
        # If not MP3, convert to MP3 first
        if file_ext != '.mp3':
            try:
                # Get FFmpeg path
                ffmpeg_path = get_ffmpeg_path()
                
                # Create a temporary MP3 file
                temp_mp3_path = os.path.splitext(audio_path)[0] + '_temp.mp3'
                
                # Convert to MP3 using FFmpeg
                import subprocess
                cmd = [
                    ffmpeg_path,
                    '-i', audio_path,
                    '-vn',  # No video
                    '-ar', '44100',  # Sample rate
                    '-ac', '2',  # Stereo
                    '-b:a', '192k',  # Bitrate
                    '-f', 'mp3',  # Format
                    temp_mp3_path
                ]
                
                # Run FFmpeg
                subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                
                # Use the converted file
                audio_path = temp_mp3_path
                
            except Exception as e:
                print(f"Error converting audio file: {e}")
                # Continue with original file if conversion fails
        
        try:
            # First load the audio to get the sample rate
            waveform, sample_rate = torchaudio.load(audio_path)
            
            # Use demucs.separate.load_track with the sample rate

            audio, sr = load_track(audio_path, sample_rate, self.device)

            # Clean up temporary file if it exists
            temp_mp3_path = os.path.splitext(audio_path)[0] + '_temp.mp3'
            if os.path.exists(temp_mp3_path) and temp_mp3_path != audio_path:
                try:
                    os.remove(temp_mp3_path)
                except:
                    pass
                
            return audio, sr
        except Exception as e:
            raise Exception(f"Failed to load audio file: {e}")
    
    def _extract_stems(self, model, audio: torch.Tensor, sr: int, item: ExtractionItem) -> Dict[str, torch.Tensor]:
        """Extract stems from audio.
        
        Args:
            model: Demucs model.
            audio: Audio tensor.
            sr: Sample rate.
            item: Extraction item.
            
        Returns:
            Dictionary of stem name to audio tensor.
        """
        # Get available stems for the model
        model_info = STEM_MODELS.get(item.model_name, {})
        available_stems = model_info.get("stems", [])
        
        # Filter selected stems
        selected_stems = [s for s in item.selected_stems if s in available_stems]
        if not selected_stems:
            selected_stems = available_stems
        
        # Apply model to extract stems
        sources = apply_model(model, audio, self.device, progress=True)
        
        # Create dictionary of stems
        stems = {}
        for i, source_name in enumerate(model.sources):
            if source_name in selected_stems:
                stems[source_name] = sources[:, i]
                
                # Update progress
                progress = (i + 1) / len(model.sources) * 100
                item.progress = progress
                
                # Notify progress
                self._on_extraction_progress(item.extraction_id, progress)
        
        # Handle two-stem mode
        if item.two_stem_mode and item.primary_stem in stems:
            # Create a mix of all other stems
            other_stems = torch.zeros_like(stems[item.primary_stem])
            for name, source in stems.items():
                if name != item.primary_stem:
                    other_stems += source
            
            # Keep only primary stem and "other"
            stems = {
                item.primary_stem: stems[item.primary_stem],
                "other": other_stems
            }
        
        return stems
    
    def _save_stems(self, stems: Dict[str, torch.Tensor], sr: int, item: ExtractionItem):
        """Save stems to files.
        
        Args:
            stems: Dictionary of stem name to audio tensor.
            sr: Sample rate.
            item: Extraction item.
        """
        # Get base filename without extension
        base_name = os.path.splitext(os.path.basename(item.audio_path))[0]
        
        # Ensure output directory exists
        os.makedirs(item.output_dir, exist_ok=True)
        
        # Save each stem and analyze content
        analyzed_stems = {}
        for stem_name, audio in stems.items():
            # Create output path
            output_path = os.path.join(item.output_dir, f"{base_name}_{stem_name}.wav")

            # Save audio file
            torchaudio.save(output_path, audio.cpu(), sr)

            # Analyze audio content to determine if it's meaningful (if feature is enabled)
            if get_setting("enable_silent_stem_detection", True):
                threshold_db = get_setting("silent_stem_threshold_db", -40.0)
                min_duration_ratio = get_setting("silent_stem_min_duration_ratio", 0.05)
                has_meaningful_content = self._analyze_audio_content(output_path, threshold_db, min_duration_ratio)
            else:
                # If analysis is disabled, include all stems
                has_meaningful_content = True

            if has_meaningful_content:
                # Only include stems with meaningful content
                item.output_paths[stem_name] = output_path
                analyzed_stems[stem_name] = output_path
                print(f"✓ Stem '{stem_name}' added to mixer (has meaningful content)")
            else:
                # Keep the file on disk for debugging but don't include in mixer
                print(f"✗ Stem '{stem_name}' excluded from mixer (mostly silent/empty)")

        if get_setting("enable_silent_stem_detection", True):
            print(f"Stem analysis complete: {len(analyzed_stems)}/{len(stems)} stems have meaningful content")
        else:
            print(f"Silent stem detection disabled - all {len(analyzed_stems)} stems included")
        
        # Create ZIP archive of meaningful stems only
        if analyzed_stems:
            zip_path = self._create_zip_archive(item, base_name)
            if zip_path:
                item.zip_path = zip_path
        else:
            print("No meaningful stems found, skipping ZIP creation")
    
    def _create_zip_archive(self, item: ExtractionItem, base_name: str) -> str:
        """Create a ZIP archive of extracted stems.
        
        Args:
            item: Extraction item.
            base_name: Base filename without extension.
            
        Returns:
            Path to the created ZIP archive, or None if creation failed.
        """
        try:
            import zipfile
            
            # Create ZIP file path
            zip_path = os.path.join(item.output_dir, f"{base_name}_stems.zip")
            
            # Create ZIP file
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for stem_name, file_path in item.output_paths.items():
                    # Add file to ZIP
                    zipf.write(file_path, os.path.basename(file_path))
            
            print(f"Created ZIP archive: {zip_path}")
            return zip_path
        except Exception as e:
            print(f"Error creating ZIP archive: {e}")
            return None
    
    def is_using_gpu(self) -> bool:
        """Check if GPU is being used for extraction.
        
        Returns:
            True if GPU is being used, False otherwise.
        """
        return self.using_gpu
    
    def set_use_gpu(self, use_gpu: bool):
        """Set whether to use GPU for extraction.
        
        Args:
            use_gpu: Whether to use GPU.
        """
        # Only update if there's a change and GPU is available
        if use_gpu != self.using_gpu and torch.cuda.is_available():
            self.using_gpu = use_gpu
            self.device = torch.device("cuda" if use_gpu else "cpu")
            
            # Clear model cache to reload models on the new device
            self.models.clear()


# Create a singleton instance
_stems_extractor = None

def get_stems_extractor() -> StemsExtractor:
    """Get the stems extractor singleton instance."""
    global _stems_extractor
    if _stems_extractor is None:
        _stems_extractor = StemsExtractor()
    return _stems_extractor
