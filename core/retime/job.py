"""Straighten a library song into a new, duplicate library song.

The source song is left untouched. The copy has a regular beat grid at the
average tempo of the source: every audio stem is warped along the same time map
(so the voice follows), the MIDI tracks are moved with it and their notes pulled
onto the grid, and the analysis that carries times (beats, chords, lyrics,
structure) is moved too. It opens in the mixer like any extracted song.
"""
import json
import os
import shutil
import uuid

import numpy as np

from core.automix import dsp
from core.automix.engine import load_stem, write_audio
from core.automix.job import ANALYSIS_COLUMNS, _folder_name, _free_title, _stems_of, analysis_select
from core.config import ensure_valid_downloads_directory, get_ffmpeg_path
from core.db.connection import _conn
from core.downloads_db import add_or_update, get_download_by_id, mark_extraction_complete
from core.logging_config import get_logger

from . import warp

logger = get_logger(__name__)

SUFFIX = "Retimed"
VOCAL_WEIGHT = 4.0                  # the lead vocal counts this much in the splice decisions
TIMED_COLUMNS = ("chords_data", "lyrics_data", "structure_data")


def _drums_full(stems_dir):
    for name in ("drums_full.mp3", "drums_full.wav"):
        path = os.path.join(stems_dir, name)
        if os.path.exists(path):
            return path
    return None


