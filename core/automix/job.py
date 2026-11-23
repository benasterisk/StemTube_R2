"""Auto remix of a library song into a new, duplicate library song.

The source song is left untouched. The duplicate gets its own id, its own folder
and the processed stems, and inherits the analysis of the source (tempo, key,
beats, chords, lyrics, structure): the timing is the same, only the sound changed.
It opens in the mixer like any extracted song, starting from the chosen style.

On the multi-user server the duplicate is a song of its own (new ``video_id``, new
``global_downloads`` row) and is added to the library of the user who asked for it,
and of that user only.
"""
import json
import os
import re
import shutil
import uuid

from core.config import ensure_valid_downloads_directory, get_ffmpeg_path
from core.db.connection import _conn
from core.downloads_db import add_or_update, get_download_by_id, mark_extraction_complete
from core.logging_config import get_logger

from .engine import remix
from .styles import FAMILY, STYLES

logger = get_logger(__name__)

# Analysis copied as is from the source song (raw column values).
ANALYSIS_COLUMNS = ("detected_bpm", "detected_key", "analysis_confidence", "chords_data",
                    "beat_offset", "structure_data", "lyrics_data", "beat_times",
                    "beat_positions", "music_start_time", "metronome_offset_ms", "media_metadata")
# Stems that live next to the others but are not mixer tracks.
HIDDEN_STEMS = ("drums_full",)
# Analysis a user sets for themselves: their value wins over the shared one.
PER_USER_COLUMNS = ("metronome_offset_ms",)


def analysis_select():
    """SQL column list reading the analysis of a song as its user sees it.

    The analysis is shared by every user of a song (global_downloads, with the
    user's own row as a fallback), except the columns a user sets for themselves.
    Tables are aliased gd (global_downloads) and ud (user_downloads).
    """
    return ", ".join(
        ("COALESCE(ud.%s, gd.%s) AS %s" if c in PER_USER_COLUMNS else "COALESCE(gd.%s, ud.%s) AS %s") % (c, c, c)
        for c in ANALYSIS_COLUMNS)


