#!/bin/bash

# StemTube Service Startup Script
# Launches both Flask application and ngrok tunnel

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Navigate to project root (two levels up from utils/deployment)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
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
CUDNN_LIB_PATH="$VENV_SITE_PACKAGES/nvidia/cudnn/lib"
CUBLAS_LIB_PATH="$VENV_SITE_PACKAGES/nvidia/cublas/lib"

# Add cuDNN path
if [ -d "$CUDNN_LIB_PATH" ]; then
    export LD_LIBRARY_PATH="$CUDNN_LIB_PATH:$LD_LIBRARY_PATH"
    echo "[$(date)] Configured cuDNN library path: $CUDNN_LIB_PATH" | tee -a "$APP_LOG"
else
    echo "[$(date)] Warning: cuDNN library not found at $CUDNN_LIB_PATH" | tee -a "$APP_LOG"
fi

# Add cuBLAS path (required by ctranslate2 for faster-whisper GPU)
if [ -d "$CUBLAS_LIB_PATH" ]; then
    export LD_LIBRARY_PATH="$CUBLAS_LIB_PATH:$LD_LIBRARY_PATH"
    echo "[$(date)] Configured cuBLAS library path: $CUBLAS_LIB_PATH" | tee -a "$APP_LOG"
else
    echo "[$(date)] Warning: cuBLAS library not found at $CUBLAS_LIB_PATH" | tee -a "$APP_LOG"
    echo "[$(date)] faster-whisper will run in CPU mode" | tee -a "$APP_LOG"
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
