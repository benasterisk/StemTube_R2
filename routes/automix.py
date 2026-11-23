"""Auto remix routes: style list, job start, job status."""
import threading

from flask import Blueprint, jsonify, request
from flask_login import current_user

from extensions import api_login_required, socketio
from core.logging_config import get_logger

logger = get_logger(__name__)

automix_bp = Blueprint('automix', __name__)

# One job per user and source song: {key: {state, progress, message, result | error}},
# key = (user_id, download_id) for an auto remix, ('premix', user_id, extraction_id)
# for a pre-mix. A user only ever sees their own jobs.
_JOBS = {}
_LOCK = threading.Lock()


def _set(key, **fields):
    with _LOCK:
        _JOBS.setdefault(key, {}).update(fields)
        return dict(_JOBS[key])


@automix_bp.route('/api/automix/styles', methods=['GET'])
@api_login_required
def automix_styles():
    from core.automix import DEFAULT_STYLE, STYLES
    gpu = False
    try:
        import torch
        gpu = bool(torch.cuda.is_available())
    except Exception:
        pass
    return jsonify({
        'styles': [{'key': k, 'label': v['label']} for k, v in STYLES.items()],
        'default': DEFAULT_STYLE,
        # Drying the vocal is quick on a GPU and slow on a CPU: offered either
        # way, ticked by default only with a GPU.
        'dry_vocals_default': gpu,
    })


