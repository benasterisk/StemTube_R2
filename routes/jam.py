"""
Jam session HTTP routes (Blueprint) and SocketIO event handlers.

Provides:
- /api/jam/my-session, /api/jam/info/<code>, /jam/<code>
- /api/jam/stems/<code>/<stem_name>, /api/jam/extraction/<code>
- All jam-related SocketIO events via register_jam_socketio_events()
"""

import os
import json
import time
import uuid
import random
import mimetypes
import sqlite3

from datetime import datetime

from flask import Blueprint, request, jsonify, session, send_from_directory, render_template, url_for
from flask_login import login_required, current_user
from flask_socketio import emit, join_room, leave_room

from extensions import (
    active_jam_sessions, user_session_manager, socketio,
    is_mobile_user_agent,
)
from core.config import ensure_valid_downloads_directory
from core.logging_config import get_logger
from core.download_manager import DownloadItem, DownloadType

logger = get_logger(__name__)

# ── Blueprint ─────────────────────────────────────────────────────────

jam_bp = Blueprint('jam', __name__)

# ------------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------------

def generate_jam_code():
    """Generate a unique jam session code like JAM-7X3K."""
    from core.auth_db import find_user_by_jam_code
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # No ambiguous chars (0/O, 1/I/L)
    for _ in range(100):  # Avoid infinite loop
        code = 'JAM-' + ''.join(random.choices(chars, k=4))
        if code not in active_jam_sessions and not find_user_by_jam_code(code):
            return code
    return 'JAM-' + uuid.uuid4().hex[:4].upper()


def _emit_jam_participants(code):
    """Broadcast updated participant list to the jam room."""
    jam = active_jam_sessions.get(code)
    if not jam:
        return
    participants = [{'name': jam['host_name'], 'role': 'host'}]
    for sid, name in jam.get('participants', {}).items():
        participants.append({'name': name, 'role': 'guest'})
    socketio.emit('jam_participants', {'participants': participants}, room=f'jam_{code}')


_jam_ping_started = False


def jam_ping_loop():
    """Background thread: send jam_ping to all active jam session participants every 2 seconds."""
    while True:
        socketio.sleep(2)
        for code in list(active_jam_sessions.keys()):
            try:
                socketio.emit('jam_ping', {'server_time': time.time() * 1000}, room=f'jam_{code}')
            except Exception:
                pass


def _ensure_jam_ping_loop():
    """Start the jam ping background loop once."""
    global _jam_ping_started
    if not _jam_ping_started:
        _jam_ping_started = True
        socketio.start_background_task(jam_ping_loop)


# ------------------------------------------------------------------
# HTTP Routes
# ------------------------------------------------------------------

@jam_bp.route('/api/jam/my-session')
@login_required
def jam_my_session():
    """Check if current user has an active jam session (for auto-reclaim on page reload)."""
    from core.auth_db import get_user_jam_code
    code = get_user_jam_code(current_user.id)
    if code and code in active_jam_sessions:
        jam = active_jam_sessions[code]
        return jsonify({'active': True, 'code': code})
    return jsonify({'active': False})


@jam_bp.route('/api/jam/info/<code>')
def jam_info(code):
    """Return jam session info (no auth required)."""
    # Try with JAM- prefix
    full_code = code if code.startswith('JAM-') else f'JAM-{code}'
    jam = active_jam_sessions.get(full_code)
    if not jam:
        return jsonify({'error': 'Session not found'}), 404
    participants = [{'name': jam['host_name'], 'role': 'host'}]
    for sid, name in jam.get('participants', {}).items():
        participants.append({'name': name, 'role': 'guest'})
    return jsonify({
        'code': full_code,
        'host_name': jam['host_name'],
        'participants': participants,
        'track_title': jam['extraction_data'].get('title') if jam.get('extraction_data') else None,
        'created_at': jam.get('created_at')
    })


