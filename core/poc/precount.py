"""
"Detect Intro" + hard-baked precount.

Bakes a count-in straight into the metronome WAVs (one per resolution) so it is
sample-locked to the stems and follows time-stretch automatically (it IS the
metronome track). Strategy, per the user's design:

  1. Take a START time (auto-detected first steady downbeat, or user-provided).
  2. Compute the precount tempo from the 4 real beats AFTER the start.
  3. Build a regular grid of `precount_count` beats (default 8) ending exactly on
     the start, at that tempo.
  4. Erase the pre-intro metronome (everything before the start) and write only:
       precount clicks (before start) + the song's own beats (from start on),
     each resolution applying the same half/on/double rule to BOTH halves.
  5. If there isn't room before the start for the precount, report `lead_silence`
     (seconds) so playback can delay the stems by that much (scaled by tempo at
     play time). The metronome WAV still starts at t=0 with the precount.

Originals (metronome.wav, metronome_0.5.wav, metronome_2.wav) are left intact;
precount versions are written as metronome_precount_{res}.wav → reversible.
"""
from __future__ import annotations
import os
import statistics
import numpy as np
import soundfile as sf

from .metronome import _resolution_grid, METRONOME_RESOLUTIONS
from .startpoint import detect_start
from . import click_kit


PRECOUNT_COUNT = 8        # how many precount beats to bake in (UI plays 2/4/8 of them)
PRECOUNT_TEMPO_BEATS = 4  # number of post-start beats used to estimate the tempo


def _precount_tempo_ibi(beats, start_index):
    """Median inter-beat interval of the PRECOUNT_TEMPO_BEATS beats after start."""
    seg = beats[start_index:start_index + PRECOUNT_TEMPO_BEATS + 1]
    ibis = [seg[i + 1] - seg[i] for i in range(len(seg) - 1)]
    if not ibis:
        # fall back to whole-song median
        all_ibi = [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]
        return statistics.median(all_ibi) if all_ibi else 0.5
    return statistics.median(ibis)


def plan(beats, positions, start_index=None, start_time=None, precount_count=PRECOUNT_COUNT,
         stop_time=None):
    """
    Compute the precount plan without rendering. Returns a dict:
      start_index, start_time, precount_ibi, precount_bpm, precount_count,
      precount_times (absolute seconds, in the ORIGINAL timeline; may be negative
      if there isn't room), lead_silence (seconds to prepend if times go < 0),
      stop_time (seconds, original timeline) — the metronome click stops AFTER this
      point; the count-in is always kept. `None` = click runs to the end.
    """
    if start_index is None and start_time is None:
        start_index, start_time = detect_start(beats, positions)
    elif start_index is None:
        # snap provided time to nearest beat
        start_index = min(range(len(beats)), key=lambda i: abs(beats[i] - start_time))
        start_time = beats[start_index]
    else:
        start_time = beats[start_index]

    ibi = _precount_tempo_ibi(beats, start_index)
    # precount beats end ON the start: times = start - k*ibi for k=count..1
    times = [start_time - k * ibi for k in range(precount_count, 0, -1)]
    earliest = times[0]
    lead_silence = max(0.0, -earliest) if earliest < 0 else 0.0
    st = None
    if stop_time is not None:
        try:
            st = round(float(stop_time), 3)
        except (TypeError, ValueError):
            st = None
    return {
        "start_index": int(start_index),
        "start_time": round(float(start_time), 3),
        "precount_ibi": round(float(ibi), 4),
        "precount_bpm": int(round(60.0 / ibi)) if ibi > 0 else 120,
        "precount_count": int(precount_count),
        "precount_times": [round(float(t), 3) for t in times],
        "lead_silence": round(float(lead_silence), 3),
        "stop_time": st,
    }


def _grid_for_resolution(precount_times, song_beats, song_positions, start_index, resolution):
    """
    Build (times, downbeats) for one resolution, combining:
      - precount beats (a regular grid; apply half/double like a normal grid,
        treating each precount beat as a non-downbeat except keep accents sane)
      - the song's own beats from start onward (its real positions)
    """
    times, downs = [], []

    # PRECOUNT half: treat as plain beats; apply resolution
    if resolution == 0.5:
        pc = [(precount_times[i], False) for i in range(0, len(precount_times), 2)]
    elif resolution == 2:
        pc = []
        for i in range(len(precount_times)):
            pc.append((precount_times[i], False))
            if i + 1 < len(precount_times):
                pc.append(((precount_times[i] + precount_times[i + 1]) / 2.0, False))
    else:
        pc = [(t, False) for t in precount_times]
    # accent the LAST precount click (it's the lead-in to "1")
    if pc:
        pc[-1] = (pc[-1][0], True)

    # SONG half: from start_index onward, with real positions, apply resolution
    sb = song_beats[start_index:]
    sp = song_positions[start_index:] if song_positions else [0] * len(sb)
    sg_times, sg_downs = _resolution_grid(sb, sp, resolution)

    for t, d in pc:
        times.append(t); downs.append(d)
    for t, d in zip(sg_times, sg_downs):
        times.append(t); downs.append(d)
    return times, downs