def run(user_id, download_id, beats, positions, division="1/16", strength=1.0, follow="beat",
        progress=None):
    """Straighten the song ``download_id`` of ``user_id``.

    ``beats`` / ``positions``: the beat grid the mixer shows for this song.
    ``division``: grid the MIDI notes are pulled to (see warp.DIVISIONS).
    ``strength``: 1.0 = fully regular, lower keeps part of the original feel.
    ``follow``: "beat" (every beat on the grid) or "bar" (tempo only, see warp.beat_map).
    Returns a dict describing the new song.
    """
    src = get_download_by_id(user_id, download_id)
    if not src:
        raise ValueError("Song not found")
    stems = _stems_of(src)
    if not src.get("extracted") or not stems:
        raise ValueError("Extract the stems of this song first")
    if division not in warp.DIVISIONS:
        raise ValueError(f"Unknown grid: {division}")

    def tell(pct, text):
        if progress:
            progress(float(pct), text)

    downloads_dir = ensure_valid_downloads_directory()
    title = _free_title(downloads_dir, _folder_name(f"{src['title']} ({SUFFIX})"))
    audio_dir = os.path.join(downloads_dir, title, "audio")
    stems_dir = os.path.join(audio_dir, "stems")
    src_stems_dir = os.path.dirname(next(iter(stems.values())))
    video_id = f"retime_{uuid.uuid4().hex[:12]}"
    ffmpeg = get_ffmpeg_path()

    try:
        os.makedirs(stems_dir, exist_ok=True)
        # ---- the guide: the mix, with the lead vocal pushed forward
        tell(3, "Reading the stems")
        guide = np.zeros(0, np.float32)
        for i, (name, path) in enumerate(stems.items()):
            x = load_stem(path).mean(axis=0)
            if name == "vocals":
                x = x * VOCAL_WEIGHT
            if len(x) > len(guide):
                guide = np.concatenate([guide, np.zeros(len(x) - len(guide), np.float32)])
            guide[:len(x)] += x
            tell(3 + 17 * (i + 1) / len(stems), "Reading the stems")
        duration = len(guide) / dsp.SR
        bm = warp.beat_map(beats, positions, duration, strength, follow)
        tell(22, "Planning the time map")
        plan = warp.splice_plan(guide, bm)
        del guide

        # ---- every stem along the same plan
        out, mix = {}, None
        for i, (name, path) in enumerate(stems.items()):
            tell(25 + 50 * i / len(stems), f"Warping {name}")
            y = warp.warp(load_stem(path), plan)
            out[name] = os.path.join(stems_dir, name + ".mp3")
            write_audio(out[name], y, ffmpeg)
            mix = y if mix is None else mix + y
        full = _drums_full(src_stems_dir)
        if full:                              # the kit as a whole, used by the mixer as a reference
            write_audio(os.path.join(stems_dir, "drums_full.mp3"), warp.warp(load_stem(full), plan), ffmpeg)
        tell(78, "Writing the mix")
        peak = float(np.abs(mix).max())
        if peak > 0.98:
            mix = mix * (0.98 / peak)
        mix_path = os.path.join(audio_dir, f"{title}.mp3")
        write_audio(mix_path, mix, ffmpeg)
        del mix

        # ---- the click on the exact grid (otherwise the mixer snaps it back on the drums)
        tell(82, "Rendering the metronome")
        try:
            from core.poc import metronome as M_metro
            ref = os.path.join(stems_dir, "drums_full.mp3")
            if not os.path.exists(ref):
                ref = next(iter(out.values()))
            M_metro.render_all(bm["beats"], bm["positions"], ref, stems_dir)
            os.replace(os.path.join(stems_dir, "metronome.wav"), os.path.join(stems_dir, "metronome_1.wav"))
        except Exception as exc:
            logger.warning(f"[RETIME] metronome not rendered: {exc}")

        # ---- MIDI tracks: same map, onsets on the grid
        tell(86, "Moving the MIDI tracks")
        midi = None
        try:
            from core.config import get_setting
            from core.midi import tracks as midi_tracks
            # A source without MIDI tracks (extracted before they existed) gets them
            # now, so the copy has them too.
            if not midi_tracks.load(src_stems_dir) and get_setting("enable_midi_tracks", True):
                tell(84, "Creating the MIDI tracks of the source")
                midi_tracks.build_for_video(src["video_id"], stems)
                tell(90, "Moving the MIDI tracks")

            def notes_map(stem, notes):
                return warp.map_notes(notes, bm, division, strength, snap=stem not in warp.UNSNAPPED)

            midi = midi_tracks.carry_over(src_stems_dir, stems_dir, out, ffmpeg,
                                          notes_map=notes_map, bpm=bm["bpm"])
        except Exception as exc:
            logger.warning(f"[RETIME] MIDI tracks not carried over: {exc}", exc_info=True)

        # a retimed copy of an auto remix is still that remix
        marker = os.path.join(os.path.dirname(src_stems_dir), "auto_remix.json")
        if os.path.exists(marker):
            shutil.copy2(marker, os.path.join(audio_dir, "auto_remix.json"))
        report = {"source_video_id": src["video_id"], "source_title": src["title"],
                  "division": division, "strength": strength, "follow": follow, "bpm": bm["bpm"],
                  "drift_ms": bm["drift_ms"], "jitter_ms": bm["jitter_ms"], "ratio": bm["ratio"],
                  "duration": round(bm["duration"], 3)}
        with open(os.path.join(audio_dir, "retime.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)

        tell(96, "Adding the song to the library")
        add_or_update(user_id, {"video_id": video_id, "title": title,
                                "thumbnail_url": src.get("thumbnail"), "file_path": mix_path,
                                "file_size": os.path.getsize(mix_path),
                                "download_type": "audio", "quality": "original"})
        mark_extraction_complete(video_id, {
            "model_name": src.get("extraction_model") or "retime",
            "stems_paths": out, "zip_path": ""})
        with _conn() as conn:
            row = conn.execute(f"SELECT {analysis_select()} "
                               "FROM user_downloads ud LEFT JOIN global_downloads gd ON gd.id = ud.global_download_id "
                               "WHERE ud.id = ? AND ud.user_id = ?", (download_id, user_id)).fetchone()
            values = {c: row[c] for c in ANALYSIS_COLUMNS}
            for c in TIMED_COLUMNS:           # JSON with times in it
                try:
                    if values[c]:
                        values[c] = json.dumps(warp.map_times(json.loads(values[c]), bm))
                except (TypeError, ValueError):
                    pass
            values["beat_times"] = json.dumps(bm["beats"])
            values["beat_positions"] = json.dumps(bm["positions"])
            values["detected_bpm"] = bm["bpm"]
            for c in ("beat_offset", "music_start_time"):
                if isinstance(values[c], (int, float)) and values[c]:
                    values[c] = round(float(warp.to_dst(values[c], bm)), 3)
            sets = ", ".join(f"{c} = ?" for c in ANALYSIS_COLUMNS)
            args = [values[c] for c in ANALYSIS_COLUMNS]
            conn.execute(f"UPDATE global_downloads SET {sets} WHERE video_id = ?", args + [video_id])
            conn.execute(f"UPDATE user_downloads SET {sets} WHERE video_id = ?", args + [video_id])
            new_id = conn.execute("SELECT id FROM user_downloads WHERE user_id = ? AND video_id = ?",
                                  (user_id, video_id)).fetchone()["id"]
            conn.commit()
    except Exception:
        shutil.rmtree(os.path.join(downloads_dir, title), ignore_errors=True)
        raise

    tell(100, "Done")
    logger.info(f"[RETIME] {src['title']} -> {title} ({bm['bpm']} BPM, drift {bm['drift_ms']} ms, "
                f"{len(out)} stems, MIDI {'yes' if midi else 'no'})")
    return dict(report, download_id=new_id, video_id=video_id, title=title,
                extraction_id=f"download_{new_id}", stems=sorted(out),
                midi_tracks=sorted((midi or {}).get("tracks", {})))
