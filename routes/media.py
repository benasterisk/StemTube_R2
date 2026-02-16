"""
Blueprint for lyrics, chords, beats, and Musixmatch API routes.

Covers lyrics retrieval/regeneration, chord/beat regeneration,
and Musixmatch search integration.
"""

import os
import json

from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import api_login_required, socketio
from core.config import get_setting
from core.logging_config import get_logger
from core.downloads_db import find_any_global_extraction as db_find_any_global_extraction

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
        from core.downloads_db import get_download_by_id, list_extractions_for, update_download_analysis
        from core.chord_detector import analyze_audio_file
        from core.config import load_config

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

        config = load_config()
        use_hybrid = config.get('chords_use_hybrid', True)
        use_madmom = config.get('chords_use_madmom', True)

        chords_json, beat_offset, beat_times = analyze_audio_file(
            audio_path,
            bpm=download.get('detected_bpm'),
            detected_key=download.get('detected_key'),
            use_hybrid=use_hybrid,
            use_madmom=use_madmom
        )

        if not chords_json:
            return jsonify({'error': 'Chord detection failed'}), 500

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

        video_id = download.get('video_id')
        if not video_id:
            return jsonify({'error': 'Video ID not found'}), 400

        update_download_analysis(
            video_id,
            download.get('detected_bpm'),
            download.get('detected_key'),
            download.get('analysis_confidence'),
            chords_json,
            beat_offset,
            structure_data,
            lyrics_data,
            beat_times=beat_times
        )

        parsed_chords = json.loads(chords_json)
        return jsonify({
            'success': True,
            'chords': parsed_chords,
            'beat_offset': beat_offset,
            'beat_times': beat_times
        })

    except Exception as e:
        logger.error(f"Error regenerating chords: {e}", exc_info=True)
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
        beat_offset, beats = detector._detect_beats(audio_path, download.get('detected_bpm'))
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
            beat_times=beat_times
        )

        return jsonify({
            'success': True,
            'beat_times': beat_times,
            'beat_offset': beat_offset,
            'beat_count': len(beat_times)
        })

    except Exception as e:
        logger.error(f"Error regenerating beats: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Lyrics regeneration (unified endpoint)
# ------------------------------------------------------------------

@media_bp.route('/api/extractions/<extraction_id>/lyrics/regenerate', methods=['POST'])
@api_login_required
def regenerate_extraction_lyrics(extraction_id):
    """
    Unified lyrics regeneration: Musixmatch first, then Whisper fallback.

    This is the single endpoint for all lyrics regeneration requests.
    Flow: Musixmatch (word-level) -> Whisper fallback (if Musixmatch fails)
    Emits SocketIO 'lyrics_progress' events for real-time UI updates.

    Request JSON (optional):
        - artist: Override artist name for Musixmatch search
        - track: Override track name for Musixmatch search
        - force_whisper: Skip Musixmatch and use Whisper directly
    """
    try:
        from core.downloads_db import get_download_by_id, update_download_lyrics, list_extractions_for
        from core.lyrics_detector import detect_lyrics_unified

        # Get request parameters
        req_data = request.get_json(silent=True) or {}
        override_artist = req_data.get('artist', '').strip()
        override_track = req_data.get('track', '').strip()
        force_whisper = req_data.get('force_whisper', False)
        skip_onset_sync = req_data.get('skip_onset_sync', False)
        musixmatch_track_id = req_data.get('musixmatch_track_id')

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
        if file_path:
            vocals_stem_path = os.path.join(os.path.dirname(file_path), "stems", "vocals.mp3")
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
        if skip_onset_sync:
            logger.info(f"[LYRICS] Skip onset sync mode enabled")
        logger.info(f"[LYRICS] Model: {model_size}, GPU: {use_gpu}")

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

        # Unified detection: Musixmatch -> Whisper fallback
        result = detect_lyrics_unified(
            audio_path=audio_path,
            title=db_title,
            model_size=model_size,
            use_gpu=use_gpu,
            progress_callback=progress_callback,
            override_artist=override_artist if override_artist else None,
            override_track=override_track if override_track else None,
            force_whisper=force_whisper,
            skip_onset_sync=skip_onset_sync,
            musixmatch_track_id=musixmatch_track_id
        )

        lyrics_data = result.get('lyrics')
        source = result.get('source')
        alignment_stats = result.get('alignment_stats')

        if not lyrics_data:
            return jsonify({
                'error': 'Failed to detect lyrics (LrcLib and Whisper both failed)',
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
            'segments_count': len(lyrics_data),
            'has_word_timestamps': any('words' in seg for seg in lyrics_data),
            'alignment_stats': alignment_stats
        })

    except Exception as e:
        logger.error(f"Error regenerating lyrics: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Musixmatch search
# ------------------------------------------------------------------

@media_bp.route('/api/musixmatch/search', methods=['POST'])
@api_login_required
def musixmatch_search():
    """Search Musixmatch for tracks matching artist/track query."""
    try:
        from core.musixmatch_client import search_tracks

        req_data = request.get_json(silent=True) or {}
        artist = req_data.get('artist', '').strip()
        track = req_data.get('track', '').strip()

        if not artist and not track:
            return jsonify({'error': 'Artist or track name required'}), 400

        results = search_tracks(artist=artist, track=track, page_size=10)

        return jsonify({
            'results': results,
            'query': f"{artist} - {track}".strip(' -')
        })

    except Exception as e:
        logger.error(f"Error searching Musixmatch: {e}", exc_info=True)
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
