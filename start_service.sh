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

# Find and add all NVIDIA CUDA library paths (batched I/O for faster boot)
NOW="$(date)"
if [ -d "$NVIDIA_BASE" ]; then
    CUDA_LIB_PATHS=""
    CUDA_PACKAGES=""
    for package_dir in "$NVIDIA_BASE"/*; do
        if [ -d "$package_dir/lib" ]; then
            CUDA_LIB_PATHS="$package_dir/lib:$CUDA_LIB_PATHS"
            CUDA_PACKAGES="$CUDA_PACKAGES  - $(basename "$package_dir")"$'\n'
        fi
    done

    if [ -n "$CUDA_LIB_PATHS" ]; then
        export LD_LIBRARY_PATH="$CUDA_LIB_PATHS:$LD_LIBRARY_PATH"
        {
            echo "[$NOW] Configured CUDA library paths from nvidia packages"
            printf '%s' "$CUDA_PACKAGES" | sed "s|^|[$NOW] |"
        } | tee -a "$APP_LOG"
    else
        printf '[%s] Warning: No NVIDIA CUDA libraries found in venv\n[%s] faster-whisper will run in CPU mode\n' "$NOW" "$NOW" | tee -a "$APP_LOG"
    fi
else
    printf '[%s] Warning: NVIDIA packages not found at %s\n[%s] faster-whisper will run in CPU mode\n' "$NOW" "$NVIDIA_BASE" "$NOW" | tee -a "$APP_LOG"
fi

# Check Node.js availability (required for JS challenge solving)
if command -v node &> /dev/null; then
    echo "[$(date)] Node.js found: $(node --version)" | tee -a "$APP_LOG"
else
    echo "[$(date)] WARNING: Node.js not found. Install with: sudo apt-get install -y nodejs" | tee -a "$APP_LOG"
fi

# Add Node.js to PATH if using nvm
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_PATH=$(find "$HOME/.nvm/versions/node" -maxdepth 1 -type d -name "v*" | sort -V | tail -1)/bin
    if [ -d "$NODE_PATH" ]; then
        export PATH="$NODE_PATH:$PATH"
        echo "[$(date)] Added Node.js to PATH: $NODE_PATH" | tee -a "$APP_LOG"
    fi
fi

# yt-dlp tries Deno first for JS challenge solving; systemd's PATH does not include it
if [ -x "$HOME/.deno/bin/deno" ]; then
    export PATH="$HOME/.deno/bin:$PATH"
    echo "[$(date)] Added Deno to PATH: $HOME/.deno/bin" | tee -a "$APP_LOG"
fi

# Activate virtual environment
if [ -f "./venv/bin/activate" ]; then
    source ./venv/bin/activate
    echo "[$(date)] Virtual environment activated" | tee -a "$APP_LOG"
else
    echo "[$(date)] ERROR: Virtual environment not found at ./venv" | tee -a "$APP_LOG"
    exit 1
fi

# Get port without importing the module (avoids slow Python boot): STEMTUBE_PORT wins, as in
# core/config.py; otherwise take the first number on the PORT line (literal or env default)
PORT="${STEMTUBE_PORT:-$(grep -oP '^PORT\s*=\D*\K\d+' core/config.py | head -1)}"
if [ -z "$PORT" ]; then
    # Fallback to Python import if the simple parse fails
    PORT=$(python -c "from core.config import PORT; print(PORT)")
fi
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

# Start Flask immediately - ngrok will reach the local port once Flask binds
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
