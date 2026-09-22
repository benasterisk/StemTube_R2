"""
Blueprint for lyrics, chords, beats, and lyrics search routes.

Covers lyrics retrieval/regeneration, chord/beat regeneration,
and LRCLIB lyrics search.
"""

import os
import json

from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required, socketio
from core.config import get_setting
from core.logging_config import get_logger
from core.downloads_db import find_any_global_extraction as db_find_any_global_extraction


def _as_list(value):
    """DB JSON columns come back as a JSON string, a list or None."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def _find_download_for(extraction_id):
    """Resolve an extraction id (download_<id>, video id or filename prefix) to a row."""
    from core.downloads_db import get_download_by_id, list_extractions_for
    download = None
    if extraction_id.startswith('download_'):
        download = get_download_by_id(current_user.id, extraction_id.replace('download_', ''))
    if not download:
        for db_extraction in list_extractions_for(current_user.id):
            video_id = db_extraction.get('video_id', '')
            file_path = db_extraction.get('file_path', '')
            filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''
            if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                download = db_extraction
                break
    if not download:
        download = db_find_any_global_extraction(extraction_id)
    return download

logger = get_logger(__name__)

media_bp = Blueprint('media', __name__)


# ------------------------------------------------------------------
# Lyrics retrieval
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/lyrics', methods=['GET'])
@api_login_required
def get_extraction_lyrics(extraction_id):
    """Get or generate lyrics for an extraction"""
    try:
        from core.downloads_db import get_download_by_id, list_extractions_for

        # Find download using same logic as get_extraction_status
        download = None
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        else:
            # Search by video_id or filename
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path) if file_path else ''

                # Normalize extraction_id for comparison (strip timestamp suffix like _1760135361)
                normalized_extraction_id = extraction_id.rsplit('_', 1)[0] if '_' in extraction_id else extraction_id
                # Also strip .mp3 extension if present in extraction_id for comparison
                normalized_extraction_id = normalized_extraction_id.replace('.mp3', '')
                normalized_filename = filename.replace('.mp3', '')

                # Match by video_id or filename (with/without .mp3 extension)
                matches = (
                    video_id == extraction_id or
                    filename == extraction_id or
                    (normalized_filename and normalized_extraction_id.startswith(normalized_filename))
                )

                if matches:
                    download = db_extraction
                    logger.info(f"[LYRICS] Found extraction by matching {extraction_id} with video_id={video_id} or filename={filename}")
                    break

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        # Check if lyrics already exist
        if download.get('lyrics_data'):
            lyrics_json = download['lyrics_data']
            lyrics = json.loads(lyrics_json) if isinstance(lyrics_json, str) else lyrics_json
            return jsonify({
                'success': True,
                'lyrics': lyrics,
                'cached': True
            })

        # Lyrics not cached
        return jsonify({
            'success': False,
            'message': 'Lyrics not yet generated. Please request generation.',
            'cached': False
        })

    except Exception as e:
        logger.error(f"Error getting lyrics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Chords regeneration
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/chords/regenerate', methods=['POST'])
@api_login_required
def regenerate_extraction_chords(extraction_id):
    """Regenerate chord timeline for an extraction."""
    try:
        from core.downloads_db import get_download_by_id, list_extractions_for

        download = None
        download_id = extraction_id
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        if not download:
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''
                if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                    download = db_extraction
                    break

        if not download:
            download = db_find_any_global_extraction(extraction_id)

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        # Same pass as after an extraction: BTC on the harmonic stems, decoded on the
        # stored beat grid, key re-estimated. Only chords and key are written; the beat
        # grid, Skip Intro and the rest of the analysis are left untouched.
        from core.chord_refiner import update_song_chords
        result = update_song_chords(video_id)
        if not result:
            return jsonify({'error': 'Chord detection failed'}), 500

        return jsonify({
            'success': True,
            'chords': result['chords'],
            'detected_key': result['key'],
            'key_confidence': result['key_confidence'],
            'source': result['source'],
            'detected_bpm': download.get('detected_bpm'),
            # the STORED grid, so clients keep their metronome alignment
            'beat_offset': download.get('beat_offset') or 0.0,
            'beat_times': _as_list(download.get('beat_times')),
            'beat_positions': _as_list(download.get('beat_positions'))
        })

    except Exception as e:
        logger.error(f"Error regenerating chords: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Structure analysis
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/analyze-structure', methods=['POST'])
@api_login_required
def analyze_extraction_structure(extraction_id):
    """Detect song sections with MSAF and store them as structure_data."""
    try:
        from core.downloads_db import update_download_analysis
        from core.msaf_structure_detector import detect_song_structure_msaf

        download = _find_download_for(extraction_id)
        if not download:
            return jsonify({'error': 'Extraction not found'}), 404
        audio_path = download.get('file_path')
        if not audio_path or not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404
        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        sections = detect_song_structure_msaf(audio_path)
        if not sections:
            return jsonify({'error': 'Structure detection failed'}), 500

        # Everything else is None, so COALESCE keeps the stored analysis untouched.
        update_download_analysis(video_id, None, None, None, structure_data=sections)
        return jsonify({
            'success': True,
            'structure': {'sections': sections},
            'sections_count': len(sections)
        })
    except Exception as e:
        logger.error(f"Error analyzing structure: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Beats regeneration
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/beats/regenerate', methods=['POST'])
@api_login_required
def regenerate_extraction_beats(extraction_id):
    """Regenerate beat timestamps using madmom beat tracker."""
    try:
        from core.downloads_db import get_download_by_id, list_extractions_for, update_download_analysis
        from core.madmom_chord_detector import MadmomChordDetector

        download = None
        download_id = extraction_id
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        if not download:
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path).replace('.mp3', '') if file_path else ''
                if video_id == extraction_id or (filename and extraction_id.startswith(filename)):
                    download = db_extraction
                    break

        if not download:
            download = db_find_any_global_extraction(extraction_id)

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        audio_path = download.get('file_path')
        if not audio_path or not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        detector = MadmomChordDetector()
        beat_offset, beats, beat_positions = detector._detect_beats(audio_path, download.get('detected_bpm'))
        beat_times = [round(float(b), 4) for b in beats]

        # Preserve existing analysis fields, only update beat data
        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        structure_data = download.get('structure_data')
        if isinstance(structure_data, str):
            try:
                structure_data = json.loads(structure_data)
            except Exception:
                structure_data = None

        lyrics_data = download.get('lyrics_data')
        if isinstance(lyrics_data, str):
            try:
                lyrics_data = json.loads(lyrics_data)
            except Exception:
                lyrics_data = None

        update_download_analysis(
            video_id,
            download.get('detected_bpm'),
            download.get('detected_key'),
            download.get('analysis_confidence'),
            download.get('chords_data'),
            beat_offset,
            structure_data,
            lyrics_data,
            beat_times=beat_times,
            beat_positions=beat_positions
        )

        # Chords are decoded on the beat grid: a new grid means new chord boundaries.
        chords = None
        try:
            from core.chord_refiner import update_song_chords
            chords_result = update_song_chords(video_id)
            chords = chords_result['chords'] if chords_result else None
        except Exception as chords_error:
            logger.warning(f"[CHORDS] Re-decoding after beat regeneration failed: {chords_error}")

        return jsonify({
            'success': True,
            'beat_times': beat_times,
            'beat_positions': beat_positions,
            'beat_offset': beat_offset,
            'beat_count': len(beat_times),
            'chords': chords
        })

    except Exception as e:
        logger.error(f"Error regenerating beats: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Metronome grid alignment (per-user manual nudge)
# ------------------------------------------------------------------

@media_bp.route('/api/media/<video_id>/metronome-offset', methods=['POST'])
@api_login_required
def update_metronome_offset(video_id):
    """Save the manual metronome grid-alignment nudge (milliseconds).

    Backported from the Friend desktop edition, REWRITTEN for multi-user:
    Friend updates global_downloads unconditionally, which in a shared
    library would let one user's nudge overwrite the grid alignment for
    everyone. Here the nudge is personal - write ONLY the current user's
    user_downloads row (read back user-first via
    COALESCE(ud.metronome_offset_ms, gd.metronome_offset_ms)).
    """
    try:
        data = request.json or {}
        offset_ms = float(data.get('offset_ms', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid offset_ms'}), 400

    # Clamp to the client-side nudge range (+/-1 s) to keep stored values sane
    offset_ms = max(-1000.0, min(1000.0, offset_ms))

    try:
        from core.db.connection import _conn
        with _conn() as conn:
            cur = conn.execute(
                "UPDATE user_downloads SET metronome_offset_ms=? WHERE user_id=? AND video_id=?",
                (offset_ms, current_user.id, video_id)
            )
            updated = cur.rowcount

        if updated == 0:
            return jsonify({'error': 'No matching download for this user'}), 404

        return jsonify({'success': True, 'metronome_offset_ms': offset_ms})
    except Exception as e:
        logger.error(f"Error saving metronome offset: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Lyrics regeneration (unified endpoint)
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/lyrics/regenerate', methods=['POST'])
@api_login_required
def regenerate_extraction_lyrics(extraction_id):
    """
    Regenerate lyrics (core.lyrics_detector.detect_lyrics_unified): LRCLIB text aligned on
    Whisper word timings, Whisper alone when LRCLIB has nothing.
    Emits SocketIO 'lyrics_progress' events for real-time UI updates.

    Request JSON (optional):
        - artist / track: search terms (default: YouTube metadata, then the title)
        - force_whisper: skip LRCLIB, transcribe with Whisper only
        - lrclib_id: LRCLIB record picked in the search dialog
        - sync_with_whisper: false keeps the record's own line timing (default true)
    """
    try:
        from core.downloads_db import get_download_by_id, update_download_lyrics, list_extractions_for
        from core.lyrics_detector import detect_lyrics_unified

        # Get request parameters
        req_data = request.get_json(silent=True) or {}
        override_artist = req_data.get('artist', '').strip()
        override_track = req_data.get('track', '').strip()
        force_whisper = bool(req_data.get('force_whisper', False))
        lrclib_id = req_data.get('lrclib_id')
        sync_with_whisper = req_data.get('sync_with_whisper', True) is not False

        # Find download
        download = None
        if extraction_id.startswith('download_'):
            download_id = extraction_id.replace('download_', '')
            download = get_download_by_id(current_user.id, download_id)
        else:
            db_extractions = list_extractions_for(current_user.id)
            for db_extraction in db_extractions:
                video_id = db_extraction.get('video_id', '')
                file_path = db_extraction.get('file_path', '')
                filename = os.path.basename(file_path) if file_path else ''

                normalized_extraction_id = extraction_id.rsplit('_', 1)[0] if '_' in extraction_id else extraction_id
                normalized_extraction_id = normalized_extraction_id.replace('.mp3', '')
                normalized_filename = filename.replace('.mp3', '')

                matches = (
                    video_id == extraction_id or
                    filename == extraction_id or
                    (normalized_filename and normalized_extraction_id.startswith(normalized_filename))
                )

                if matches:
                    download = db_extraction
                    break

        if not download:
            return jsonify({'error': 'Extraction not found'}), 404

        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        # Get file paths
        file_path = download.get('file_path')
        db_title = download.get('title', '')

        # Use vocals stem if available for better quality
        audio_path = file_path
        stems_paths = download.get('stems_paths') or {}
        if isinstance(stems_paths, str):
            try:
                stems_paths = json.loads(stems_paths)
            except ValueError:
                stems_paths = {}
        vocals_stem_path = stems_paths.get('vocals')
        if vocals_stem_path:
            from core.downloads_db import resolve_file_path
            vocals_stem_path = resolve_file_path(vocals_stem_path) or vocals_stem_path
        elif file_path:
            vocals_stem_path = os.path.join(os.path.dirname(file_path), "stems", "vocals.mp3")
        if vocals_stem_path:
            if os.path.exists(vocals_stem_path):
                audio_path = vocals_stem_path
                logger.info(f"[LYRICS] Using vocals stem: {vocals_stem_path}")

        if not audio_path or not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        # Get settings (single source of truth)
        model_size = get_setting('lyrics_model_size')
        use_gpu = get_setting('use_gpu_for_extraction', False)

        logger.info(f"[LYRICS] Regenerating lyrics for: {db_title}")
        if override_artist or override_track:
            logger.info(f"[LYRICS] User override: artist='{override_artist}', track='{override_track}'")
        if force_whisper:
            logger.info(f"[LYRICS] Force Whisper mode enabled")
        logger.info(f"[LYRICS] Model: {model_size}, GPU: {use_gpu}, LRCLIB id: {lrclib_id}, "
                    f"sync with Whisper: {sync_with_whisper}")

        # Progress callback to emit SocketIO events
        def progress_callback(step, message):
            try:
                socketio.emit('lyrics_progress', {
                    'extraction_id': extraction_id,
                    'step': step,
                    'message': message,
                    'model': model_size,
                    'gpu': use_gpu
                }, namespace='/')
            except Exception as e:
                logger.warning(f"[LYRICS] Failed to emit progress: {e}")

        from core.media_metadata import load_media_metadata
        from core.downloads_db import resolve_file_path

        result = detect_lyrics_unified(
            audio_path=audio_path,
            title=db_title,
            model_size=model_size,
            use_gpu=use_gpu,
            progress_callback=progress_callback,
            override_artist=override_artist if override_artist else None,
            override_track=override_track if override_track else None,
            force_whisper=force_whisper,
            lrclib_id=int(lrclib_id) if lrclib_id else None,
            sync_with_whisper=sync_with_whisper,
            media_metadata=load_media_metadata(video_id),
            file_path=resolve_file_path(file_path) or file_path
        )

        lyrics_data = result.get('lyrics')
        source = result.get('source')
        alignment_stats = result.get('alignment_stats')

        if not lyrics_data:
            return jsonify({
                'error': 'Failed to detect lyrics (LRCLIB and Whisper both failed)',
                'artist': result.get('artist'),
                'track': result.get('track')
            }), 500

        # Save lyrics to database
        update_download_lyrics(video_id, lyrics_data)

        logger.info(f"[LYRICS] Success ({source}): {len(lyrics_data)} segments")

        return jsonify({
            'success': True,
            'lyrics': lyrics_data,
            'source': source,
            'artist': result.get('artist'),
            'track': result.get('track'),
            'language': result.get('language'),
            'lrclib_id': result.get('lrclib_id'),
            'segments_count': len(lyrics_data),
            'has_word_timestamps': any('words' in seg for seg in lyrics_data),
            'alignment_stats': alignment_stats
        })

    except Exception as e:
        logger.error(f"Error regenerating lyrics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Lyrics search (LRCLIB)
# ------------------------------------------------------------------

@media_bp.route('/api/lyrics/search', methods=['POST'])
@api_login_required
def lyrics_search():
    """Search LRCLIB for lyrics matching an artist/track query."""
    try:
        from core.lrclib_client import search_tracks

        req_data = request.get_json(silent=True) or {}
        artist = req_data.get('artist', '').strip()
        track = req_data.get('track', '').strip()

        if not artist and not track:
            return jsonify({'error': 'Artist or track name required'}), 400

        results = search_tracks(artist=artist, track=track, limit=10)

        return jsonify({
            'results': results,
            'query': f"{artist} - {track}".strip(' -')
        })

    except Exception as e:
        logger.error(f"Error searching LRCLIB: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Legacy routes - redirect to unified endpoint
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/lyrics/generate', methods=['POST'])
@api_login_required
def generate_extraction_lyrics(extraction_id):
    """DEPRECATED: Use /lyrics/regenerate instead. Redirects to unified endpoint."""
    logger.warning(f"[LYRICS] Deprecated /generate endpoint called, redirecting to /regenerate")
    return regenerate_extraction_lyrics(extraction_id)


@media_bp.route('/api/extractions/<extraction_id>/lyrics/lrclib', methods=['POST'])
@api_login_required
def fetch_lrclib_lyrics(extraction_id):
    """DEPRECATED: Use /lyrics/regenerate instead. Redirects to unified endpoint."""
    logger.warning(f"[LYRICS] Deprecated /lrclib endpoint called, redirecting to /regenerate")
    return regenerate_extraction_lyrics(extraction_id)
