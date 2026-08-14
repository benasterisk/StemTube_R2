"""
Server-side mix export.

Mixes the active stems (with their volume + pan) into a stereo file and, when
asked, bakes in the metronome click track EXACTLY as the user hears it in the
mixer — including the count-in (precount), the skip-intro start, and the
metronome-stop cutoff. All of that is already rendered, sample-locked, into the
`metronome_precount_{res}.wav` produced by precount.render_precount(); this module
just lays the stems and that click track onto one timeline the same way the
browser does at playback (audio.js).

Design (mirrors static/js/poc/audio.js playback):
  * Stems play from `firstOffset` in the song timeline (firstOffset = start_time -
    heard_precount_beats * ibi, clamped to >= 0).
  * The precount metronome WAV is itself prefixed with `lead_silence` of silence,
    so to align its song body with the stems the metronome is read from
    (firstOffset + lead_silence). When precount beats are HEARD, the count-in
    clicks sit BEFORE the song — the output therefore opens with the count-in and
    the stems enter `heard_precount_beats * ibi` seconds later.
  * Tempo/pitch are NOT applied here — the export is at the song's original tempo
    (the mixer's time-stretch is a live SoundTouch effect; replicating it offline
    is out of scope for v1).

Output is float32 stereo; written as WAV, then optionally transcoded to MP3 with
ffmpeg (falls back to WAV if ffmpeg is unavailable).
"""
from __future__ import annotations
import os
import shutil
import subprocess

import numpy as np
import soundfile as sf


# Stems that are real audio (everything except the metronome click track).
_REAL_STEMS = ("drums", "bass", "vocals", "other", "guitar", "piano")


def _read_audio(path, target_sr):
    """Read any stem (wav via soundfile, mp3/other via librosa) → (float32 [N,2], sr).

    Returns stereo (duplicating mono). Resamples to target_sr when it differs.
    """
    ext = os.path.splitext(path)[1].lower()
    data = None
    sr = None
    if ext in (".wav", ".flac", ".ogg", ".aiff", ".aif"):
        data, sr = sf.read(path, dtype="float32", always_2d=True)  # [N, ch]
    else:
        # mp3/m4a/etc — librosa decodes via audioread/ffmpeg
        import librosa
        y, sr = librosa.load(path, sr=None, mono=False)            # [ch, N] or [N]
        if y.ndim == 1:
            data = y[:, None]
        else:
            data = y.T
        data = data.astype(np.float32, copy=False)

    if data.ndim == 1:
        data = data[:, None]
    # to stereo
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]

    if target_sr and sr != target_sr:
        import librosa
        # resample each channel
        res = librosa.resample(data.T, orig_sr=sr, target_sr=target_sr)  # [ch, N]
        data = res.T.astype(np.float32, copy=False)
        sr = target_sr
    return data, sr


def _pan_gains(pan):
    """Equal-power stereo pan. pan in [-1,1]; returns (left_gain, right_gain)."""
    p = max(-1.0, min(1.0, float(pan or 0.0)))
    angle = (p + 1.0) * (np.pi / 4.0)   # -1→0, 0→π/4, +1→π/2
    return float(np.cos(angle)), float(np.sin(angle))


def _limit(stereo, ceiling=0.989):
    """Brick-wall safety + normalize to `ceiling` if the mix peaks over it.

    Mirrors the intent of audio.js's master limiter: let the metronome be loud
    without clipping. A simple peak-normalize is enough for an offline render.
    """
    peak = float(np.max(np.abs(stereo))) if stereo.size else 0.0
    if peak > ceiling:
        stereo *= (ceiling / peak)
    return stereo


