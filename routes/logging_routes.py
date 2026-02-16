import json
from datetime import datetime
from pathlib import Path

from flask import Blueprint, request, jsonify, send_from_directory
from flask_login import current_user

from extensions import api_login_required
from core.logging_config import get_logger, log_with_context

logger = get_logger(__name__)

LOG_DIR = Path(__file__).resolve().parent.parent / 'logs'

logging_bp = Blueprint('logging_routes', __name__)


@logging_bp.route('/api/logs/browser', methods=['POST'])
@api_login_required
def collect_browser_logs():
    """Collect browser console logs sent from frontend."""
    try:
        data = request.json or {}
        logs = data.get('logs', [])

        if not logs:
            return jsonify({'success': True, 'message': 'No logs received'})

        # Get user context
        user_id = current_user.id if current_user.is_authenticated else None
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)

        # Create browser logger
        browser_logger = get_logger('browser')

        # Process each log entry
        for log_entry in logs:
            level = log_entry.get('level', 'info')
            message = log_entry.get('message', '')
            timestamp = log_entry.get('timestamp', '')
            session_id = log_entry.get('sessionId', '')
            url = log_entry.get('url', '')

            # Add context and log the browser message
            with log_with_context(browser_logger,
                                user_id=user_id,
                                ip_address=client_ip,
                                browser_session_id=session_id,
                                browser_url=url):

                if level == 'debug':
                    browser_logger.debug(f"Browser: {message}")
                elif level == 'info':
                    browser_logger.info(f"Browser: {message}")
                elif level == 'warn':
                    browser_logger.warning(f"Browser: {message}")
                elif level == 'error':
                    browser_logger.error(f"Browser: {message}")
                else:
                    browser_logger.info(f"Browser [{level}]: {message}")

        logger.debug(f"Collected {len(logs)} browser log entries from user {user_id}")

        return jsonify({
            'success': True,
            'message': f'Collected {len(logs)} log entries',
            'processed': len(logs)
        })

    except Exception as e:
        logger.error(f"Error collecting browser logs: {e}", exc_info=True)
        return jsonify({'error': 'Failed to collect logs'}), 500


@logging_bp.route('/api/logs/list', methods=['GET'])
@api_login_required
def list_log_files():
    """List available log files for admin viewing."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        log_dir = LOG_DIR
        log_files = []

        for log_file in log_dir.glob('*.log'):
            stat = log_file.stat()
            log_files.append({
                'name': log_file.name,
                'size': stat.st_size,
                'size_mb': round(stat.st_size / (1024 * 1024), 2),
                'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'type': 'main' if 'stemtube.log' in log_file.name else
                        'error' if 'error' in log_file.name else
                        'access' if 'access' in log_file.name else
                        'database' if 'database' in log_file.name else
                        'processing' if 'processing' in log_file.name else 'other'
            })

        # Sort by modified time, newest first
        log_files.sort(key=lambda x: x['modified'], reverse=True)

        return jsonify({
            'success': True,
            'log_files': log_files,
            'log_directory': str(log_dir)
        })

    except Exception as e:
        logger.error(f"Error listing log files: {e}", exc_info=True)
        return jsonify({'error': 'Failed to list log files'}), 500


@logging_bp.route('/api/logs/view/<filename>', methods=['GET'])
@api_login_required
def view_log_file(filename):
    """View contents of a specific log file."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        log_dir = LOG_DIR
        log_file = log_dir / filename

        # Security check - ensure file is in log directory
        if not str(log_file.resolve()).startswith(str(log_dir.resolve())):
            return jsonify({'error': 'Invalid file path'}), 400

        if not log_file.exists():
            return jsonify({'error': 'Log file not found'}), 404

        # Get parameters
        lines = int(request.args.get('lines', 100))  # Default to last 100 lines
        offset = int(request.args.get('offset', 0))   # Skip lines from end

        # Read file content
        with open(log_file, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()

        # Calculate slice
        total_lines = len(all_lines)
        start_idx = max(0, total_lines - lines - offset)
        end_idx = total_lines - offset if offset > 0 else total_lines

        selected_lines = all_lines[start_idx:end_idx]

        # Parse JSON logs if applicable
        parsed_logs = []
        for line in selected_lines:
            line = line.strip()
            if line:
                try:
                    # Try to parse as JSON
                    log_entry = json.loads(line)
                    parsed_logs.append(log_entry)
                except json.JSONDecodeError:
                    # Fallback to plain text
                    parsed_logs.append({'message': line, 'type': 'plain'})

        return jsonify({
            'success': True,
            'filename': filename,
            'total_lines': total_lines,
            'returned_lines': len(selected_lines),
            'logs': parsed_logs
        })

    except Exception as e:
        logger.error(f"Error viewing log file {filename}: {e}", exc_info=True)
        return jsonify({'error': 'Failed to read log file'}), 500


@logging_bp.route('/api/logs/download/<filename>', methods=['GET'])
@api_login_required
def download_log_file(filename):
    """Download a log file."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    try:
        log_dir = LOG_DIR
        log_file = log_dir / filename

        # Security check
        if not str(log_file.resolve()).startswith(str(log_dir.resolve())):
            return jsonify({'error': 'Invalid file path'}), 400

        if not log_file.exists():
            return jsonify({'error': 'Log file not found'}), 404

        return send_from_directory(log_dir, filename, as_attachment=True)

    except Exception as e:
        logger.error(f"Error downloading log file {filename}: {e}", exc_info=True)
        return jsonify({'error': 'Failed to download log file'}), 500
