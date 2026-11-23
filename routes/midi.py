"""MIDI companion tracks: per-track settings, generation for older songs, .mid download."""
import os
import re
import threading

from flask import Blueprint, jsonify, request, send_from_directory
from flask_login import current_user

from extensions import api_login_required, socketio
from core.config import get_ffmpeg_path
from core.logging_config import get_logger

logger = get_logger(__name__)

midi_bp = Blueprint('midi', __name__)

# The MIDI tracks of a song live next to its stems, so they are shared by every user
# who has the song, like the stems, the chords and the lyrics. The job states are
# kept per user: {(user_id, extraction_id): {state, progress, message}}.
_JOBS = {}
_LOCK = threading.Lock()


def _context(extraction_id):
    """(row, stems_map, stems_dir) of a song of the caller; ValueError when it is not theirs."""
    from routes.poc_mixer import _resolve_context
    return _resolve_context(current_user.id, extraction_id)


@midi_bp.route('/api/midi/<path:extraction_id>/tracks', methods=['GET'])
@api_login_required
def midi_tracks_info(extraction_id):
    try:
        _row, _stems, stems_dir = _context(extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    from core.midi import tracks
    with _LOCK:
        job = dict(_JOBS.get((current_user.id, extraction_id)) or {'state': 'idle'})
    return jsonify({'tracks': tracks.describe(stems_dir), 'job': job})


@midi_bp.route('/api/midi/<path:extraction_id>/track', methods=['POST'])
@api_login_required
def midi_track_update(extraction_id):
    """Body: {stem, mode?, instrument?}. Renders that one track again."""
    data = request.json or {}
    stem = re.sub(r'_midi$', '', str(data.get('stem') or ''))
    try:
        _row, _stems, stems_dir = _context(extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    from core.midi import tracks
    try:
        tracks.update(stems_dir, stem, mode=data.get('mode'), instrument=data.get('instrument'),
                      ffmpeg=get_ffmpeg_path())
    except KeyError:
        return jsonify({'error': 'No MIDI track for this stem'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"[MIDI] render failed for {extraction_id}/{stem}: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    info = tracks.describe(stems_dir).get(stem + '_midi')
    return jsonify({'name': stem + '_midi', 'track': info, 'tag': f"r{info['rev']}"})


@midi_bp.route('/api/midi/<path:extraction_id>/notes/<stem>', methods=['GET'])
@api_login_required
def midi_notes(extraction_id, stem):
    """Notes the track currently plays: {mode, drums, notes: [[start_s, end_s, pitch, velocity]]}."""
    stem = re.sub(r'_midi$', '', stem)
    try:
        _row, _stems, stems_dir = _context(extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    from core.midi import tracks
    try:
        mode, notes = tracks.notes_of(stems_dir, stem)
    except (KeyError, OSError):
        return jsonify({'error': 'No MIDI track for this stem'}), 404
    state = tracks.load(stems_dir) or {}
    entry = state.get('tracks', {}).get(stem, {})
    resp = jsonify({'mode': mode, 'drums': entry.get('kind') == 'drums', 'rev': entry.get('rev', 1),
                    'notes': [[round(s, 4), round(e, 4), p, v] for s, e, p, v in notes]})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@midi_bp.route('/api/midi/<path:extraction_id>/notes', methods=['POST'])
@api_login_required
def midi_notes_save(extraction_id):
    """Body: {stem, notes}. Replaces the notes of the mode the track is in, renders it again."""
    data = request.get_json(silent=True) or {}
    stem = re.sub(r'_midi$', '', str(data.get('stem') or ''))
    try:
        _row, _stems, stems_dir = _context(extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    from core.midi import tracks
    try:
        tracks.set_notes(stems_dir, stem, data.get('notes'), ffmpeg=get_ffmpeg_path())
    except KeyError:
        return jsonify({'error': 'No MIDI track for this stem'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"[MIDI] note edit failed for {extraction_id}/{stem}: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    info = tracks.describe(stems_dir).get(stem + '_midi')
    return jsonify({'name': stem + '_midi', 'track': info, 'tag': f"r{info['rev']}"})


@midi_bp.route('/api/midi/<path:extraction_id>/generate', methods=['POST'])
@api_login_required
def midi_generate(extraction_id):
    """Create the MIDI tracks of a song extracted before the feature existed (or redo them)."""
    try:
        row, stems_map, _stems_dir = _context(extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    key = (current_user.id, extraction_id)
    with _LOCK:
        if _JOBS.get(key, {}).get('state') == 'running':
            return jsonify({'error': 'Already running'}), 409
        _JOBS[key] = {'state': 'running', 'progress': 0, 'message': ''}
    room = f"user_{current_user.id}"
    video_id = row.get('video_id')
    # keep: measure and render again but keep the notes, modes and sounds (edits survive)
    keep = bool((request.get_json(silent=True) or {}).get('keep'))

    def progress(fraction, name):
        with _LOCK:
            _JOBS[key].update(progress=round(fraction * 100), message=name)
        socketio.emit('midi_progress', {'extraction_id': extraction_id,
                                        'progress': round(fraction * 100), 'message': name}, room=room)

    def work():
        try:
            from core.automix.gate import heavy_job
            from core.midi import tracks
            with heavy_job(lambda: progress(0, 'Waiting for another job to finish')):
                state = tracks.build_for_video(video_id, stems_map, progress, keep_notes=keep)
            count = len(state['tracks']) if state else 0
            with _LOCK:
                _JOBS[key] = {'state': 'done', 'progress': 100, 'tracks': count}
            socketio.emit('midi_ready', {'extraction_id': extraction_id, 'tracks': count}, room=room)
        except Exception as e:
            logger.error(f"[MIDI] generation failed for {extraction_id}: {e}", exc_info=True)
            with _LOCK:
                _JOBS[key] = {'state': 'error', 'error': str(e)}
            socketio.emit('midi_error', {'extraction_id': extraction_id, 'error': str(e)}, room=room)

    threading.Thread(target=work, daemon=True, name="midi-generate").start()
    return jsonify({'started': True}), 202


@midi_bp.route('/api/midi/<path:extraction_id>/file/<name>', methods=['GET'])
@api_login_required
def midi_file(extraction_id, name):
    """Download song.mid, <stem>.mid or <stem>.simple.mid."""
    if not re.fullmatch(r'[A-Za-z0-9_]+(\.simple)?\.mid', name):
        return jsonify({'error': 'bad name'}), 400
    try:
        row, _stems, stems_dir = _context(extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    from core.midi import tracks
    folder = tracks.sidecar_dir(stems_dir)
    if not os.path.exists(os.path.join(folder, name)):
        return jsonify({'error': 'not found'}), 404
    title = re.sub(r'[^\w\- ]+', '_', row.get('title') or 'song').strip() or 'song'
    download = f"{title}.mid" if name == 'song.mid' else f"{title} - {name}"
    return send_from_directory(folder, name, as_attachment=True, download_name=download,
                               mimetype='audio/midi')
