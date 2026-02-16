#!/bin/bash
# StemTube Web startup script with cuDNN support for faster-whisper GPU acceleration

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Configure cuDNN library path for GPU support
VENV_SITE_PACKAGES="$SCRIPT_DIR/venv/lib/python3.12/site-packages"
CUDNN_LIB_PATH="$VENV_SITE_PACKAGES/nvidia/cudnn/lib"

if [ -d "$CUDNN_LIB_PATH" ]; then
    export LD_LIBRARY_PATH="$CUDNN_LIB_PATH:$LD_LIBRARY_PATH"
    echo "[STARTUP] Configured cuDNN library path: $CUDNN_LIB_PATH"
else
    echo "[STARTUP] Warning: cuDNN library not found at $CUDNN_LIB_PATH"
    echo "[STARTUP] faster-whisper will run in CPU mode"
fi

# Start the application (port configured in core/config.py)
echo "[STARTUP] Starting StemTube Web (port configured in core/config.py)"
exec ./venv/bin/python app.py