def _folder_name(title):
    """A title that is also a valid folder name on every platform."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", title).strip(" .")
    return name or "Remix"


def _free_title(downloads_dir, base):
    title, i = base, 2
    while os.path.exists(os.path.join(downloads_dir, title)):
        title = f"{base} {i}"
        i += 1
    return title


def _stems_of(row):
    paths = row.get("stems_paths")
    if isinstance(paths, str):
        paths = json.loads(paths or "{}")
    return {k: p for k, p in (paths or {}).items()
            if k not in HIDDEN_STEMS and p and os.path.exists(p)}


def run(user_id, download_id, style, dry_vocals=False, progress=None, sources=None, master=True,
        roles=None):
    """Remix the song ``download_id`` of ``user_id``. Returns a dict describing the new song.

    ``sources``: {stem: file or [files]} to mix instead of the stems of the song
    (the tracks the mixer currently plays, a MIDI track standing in for its stem).
    ``master=False``: a pre-mix, without the master stage (see engine.remix).
    ``roles``: {stem: stem of the source} for the mixed stems that are a MIDI
    track under its own name; they are mixed and get MIDI tracks as that stem.
    """
    src = get_download_by_id(user_id, download_id)
    if not src:
        raise ValueError("Song not found")
    stems = _stems_of(src)
    if not src.get("extracted") or not stems:
        raise ValueError("Extract the stems of this song first")
    mixed = sources or stems
    if style not in STYLES:
        raise ValueError(f"Unknown style: {style}")

    downloads_dir = ensure_valid_downloads_directory()
    label = STYLES[style]["label"].replace(" / ", "-")
    kind = "Remix" if master else "Pre-mix"
    title = _free_title(downloads_dir, _folder_name(f"{src['title']} ({kind} {label})"))
    audio_dir = os.path.join(downloads_dir, title, "audio")
    stems_dir = os.path.join(audio_dir, "stems")
    video_id = f"autoremix_{uuid.uuid4().hex[:12]}"

    dry = None
    if dry_vocals:
        from .dereverb import dereverb as dry

    try:
        os.makedirs(stems_dir, exist_ok=True)
        report = remix(mixed, stems_dir, style=style, dereverb=dry, progress=progress,
                       ffmpeg=get_ffmpeg_path(), ext="mp3", master=master,
                       families={k: FAMILY.get(v, "other") for k, v in (roles or {}).items()})
        mix_path = os.path.join(audio_dir, f"{title}.mp3")
        shutil.move(report.pop("mix"), mix_path)

        # The mixer snaps the beat grid on drums_full (or the drums stem) when it
        # builds its metronome. Hand it the source's untouched drums so the grid,
        # the metronome and the song length come out exactly as on the source.
        src_stems_dir = os.path.dirname(next(iter(stems.values())))
        for name in ("drums_full.mp3", "drums_full.wav"):
            if os.path.exists(os.path.join(src_stems_dir, name)):
                shutil.copy2(os.path.join(src_stems_dir, name), os.path.join(stems_dir, name))
                break
        else:
            if "drums" in stems:
                ext = os.path.splitext(stems["drums"])[1]
                shutil.copy2(stems["drums"], os.path.join(stems_dir, "drums_full" + ext))

        # MIDI companion tracks follow their stem into the copy (same notes, same
        # sound and mode), levelled on the remixed stem. Never fatal.
        try:
            from core.midi import tracks as midi_tracks
            if progress:
                progress(99, "Carrying the MIDI tracks over")
            midi_tracks.carry_over(src_stems_dir, stems_dir, report["stems"], get_ffmpeg_path(),
                                    style=style, alias=roles)
        except Exception as exc:
            logger.warning(f"[AUTO REMIX] MIDI tracks not carried over: {exc}")

        with open(os.path.join(audio_dir, "auto_remix.json"), "w", encoding="utf-8") as f:
            json.dump({"source_video_id": src["video_id"], "source_title": src["title"],
                       "style": style, "dry_vocals": bool(dry_vocals), "premix": not master,
                       "cleaning": report["cleaning"], "settings": report["settings"],
                       "master": report["master"], "dereverb": report.get("dereverb")}, f, indent=1)

        add_or_update(user_id, {"video_id": video_id, "title": title,
                                "thumbnail_url": src.get("thumbnail"), "file_path": mix_path,
                                "file_size": os.path.getsize(mix_path),
                                "download_type": "audio", "quality": "original"})
        mark_extraction_complete(video_id, {
            "model_name": src.get("extraction_model") or "auto_remix",
            "stems_paths": report["stems"], "zip_path": ""})
        sets = ", ".join(f"{c} = ?" for c in ANALYSIS_COLUMNS)
        with _conn() as conn:
            row = conn.execute(f"SELECT {analysis_select()} "
                               "FROM user_downloads ud LEFT JOIN global_downloads gd ON gd.id = ud.global_download_id "
                               "WHERE ud.id = ? AND ud.user_id = ?", (download_id, user_id)).fetchone()
            values = [row[c] for c in ANALYSIS_COLUMNS]
            conn.execute(f"UPDATE global_downloads SET {sets} WHERE video_id = ?", values + [video_id])
            conn.execute(f"UPDATE user_downloads SET {sets} WHERE video_id = ?", values + [video_id])
            new_id = conn.execute("SELECT id FROM user_downloads WHERE user_id = ? AND video_id = ?",
                                  (user_id, video_id)).fetchone()["id"]
            conn.commit()
    except Exception:
        shutil.rmtree(os.path.join(downloads_dir, title), ignore_errors=True)
        raise

    logger.info(f"[AUTO REMIX] {src['title']} -> {title} ({style}, {len(report['stems'])} stems)")
    return {"download_id": new_id, "video_id": video_id, "title": title,
            "extraction_id": f"download_{new_id}", "stems": sorted(report["stems"]),
            "cleaning": report["cleaning"], "master": report["master"]}
