#!/bin/bash

# StemTube Service Stop Script
# Stops both Flask application and ngrok tunnel

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
STOP_LOG="$LOG_DIR/stemtube_stop.log"

echo "[$(date)] Stopping StemTube service..." | tee -a "$STOP_LOG"

# Get port from centralized configuration (single source of truth)
if [ -f "./venv/bin/python" ]; then
    PORT=$(./venv/bin/python -c "from core.config import PORT; print(PORT)")
    echo "[$(date)] Using port $PORT from core/config.py" | tee -a "$STOP_LOG"
else
    PORT=5012  # Fallback if venv not available
    echo "[$(date)] Warning: venv not found, using fallback port $PORT" | tee -a "$STOP_LOG"
fi

# Stop Flask app
if [ -f "$SCRIPT_DIR/stemtube_app.pid" ]; then
    APP_PID=$(cat "$SCRIPT_DIR/stemtube_app.pid")
    if ps -p $APP_PID > /dev/null 2>&1; then
        echo "[$(date)] Stopping Flask app (PID: $APP_PID)..." | tee -a "$STOP_LOG"
        kill $APP_PID
        sleep 2
        # Force kill if still running
        if ps -p $APP_PID > /dev/null 2>&1; then
            kill -9 $APP_PID
        fi
    fi
    rm -f "$SCRIPT_DIR/stemtube_app.pid"
fi

# Stop ngrok
if [ -f "$SCRIPT_DIR/stemtube_ngrok.pid" ]; then
    NGROK_PID=$(cat "$SCRIPT_DIR/stemtube_ngrok.pid")
    if ps -p $NGROK_PID > /dev/null 2>&1; then
        echo "[$(date)] Stopping ngrok (PID: $NGROK_PID)..." | tee -a "$STOP_LOG"
        kill $NGROK_PID
        sleep 1
        # Force kill if still running
        if ps -p $NGROK_PID > /dev/null 2>&1; then
            kill -9 $NGROK_PID
        fi
    fi
    rm -f "$SCRIPT_DIR/stemtube_ngrok.pid"
fi

# Also kill any remaining processes by name
pkill -f "python app.py" || true
pkill -f "ngrok http.*${PORT}" || true

echo "[$(date)] StemTube service stopped" | tee -a "$STOP_LOG"