def _render_grid_to_wav(times, downs, sr, total, shift, out_path,
                        metro_start=None, stop_time=None, keep_below=None,
                        instrument="click"):
    """Render a (times, downbeats) click grid into a fixed-length WAV.

    total       : output frame count (== song frames + lead silence).
    shift       : seconds prepended (lead silence); each click written at bt+shift.
    metro_start : drop SONG clicks at bt < metro_start (None = no start cutoff).
    stop_time   : drop SONG clicks at bt > stop_time (None = no end cutoff).
    keep_below  : clicks with bt < keep_below are ALWAYS kept (immune to BOTH
                  cutoffs) — used to keep the count-in audible. None = no exemption.
    instrument  : timbre id (see core.poc.click_kit); accent on downbeats.
    """
    accent, normal = click_kit.sample(instrument, sr)
    maxn = max(len(accent), len(normal))
    track = np.zeros(total + maxn, dtype=np.float32)
    for bt, is_db in zip(times, downs):
        immune = keep_below is not None and bt < keep_below
        if not immune:
            if metro_start is not None and bt < metro_start:
                continue
            if stop_time is not None and bt > stop_time:
                continue
        idx = int(round((bt + shift) * sr))
        if 0 <= idx < total:
            smp = accent if is_db else normal
            end = min(idx + len(smp), len(track))
            track[idx:end] += smp[:end - idx]
    sf.write(out_path, track[:total], sr)


def render_precount(beats, positions, ref_wav, stems_dir,
                    start_index=None, start_time=None, precount_count=PRECOUNT_COUNT,
                    stop_time=None, instrument="click"):
    """
    Render metronome_precount_{res}.wav for each resolution. The pre-intro metro
    is erased; only precount + post-start song clicks are written. Times are
    shifted by `lead_silence` so nothing is negative (the WAV starts at 0 with the
    first precount click); playback applies the same lead_silence to the stems.

    If `stop_time` (seconds, original timeline) is given, the song clicks AFTER it
    are dropped — the click guides the intro then goes silent while the stems keep
    playing. The count-in is always kept (only song beats, i.e. bt >= start_time,
    are subject to the cutoff). The WAV keeps its full length (silence after the
    cutoff) so the stems stay aligned.

    When `stop_time` is set we ALSO render metronome_stop_{res}.wav: the full-song
    metronome (no count-in, no lead silence) with the same cutoff, so playback can
    honour the cutoff even with the count-in turned Off (see `stop_files`). When
    `stop_time` is None those files are removed (cutoff cleared).

    Returns the plan dict augmented with `files` {res: "stems/...wav"} and, when a
    cutoff exists, `stop_files` {res: "stems/metronome_stop_...wav"}.
    """
    p = plan(beats, positions, start_index, start_time, precount_count, stop_time)
    shift = p["lead_silence"]
    st = p["stop_time"]                 # None or seconds (original timeline)
    song_start = p["start_time"]

    info = sf.info(ref_wav)
    sr = int(info.samplerate)
    song_frames = int(info.frames)
    # total length = original song + the lead silence we prepend (if any)
    total = song_frames + int(round(shift * sr))

    files = {}
    stop_files = {}
    for res, suffix in METRONOME_RESOLUTIONS.items():
        # ── count-in + song, cutoff applied (count-in immune) ──
        times, downs = _grid_for_resolution(p["precount_times"], beats, positions,
                                            p["start_index"], res)
        out = os.path.join(stems_dir, f"metronome_precount_{suffix}.wav")
        _render_grid_to_wav(times, downs, sr, total, shift, out,
                            stop_time=st, keep_below=song_start, instrument=instrument)
        files[suffix] = f"stems/{os.path.basename(out)}"

        # ── full-song metronome with the same cutoff (no count-in), for the
        # "whole song from t=0" playback/export mode (precount Off) ──
        stop_out = os.path.join(stems_dir, f"metronome_stop_{suffix}.wav")
        if st is not None:
            sg_times, sg_downs = _resolution_grid(beats, positions or [0] * len(beats), res)
            _render_grid_to_wav(sg_times, sg_downs, sr, song_frames, 0.0, stop_out,
                                metro_start=None, stop_time=st, keep_below=None,
                                instrument=instrument)
            stop_files[suffix] = f"stems/{os.path.basename(stop_out)}"
        elif os.path.exists(stop_out):
            os.remove(stop_out)   # cutoff cleared → drop the stale stop track

    p["files"] = files
    p["stop_files"] = stop_files
    p["lead_silence"] = shift
    return p