@jam_bp.route('/jam/<code>')
def jam_guest(code):
    """Guest entry point for jam sessions -- NO login required."""
    full_code = code if code.startswith('JAM-') else f'JAM-{code}'
    jam = active_jam_sessions.get(full_code)
    if not jam:
        # Check if this is a valid persistent code (host exists but session not active)
        from core.auth_db import find_user_by_jam_code
        owner = find_user_by_jam_code(full_code)
        if owner:
            short = full_code.replace('JAM-', '')
            return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Host is Offline</title>
<style>body{{background:#0a0a0a;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}}
.box{{max-width:400px;padding:40px}}.box h1{{color:#f39c12;margin-bottom:16px}}.box p{{color:#aaa;margin-bottom:24px}}
a{{color:#1DB954;text-decoration:none}}.retry-btn{{display:inline-block;padding:12px 24px;background:#1DB954;color:#fff;border-radius:8px;text-decoration:none;margin-top:12px;font-weight:bold}}</style>
<meta http-equiv="refresh" content="10"></head>
<body><div class="box"><h1>Host is Offline</h1>
<p>{owner['username']}'s jam session is not currently active. The host needs to start their session first.</p>
<p style="color:#666;font-size:0.9em">This page will auto-refresh every 10 seconds.</p>
<a class="retry-btn" href="/jam/{short}">Retry Now</a><br><br>
<a href="/">Go to StemTube</a></div></body></html>""", 503

        return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jam Session Not Found</title>
<style>body{{background:#0a0a0a;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}}
.box{{max-width:400px;padding:40px}}.box h1{{color:#e74c3c;margin-bottom:16px}}.box p{{color:#aaa;margin-bottom:24px}}
a{{color:#1DB954;text-decoration:none}}</style></head>
<body><div class="box"><h1>Session Not Found</h1>
<p>This jam session code is invalid or has expired. The host may have ended the session.</p>
<a href="/">Go to StemTube</a></div></body></html>""", 404
    # Clear any stale flags from a previous session, then set fresh ones
    session.pop('jam_guest', None)
    session.pop('jam_code', None)
    session.pop('jam_guest_name', None)
    session['jam_guest'] = True
    session['jam_code'] = full_code
    session['jam_guest_name'] = f'Guest-{uuid.uuid4().hex[:4].upper()}'
    # Get extraction data from the jam session
    extraction_data = jam.get('extraction_data') or {}
    extraction_id = jam.get('extraction_id') or extraction_data.get('extraction_id', '')
    logger.info(f"[Jam Guest Route] code={full_code}, has_extraction_data={bool(extraction_data)}, extraction_id={extraction_id}, title={extraction_data.get('title')}")

    # Detect mobile
    user_agent = request.headers.get('User-Agent', '')
    if is_mobile_user_agent(user_agent):
        # Mobile: use the real mobile-index.html with jam guest mode
        return render_template('mobile-index.html',
                               current_username=session['jam_guest_name'],
                               current_user=None,
                               cache_buster=int(time.time()),
                               enable_youtube=False,
                               jam_guest_mode=True,
                               jam_code=full_code,
                               jam_guest_name=session['jam_guest_name'],
                               jam_host_name=jam.get('host_name', 'Host'),
                               jam_extraction_data=json.dumps(extraction_data) if extraction_data else '{}')

    # Desktop: render the real mixer with guest mode flags
    return render_template('mixer.html',
                           extraction_id=extraction_id,
                           extraction_info=extraction_data if extraction_data else None,
                           jam_guest_mode=True,
                           jam_code=full_code,
                           jam_guest_name=session['jam_guest_name'])


@jam_bp.route('/api/jam/stems/<code>/<stem_name>', methods=['GET', 'HEAD'])
def serve_jam_stem(code, stem_name):
    """Serve stem files for jam session guests -- NO login required.
    Validated by active jam session code only."""
    full_code = code if code.startswith('JAM-') else f'JAM-{code}'
    jam = active_jam_sessions.get(full_code)
    if not jam:
        return jsonify({'error': 'Invalid or expired jam session'}), 404

    extraction_data = jam.get('extraction_data')
    if not extraction_data:
        return jsonify({'error': 'No track loaded in this session'}), 404

    # Get stem paths from extraction data (handle both output_paths and stems_paths)
    output_paths = extraction_data.get('output_paths') or {}
    if not output_paths:
        stems_paths = extraction_data.get('stems_paths')
        if stems_paths:
            output_paths = json.loads(stems_paths) if isinstance(stems_paths, str) else stems_paths
    stem_file_path = output_paths.get(stem_name) if output_paths else None

    if not stem_file_path:
        # Fallback: look up in database using extraction_id stored in the jam session
        extraction_id = jam.get('extraction_id')
        if extraction_id:
            try:
                from core.downloads_db import resolve_file_path
                db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'downloads.db')
                with sqlite3.connect(db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    # Try matching by video_id or download ID
                    clean_id = extraction_id.replace('download_', '')
                    row = conn.execute(
                        "SELECT stems_paths FROM global_downloads WHERE (video_id=? OR id=?) AND extracted=1 AND stems_paths IS NOT NULL",
                        (extraction_id, clean_id)
                    ).fetchone()
                    if row and row['stems_paths']:
                        sp = json.loads(row['stems_paths']) if isinstance(row['stems_paths'], str) else row['stems_paths']
                        stem_file_path = sp.get(stem_name)
                        if stem_file_path:
                            stem_file_path = resolve_file_path(stem_file_path)
            except Exception as e:
                logger.error(f"[Jam Stems] DB lookup error: {e}")

    if not stem_file_path or not os.path.exists(stem_file_path):
        return jsonify({'error': f'Stem not found: {stem_name}'}), 404

    # Security check
    abs_file_path = os.path.abspath(stem_file_path)
    downloads_dir = os.path.abspath(ensure_valid_downloads_directory())
    if not abs_file_path.startswith(downloads_dir):
        logger.error(f"[Jam Stems] Security violation: {abs_file_path} not in {downloads_dir}")
        return jsonify({'error': 'Access denied'}), 403

    if request.method == 'HEAD':
        return '', 200

    directory = os.path.dirname(abs_file_path)
    filename = os.path.basename(abs_file_path)
    stem_mimetype, _ = mimetypes.guess_type(filename)
    response = send_from_directory(directory, filename, mimetype=stem_mimetype or 'audio/mpeg')
    response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
    return response


@jam_bp.route('/api/jam/extraction/<code>')
def get_jam_extraction(code):
    """Return extraction data for a jam session -- NO login required."""
    full_code = code if code.startswith('JAM-') else f'JAM-{code}'
    jam = active_jam_sessions.get(full_code)
    if not jam:
        return jsonify({'error': 'Session not found'}), 404
    extraction_data = jam.get('extraction_data')
    if not extraction_data:
        return jsonify({'error': 'No track loaded'}), 404

    # Ensure stems_paths/output_paths are present -- fall back to DB lookup
    has_stems = extraction_data.get('output_paths') or extraction_data.get('stems_paths')
    if not has_stems:
        extraction_id = jam.get('extraction_id')
        if extraction_id:
            try:
                db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'downloads.db')
                with sqlite3.connect(db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    clean_id = extraction_id.replace('download_', '')
                    row = conn.execute(
                        "SELECT stems_paths FROM global_downloads WHERE (video_id=? OR id=?) AND extracted=1 AND stems_paths IS NOT NULL",
                        (extraction_id, clean_id)
                    ).fetchone()
                    if row and row['stems_paths']:
                        extraction_data['stems_paths'] = row['stems_paths']
            except Exception as e:
                logger.error(f"[Jam Extraction] DB fallback error: {e}")

    return jsonify(extraction_data)


# ------------------------------------------------------------------
# SocketIO event registration
# ------------------------------------------------------------------

def register_jam_socketio_events(sio):
    """Register all jam-related SocketIO events.

    Parameters
    ----------
    sio : flask_socketio.SocketIO
        The SocketIO instance to register events on.
    """

    @sio.on('connect')
    def handle_connect():
        # Allow jam session guests (no login required)
        if session.get('jam_guest'):
            jam_code = session.get('jam_code')
            logger.info(f"[Jam DEBUG] Guest connecting: code={jam_code}, in_sessions={jam_code in active_jam_sessions if jam_code else 'N/A'}")
            if jam_code and jam_code in active_jam_sessions:
                join_room(f'jam_{jam_code}')
                # Add guest to participants
                jam = active_jam_sessions[jam_code]
                guest_name = session.get('jam_guest_name', 'Guest')
                jam['participants'][request.sid] = guest_name
                ext_data = jam.get('extraction_data')
                logger.info(f"[Jam DEBUG] Guest joined: extraction_data={'has title: ' + str(ext_data.get('title')) if ext_data else 'NONE'}, extraction_id={jam.get('extraction_id')}")
                # Notify room
                emit('jam_joined', {
                    'code': jam_code,
                    'role': 'guest',
                    'extraction_data': ext_data,
                    'state': jam.get('state', {})
                })
                # Broadcast updated participant list
                _emit_jam_participants(jam_code)
                _ensure_jam_ping_loop()
                return True
            else:
                # Session expired -- clear stale flags, allow normal connection
                logger.info(f"[Jam] Clearing stale guest flags for expired session {jam_code}")
                session.pop('jam_guest', None)
                session.pop('jam_code', None)
                session.pop('jam_guest_name', None)
                # Fall through to normal auth check below

        if not current_user.is_authenticated:
            emit('auth_error', {'redirect': url_for('auth.login')})
            return False
        room = user_session_manager._key()
        join_room(room)
        emit('connection_established', {'session_key': room})
        # Start jam ping loop if not already started
        _ensure_jam_ping_loop()

    @sio.on('disconnect')
    def handle_disconnect():
        # Check if disconnecting user is a jam host or guest
        for code, jam in list(active_jam_sessions.items()):
            if jam['host_sid'] == request.sid:
                # Host disconnected -- start 30s grace period (mobile refresh can take 10-15s)
                jam['host_disconnected_at'] = time.time()
                jam['host_sid'] = None  # Clear stale SID
                jam['state']['is_playing'] = False  # Guests should pause
                logger.info(f"[Jam] Host disconnected from session {code}, starting 30s grace period")

                # Notify guests: pause playback + show 10s countdown UI
                sio.emit('jam_host_status', {'status': 'disconnected', 'timeout': 10}, room=f'jam_{code}')

                # Schedule cleanup after 30s server-side grace period
                def _check_host_timeout(session_code):
                    sio.sleep(30)
                    sess = active_jam_sessions.get(session_code)
                    if sess and sess.get('host_disconnected_at'):
                        # Host did not reconnect within grace period
                        sio.emit('jam_ended', {'reason': 'Host disconnected'}, room=f'jam_{session_code}')
                        del active_jam_sessions[session_code]
                        logger.info(f"[Jam] Session {session_code} ended (host timeout after 30s)")

                sio.start_background_task(_check_host_timeout, code)
                break
            elif request.sid in jam.get('participants', {}):
                # Guest disconnected -- remove from session and clear stale flags
                del jam['participants'][request.sid]
                session.pop('jam_guest', None)
                session.pop('jam_code', None)
                session.pop('jam_guest_name', None)
                _emit_jam_participants(code)
                break
        try:
            leave_room(user_session_manager._key())
        except Exception:
            pass  # Guest may not have a user session

    @sio.on('jam_create')
    def handle_jam_create(data=None):
        # Clear any stale guest flags (user is now acting as host)
        session.pop('jam_guest', None)
        session.pop('jam_code', None)
        session.pop('jam_guest_name', None)
        if not current_user.is_authenticated:
            logger.warning(f"[Jam] jam_create rejected -- user not authenticated (sid={request.sid})")
            emit('jam_create_error', {'error': 'Not authenticated -- please log in again'})
            return
        from core.auth_db import get_user_jam_code, set_user_jam_code

        # Check for existing persistent code in DB
        code = get_user_jam_code(current_user.id)

        if code:
            # User has a persistent code -- check if there's an active in-memory session
            if code in active_jam_sessions:
                existing = active_jam_sessions[code]
                if existing['host_user_id'] == current_user.id:
                    # Same user reclaiming -- update the host SID
                    existing['host_sid'] = request.sid
                    existing['host_disconnected_at'] = None  # Cancel any grace period
                    # Host's mixer reloads from scratch -> stopped state
                    existing['state']['is_playing'] = False
                    existing['state']['position'] = 0.0
                    join_room(f'jam_{code}')
                    short_code = code.replace('JAM-', '')
                    url = f"{request.url_root.rstrip('/')}/jam/{short_code}"
                    emit('jam_created', {'code': code, 'url': url})
                    _emit_jam_participants(code)
                    # Notify guests that host is back -- include full state for resync
                    sio.emit('jam_host_status', {
                        'status': 'reconnected',
                        'state': existing['state'],
                        'extraction_data': existing.get('extraction_data')
                    }, room=f'jam_{code}', include_self=False)
                    logger.info(f"[Jam] Session {code} reclaimed by user {current_user.id}, new host_sid={request.sid}")
                    return
                else:
                    # Code collision -- should not happen, regenerate
                    logger.warning(f"[Jam] Code collision: {code} for user {current_user.id} but active for user {existing['host_user_id']}")
                    code = generate_jam_code()
                    set_user_jam_code(current_user.id, code)
            # Persistent code exists but no active session -- create new in-memory session
        else:
            # First time -- generate and persist
            code = generate_jam_code()
            set_user_jam_code(current_user.id, code)

        active_jam_sessions[code] = {
            'host_sid': request.sid,
            'host_user_id': current_user.id,
            'host_name': current_user.username if hasattr(current_user, 'username') else f'User-{current_user.id}',
            'extraction_id': None,
            'extraction_data': None,
            'created_at': datetime.now().isoformat(),
            'participants': {},  # {sid: name}
            'state': {
                'is_playing': False,
                'position': 0.0,
                'bpm': 120,
                'original_bpm': 120,
                'pitch_shift': 0,
                'original_key': 'C',
                'current_key': 'C',
            },
            'rtts': {},
            'host_disconnected_at': None
        }
        join_room(f'jam_{code}')
        short_code = code.replace('JAM-', '')
        url = f"{request.url_root.rstrip('/')}/jam/{short_code}"
        emit('jam_created', {'code': code, 'url': url})
        _emit_jam_participants(code)
        logger.info(f"[Jam] Session {code} created by user {current_user.id}, host_sid={request.sid}")

    @sio.on('jam_end')
    def handle_jam_end(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if not jam or jam['host_sid'] != request.sid:
            return
        sio.emit('jam_ended', {'reason': 'Host ended session'}, room=f'jam_{code}')
        del active_jam_sessions[code]
        logger.info(f"[Jam] Session {code} ended by host (DB code preserved)")

    @sio.on('jam_delete_code')
    def handle_jam_delete_code(data=None):
        """Delete host's persistent jam code so a new one is generated next time."""
        if not current_user.is_authenticated:
            return
        from core.auth_db import get_user_jam_code, delete_user_jam_code

        code = get_user_jam_code(current_user.id)
        if code:
            # End any active session with this code
            if code in active_jam_sessions:
                sio.emit('jam_ended', {'reason': 'Host deleted session code'}, room=f'jam_{code}')
                del active_jam_sessions[code]
            delete_user_jam_code(current_user.id)
            emit('jam_code_deleted', {'success': True})
            logger.info(f"[Jam] User {current_user.id} deleted their jam code {code}")
        else:
            emit('jam_code_deleted', {'success': False, 'error': 'No jam code found'})

    @sio.on('jam_join')
    def handle_jam_join(data):
        code = data.get('code')
        guest_name = data.get('guest_name', f'Guest-{uuid.uuid4().hex[:4].upper()}')
        jam = active_jam_sessions.get(code)
        if not jam:
            emit('jam_join_error', {'error': 'Invalid or expired session code'})
            return
        jam['participants'][request.sid] = guest_name
        join_room(f'jam_{code}')
        emit('jam_joined', {
            'code': code,
            'role': 'guest',
            'extraction_data': jam.get('extraction_data'),
            'state': jam.get('state', {})
        })
        _emit_jam_participants(code)
        logger.info(f"[Jam] {guest_name} joined session {code}")

    @sio.on('jam_leave')
    def handle_jam_leave(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if not jam:
            return
        if request.sid in jam.get('participants', {}):
            name = jam['participants'].pop(request.sid, 'Guest')
            leave_room(f'jam_{code}')
            _emit_jam_participants(code)
            logger.info(f"[Jam] {name} left session {code}")

    @sio.on('jam_track_load')
    def handle_jam_track_load(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        logger.info(f"[Jam DEBUG] jam_track_load received: code={code}, jam_exists={jam is not None}, host_match={jam['host_sid'] == request.sid if jam else 'N/A'}")
        if not jam or jam['host_sid'] != request.sid:
            logger.info(f"[Jam DEBUG] jam_track_load REJECTED: host_sid={jam.get('host_sid') if jam else 'N/A'}, request.sid={request.sid}")
            return
        ext_data = data.get('extraction_data')
        logger.info(f"[Jam DEBUG] jam_track_load ACCEPTED: extraction_id={data.get('extraction_id')}, has_title={ext_data.get('title') if ext_data else 'NONE'}, has_output_paths={bool(ext_data.get('output_paths')) if ext_data else 'NONE'}")
        jam['extraction_id'] = data.get('extraction_id')
        jam['extraction_data'] = ext_data
        sio.emit('jam_track_loaded', {
            'extraction_id': data.get('extraction_id'),
            'extraction_data': data.get('extraction_data')
        }, room=f'jam_{code}', include_self=False)

    @sio.on('jam_playback')
    def handle_jam_playback(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if not jam or jam['host_sid'] != request.sid:
            return
        cmd = data.get('command')
        jam['state']['is_playing'] = cmd in ('play',)
        if 'position' in data:
            jam['state']['position'] = data['position']
        data['server_timestamp'] = time.time() * 1000
        sio.emit('jam_playback', data, room=f'jam_{code}', include_self=False)

    @sio.on('jam_tempo')
    def handle_jam_tempo(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if not jam or jam['host_sid'] != request.sid:
            return
        jam['state']['bpm'] = data.get('bpm', 120)
        jam['state']['original_bpm'] = data.get('original_bpm', 120)
        sio.emit('jam_tempo', data, room=f'jam_{code}', include_self=False)

    @sio.on('jam_pitch')
    def handle_jam_pitch(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if not jam or jam['host_sid'] != request.sid:
            return
        jam['state']['pitch_shift'] = data.get('pitch_shift', 0)
        jam['state']['current_key'] = data.get('current_key', 'C')
        sio.emit('jam_pitch', data, room=f'jam_{code}', include_self=False)

    @sio.on('jam_sync')
    def handle_jam_sync(data):
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if not jam or jam['host_sid'] != request.sid:
            return
        # Update stored state with latest position/bpm from host
        if 'position' in data:
            jam['state']['position'] = data['position']
        if 'is_playing' in data:
            jam['state']['is_playing'] = data['is_playing']
        if 'bpm' in data:
            jam['state']['bpm'] = data['bpm']
        data['server_timestamp'] = time.time() * 1000
        sio.emit('jam_sync', data, room=f'jam_{code}', include_self=False)

    @sio.on('jam_pong')
    def handle_jam_pong(data):
        server_time = data.get('server_time', 0)
        rtt = time.time() * 1000 - server_time
        code = data.get('code')
        jam = active_jam_sessions.get(code)
        if jam:
            jam['rtts'][request.sid] = rtt
            emit('jam_rtt', {'rtt': rtt})
