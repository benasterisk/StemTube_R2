#!/bin/bash
# StemTube Web startup script with cuDNN support for faster-whisper GPU acceleration

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Configure CUDA library paths for GPU support
VENV_SITE_PACKAGES="$SCRIPT_DIR/venv/lib/python3.12/site-packages"
NVIDIA_BASE="$VENV_SITE_PACKAGES/nvidia"

# Find and add all NVIDIA CUDA library paths
if [ -d "$NVIDIA_BASE" ]; then
    CUDA_LIB_PATHS=""
    for package_dir in "$NVIDIA_BASE"/*; do
        if [ -d "$package_dir/lib" ]; then
            CUDA_LIB_PATHS="$package_dir/lib:$CUDA_LIB_PATHS"
        fi
    done

    if [ -n "$CUDA_LIB_PATHS" ]; then
        export LD_LIBRARY_PATH="$CUDA_LIB_PATHS:$LD_LIBRARY_PATH"
        echo "[STARTUP] Configured CUDA library paths from nvidia packages"
    else
        echo "[STARTUP] Warning: No NVIDIA CUDA libraries found in venv"
        echo "[STARTUP] faster-whisper will run in CPU mode"
    fi
else
    echo "[STARTUP] Warning: NVIDIA packages not found at $NVIDIA_BASE"
    echo "[STARTUP] faster-whisper will run in CPU mode"
fi

# Start the application (port configured in core/config.py)
echo "[STARTUP] Starting StemTube Web (port configured in core/config.py)"
exec ./venv/bin/python app.py
