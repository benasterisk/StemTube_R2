#!/usr/bin/env python3
"""
StemTube Unified Setup Script
Automatically detects platform, GPU availability, and installs appropriate dependencies.
Handles Windows, Linux, and macOS with CPU-only or GPU-accelerated PyTorch.
"""

import os
import sys
import platform
import subprocess
import importlib.util
import shutil
import logging
from datetime import datetime

# Global variable to track venv directory name
venv_dir_name = "venv"

CHORD_LIBRARY_REPO = "https://github.com/szaza/guitar-chords-db-json.git"
CHORD_LIBRARY_PATH = os.path.join("static", "js", "datas", "guitar-chords-db-json")

# Mapping for supported CUDA versions → PyTorch wheels + cuDNN packages
CUDA_COMPATIBILITY_MATRIX = [
    {
        "min_version": (13, 0),
        "pytorch_index": "https://download.pytorch.org/whl/cu124",
        "label": "CUDA 13.0+ (PyTorch cu124 - backward compatible)",
        "cudnn_package": "nvidia-cudnn-cu12",
    },
    {
        "min_version": (12, 4),
        "pytorch_index": "https://download.pytorch.org/whl/cu124",
        "label": "CUDA 12.4+ (PyTorch cu124)",
        "cudnn_package": "nvidia-cudnn-cu12",
    },
    {
        "min_version": (12, 0),
        "pytorch_index": "https://download.pytorch.org/whl/cu121",
        "label": "CUDA 12.0-12.3 (PyTorch cu121)",
        "cudnn_package": "nvidia-cudnn-cu12",
    },
    {
        "min_version": (11, 8),
        "pytorch_index": "https://download.pytorch.org/whl/cu118",
        "label": "CUDA 11.8+ (PyTorch cu118)",
        "cudnn_package": "nvidia-cudnn-cu11",
    },
    {
        "min_version": (11, 0),
        "pytorch_index": "https://download.pytorch.org/whl/cu117",
        "label": "CUDA 11.0-11.7 (PyTorch cu117)",
        "cudnn_package": "nvidia-cudnn-cu11",
    },
]

# Used when we detect a GPU but nvidia-smi cannot report the CUDA version
DEFAULT_CUDA_CONFIG = {
    "pytorch_index": "https://download.pytorch.org/whl/cu118",
    "label": "Fallback CUDA 11.8 wheels",
    "cudnn_package": "nvidia-cudnn-cu11",
}

# Setup logging
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, f"setup_dependencies_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

# Configure logging to both file and console
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(asctime)s] %(levelname)-8s %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Log startup
logger.info("="*80)
logger.info("StemTube Setup Dependencies - Starting installation")
logger.info(f"Log file: {LOG_FILE}")
logger.info(f"Platform: {platform.system()}")
logger.info(f"Python: {sys.version}")
logger.info("="*80)

def get_platform():
    """Get normalized platform name."""
    system = platform.system().lower()
    if system == "windows":
        return "windows"
    elif system == "linux":
        return "linux"
    elif system == "darwin":
        return "macos"
    else:
        return "unknown"

def check_nvidia_gpu():
    """Check if NVIDIA GPU is available."""
    try:
        result = subprocess.run(['nvidia-smi'],
                              capture_output=True,
                              text=True,
                              timeout=10)
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
        return False