@automix_bp.route('/api/automix', methods=['POST'])
@api_login_required
def automix_start():
    data = request.json or {}
    try:
        download_id = int(data.get('download_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'download_id is required'}), 400
    style = data.get('style') or ''
    dry_vocals = bool(data.get('dry_vocals'))
    user_id = current_user.id
    # the song must be one of the caller's own (user_downloads row of this user)
    from core.downloads_db import get_download_by_id
    if not get_download_by_id(user_id, download_id):
        return jsonify({'error': 'Song not found'}), 404
    key = (user_id, download_id)

    with _LOCK:
        if _JOBS.get(key, {}).get('state') == 'running':
            return jsonify({'error': 'A remix of this song is already running'}), 409
        _JOBS[key] = {'state': 'running', 'progress': 0, 'message': 'Starting'}

    room = f"user_{user_id}"

    def progress(pct, text):
        _set(key, progress=round(pct, 1), message=text)
        socketio.emit('automix_progress', {'download_id': download_id, 'progress': round(pct, 1),
                                           'message': text}, room=room)

    def work():
        try:
            from core.automix import job
            from core.automix.gate import heavy_job
            with heavy_job(lambda: progress(0, 'Waiting for another job to finish')):
                result = job.run(user_id, download_id, style, dry_vocals=dry_vocals, progress=progress)
                try:
                    from routes.poc_mixer import warm_prepare
                    progress(100, 'Preparing the mixer')
                    warm_prepare(user_id, result['extraction_id'])
                except Exception as e:
                    logger.warning(f"[AUTO REMIX] mixer warm-up skipped: {e}")
            _set(key, state='done', progress=100, message='Done', result=result)
            socketio.emit('automix_complete', dict(result, source_download_id=download_id), room=room)
        except Exception as e:
            logger.error(f"[AUTO REMIX] failed for download {download_id}: {e}", exc_info=True)
            _set(key, state='error', message=str(e), error=str(e))
            socketio.emit('automix_error', {'download_id': download_id, 'error': str(e)}, room=room)

    threading.Thread(target=work, daemon=True, name=f"automix-{download_id}").start()
    return jsonify({'started': True, 'download_id': download_id}), 202


@automix_bp.route('/api/automix/status/<int:download_id>', methods=['GET'])
@api_login_required
def automix_status(download_id):
    with _LOCK:
        job = dict(_JOBS.get((current_user.id, download_id)) or {'state': 'idle'})
    return jsonify(job)


# -- Pre-mix from the mixer ---------------------------------------------------
# The mixer sends which tracks it currently plays (mute / solo, a MIDI track
# standing in for its stem). Those tracks are cleaned, shaped and balanced in a
# style into a new song with independent stems; no master stage.

def audible_sources(tracks, stems_map, midi_files, midi_state=None):
    """({stem: file}, {stem: role}) of the tracks that sound, from the mixer state.

    ``tracks``: {name: {muted, solo}}. Same rule as the mixer: a muted track is
    silent, and with any solo active only the soloed tracks pass.

    A MIDI track ("<stem>_midi") that stands in for its silent stem with its
    default sound simply takes the name of that stem. In every other case it is
    an instrument of its own and stays a separate stem named after its sound: when
    the user chose that sound (strings playing the guitar part are strings), or
    when its audio stem plays too. ``role`` then says which stem it plays the part of.
    """
    from core.midi import instruments
    from core.midi import tracks as midi_tracks
    entries = (midi_state or {}).get('tracks', {})
    known = {n: p for n, p in stems_map.items() if n not in ('drums_full', 'metronome')}
    real = set(known)
    known.update(midi_files)
    state = {n: t for n, t in (tracks or {}).items() if n in known and isinstance(t, dict)}
    any_solo = any(t.get('solo') and not t.get('muted') for t in state.values())
    audible = [n for n, t in state.items()
               if not t.get('muted') and (not any_solo or t.get('solo'))]
    out = {n: known[n] for n in audible if not n.endswith('_midi')}
    roles = {}
    for name in audible:
        if not name.endswith('_midi'):
            continue
        stem = name[:-5]
        entry = entries.get(stem) or {}
        if stem not in out and not (entry and midi_tracks.is_named(stem, entry)):
            out[stem] = known[name]
            continue
        base = instruments.track_slug(entry.get('role', stem), entry.get('instrument', 'sf:0'),
                                      entry.get('kind') == 'drums')
        new, i = base, 2
        while new in out or new in real:
            new, i = f"{base}_{i}", i + 1
        out[new] = known[name]
        roles[new] = entry.get('role', stem)
    return out, roles


@automix_bp.route('/api/automix/premix/<path:extraction_id>', methods=['POST'])
@api_login_required
def premix_start(extraction_id):
    """Body: {tracks: {name: {muted, solo}}, style}."""
    import os
    from core.automix import STYLES
    from routes.poc_mixer import _real_stem_names, _resolve_context
    data = request.get_json(silent=True) or {}
    style = data.get('style') or ''
    if style not in STYLES:
        return jsonify({'error': 'Unknown style'}), 400
    try:
        row, stems_map, stems_dir = _resolve_context(current_user.id, extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    midi_files, midi_state = {}, None
    try:
        from core.midi import tracks as midi_tracks
        midi_files = midi_tracks.track_files(stems_dir)
        midi_state = midi_tracks.load(stems_dir)
    except Exception as e:
        logger.warning(f"[PREMIX] MIDI tracks unavailable: {e}")
    real = {n: stems_map[n] for n in _real_stem_names(stems_map) if os.path.exists(stems_map[n])}
    sources, roles = audible_sources(data.get('tracks'), real, midi_files, midi_state)
    if not sources:
        return jsonify({'error': 'No track is playing: unmute at least one'}), 400
    user_id = current_user.id
    download_id = row['id']
    key = ('premix', user_id, extraction_id)
    with _LOCK:
        if _JOBS.get(key, {}).get('state') == 'running':
            return jsonify({'error': 'A pre-mix of this song is already running'}), 409
        _JOBS[key] = {'state': 'running', 'progress': 0, 'message': 'Starting'}
    room = f"user_{user_id}"

    def progress(pct, text):
        _set(key, progress=round(pct, 1), message=text)

    def work():
        try:
            from core.automix import job
            from core.automix.gate import heavy_job
            with heavy_job(lambda: progress(0, 'Waiting for another job to finish')):
                result = job.run(user_id, download_id, style, progress=progress,
                                 sources=sources, master=False, roles=roles)
                try:
                    from routes.poc_mixer import warm_prepare
                    progress(100, 'Preparing the mixer')
                    warm_prepare(user_id, result['extraction_id'])
                except Exception as e:
                    logger.warning(f"[PREMIX] mixer warm-up skipped: {e}")
            _set(key, state='done', progress=100, message='Done', result=result)
            socketio.emit('premix_complete', dict(result, source_extraction_id=extraction_id), room=room)
        except Exception as e:
            logger.error(f"[PREMIX] failed for {extraction_id}: {e}", exc_info=True)
            _set(key, state='error', message=str(e), error=str(e))

    threading.Thread(target=work, daemon=True, name="premix").start()
    return jsonify({'started': True, 'tracks': sorted(sources)}), 202


@automix_bp.route('/api/automix/premix/<path:extraction_id>/status', methods=['GET'])
@api_login_required
def premix_status(extraction_id):
    with _LOCK:
        job = dict(_JOBS.get(('premix', current_user.id, extraction_id)) or {'state': 'idle'})
    return jsonify(job)
