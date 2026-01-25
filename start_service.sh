#!/bin/bash

# StemTube Service Startup Script
# Launches both Flask application and ngrok tunnel

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Project root is the script directory itself
PROJECT_ROOT="$SCRIPT_DIR"
cd "$PROJECT_ROOT"

# Log file location
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"
APP_LOG="$LOG_DIR/stemtube_app.log"
NGROK_LOG="$LOG_DIR/stemtube_ngrok.log"

echo "[$(date)] Starting StemTube service..." | tee -a "$APP_LOG"

# ============================================================================
# SECURITY: Verify .env configuration (MANDATORY)
# ============================================================================
echo "[$(date)] Checking security configuration..." | tee -a "$APP_LOG"

if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "[$(date)] ================================" | tee -a "$APP_LOG"
    echo "[$(date)] ERROR: .env file not found!" | tee -a "$APP_LOG"
    echo "[$(date)] ================================" | tee -a "$APP_LOG"
    echo "[$(date)]" | tee -a "$APP_LOG"
    echo "[$(date)] StemTube requires secure configuration via .env file." | tee -a "$APP_LOG"
    echo "[$(date)]" | tee -a "$APP_LOG"
    echo "[$(date)] Quick setup:" | tee -a "$APP_LOG"
    echo "[$(date)]   cd $PROJECT_ROOT" | tee -a "$APP_LOG"
    echo "[$(date)]   cp .env.example .env" | tee -a "$APP_LOG"
    echo "[$(date)]   python -c \"import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))\" >> .env" | tee -a "$APP_LOG"
    echo "[$(date)]   chmod 600 .env" | tee -a "$APP_LOG"
    echo "[$(date)]" | tee -a "$APP_LOG"
    echo "[$(date)] See SECURITY_NOTICE.md for details" | tee -a "$APP_LOG"
    echo "[$(date)] ================================" | tee -a "$APP_LOG"
    exit 1
fi

# Load environment variables from .env
echo "[$(date)] Loading environment variables from .env..." | tee -a "$APP_LOG"
set -a  # Export all variables
source "$PROJECT_ROOT/.env"
set +a  # Stop exporting

# Verify required variables
if [ -z "$FLASK_SECRET_KEY" ]; then
    echo "[$(date)] ================================" | tee -a "$APP_LOG"
    echo "[$(date)] ERROR: FLASK_SECRET_KEY not set in .env!" | tee -a "$APP_LOG"
    echo "[$(date)] ================================" | tee -a "$APP_LOG"
    echo "[$(date)]" | tee -a "$APP_LOG"
    echo "[$(date)] Add this to your .env file:" | tee -a "$APP_LOG"
    echo "[$(date)]   python -c \"import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))\" >> .env" | tee -a "$APP_LOG"
    echo "[$(date)] ================================" | tee -a "$APP_LOG"
    exit 1
fi

echo "[$(date)] Security configuration verified ✓" | tee -a "$APP_LOG"
echo "[$(date)] - FLASK_SECRET_KEY: Set (${#FLASK_SECRET_KEY} characters)" | tee -a "$APP_LOG"
if [ -n "$NGROK_URL" ]; then
    echo "[$(date)] - NGROK_URL: $NGROK_URL" | tee -a "$APP_LOG"
else
    echo "[$(date)] - NGROK_URL: Not set (will use random URL)" | tee -a "$APP_LOG"
fi

# Configure GPU library paths for faster-whisper and ctranslate2
VENV_SITE_PACKAGES="$PROJECT_ROOT/venv/lib/python3.12/site-packages"
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
        echo "[$(date)] Configured CUDA library paths from nvidia packages" | tee -a "$APP_LOG"
        # List the configured paths for debugging
        echo "$CUDA_LIB_PATHS" | tr ':' '\n' | grep -v '^$' | while read path; do
            package_name=$(basename $(dirname "$path"))
            echo "[$(date)]   - $package_name" | tee -a "$APP_LOG"
        done
    else
        echo "[$(date)] Warning: No NVIDIA CUDA libraries found in venv" | tee -a "$APP_LOG"
        echo "[$(date)] faster-whisper will run in CPU mode" | tee -a "$APP_LOG"
    fi
else
    echo "[$(date)] Warning: NVIDIA packages not found at $NVIDIA_BASE" | tee -a "$APP_LOG"
    echo "[$(date)] faster-whisper will run in CPU mode" | tee -a "$APP_LOG"
fi

# Add Deno to PATH (required for yt-dlp YouTube downloads)
if [ -d "$HOME/.deno/bin" ]; then
    export PATH="$HOME/.deno/bin:$PATH"
    echo "[$(date)] Added Deno to PATH: $HOME/.deno/bin" | tee -a "$APP_LOG"
fi

# Add Node.js to PATH if using nvm
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_PATH=$(find "$HOME/.nvm/versions/node" -maxdepth 1 -type d -name "v*" | sort -V | tail -1)/bin
    if [ -d "$NODE_PATH" ]; then
        export PATH="$NODE_PATH:$PATH"
        echo "[$(date)] Added Node.js to PATH: $NODE_PATH" | tee -a "$APP_LOG"
    fi
fi

# Activate virtual environment
if [ -f "./venv/bin/activate" ]; then
    source ./venv/bin/activate
    echo "[$(date)] Virtual environment activated" | tee -a "$APP_LOG"
else
    echo "[$(date)] ERROR: Virtual environment not found at ./venv" | tee -a "$APP_LOG"
    exit 1
fi

# Get port from centralized configuration (single source of truth)
PORT=$(python -c "from core.config import PORT; print(PORT)")
echo "[$(date)] Using port $PORT from core/config.py" | tee -a "$APP_LOG"

# Start ngrok in background (if NGROK_URL is configured)
if [ -n "$NGROK_URL" ]; then
    echo "[$(date)] Starting ngrok tunnel with URL: $NGROK_URL..." | tee -a "$NGROK_LOG"
    ngrok http --url="$NGROK_URL" "$PORT" >> "$NGROK_LOG" 2>&1 &
    NGROK_PID=$!
    echo "[$(date)] ngrok started with PID: $NGROK_PID" | tee -a "$NGROK_LOG"
else
    echo "[$(date)] NGROK_URL not configured - starting ngrok without custom URL..." | tee -a "$NGROK_LOG"
    ngrok http "$PORT" >> "$NGROK_LOG" 2>&1 &
    NGROK_PID=$!
    echo "[$(date)] ngrok started with PID: $NGROK_PID (random URL mode)" | tee -a "$NGROK_LOG"
fi

# Wait a moment for ngrok to initialize
sleep 2

# Start Flask application
echo "[$(date)] Starting Flask application..." | tee -a "$APP_LOG"
python app.py >> "$APP_LOG" 2>&1 &
APP_PID=$!
echo "[$(date)] Flask app started with PID: $APP_PID" | tee -a "$APP_LOG"

# Create PID file for service management
echo "$APP_PID" > "$PROJECT_ROOT/stemtube_app.pid"
echo "$NGROK_PID" > "$PROJECT_ROOT/stemtube_ngrok.pid"

echo "[$(date)] Service started successfully" | tee -a "$APP_LOG"
echo "[$(date)] Flask PID: $APP_PID, ngrok PID: $NGROK_PID" | tee -a "$APP_LOG"

# Exit successfully (systemd Type=forking expects the script to exit)
exit 0
