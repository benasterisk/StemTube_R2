"""MIDI companion tracks of a song, kept in a sidecar folder next to the stems.

    <stems_dir>/midi/
        tracks.json            settings and facts per stem
        <stem>.mid             note-for-note transcription (editable)
        <stem>.simple.mid      block chords (stems that play chords/arpeggios only)
        <stem>.mp3             the track as currently rendered (mode + instrument)
        song.mid               every stem in one file

The mixer shows each rendered file as an extra track named "<stem>_midi". The
sidecar is not in the database: a song without it simply has no MIDI tracks.

A render is the notes played by the chosen instrument, then seated in the mix by
``seat``: family EQ, dynamics and room, and a level that comes from a mix model
rather than from the (often bleed-ridden) stem it doubles.
"""
import json
import os
import shutil
import threading

import numpy as np

from core.automix import dsp
from core.automix.engine import load_stem, write_audio

from . import instruments, seat, simplify, smf, soundfont, synths, transcribe

SIDE = "midi"
SUFFIX = "_midi"
HIDDEN = ("drums_full", "mix")
MIN_NOTES = 4
MAX_NOTES = 20000
VERSION = 2
_locks = {}
_locks_guard = threading.Lock()


def _lock(stems_dir):
    with _locks_guard:
        return _locks.setdefault(os.path.normcase(os.path.abspath(stems_dir)), threading.RLock())


def sidecar_dir(stems_dir):
    return os.path.join(stems_dir, SIDE)