def render_mix(stems_map, tracks, out_path,
               metro_wav=None, lead_silence=0.0, first_offset=0.0,
               metro_gain=1.0, lead_pad=0.0, sr=44100, fmt="mp3", mp3_bitrate="192k"):
    """Render the current mix to `out_path` (extension chosen by `fmt`).

    Args:
      stems_map: {stem_name: abs_path} for the real stems (mp3/wav on disk).
      tracks: {stem_name: {"vol": float, "pan": float, "muted": bool, "solo": bool}}
              — the mixer state for each real stem. Solo/mute follow DAW rules.
      out_path: target file path WITHOUT enforced extension; the real extension is
                derived from `fmt` and returned.
      metro_wav: abs path to the baked metronome WAV to include (already contains
                 precount + skip-intro + stop cutoff), or None to omit the click.
      lead_silence: seconds of silence prepended to metro_wav (from the precount
                    plan) — the click is read offset by this so its song body lines
                    up with the stems.
      first_offset: song-time position the stems start from (== precount firstOffset
                    when a count-in is heard, else 0). Determines how much of the
                    metronome's lead-in count-in is placed before the stems.
      lead_pad: seconds of SILENCE inserted at the very front of the output (stems
                pushed right by this much). The metronome's count-in falls inside this
                pad, so the file opens with silence + count-in clicks, THEN the song —
                matching the timeline's visible lead-in. Mutually used with first_offset=0.
      sr: output sample rate.
      fmt: "mp3" or "wav".
      mp3_bitrate: ffmpeg bitrate for mp3.

    Returns the absolute path actually written (extension matches the format used).
    """
    # ── resolve which stems are audible (DAW solo/mute) ──
    any_solo = any(t.get("solo") for t in tracks.values())

    def audible(name):
        t = tracks.get(name, {})
        if t.get("muted"):
            return False
        return bool(t.get("solo")) if any_solo else True

    active = [(n, p) for n, p in stems_map.items()
              if n in _REAL_STEMS and os.path.exists(p) and audible(n)]
    if not active and not metro_wav:
        raise ValueError("nothing to export: no audible stems and no metronome")

    # ── load the stems (and the metronome) onto a common timeline ──
    # All stems share length/sr in practice; we still align by sample index.
    loaded = []
    for name, path in active:
        data, _sr = _read_audio(path, sr)
        loaded.append((name, data))

    pad = max(0.0, lead_pad)
    pad_samp = int(round(pad * sr))

    metro_data = None
    if metro_wav and os.path.exists(metro_wav):
        metro_data, _ = _read_audio(metro_wav, sr)

    if pad_samp > 0:
        # Lead-in pad: `pad` seconds of SILENCE open the file; the stems enter at the
        # pad, the metronome's count-in plays inside it. Output sample 0 == song-time
        # -pad; output `pad_samp` == song 0.
        #   stem  out-offset = pad_samp           (read stem from song 0)
        #   metro out-offset = 0, read WAV from (lead_silence - pad) → song-time -pad
        stem_out = pad_samp
        stem_read = 0
        metro_out = 0
        metro_read = int(round((max(0.0, lead_silence) - pad) * sr))
    else:
        # No pad: playback ("From Start") starts the stems at first_offset and reads
        # the metronome WAV from (first_offset + lead_silence) → both share origin.
        stem_out = 0
        stem_read = int(round(max(0.0, first_offset) * sr))
        metro_out = 0
        metro_read = int(round((max(0.0, first_offset) + max(0.0, lead_silence)) * sr))

    # Output length = the longest of every source as it sits on the output timeline,
    # so a metronome-only export (all stems muted) still produces full audio.
    body_len = 0
    for _name, data in loaded:
        body_len = max(body_len, stem_out + (data.shape[0] - stem_read))
    if metro_data is not None:
        body_len = max(body_len, metro_out + (metro_data.shape[0] - metro_read))
    body_len = max(0, body_len)

    mix = np.zeros((body_len, 2), dtype=np.float32)
    for name, data in loaded:
        seg = data[stem_read:]
        if seg.shape[0] == 0:
            continue
        seg = seg[:max(0, body_len - stem_out)]
        if seg.shape[0] == 0:
            continue
        t = tracks.get(name, {})
        vol = float(t.get("vol", 1.0))
        lg, rg = _pan_gains(t.get("pan", 0.0))
        n = seg.shape[0]
        mix[stem_out:stem_out + n, 0] += seg[:, 0] * vol * lg
        mix[stem_out:stem_out + n, 1] += seg[:, 1] * vol * rg

    # ── lay the metronome click on the same timeline ──
    if metro_data is not None:
        mr = max(0, metro_read)
        seg = metro_data[mr:]
        # if metro_read is negative (count-in before song start with a pad), the WAV's
        # own front already supplies that lead — clamp read to 0 and offset the write.
        write_at = metro_out + max(0, -metro_read)
        seg = seg[:max(0, body_len - write_at)]
        if seg.shape[0]:
            n = seg.shape[0]
            g = float(metro_gain)
            mix[write_at:write_at + n, 0] += seg[:, 0] * g
            mix[write_at:write_at + n, 1] += seg[:, 1] * g

    mix = _limit(mix)

    # ── write WAV, optionally transcode to MP3 ──
    base = os.path.splitext(out_path)[0]
    wav_path = base + ".wav"
    sf.write(wav_path, mix, sr, subtype="PCM_16")

    if fmt == "wav":
        return wav_path

    mp3_path = base + ".mp3"
    ff = shutil.which("ffmpeg")
    if not ff:
        # no encoder available → return the WAV we already wrote
        return wav_path
    try:
        subprocess.run(
            [ff, "-y", "-loglevel", "error", "-i", wav_path,
             "-codec:a", "libmp3lame", "-b:a", mp3_bitrate, mp3_path],
            check=True, timeout=300,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return wav_path
    finally:
        # the wav is an intermediate when mp3 succeeds
        if os.path.exists(mp3_path):
            try:
                os.remove(wav_path)
            except OSError:
                pass
    return mp3_path if os.path.exists(mp3_path) else wav_path
