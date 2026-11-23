"""Retime routes: straighten a song into a copy with a regular beat grid."""
import threading

from flask import Blueprint, jsonify, request
from flask_login import current_user

from extensions import api_login_required, socketio
from core.logging_config import get_logger

logger = get_logger(__name__)

retime_bp = Blueprint('retime', __name__)

# One job per user and source song: {(user_id, extraction_id): {state, progress, message, result | error}}
_JOBS = {}
_LOCK = threading.Lock()


def _set(key, **fields):
    with _LOCK:
        _JOBS.setdefault(key, {}).update(fields)
        return dict(_JOBS[key])


@retime_bp.route('/api/retime/<path:extraction_id>', methods=['POST'])
@api_login_required
def retime_start(extraction_id):
    """Body: {division?: "1/4"|"1/8"|"1/16"|"1/8T"|"1/16T", strength?: 0..1, follow?: "beat"|"bar"}."""
    from core.retime import warp
    from routes.poc_mixer import _db_beats, _read_meta, _resolve_context, _user_cache_dir
    data = request.get_json(silent=True) or {}
    division = str(data.get('division') or '1/16')
    if division not in warp.DIVISIONS:
        return jsonify({'error': 'Unknown grid'}), 400
    try:
        strength = min(1.0, max(0.1, float(data.get('strength', 1.0))))
    except (TypeError, ValueError):
        return jsonify({'error': 'Bad strength'}), 400
    follow = "bar" if data.get('follow') == 'bar' else "beat"
    try:
        row, _stems, _stems_dir = _resolve_context(current_user.id, extraction_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    # The grid the mixer shows to this user (snapped on the drums) when it has one,
    # else the stored analysis.
    meta = _read_meta(_user_cache_dir(current_user.id, row['id'])) or {}
    beats, positions = meta.get('beats'), meta.get('positions')
    if not (beats and positions and len(beats) == len(positions)):
        beats, positions = _db_beats(row)
    if not beats or len(beats) < warp.MIN_BEATS:
        return jsonify({'error': 'No beat grid for this song: open it in the mixer first'}), 400
    user_id = current_user.id
    download_id = row['id']
    key = (user_id, extraction_id)
    with _LOCK:
        if _JOBS.get(key, {}).get('state') == 'running':
            return jsonify({'error': 'Already running'}), 409
        _JOBS[key] = {'state': 'running', 'progress': 0, 'message': 'Starting'}
    room = f"user_{user_id}"

    def progress(pct, text):
        _set(key, progress=round(pct, 1), message=text)
        socketio.emit('retime_progress', {'extraction_id': extraction_id, 'progress': round(pct, 1),
                                          'message': text}, room=room)

    def work():
        try:
            from core.automix.gate import heavy_job
            from core.retime import job
            with heavy_job(lambda: progress(0, 'Waiting for another job to finish')):
                result = job.run(user_id, download_id, beats, positions, division=division,
                                 strength=strength, follow=follow, progress=progress)
                try:
                    from routes.poc_mixer import warm_prepare
                    progress(100, 'Preparing the mixer')
                    warm_prepare(user_id, result['extraction_id'])
                except Exception as e:
                    logger.warning(f"[RETIME] mixer warm-up skipped: {e}")
            _set(key, state='done', progress=100, message='Done', result=result)
            socketio.emit('retime_complete', dict(result, source_extraction_id=extraction_id), room=room)
        except Exception as e:
            logger.error(f"[RETIME] failed for {extraction_id}: {e}", exc_info=True)
            _set(key, state='error', message=str(e), error=str(e))
            socketio.emit('retime_error', {'extraction_id': extraction_id, 'error': str(e)}, room=room)

    threading.Thread(target=work, daemon=True, name="retime").start()
    return jsonify({'started': True}), 202


@retime_bp.route('/api/retime/<path:extraction_id>/status', methods=['GET'])
@api_login_required
def retime_status(extraction_id):
    with _LOCK:
        job = dict(_JOBS.get((current_user.id, extraction_id)) or {'state': 'idle'})
    return jsonify(job)
