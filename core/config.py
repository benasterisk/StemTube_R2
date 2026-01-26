"""
Configuration module for StemTubes application.
Contains application settings, paths, and constants.
"""
import os
import json
import platform
from pathlib import Path
from dotenv import load_dotenv
import tempfile
import urllib.request
import zipfile
import shutil

# Load environment variables from .env file
load_dotenv()

# Application information
APP_NAME = "StemTubes"
APP_VERSION = "1.0.0"
APP_AUTHOR = "StemTubes Team"

# ============================================================================
# Server Configuration - SINGLE SOURCE OF TRUTH
# ============================================================================
# Application server port - This is the ONLY place where port is defined
PORT = 5011

# Application host address
HOST = "0.0.0.0"  # Bind to all interfaces

# Paths
APP_DIR = os.path.dirname(os.path.abspath(__file__))
RESOURCES_DIR = os.path.join(APP_DIR, "resources")
# Default downloads directory is now relative to the app directory to make it more portable
DOWNLOADS_DIR = os.path.join(APP_DIR, "downloads")
MODELS_DIR = os.path.join(APP_DIR, "models")
CONFIG_FILE = os.path.join(APP_DIR, "config.json")
FFMPEG_DIR = os.path.join(APP_DIR, "ffmpeg")

# Create necessary directories if they don't exist
os.makedirs(RESOURCES_DIR, exist_ok=True)
os.makedirs(DOWNLOADS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(FFMPEG_DIR, exist_ok=True)

# FFmpeg settings
if platform.system() == "Windows":
    FFMPEG_EXECUTABLE = os.path.join(FFMPEG_DIR, "bin", "ffmpeg.exe")
    FFPROBE_EXECUTABLE = os.path.join(FFMPEG_DIR, "bin", "ffprobe.exe")
else:
    FFMPEG_EXECUTABLE = "ffmpeg"
    FFPROBE_EXECUTABLE = "ffprobe"

# YouTube API settings
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")

# Default application settings
DEFAULT_SETTINGS = {
    "theme": "dark",  # dark or light
    "downloads_directory": DOWNLOADS_DIR,
    "max_concurrent_downloads": 3,
    "preferred_video_quality": "720p",
    "preferred_audio_quality": "best",
    "use_gpu_for_extraction": True,
    "default_stem_model": "htdemucs",
    "max_concurrent_extractions": 1,
    "lyrics_model_size": "medium",
    "ffmpeg_path": "",
    "auto_check_updates": True,
    "extraction_timeout_minutes": 30,
    "extraction_progress_timeout_minutes": 5,
    # Silent stem detection settings
    "enable_silent_stem_detection": True,  # Enable intelligent filtering of silent/empty stems
    "silent_stem_threshold_db": -40.0,     # dB threshold for silence detection
    "silent_stem_min_duration_ratio": 0.05,  # Minimum 5% active content required
    # Browser logging settings (disabled by default to prevent Ngrok rate limiting)
    "browser_logging_enabled": False,      # Disabled by default to prevent Ngrok rate limiting
    "browser_logging_level": "error",      # Minimum log level: debug, info, warn, error
    "browser_logging_flush_interval": 300, # Flush interval in seconds (10-300) - 5 minutes default
    "browser_logging_buffer_size": 50,     # Maximum logs to buffer before flush (50-500)
    # Chord detection backend settings
    "chord_backend": "btc",                # Options: "btc", "madmom", "hybrid", "librosa" (DEFAULT: btc)
    "chords_use_btc": True,                # Use BTC Transformer (170 chord vocabulary, best accuracy)
    "chords_use_madmom": True,             # Fallback to madmom CRF for chord regeneration
    "chords_use_hybrid": True,             # Allow fallback hybrid detector
    # YouTube features (controlled per-user by admins)
    "enable_youtube_features": True        # Global switch - per-user access controlled via admin panel
}


def load_config():
    """Load configuration from config file or create default if not exists."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            print(f"Error loading config file. Using defaults.")
            return DEFAULT_SETTINGS.copy()
    else:
        # Create default config file
        save_config(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()


def save_config(config_data):
    """Save configuration to config file."""
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config_data, f, indent=4)
        return True
    except IOError:
        print(f"Error saving config file.")
        return False


# Load configuration
CONFIG = load_config()


def validate_and_fix_config_paths():
    """Validate and fix all paths in config on startup.

    This function:
    - Detects cross-platform path issues
    - Normalizes paths for current platform
    - Cleans up invalid directories
    - Updates config file with corrected paths

    Should be called once on application startup.
    """
    print("Validating configuration paths for current platform...")

    # Check and fix downloads directory
    downloads_dir = get_setting("downloads_directory", DOWNLOADS_DIR)
    original_path = downloads_dir

    # Normalize the path
    normalized_path = normalize_path_for_platform(downloads_dir)

    if normalized_path != original_path:
        print(f"Fixed downloads_directory path:")
        print(f"  From: {original_path}")
        print(f"  To:   {normalized_path}")
        update_setting("downloads_directory", normalized_path)

        # Clean up invalid directory if it exists
        if current_platform := platform.system() != "Windows":
            # Check if there's a directory with Windows path as literal name
            invalid_dir_patterns = [
                "C:\\Users",
                "C:\\",
            ]
            for pattern in invalid_dir_patterns:
                # Look in current directory for folders starting with these patterns
                try:
                    for item in os.listdir('.'):
                        if item.startswith(pattern):
                            invalid_path = os.path.join('.', item)
                            if os.path.isdir(invalid_path):
                                print(f"Found invalid directory with Windows path name: {item}")
                                print(f"Removing: {invalid_path}")
                                try:
                                    shutil.rmtree(invalid_path)
                                    print(f"Successfully removed invalid directory")
                                except Exception as e:
                                    print(f"Warning: Could not remove invalid directory: {e}")
                except Exception as e:
                    print(f"Error during directory cleanup: {e}")

    # Ensure the valid directory exists
    ensure_valid_downloads_directory()

    print("Configuration validation complete.")
    return True


def get_setting(key, default=None):
    """Get a setting value from config."""
    return CONFIG.get(key, default)


def update_setting(key, value):
    """Update a setting value and save config."""
    CONFIG[key] = value
    save_config(CONFIG)
    return True


def is_windows_absolute_path(path_str):
    """Check if a path string is a Windows-style absolute path (e.g., C:\\...).

    Args:
        path_str: Path string to check

    Returns:
        bool: True if it's a Windows absolute path
    """
    if not isinstance(path_str, str):
        return False
    # Check for Windows drive letter pattern (C:, D:, etc.)
    if len(path_str) >= 2 and path_str[1] == ':' and path_str[0].isalpha():
        return True
    return False


def normalize_path_for_platform(path_str):
    """Normalize a path string to work on the current platform.

    Handles cross-platform path issues:
    - Converts Windows absolute paths to relative paths when on Linux/Mac
    - Removes invalid characters from directory names
    - Ensures path is valid for current OS

    Args:
        path_str: Path string to normalize

    Returns:
        str: Normalized path string suitable for current platform
    """
    if not isinstance(path_str, str):
        return DOWNLOADS_DIR

    current_platform = platform.system()

    # If we're on Linux/Mac but have a Windows absolute path, convert to relative
    if current_platform != "Windows" and is_windows_absolute_path(path_str):
        print(f"Warning: Detected Windows absolute path on {current_platform}: {path_str}")
        print(f"Converting to platform-appropriate default: {DOWNLOADS_DIR}")
        return DOWNLOADS_DIR

    # If we're on Windows but have a Unix absolute path, convert
    if current_platform == "Windows" and path_str.startswith('/') and not is_windows_absolute_path(path_str):
        print(f"Warning: Detected Unix absolute path on Windows: {path_str}")
        print(f"Converting to platform-appropriate default: {DOWNLOADS_DIR}")
        return DOWNLOADS_DIR

    # If path is relative, make it absolute based on APP_DIR
    if not os.path.isabs(path_str):
        path_str = os.path.join(os.path.dirname(APP_DIR), path_str)

    return path_str


def ensure_valid_downloads_directory():
    """Ensures that the configured downloads directory is valid and accessible.

    If the configured directory is not valid or accessible, fall back to the default.
    Auto-detects and fixes cross-platform path issues.

    Returns:
        str: The valid downloads directory path
    """
    downloads_dir = get_setting("downloads_directory", DOWNLOADS_DIR)

    # Normalize the path for current platform
    downloads_dir = normalize_path_for_platform(downloads_dir)

    # Test if the directory exists or can be created
    try:
        os.makedirs(downloads_dir, exist_ok=True)
        # Try to write a small test file to verify permissions
        test_file_path = os.path.join(downloads_dir, ".write_test")
        with open(test_file_path, 'w') as f:
            f.write("test")
        os.remove(test_file_path)

        # If normalized path differs from config, update it
        configured_path = get_setting("downloads_directory", DOWNLOADS_DIR)
        if downloads_dir != configured_path:
            print(f"Updating downloads directory in config: {downloads_dir}")
            update_setting("downloads_directory", downloads_dir)

        return downloads_dir
    except (IOError, OSError, PermissionError) as e:
        print(f"Warning: Configured downloads directory is not accessible: {e}")
        print(f"Falling back to default downloads directory: {DOWNLOADS_DIR}")
        # Update the setting to the default
        update_setting("downloads_directory", DOWNLOADS_DIR)
        return DOWNLOADS_DIR


# FFmpeg path management
def get_ffmpeg_path():
    """Get FFmpeg executable path."""
    custom_path = get_setting("ffmpeg_path")
    if custom_path:
        # If custom path is a directory, append ffmpeg executable
        if os.path.isdir(custom_path):
            ffmpeg_path = os.path.join(custom_path, "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg")
            if os.path.exists(ffmpeg_path):
                return ffmpeg_path
        # If custom path points directly to executable
        elif os.path.isfile(custom_path):
            return custom_path

    # Use bundled ffmpeg if available
    if os.path.exists(FFMPEG_EXECUTABLE):
        return FFMPEG_EXECUTABLE

    # Default to system PATH
    return "ffmpeg"


def get_ffprobe_path():
    """Get FFprobe executable path."""
    custom_path = get_setting("ffmpeg_path")
    if custom_path:
        # If custom path is a directory, append ffprobe executable
        if os.path.isdir(custom_path):
            probe_path = os.path.join(custom_path, "ffprobe.exe" if platform.system() == "Windows" else "ffprobe")
            if os.path.exists(probe_path):
                return probe_path
        # If custom path points to ffmpeg executable, try to find ffprobe in same directory
        elif os.path.isfile(custom_path) and "ffmpeg" in os.path.basename(custom_path).lower():
            probe_path = os.path.join(os.path.dirname(custom_path), 
                                     "ffprobe.exe" if platform.system() == "Windows" else "ffprobe")
            if os.path.exists(probe_path):
                return probe_path
    
    # Use bundled ffprobe if available
    if os.path.exists(FFPROBE_EXECUTABLE):
        return FFPROBE_EXECUTABLE
    
    # Default to system PATH
    return "ffprobe"


def download_ffmpeg():
    """Download and set up FFmpeg if not already available.
    
    Returns:
        Tuple of (success, message)
    """
    # Check if FFmpeg is already available
    if os.path.exists(FFMPEG_EXECUTABLE) and os.path.exists(FFPROBE_EXECUTABLE):
        return True, "FFmpeg already installed"
    
    try:
        # Download FFmpeg based on platform
        if platform.system() == "Windows":
            ffmpeg_url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
            print(f"Downloading FFmpeg from {ffmpeg_url}...")
            
            # Download to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as temp_file:
                temp_path = temp_file.name
                
            urllib.request.urlretrieve(ffmpeg_url, temp_path)
            
            # Extract the zip file
            with zipfile.ZipFile(temp_path, 'r') as zip_ref:
                # Extract to a temporary directory first
                temp_extract_dir = tempfile.mkdtemp()
                zip_ref.extractall(temp_extract_dir)
                
                # Find the extracted directory (should be the only directory)
                extracted_dirs = [d for d in os.listdir(temp_extract_dir) if os.path.isdir(os.path.join(temp_extract_dir, d))]
                if not extracted_dirs:
                    return False, "Failed to extract FFmpeg"
                
                # Move contents to FFmpeg directory
                extracted_dir = os.path.join(temp_extract_dir, extracted_dirs[0])
                for item in os.listdir(extracted_dir):
                    src = os.path.join(extracted_dir, item)
                    dst = os.path.join(FFMPEG_DIR, item)
                    if os.path.exists(dst):
                        if os.path.isdir(dst):
                            shutil.rmtree(dst)
                        else:
                            os.remove(dst)
                    shutil.move(src, dst)
                
                # Clean up
                shutil.rmtree(temp_extract_dir)
                os.remove(temp_path)
            
            # Update settings
            update_setting("ffmpeg_path", os.path.join(FFMPEG_DIR, "bin"))
            
            return True, "FFmpeg downloaded and installed successfully"
        else:
            # For non-Windows platforms, suggest manual installation
            return False, "Automatic FFmpeg installation is only supported on Windows. Please install FFmpeg manually."
    
    except Exception as e:
        return False, f"Error downloading FFmpeg: {str(e)}"


def ensure_ffmpeg_available():
    """Ensure FFmpeg is available, downloading it if necessary.
    
    Returns:
        True if FFmpeg is available, False otherwise.
    """
    # 1. Check if FFmpeg is available in the system PATH
    try:
        import subprocess
        import shutil
        
        # Try to get FFmpeg path from system using 'where' command on Windows or 'which' on Unix
        if platform.system() == "Windows":
            result = subprocess.run(["where", "ffmpeg"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if result.returncode == 0 and result.stdout.strip():
                # Get the first path from the output (in case there are multiple)
                ffmpeg_system_path = result.stdout.strip().split('\n')[0].strip()
                
                # Get the directory containing ffmpeg.exe
                ffmpeg_dir = os.path.dirname(ffmpeg_system_path)
                
                # Verify ffprobe is also available in the same directory
                ffprobe_path = os.path.join(ffmpeg_dir, "ffprobe.exe")
                if os.path.exists(ffprobe_path):
                    # Update the config with the found path
                    update_setting("ffmpeg_path", ffmpeg_dir)
                    print(f"Found system FFmpeg at: {ffmpeg_dir}")
                    return True
        else:
            # For non-Windows platforms, use 'which'
            result = subprocess.run(["which", "ffmpeg"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if result.returncode == 0 and result.stdout.strip():
                ffmpeg_system_path = result.stdout.strip()
                ffmpeg_dir = os.path.dirname(ffmpeg_system_path)
                
                # Verify ffprobe is also available in the same directory
                ffprobe_path = os.path.join(ffmpeg_dir, "ffprobe")
                if os.path.exists(ffprobe_path):
                    # Update the config with the found path
                    update_setting("ffmpeg_path", ffmpeg_dir)
                    print(f"Found system FFmpeg at: {ffmpeg_dir}")
                    return True
    except Exception as e:
        print(f"Error checking system FFmpeg: {e}")
    
    # 2. Check if we have a bundled version in the application directory
    if os.path.exists(FFMPEG_EXECUTABLE) and os.path.exists(FFPROBE_EXECUTABLE):
        ffmpeg_dir = os.path.dirname(FFMPEG_EXECUTABLE)
        update_setting("ffmpeg_path", ffmpeg_dir)
        print(f"Using bundled FFmpeg at: {ffmpeg_dir}")
        return True
    
    # 3. Try to download FFmpeg
    print("FFmpeg not found in system or bundled. Attempting to download...")
    success, message = download_ffmpeg()
    print(message)
    return success


# Check for diffq availability
def check_diffq_available():
    """Check if diffq is available for advanced models."""
    try:
        import diffq
        return True
    except ImportError:
        return False

# Stem extraction models
STEM_MODELS = {
    "htdemucs": {
        "name": "HTDemucs (4 stems)",
        "stems": ["vocals", "drums", "bass", "other"],
        "path": os.path.join(MODELS_DIR, "htdemucs"),
        "url": "https://dl.fbaipublicfiles.com/demucs/v4_htdemucs.th",
        "description": "High quality 4-stem separation (vocals, drums, bass, other)",
        "requires_diffq": False,
        "compatible": True
    },
    "htdemucs_6s": {
        "name": "HTDemucs 6-stem",
        "stems": ["vocals", "drums", "bass", "guitar", "piano", "other"],
        "path": os.path.join(MODELS_DIR, "htdemucs_6s"),
        "url": "https://dl.fbaipublicfiles.com/demucs/v4_htdemucs_6s.th",
        "description": "6-stem separation (vocals, drums, bass, guitar, piano, other)",
        "requires_diffq": False,
        "compatible": True
    },
    "htdemucs_ft": {
        "name": "HTDemucs Fine-Tuned",
        "stems": ["vocals", "drums", "bass", "other"],
        "path": os.path.join(MODELS_DIR, "htdemucs_ft"),
        "url": "https://dl.fbaipublicfiles.com/demucs/v4_htdemucs_ft.th",
        "description": "Fine-tuned 4-stem separation with better quality",
        "requires_diffq": False,
        "compatible": True
    },
    "mdx_extra": {
        "name": "MDX Extra",
        "stems": ["vocals", "drums", "bass", "other"],
        "path": os.path.join(MODELS_DIR, "mdx_extra"),
        "url": "https://dl.fbaipublicfiles.com/demucs/mdx_final/mdx_extra.th",
        "description": "MDX model with enhanced vocal separation",
        "requires_diffq": False,
        "compatible": True
    },
    "mdx_extra_q": {
        "name": "MDX Extra Q (Requires diffq)",
        "stems": ["vocals", "drums", "bass", "other"],
        "path": os.path.join(MODELS_DIR, "mdx_extra_q"),
        "url": "https://dl.fbaipublicfiles.com/demucs/mdx_final/83fc094f-4a16d450.th",
        "description": "Optimized MDX model for superior quality (requires diffq package)",
        "requires_diffq": True,
        "compatible": check_diffq_available()
    }
}

def get_compatible_models():
    """Get only models that are compatible with current system."""
    compatible = {}
    for model_id, model_info in STEM_MODELS.items():
        if model_info.get("compatible", True):
            compatible[model_id] = model_info
    return compatible

def get_fallback_model():
    """Get a reliable fallback model that works on all systems."""
    return "htdemucs"