def load(stems_dir):
    path = os.path.join(sidecar_dir(stems_dir), "tracks.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save(stems_dir, state):
    path = os.path.join(sidecar_dir(stems_dir), "tracks.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, path)


def track_files(stems_dir):
    """{"<stem>_midi": file} for every rendered track."""
    state = load(stems_dir)
    out = {}
    if state:
        for stem in state.get("tracks", {}):
            path = os.path.join(sidecar_dir(stems_dir), stem + ".mp3")
            if os.path.exists(path):
                out[stem + SUFFIX] = path
    return out


def _mid_path(stems_dir, stem, mode):
    return os.path.join(sidecar_dir(stems_dir), stem + (".simple.mid" if mode == "simple" else ".mid"))


def _mode_of(stems_dir, stem, entry):
    """The mode actually playable: "simple" only while its file exists."""
    if entry.get("mode") == "simple" and os.path.exists(_mid_path(stems_dir, stem, "simple")):
        return "simple"
    return "normal"


def is_named(stem, entry, has_sf=True):
    """Did the user choose the sound of this track? It then goes by the name of its instrument."""
    if "named" in entry:
        return bool(entry["named"])
    drums = entry.get("kind") == "drums"
    return entry.get("instrument") != instruments.default_for(entry.get("role", stem), drums, has_sf)


def _synthesize(notes, instrument, length_s):
    engine, _, preset = instrument.partition(":")
    if engine == "sf":
        return soundfont.render(notes, length_s, int(preset), False)
    if engine == "sfkit":
        return soundfont.render(notes, length_s, int(preset), True)
    if engine == "dm":
        return synths.render("drums", preset, notes, length_s)
    x = synths.render({"wt": "wavetable"}.get(engine, engine), preset, notes, length_s)
    if engine in ("fm", "wt"):        # left and right are separate detuned voices: narrow them
        x = np.stack([x[0] + 0.45 * x[1], x[1] + 0.45 * x[0]]) / 1.45
    return x


def _render_file(stems_dir, stem, entry, ffmpeg, style=None):
    side = sidecar_dir(stems_dir)
    notes = smf.read_notes(_mid_path(stems_dir, stem, _mode_of(stems_dir, stem, entry)))
    # role: the stem this track plays the part of, when it goes by another name
    role = entry.get("role", stem)
    played = notes if entry["kind"] == "drums" else seat.even_velocities(notes)
    audio = _synthesize(played, entry["instrument"], entry["duration"])
    if notes and float(np.abs(audio).max()) > 1e-6:
        # The EQ follows the sound, hardly the notes: computed once per instrument,
        # so an edit of the notes renders faster.
        cached = entry.get("eq") or {}
        if cached.get("for") == entry["instrument"] and len(cached.get("db", [])) == len(dsp.FC):
            curve = cached["db"]
        else:
            curve = [round(float(v), 2) for v in seat.eq_curve(audio, role, style)]
            entry["eq"] = {"for": entry["instrument"], "db": curve}
        audio = seat.process(audio, role, style, curve)
        audio = seat.finish(audio, entry.get("target", entry["lufs"]), entry.get("pan_db", 0.0))
    tmp = os.path.join(side, stem + ".tmp.mp3")
    write_audio(tmp, audio.astype(np.float32), ffmpeg, bitrate="192k", fast=True)
    os.replace(tmp, os.path.join(side, stem + ".mp3"))


def _write_song(stems_dir, state):
    """song.mid: the note-for-note file of every track, in one file."""
    song = []
    for stem, entry in state.get("tracks", {}).items():
        path = _mid_path(stems_dir, stem, "normal")
        if os.path.exists(path):
            song.append({"name": stem, "program": instruments.GM_PROGRAM.get(stem, 0),
                         "drums": entry["kind"] == "drums", "notes": smf.read_notes(path)})
    if song:
        smf.write(os.path.join(sidecar_dir(stems_dir), "song.mid"), song, state.get("bpm"))


def _pool(jobs, work, progress, share, base):
    """Run work(*job) for every job, a few at a time; one failing job does not lose the others."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    results = {}
    workers = max(1, min(4, (os.cpu_count() or 2) // 2))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, *job): job[0] for job in jobs}
        for done, fut in enumerate(as_completed(futures), 1):
            name = futures[fut]
            try:
                results[name] = fut.result()
            except Exception as exc:
                results[name] = None
                print(f"[MIDI] {name}: {exc}")
            if progress:
                progress(base + share * done / max(1, len(jobs)), name)
    return results


def build(stems_paths, chords=None, beat_times=None, beat_positions=None, bpm=None,
          progress=None, ffmpeg="ffmpeg", style=None, keep_notes=False, snap=None):
    """Transcribe every stem and render its companion.

    ``stems_paths``: {stem: file} of the mixer stems. ``style``: mixing style of
    the song when it is an auto remix. ``keep_notes``: reuse the notes, modes and
    sounds of the existing sidecar (edits survive) and only measure and render
    again. ``snap(stem, notes) -> notes`` moves freshly transcribed notes (a song
    that was straightened has its notes pulled onto its grid). Returns the sidecar
    state, or None when there is nothing to transcribe.
    """
    audio = {k: p for k, p in stems_paths.items() if k not in HIDDEN and not k.endswith(SUFFIX)
             and p and os.path.exists(p)}
    if not audio:
        return None
    stems_dir = os.path.dirname(next(iter(audio.values())))
    # A stem that is a MIDI track written out under the name of its instrument
    # (pre-mix) says nothing by its name: the sidecar remembers which stem it
    # plays the part of, and which instrument it is.
    existing = (load(stems_dir) or {}).get("tracks", {})
    roles = {k: e["role"] for k, e in existing.items() if e.get("role")}
    stems = {k: p for k, p in audio.items() if transcribe.kind_of(roles.get(k, k))}
    if not stems:
        return None
    side = sidecar_dir(stems_dir)
    with _lock(stems_dir):
        previous = existing if keep_notes else {}
        os.makedirs(side, exist_ok=True)
        has_sf = soundfont.ensure_player()
        if has_sf:
            try:
                soundfont.ensure_soundfont()
            except Exception:
                has_sf = False

        def analyse(stem, path):
            y = transcribe.load_mono(path)
            power = seat.band_power(y)
            parent = load_stem(path)
            info = {"lufs": dsp.loudness(parent)[0], "pan_db": seat.balance_db(parent),
                    "duration": parent.shape[1] / dsp.SR}
            del parent
            if stem not in stems:
                return power, info, None
            old = previous.get(stem)
            if old and os.path.exists(_mid_path(stems_dir, stem, "normal")):
                kept = {k: old[k] for k in ("kind", "mode", "instrument", "edited", "named", "role")
                        if k in old}
                kept["notes"] = len(smf.read_notes(_mid_path(stems_dir, stem, "normal")))
                return power, info, kept
            role = roles.get(stem, stem)
            kind, notes = transcribe.transcribe_audio(role, y)
            if snap is not None and notes:
                notes = snap(role, notes)
            if len(notes) < MIN_NOTES:
                return power, info, None
            drums = kind == "drums"
            program = instruments.GM_PROGRAM.get(role, 0)
            smf.write(_mid_path(stems_dir, stem, "normal"),
                      [{"name": stem, "program": program, "drums": drums, "notes": notes}], bpm)
            simple_path = _mid_path(stems_dir, stem, "simple")
            if os.path.exists(simple_path):
                os.remove(simple_path)
            if not drums and transcribe.PITCHED[role]["chords"]:
                simple_notes = simplify.simplify(notes, chords, beat_times, beat_positions)
                if len(simple_notes) >= MIN_NOTES:
                    smf.write(simple_path, [{"name": stem + " (simple)", "program": program,
                                             "notes": simple_notes}], bpm)
            fresh = {"kind": kind, "notes": len(notes), "mode": "normal",
                     "instrument": instruments.default_for(role, drums, has_sf)}
            if role != stem:                    # it is that instrument: its name says so
                fresh.update(role=role, named=True,
                             instrument=existing[stem].get("instrument", fresh["instrument"]))
            return power, info, fresh

        # The stems are independent: a few at a time (model inference, synthesis
        # and the MP3 encoder all release the interpreter lock for most of their work).
        found = _pool(list(audio.items()), analyse, progress, 0.6, 0.0)
        found = {k: v for k, v in found.items() if v}
        entries = {k: found[k][2] for k in stems if k in found and found[k][2]}
        if not entries:
            return None
        bleed = seat.bleed_shares({k: v[0] for k, v in found.items()})
        want = seat.targets({k: v[1]["lufs"] for k, v in found.items()}, bleed, list(entries))
        state = {"version": VERSION, "bpm": bpm, "style": style, "tracks": {}}
        for stem in stems:                      # same order as the stems
            if stem not in entries:
                continue
            info = found[stem][1]
            state["tracks"][stem] = dict(
                entries[stem], lufs=round(info["lufs"], 2), target=want[stem],
                bleed=round(bleed.get(stem, 0.0), 2), pan_db=round(info["pan_db"], 1),
                duration=round(info["duration"], 3),
                rev=int(previous.get(stem, {}).get("rev", 0)) + 1)
        del found

        def render(stem):
            _render_file(stems_dir, stem, state["tracks"][stem], ffmpeg, style)
            return True

        _pool([(k,) for k in state["tracks"]], render, progress, 0.4, 0.6)
        _write_song(stems_dir, state)
        _save(stems_dir, state)
        return state


def update(stems_dir, stem, mode=None, instrument=None, ffmpeg="ffmpeg"):
    """Change the mode and/or the sound of one track and render it again."""
    with _lock(stems_dir):
        state = load(stems_dir)
        if not state or stem not in state.get("tracks", {}):
            raise KeyError(stem)
        entry = state["tracks"][stem]
        if mode is not None:
            if mode not in ("normal", "simple") or (
                    mode == "simple" and not os.path.exists(_mid_path(stems_dir, stem, "simple"))):
                raise ValueError("This track has no such mode")
            entry["mode"] = mode
        if instrument is not None:
            if not instruments.exists(instrument, entry["kind"] == "drums"):
                raise ValueError("Unknown instrument")
            entry["instrument"] = instrument
            entry["named"] = True
        _render_file(stems_dir, stem, entry, ffmpeg, state.get("style"))
        entry["rev"] = int(entry.get("rev", 1)) + 1
        _save(stems_dir, state)
        return entry


def notes_of(stems_dir, stem):
    """The notes the track currently plays: (mode, [(start_s, end_s, pitch, velocity)])."""
    state = load(stems_dir)
    if not state or stem not in state.get("tracks", {}):
        raise KeyError(stem)
    mode = _mode_of(stems_dir, stem, state["tracks"][stem])
    return mode, smf.read_notes(_mid_path(stems_dir, stem, mode))


def clean_notes(notes, duration):
    """Validate notes coming from the editor. Raises ValueError on nonsense."""
    if not isinstance(notes, list) or len(notes) > MAX_NOTES:
        raise ValueError("Bad note list")
    out = []
    for n in notes:
        try:
            s, e, p, v = float(n[0]), float(n[1]), int(n[2]), int(n[3])
        except Exception:
            raise ValueError("Bad note")
        if not (np.isfinite(s) and np.isfinite(e)):
            raise ValueError("Bad note")
        s = min(max(0.0, s), max(0.0, duration - 0.02))
        e = min(max(s + 0.02, e), duration)
        if e - s < 0.01:
            continue
        out.append((s, e, min(127, max(0, p)), min(127, max(1, v))))
    return sorted(out, key=lambda n: (n[0], n[2]))


def set_notes(stems_dir, stem, notes, ffmpeg="ffmpeg"):
    """Replace the notes of the mode the track is in (editor) and render it again."""
    with _lock(stems_dir):
        state = load(stems_dir)
        if not state or stem not in state.get("tracks", {}):
            raise KeyError(stem)
        entry = state["tracks"][stem]
        mode = _mode_of(stems_dir, stem, entry)
        notes = clean_notes(notes, entry["duration"])
        drums = entry["kind"] == "drums"
        smf.write(_mid_path(stems_dir, stem, mode),
                  [{"name": stem + (" (simple)" if mode == "simple" else ""),
                    "program": instruments.GM_PROGRAM.get(stem, 0), "drums": drums,
                    "notes": notes}], state.get("bpm"))
        if mode == "normal":
            entry["notes"] = len(notes)
        entry["edited"] = sorted(set(entry.get("edited", [])) | {mode})
        _render_file(stems_dir, stem, entry, ffmpeg, state.get("style"))
        entry["rev"] = int(entry.get("rev", 1)) + 1
        if mode == "normal":
            _write_song(stems_dir, state)
        _save(stems_dir, state)
        return entry


def describe(stems_dir):
    """What the mixer needs: per track its settings, its modes and its instrument menu."""
    state = load(stems_dir)
    if not state:
        return {}
    has_sf = soundfont.available()
    out = {}
    for stem, e in state.get("tracks", {}).items():
        drums = e["kind"] == "drums"
        simple = os.path.exists(_mid_path(stems_dir, stem, "simple"))
        named = is_named(stem, e, has_sf)
        out[stem + SUFFIX] = {
            "stem": stem, "kind": e["kind"], "mode": _mode_of(stems_dir, stem, e),
            "named": named, "role": e.get("role"),
            "title": instruments.track_title(e.get("role", stem), e["instrument"], drums) if named else None,
            "modes": ["normal", "simple"] if simple else ["normal"],
            "instrument": e["instrument"], "instrument_label": instruments.label(e["instrument"]),
            "notes": e.get("notes", 0), "rev": e.get("rev", 1),
            "bleed": e.get("bleed", 0.0), "edited": e.get("edited", []),
            "options": instruments.options_for(e.get("role", stem), drums, has_sf)}
    return out


def carry_over(src_stems_dir, dst_stems_dir, new_stems, ffmpeg="ffmpeg", style=None,
               notes_map=None, bpm=None, alias=None):
    """Give a copy of the song (auto remix, retimed copy) the MIDI tracks of its source.

    Each track keeps its mode and its sound and is seated again against the new
    stems. ``notes_map(stem, notes) -> notes`` moves the notes when the copy has
    another timing; without it they are copied as they are. Tracks whose stem did
    not survive are left out. ``alias``: {new stem: stem of the source} for stems
    of the copy that are a MIDI track written out under its own name; they get the
    notes of that source track and keep its role.
    """
    state = load(src_stems_dir)
    if not state:
        return None
    src, dst = sidecar_dir(src_stems_dir), sidecar_dir(dst_stems_dir)
    with _lock(dst_stems_dir):
        os.makedirs(dst, exist_ok=True)
        new = {"version": VERSION, "bpm": bpm if bpm else state.get("bpm"),
               "style": style if style else state.get("style"), "tracks": {}}
        levels, pans, lengths = {}, {}, {}
        for stem, path in new_stems.items():
            if stem in HIDDEN or not path or not os.path.exists(path):
                continue
            x = load_stem(path)
            levels[stem] = dsp.loudness(x)[0]
            pans[stem] = seat.balance_db(x)
            lengths[stem] = x.shape[1] / dsp.SR
            del x
        origin = {k: k for k in state.get("tracks", {})}
        origin.update({new_name: old for new_name, old in (alias or {}).items()
                       if old in state.get("tracks", {})})
        kept = [k for k, old in origin.items()
                if k in levels and os.path.exists(os.path.join(src, old + ".mid"))]
        # the stems written by the remix are clean: no bleed to take off
        bleed = {} if style else {k: state["tracks"][origin[k]].get("bleed", 0.0) for k in kept}
        want = seat.targets(levels, bleed, kept)
        for stem in kept:
            entry = state["tracks"][origin[stem]]
            if origin[stem] != stem:
                entry = dict(entry, role=entry.get("role", origin[stem]))
            drums = entry["kind"] == "drums"
            for mode in ("normal", "simple"):
                a = _mid_path(src_stems_dir, origin[stem], mode)
                if not os.path.exists(a):
                    continue
                if notes_map is None:
                    shutil.copy2(a, _mid_path(dst_stems_dir, stem, mode))
                else:
                    smf.write(_mid_path(dst_stems_dir, stem, mode),
                              [{"name": stem, "program": instruments.GM_PROGRAM.get(stem, 0),
                                "drums": drums, "notes": notes_map(stem, smf.read_notes(a))}],
                              new["bpm"])
            e = dict(entry, rev=1, lufs=round(levels[stem], 2), target=want[stem],
                     pan_db=round(pans[stem], 1), duration=round(lengths[stem], 3))
            if style:
                e["bleed"] = 0.0
            new["tracks"][stem] = e
        if not new["tracks"]:
            shutil.rmtree(dst, ignore_errors=True)
            return None

        def render(stem):
            _render_file(dst_stems_dir, stem, new["tracks"][stem], ffmpeg, new["style"])
            return True

        _pool([(k,) for k in new["tracks"]], render, None, 1.0, 0.0)
        _write_song(dst_stems_dir, new)
        _save(dst_stems_dir, new)
        return new


def build_for_video(video_id, stems_paths, progress=None, keep_notes=False):
    """build() with the chords, beat grid and tempo stored for ``video_id``."""
    from core.config import get_ffmpeg_path
    from core.db.connection import _conn
    chords, beats, positions, bpm = [], [], [], None
    try:
        with _conn() as conn:
            row = conn.execute("SELECT chords_data, beat_times, beat_positions, detected_bpm "
                               "FROM global_downloads WHERE video_id = ?", (video_id,)).fetchone()
        if row:
            chords = json.loads(row["chords_data"] or "[]")
            beats = json.loads(row["beat_times"] or "[]")
            positions = json.loads(row["beat_positions"] or "[]")
            bpm = row["detected_bpm"]
    except Exception:
        pass
    style, snap = None, None
    audio_dir = ""
    try:
        audio_dir = os.path.dirname(os.path.dirname(next(iter(stems_paths.values()))))
    except Exception:
        pass
    try:        # an auto remix copy records its style next to its audio
        with open(os.path.join(audio_dir, "auto_remix.json"), encoding="utf-8") as f:
            style = json.load(f).get("style")
    except Exception:
        pass
    try:        # a straightened copy is on a regular grid: its notes go on that grid
        with open(os.path.join(audio_dir, "retime.json"), encoding="utf-8") as f:
            retimed = json.load(f)
        if len(beats) > 8:
            from core.retime import warp
            grid_map = warp.identity_map(beats)
            division, strength = retimed.get("division", "1/16"), float(retimed.get("strength", 1.0))

            def snap(stem, notes):
                return warp.map_notes(notes, grid_map, division, strength,
                                      snap=stem not in warp.UNSNAPPED)
    except Exception:
        pass
    return build(stems_paths, chords, beats, positions, bpm, progress, get_ffmpeg_path(),
                 style=style, keep_notes=keep_notes, snap=snap)