def detect_cuda_version():
    """
    Detect CUDA version from nvidia-smi output.

    Returns:
        dict with keys (major, minor, raw) or None if not detected.
    """

    def _parse_version(version_str):
        cleaned = (version_str or "").replace('|', '').strip()
        cleaned = cleaned.replace('CUDA Version', '').replace(':', '').strip()
        if not cleaned:
            return None
        try:
            parts = cleaned.split('.')
            major = int(parts[0])
            minor = int(parts[1]) if len(parts) > 1 else 0
            return {
                'major': major,
                'minor': minor,
                'raw': cleaned
            }
        except ValueError:
            return None

    try:
        # Try structured query first (supported on most modern drivers)
        query_cmd = ['nvidia-smi', '--query-gpu=cuda_version', '--format=csv,noheader']
        result = subprocess.run(query_cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parsed = _parse_version(line)
                if parsed:
                    return parsed
    except Exception:
        # Fallback to legacy parsing below
        pass

    try:
        result = subprocess.run(['nvidia-smi'], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if 'CUDA Version' in line:
                    parsed = _parse_version(line.split('CUDA Version', 1)[1])
                    if parsed:
                        return parsed
        return None
    except Exception as e:
        logger.info(f"[WARNING] Could not detect CUDA version: {e}")
        return None

def select_cuda_config(cuda_info):
    """
    Match detected CUDA version to the closest supported PyTorch/cuDNN build.
    """
    if not cuda_info:
        return None

    version_tuple = (cuda_info.get('major', 0), cuda_info.get('minor', 0))
    for config in CUDA_COMPATIBILITY_MATRIX:
        if version_tuple >= config['min_version']:
            return config
    return None

def check_visual_cpp_redistributable():
    """Check if Visual C++ Redistributable is installed on Windows."""
    if get_platform() != "windows":
        return True

    try:
        import ctypes
        # Try to load vcruntime140.dll which requires VC++ Redistributable
        ctypes.cdll.LoadLibrary("vcruntime140.dll")
        return True
    except OSError:
        return False

def check_existing_pytorch():
    """Check if PyTorch is already installed and get version info."""
    try:
        import torch
        return {
            'installed': True,
            'version': torch.__version__,
            'cuda_available': torch.cuda.is_available(),
            'cuda_version': torch.version.cuda if torch.cuda.is_available() else None
        }
    except ImportError:
        return {'installed': False}

def install_pytorch(platform_name, has_gpu, force_cpu=False, cuda_config=None):
    """Install appropriate PyTorch version based on platform and GPU availability."""

    if force_cpu or not has_gpu:
        logger.info("Installing CPU-only PyTorch...")
        cmd = [
            sys.executable, "-m", "pip", "install",
            "torch", "torchaudio",
            "--index-url", "https://download.pytorch.org/whl/cpu"
        ]
    else:
        target_config = cuda_config or DEFAULT_CUDA_CONFIG
        pytorch_index = target_config["pytorch_index"]
        label = target_config.get("label", "CUDA wheels")

        if platform_name == "windows":
            logger.info(f"Installing CUDA-enabled PyTorch for Windows ({label})...")
        elif platform_name == "linux":
            logger.info(f"Installing CUDA-enabled PyTorch for Linux ({label})...")
        else:
            logger.info("Installing standard PyTorch for macOS...")
            cmd = [sys.executable, "-m", "pip", "install", "torch", "torchaudio"]
            try:
                subprocess.run(cmd, check=True)
                return True
            except subprocess.CalledProcessError as e:
                logger.info(f"[ERROR] Failed to install PyTorch: {e}")
                return False

        cmd = [
            sys.executable, "-m", "pip", "install",
            "torch", "torchaudio",
            "--index-url", pytorch_index
        ]

    try:
        subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.info(f"[ERROR] Failed to install PyTorch: {e}")
        return False

def install_requirements(venv_python):
    """Install essential dependencies (excluding problematic packages from requirements.txt)."""
    logger.info("\n[INSTALLING] Essential dependencies...")

    # List of essential packages to install
    # These are carefully selected to avoid dependency conflicts with PyTorch CUDA versions
    essential_packages = [
        "aiotube",              # YouTube search
        "beautifulsoup4",       # HTML parsing
        "Flask",                # Web framework
        "Flask-Login",          # Session management
        "Flask-Session",        # Session storage
        "Flask-SocketIO",       # WebSocket support
        "eventlet",             # Concurrent networking
        "requests",             # HTTP library
        "python-dotenv",        # Environment variables
        "Pillow",               # Image processing
        "librosa",              # Audio analysis
        "soundfile",            # Audio I/O
        "scipy",                # Scientific computing
        "scikit-learn",         # Machine learning
        "yt-dlp",               # YouTube downloader
        "yt-dlp-ejs",           # YouTube JS challenge solver (required since late 2025)
        "faster-whisper",       # Speech recognition (GPU)
        "msaf",                 # Music structure analysis
        "syncedlyrics",         # Synchronized lyrics (Musixmatch)
        "pychord",              # Chord notation
    ]

    logger.info(f"Installing {len(essential_packages)} essential packages...")

    success_count = 0
    failed_packages = []

    for pkg in essential_packages:
        try:
            subprocess.run(
                [venv_python, "-m", "pip", "install", pkg],
                check=True,
                capture_output=True,
                text=True,
                timeout=300
            )
            success_count += 1
            logger.info(f"✓ Installed: {pkg}")
        except subprocess.CalledProcessError as e:
            failed_packages.append(pkg)
            logger.info(f"⚠️  Warning: Failed to install {pkg}")
        except subprocess.TimeoutExpired:
            failed_packages.append(pkg)
            logger.info(f"⚠️  Warning: Installation of {pkg} timed out")

    logger.info(f"\n[SUCCESS] Installed {success_count}/{len(essential_packages)} essential packages")

    if failed_packages:
        logger.info(f"[WARNING] Failed to install: {', '.join(failed_packages)}")
        logger.info("[INFO] Core functionality may still work despite these failures")
        return success_count >= len(essential_packages) * 0.8  # Allow 80% success rate

    return True

def create_virtual_environment():
    """Create a new virtual environment."""
    logger.info("Creating virtual environment...")

    # Remove existing venv if it exists
    if os.path.exists("venv"):
        logger.info("Removing existing virtual environment...")
        try:
            # Try multiple methods to remove the directory on Windows
            if get_platform() == "windows":
                try:
                    # Method 1: Regular removal
                    shutil.rmtree("venv")
                except Exception:
                    try:
                        # Method 2: Use Windows commands
                        subprocess.run(["rd", "/s", "/q", "venv"], shell=True, check=False)
                    except Exception:
                        # Method 3: Rename and try again
                        try:
                            os.rename("venv", "venv_old")
                            shutil.rmtree("venv_old")
                        except Exception as e:
                            logger.info(f"[WARNING] Could not fully remove venv: {e}")
                            logger.info("[INFO] Will try to create new venv anyway...")
            else:
                shutil.rmtree("venv")
        except Exception as e:
            logger.info(f"[WARNING] Could not remove existing venv: {e}")
            logger.info("[INFO] Will try to create new venv anyway...")

    try:
        # Use the system Python, not any existing venv Python
        python_exe = sys.executable
        # Make sure we're not using a venv python
        if "venv" in python_exe or "Scripts" in python_exe:
            # Try to find system python
            python_exe = "python"

        # Try creating with different name if venv still exists
        venv_name = "venv"
        if os.path.exists("venv"):
            venv_name = "venv_new"
            logger.info(f"[INFO] Using alternate name: {venv_name}")

        subprocess.run([python_exe, "-m", "venv", venv_name], check=True)

        # If we used alternate name, try to rename it
        if venv_name == "venv_new":
            try:
                if os.path.exists("venv"):
                    shutil.rmtree("venv")
                os.rename("venv_new", "venv")
            except Exception:
                logger.info("[WARNING] Using alternate venv directory name")
                # Update the global venv name for the rest of the script
                global venv_dir_name
                venv_dir_name = "venv_new"

        return True
    except subprocess.CalledProcessError as e:
        logger.info(f"[ERROR] Failed to create virtual environment: {e}")
        return False

def get_venv_python():
    """Get the path to the Python executable in the virtual environment."""
    global venv_dir_name
    platform_name = get_platform()
    if platform_name == "windows":
        return os.path.join(venv_dir_name, "Scripts", "python.exe")
    else:
        return os.path.join(venv_dir_name, "bin", "python")

def apply_madmom_patch(venv_python):
    """Apply numpy compatibility patch for madmom library."""
    logger.info("\n[PATCHING] Applying madmom numpy compatibility patch...")
    try:
        # Call patch_madmom.py using venv python
        result = subprocess.run([venv_python, "patch_madmom.py"],
                              capture_output=True, text=True, timeout=120)
        if result.returncode == 0:
            logger.info("[SUCCESS] Madmom compatibility patch applied successfully")
            return True
        else:
            stderr = result.stderr if result.stderr else "Unknown error"
            logger.info(f"[WARNING] Madmom patch encountered issues:")
            logger.info(f"  {stderr[:300]}")
            logger.info("[INFO] madmom may still work, but chord detection might have issues")
            return False
    except FileNotFoundError:
        logger.info("[WARNING] patch_madmom.py not found - skipping patch")
        logger.info("[INFO] Run 'python patch_madmom.py' manually if needed")
        return False
    except subprocess.TimeoutExpired:
        logger.info("[WARNING] Madmom patch timed out - skipping")
        return False
    except Exception as e:
        logger.info(f"[WARNING] Could not apply madmom patch: {e}")
        return False

def install_faster_whisper_gpu(venv_python, has_gpu, cuda_config=None):
    """Install faster-whisper with GPU support (cuDNN) if GPU is available."""
    if not has_gpu:
        logger.info("[INFO] No GPU detected - faster-whisper will use CPU mode")
        return True

    logger.info("[INSTALLING] faster-whisper GPU dependencies (cuDNN)...")

    try:
        # Use selected CUDA profile when available
        target_config = cuda_config or DEFAULT_CUDA_CONFIG
        cudnn_package = target_config.get("cudnn_package", "nvidia-cudnn-cu11")
        logger.info(f"[INFO] Installing {cudnn_package} ({target_config.get('label', 'CUDA fallback')})")

        # Install the appropriate cuDNN package
        # This is required for faster-whisper to use GPU via ctranslate2
        cmd = [venv_python, "-m", "pip", "install", cudnn_package]
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0:
            logger.info(f"[SUCCESS] Installed {cudnn_package} for faster-whisper GPU support")
            return True
        else:
            logger.info(f"[WARNING] Could not install {cudnn_package}: {result.stderr}")
            logger.info("[INFO] faster-whisper will work in CPU mode")
            return True  # Not a critical failure

    except subprocess.CalledProcessError as e:
        logger.info(f"[WARNING] Failed to install cuDNN: {e}")
        logger.info("[INFO] faster-whisper will work in CPU mode")
        return True  # Not a critical failure

def activate_venv_and_install():
    """Activate virtual environment and install dependencies."""
    venv_python = get_venv_python()

    if not os.path.exists(venv_python):
        logger.info("[ERROR] Virtual environment Python not found!")
        return False

    logger.info(f"Using virtual environment Python: {venv_python}")

    # Set the Python executable to use the venv one
    original_executable = sys.executable
    sys.executable = venv_python

    try:
        # Upgrade pip first
        subprocess.run([venv_python, "-m", "pip", "install", "--upgrade", "pip"], check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.info(f"[ERROR] Failed to upgrade pip: {e}")
        return False
    finally:
        sys.executable = original_executable

def install_build_dependencies(venv_python):
    """Install build dependencies required by madmom and other packages with C extensions."""
    logger.info("\n[INSTALLING] Build dependencies (Cython, numpy)...")

    build_deps = [
        "Cython",           # Required for madmom to compile C extensions
        "numpy==1.26.4",    # CRITICAL: madmom 0.16.1 incompatible with numpy 2.x
    ]

    for dep in build_deps:
        try:
            logger.info(f"Installing {dep}...")
            subprocess.run(
                [venv_python, "-m", "pip", "install", dep],
                check=True,
                capture_output=True,
                text=True
            )
            logger.info(f"✓ Installed: {dep}")
        except subprocess.CalledProcessError as e:
            logger.info(f"[ERROR] Failed to install {dep}: {e}")
            return False

    # Install madmom explicitly here while Cython is available in the environment
    # This prevents pip from creating an isolated build environment that lacks Cython
    logger.info("\nInstalling madmom (requires Cython)...")
    try:
        subprocess.run(
            [venv_python, "-m", "pip", "install", "--no-build-isolation", "madmom==0.16.1"],
            check=True,
            capture_output=True,
            text=True,
            timeout=600  # madmom compilation can be slow
        )
        logger.info("✓ Installed: madmom==0.16.1")
    except subprocess.TimeoutExpired:
        logger.info("[WARNING] madmom installation timed out - it may still be installing")
    except subprocess.CalledProcessError as e:
        logger.info(f"[ERROR] Failed to install madmom: {e}")
        logger.info("[WARNING] Madmom may not be available - chord detection will not work")
        # Don't return False here - other dependencies can still be installed

    # Install demucs here after PyTorch (removed from requirements.txt to avoid conflicts)
    logger.info("\nInstalling demucs (stem extraction)...")
    try:
        subprocess.run(
            [venv_python, "-m", "pip", "install", "demucs==4.0.1"],
            check=True,
            capture_output=True,
            text=True,
            timeout=300
        )
        logger.info("✓ Installed: demucs==4.0.1")
    except subprocess.CalledProcessError as e:
        logger.info(f"[WARNING] Failed to install demucs: {e}")
        logger.info("[WARNING] Stem extraction may not work")
        # Don't return False - other dependencies can still be installed

    logger.info("[SUCCESS] Build dependencies installed")
    return True


def ensure_chord_library():
    """Clone guitar chord JSON library if it is missing."""
    target = os.path.abspath(CHORD_LIBRARY_PATH)
    if os.path.isdir(target) and os.listdir(target):
        logger.info(f"[MOBILE] Guitar chord library already present at {target}")
        return True

    logger.info(f"[MOBILE] Fetching guitar chord diagrams from {CHORD_LIBRARY_REPO}...")
    os.makedirs(os.path.dirname(target), exist_ok=True)

    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", CHORD_LIBRARY_REPO, target],
            check=True,
            capture_output=True,
            text=True,
            timeout=120
        )
        logger.info("[MOBILE] Guitar chord library downloaded")
        return True
    except subprocess.CalledProcessError as e:
        logger.info(f"[WARNING] Unable to clone chord library: {e}")
        return False


def check_nodejs_runtime():
    """
    Check that Node.js is installed (required by yt-dlp for JavaScript challenge solving).
    Node.js 20+ is needed. On Linux/macOS it is expected to be installed via system package manager.
    """
    logger.info("\n[CHECKING] Node.js runtime...")

    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            logger.info(f"[SUCCESS] Node.js found: {version}")
            return True
    except FileNotFoundError:
        pass
    except Exception:
        pass

    logger.info("[WARNING] Node.js is not installed.")
    platform_name = get_platform()
    if platform_name == "linux":
        logger.info("[INFO] Install it with: sudo apt-get install -y nodejs")
    elif platform_name == "macos":
        logger.info("[INFO] Install it with: brew install node")
    elif platform_name == "windows":
        logger.info("[INFO] Install it from: https://nodejs.org/")
    logger.info("[INFO] Node.js 20+ is required for full functionality.")
    return False


def preload_whisper_large(venv_python, use_gpu):
    """Pre-download the faster-whisper model best suited for the host."""
    target_model = "large-v3"
    device = "cuda" if use_gpu else "cpu"
    compute_type = "float16" if use_gpu else "int8"
    logger.info(f"[LYRICS] Preloading faster-whisper {target_model} ({device}, {compute_type})...")
    preload_code = f"""
from faster_whisper import WhisperModel
WhisperModel('{target_model}', device='{device}', compute_type='{compute_type}')
print('Whisper {target_model} cached on {device} ({compute_type})')
"""
    try:
        subprocess.run(
            [venv_python, "-c", preload_code],
            check=True,
            capture_output=True,
            text=True,
            timeout=600
        )
        logger.info("[LYRICS] Whisper large-v3 cache ready")
        return True
    except subprocess.TimeoutExpired:
        logger.info("[WARNING] Whisper model download timed out (will lazy-load on first use)")
    except subprocess.CalledProcessError as e:
        logger.info(f"[WARNING] Could not pre-download Whisper model: {e}")
    return False

def main():
    """Main setup function."""
    logger.info("StemTube Unified Setup Script")
    logger.info("=" * 50)

    # Platform detection
    platform_name = get_platform()
    logger.info(f"Platform: {platform.system()} {platform.release()} ({platform_name})")
    logger.info(f"Python: {sys.version}")

    # Create virtual environment
    if not create_virtual_environment():
        return False

    # Activate virtual environment
    if not activate_venv_and_install():
        return False

    venv_python = get_venv_python()

    # GPU detection
    has_nvidia = check_nvidia_gpu()
    logger.info(f"NVIDIA GPU: {'[DETECTED]' if has_nvidia else '[NOT DETECTED]'}")

    cuda_info = detect_cuda_version() if has_nvidia else None
    cuda_config = None

    if has_nvidia:
        if cuda_info:
            logger.info(f"CUDA Version (nvidia-smi): {cuda_info['raw']}")
            cuda_config = select_cuda_config(cuda_info)
            if cuda_config:
                logger.info(f"[INFO] Selected CUDA profile: {cuda_config['label']}")
            else:
                logger.info("[WARNING] CUDA version is outside supported range for automatic GPU setup")
        else:
            logger.info("[WARNING] Unable to determine CUDA version automatically - using fallback CUDA profile")
            cuda_config = DEFAULT_CUDA_CONFIG

    # Windows-specific checks
    install_gpu_pytorch = False
    if platform_name == "windows":
        has_vcredist = check_visual_cpp_redistributable()
        logger.info(f"Visual C++ Redistributable: {'[AVAILABLE]' if has_vcredist else '[MISSING]'}")

        if not has_vcredist:
            logger.info("\n" + "="*60)
            logger.info("[IMPORTANT] Visual C++ Redistributable Required for PyTorch on Windows")
            logger.info("="*60)
            logger.info("Modern PyTorch versions (including CPU-only) on Windows require:")
            logger.info("  Microsoft Visual C++ Redistributable (x64)")
            logger.info("  Download: https://aka.ms/vs/16/release/vc_redist.x64.exe")
            logger.info("\nPlease install it manually, then run this script again.")
            logger.info("Without it, PyTorch will fail to import even in CPU-only mode.")
            logger.info("="*60)
            logger.info("\nExiting setup. Please install VC++ Redistributable first.")
            return False
        else:
            if has_nvidia and cuda_config:
                install_gpu_pytorch = True
                logger.info("[INFO] NVIDIA GPU detected - will install CUDA PyTorch")
            elif has_nvidia and not cuda_config:
                logger.info("[WARNING] NVIDIA GPU present but CUDA version is unsupported - CPU PyTorch will be installed")
            else:
                logger.info("[INFO] No NVIDIA GPU detected - will install CPU-only PyTorch")
    elif has_nvidia and platform_name in ["linux", "macos"] and cuda_config:
        install_gpu_pytorch = True
    elif has_nvidia and not cuda_config:
        logger.info("[WARNING] GPU detected but CUDA version is unsupported - using CPU-only PyTorch")

    # Install PyTorch
    logger.info(f"\n[INSTALLING] PyTorch ({'GPU-enabled' if install_gpu_pytorch else 'CPU-only'})...")
    pytorch_success = False

    try:
        # Use venv python for PyTorch installation
        original_executable = sys.executable
        sys.executable = venv_python

        pytorch_success = install_pytorch(platform_name, install_gpu_pytorch, cuda_config=cuda_config)

        if not pytorch_success and install_gpu_pytorch:
            logger.info("[FALLBACK] GPU installation failed, trying CPU-only...")
            pytorch_success = install_pytorch(platform_name, False, force_cpu=True)

    finally:
        sys.executable = original_executable

    if not pytorch_success:
        logger.info("[ERROR] Failed to install PyTorch!")
        return False

    # Install faster-whisper GPU dependencies if GPU available
    logger.info("\n[CHECKING] faster-whisper GPU support...")
    install_faster_whisper_gpu(venv_python, install_gpu_pytorch, cuda_config=cuda_config)

    # Install build dependencies BEFORE other requirements (madmom needs Cython)
    if not install_build_dependencies(venv_python):
        logger.info("[ERROR] Failed to install build dependencies!")
        return False

    # Install other requirements using venv python
    logger.info("\n[INSTALLING] Other dependencies...")
    if not install_requirements(venv_python):
        logger.info("[ERROR] Failed to install some dependencies!")
        return False

    # Apply madmom numpy compatibility patch (required for chord detection)
    apply_madmom_patch(venv_python)

    # Check Node.js runtime (required for yt-dlp JS challenge solving)
    check_nodejs_runtime()

    # Ensure mobile chord diagrams + lyrics workflow assets are ready
    if not ensure_chord_library():
        logger.info("[WARNING] Mobile chord diagrams will be missing unless the library is cloned manually.")
    preload_whisper_large(venv_python, install_gpu_pytorch)

    logger.info("\n[SUCCESS] Setup complete!")
    logger.info("\n" + "="*60)
    logger.info("NEXT STEPS:")
    logger.info("="*60)

    if platform_name == "windows":
        logger.info("   venv\\Scripts\\activate")
        logger.info("   python app.py")
    else:
        logger.info("   source venv/bin/activate")
        logger.info("   python app.py")

    logger.info("="*60)
    logger.info("\n✅ All dependencies have been installed.")
    logger.info("✅ PyTorch, cuDNN, and faster-whisper are configured for your system.")
    logger.info("✅ Node.js runtime checked for JS challenge support.")
    if install_gpu_pytorch:
        logger.info("✅ GPU acceleration is AUTOMATIC (sitecustomize.py configured).")
        logger.info("   → No wrapper scripts needed!")
        logger.info("   → LD_LIBRARY_PATH is configured automatically on Python startup.")
    else:
        logger.info("ℹ️  CPU-only mode (no NVIDIA GPU detected).")
    logger.info("\nNote: If chord detection seems slow or unavailable, madmom may have compilation issues.")

    # Final verification
    logger.info("\n[VERIFICATION] Checking installation...")
    try:
        # Test PyTorch with venv python
        result = subprocess.run([
            venv_python, "-c",
            "import torch; print(f'PyTorch {torch.__version__}'); print(f'CUDA: {torch.cuda.is_available()}')"
        ], capture_output=True, text=True, timeout=30)

        if result.returncode == 0:
            logger.info("[SUCCESS] PyTorch verification:")
            for line in result.stdout.strip().split('\n'):
                logger.info(f"   {line}")
        else:
            logger.info(f"[ERROR] PyTorch verification failed: {result.stderr}")

    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
        logger.info(f"[ERROR] Verification failed: {e}")
        if platform_name == "windows":
            logger.info("[INFO] If you see DLL errors, you may need Visual C++ Redistributable")

    # Test faster-whisper
    try:
        logger.info("\n[VERIFICATION] Checking faster-whisper...")
        test_code = """
import sys
try:
    from faster_whisper import WhisperModel
    print('faster-whisper: OK')
    try:
        m = WhisperModel('tiny', device='cuda')
        print('GPU mode: Available')
    except Exception as e:
        print('GPU mode: Not available (will use CPU)')
except Exception as e:
    print(f'Error: {e}')
    sys.exit(1)
"""
        result = subprocess.run([venv_python, "-c", test_code],
                              capture_output=True, text=True, timeout=30)

        if result.returncode == 0:
            logger.info("[SUCCESS] faster-whisper verification:")
            for line in result.stdout.strip().split('\n'):
                logger.info(f"   {line}")
        else:
            logger.info(f"[WARNING] faster-whisper check: {result.stderr}")

    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
        logger.info(f"[WARNING] faster-whisper verification skipped: {e}")

    # Create sitecustomize.py for automatic LD_LIBRARY_PATH configuration
    if install_gpu_pytorch:
        create_sitecustomize_for_gpu(venv_python)

    return True

def create_sitecustomize_for_gpu(venv_python):
    """
    Create sitecustomize.py in venv's site-packages to configure LD_LIBRARY_PATH
    automatically when Python starts. This is the official Python mechanism for
    environment-wide setup and runs BEFORE any user imports.

    This eliminates the need for wrapper scripts - users just activate venv and run app.py.
    """
    logger.info("\n[SETUP] Configuring automatic GPU library path setup...")

    try:
        # Get site-packages directory
        result = subprocess.run(
            [venv_python, "-c", "import site; print(site.getsitepackages()[0])"],
            capture_output=True,
            text=True,
            check=True
        )
        site_packages_dir = result.stdout.strip()

        sitecustomize_path = os.path.join(site_packages_dir, 'sitecustomize.py')

        sitecustomize_content = '''"""
StemTube GPU Configuration - Auto-loaded by Python on startup.

This file configures LD_LIBRARY_PATH to include ALL NVIDIA CUDA libraries
from the venv BEFORE any imports occur. This is critical for faster-whisper
GPU acceleration (via ctranslate2) and PyTorch to work correctly.

See: https://docs.python.org/3/library/site.html#module-sitecustomize
"""
import os
import sys

def setup_gpu_libraries():
    """Configure LD_LIBRARY_PATH for ALL NVIDIA CUDA libraries from venv."""
    try:
        # Get site-packages directory
        import site
        site_packages = site.getsitepackages()[0]

        # Find ALL NVIDIA CUDA library directories
        nvidia_base = os.path.join(site_packages, 'nvidia')

        if os.path.exists(nvidia_base):
            cuda_lib_paths = []

            # Iterate through all NVIDIA packages and collect lib directories
            for package_name in os.listdir(nvidia_base):
                lib_dir = os.path.join(nvidia_base, package_name, 'lib')
                if os.path.isdir(lib_dir):
                    cuda_lib_paths.append(lib_dir)

            if cuda_lib_paths:
                current_ld_path = os.environ.get('LD_LIBRARY_PATH', '')

                # Build new LD_LIBRARY_PATH with all CUDA libs
                new_paths = ':'.join(cuda_lib_paths)

                # Only modify if not already configured
                if not any(path in current_ld_path for path in cuda_lib_paths):
                    # Prepend CUDA paths so they're checked first
                    if current_ld_path:
                        new_ld_path = f"{new_paths}:{current_ld_path}"
                    else:
                        new_ld_path = new_paths

                    os.environ['LD_LIBRARY_PATH'] = new_ld_path

                    # Re-exec Python with the new environment variable
                    # This is necessary because LD_LIBRARY_PATH must be set BEFORE
                    # the dynamic linker loads any libraries
                    if not os.environ.get('_STEMTUBE_GPU_CONFIGURED'):
                        os.environ['_STEMTUBE_GPU_CONFIGURED'] = '1'
                        os.execv(sys.executable, [sys.executable] + sys.argv)

    except Exception as e:
        # Silently fail - GPU just won't work, but app will still run
        pass

# Run configuration on module import (happens automatically at Python startup)
setup_gpu_libraries()
'''

        with open(sitecustomize_path, 'w') as f:
            f.write(sitecustomize_content)

        logger.info(f"[SUCCESS] Created sitecustomize.py in: {site_packages_dir}")
        logger.info("   GPU libraries will be configured automatically on Python startup")
        logger.info("   No wrapper scripts needed - just activate venv and run app.py")

    except Exception as e:
        logger.info(f"[WARNING] Could not create sitecustomize.py: {e}")
        logger.info("   GPU may not work correctly - you may need to set LD_LIBRARY_PATH manually")

if __name__ == "__main__":
    success = main()

    # Log completion
    logger.info("="*80)
    if success:
        logger.info("Setup completed successfully!")
        logger.info(f"Full installation log saved to: {LOG_FILE}")
    else:
        logger.info("Setup failed! Check the log file for details.")
        logger.info(f"Log file: {LOG_FILE}")
    logger.info("="*80)

    if not success:
        sys.exit(1)
