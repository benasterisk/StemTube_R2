"""Auto remix: turn separated stems into a cleaned, balanced, styled set of stems.

Made for rough sources such as a rehearsal recorded on a phone. The output is a
new set of stems that add up to a finished mix at unity gain, so the mixer opens
on the chosen style and every fader, the tempo and the pitch still work on top.

Chain:
  1. cleaning   empty stems are dropped, bleed is pushed down where another stem
                owns the sound, stems that are only bleed are dropped, a harmonic
                stem that only shows up now and then is given back to the main
                harmonic instrument
  2. per stem   corrective EQ toward a neutral instrument spectrum (measured on
                studio recordings, neutral_reference.json) + style tone, phrase
                gate, compression or drum attack lift
  3. balance    kit pieces against the kick, families against the lead vocal,
                from the style
  4. stereo     pan and mono-compatible widening, vocal reverb, drum room
  5. master     tonal balance, glue compression, -14 LUFS, limiter; every master
                gain is applied to each stem so the stems still sum to the mix
"""
import json
import os
import subprocess

import numpy as np

from . import dsp
from .dsp import FC, SR
from .styles import (BACKING_VOCALS_LEVEL, BASS_LOW_PASS, DEFAULT_STYLE, FAMILY, HARMONIC,
                     HIGH_PASS, KIT, KIT_LEVEL, KIT_PUNCH, KIT_TONE, MAX_BOOST, RATIO, STYLES)

EMPTY_LU = -30.0        # further than this under the mix: nothing there
BLEED_SHARE = 0.55      # above this share of energy under other stems: only bleed
SPARSE_ACTIVE = 0.15    # a harmonic stem active less than this is a misfiled passage
MAX_LIFT = 6.0          # most a family is raised to reach the style balance (dB)
BACKGROUND_LU = -18.0   # a family this far under the mix is never raised
TARGET_LUFS = -14.0
PREMIX_LUFS = -18.0     # level of a pre-mix (no master stage): headroom left for the faders
MIN_REFERENCE_SONGS = 3
PAN_SLOTS = (-0.3, 0.3, -0.15, 0.15)

_REFERENCE = None


def neutral_reference():
    global _REFERENCE
    if _REFERENCE is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "neutral_reference.json")
        with open(path, encoding="utf-8") as f:
            _REFERENCE = json.load(f)
    return _REFERENCE


def load_stem(path):
    import librosa
    x, _ = librosa.load(path, sr=SR, mono=False)
    if x.ndim == 1:
        x = np.stack([x, x])
    return x[:2].astype(np.float32)


def write_audio(path, x, ffmpeg="ffmpeg", bitrate="320k", fast=False):
    """Encode (2, n) float32 to the format given by the file extension.

    ``fast`` trades a little MP3 quality for encoding speed (tracks rendered on demand).
    """
    cmd = [ffmpeg, "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0"]
    if path.lower().endswith(".mp3"):
        cmd += ["-b:a", bitrate]
        if fast:
            cmd += ["-compression_level", "7"]
    cmd.append(path)
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000      # CREATE_NO_WINDOW
    done = subprocess.run(cmd, input=np.ascontiguousarray(x.T, dtype=np.float32).tobytes(),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if done.returncode != 0:
        raise RuntimeError(f"ffmpeg failed writing {path}: {done.stderr.decode(errors='replace')[-300:]}")


def _db(g):
    return 10 ** (g / 20)


def _load_sources(source):
    """One stem from one file, or from several files added together (audio + its MIDI double)."""
    if isinstance(source, (list, tuple)):
        parts = [load_stem(p) for p in source]
        n = min(p.shape[1] for p in parts)
        return sum(p[:, :n] for p in parts).astype(np.float32)
    return load_stem(source)


def remix(stem_paths, out_dir, style=DEFAULT_STYLE, dereverb=None, dry_share=0.75,
          progress=None, ffmpeg="ffmpeg", ext="mp3", master=True, families=None):
    """Process the stems in ``stem_paths`` ({name: file or [files]}) into ``out_dir``.

    ``master=False`` makes a pre-mix: the stems are cleaned, shaped, balanced and
    placed as usual, but the master stage (tonal balance, glue compression,
    loudness, limiter) is left out; one plain gain, the same for every stem, only
    leaves headroom. ``families``: {name: family} for stems whose name does not
    say what they are (a MIDI track written out under the name of its instrument).

    ``dereverb`` is an optional callable taking and returning a (2, n) array; when
    given, the lead vocal is dried with it and blended back at ``dry_share``.
    ``progress(percent, text)`` is called along the way.

    Returns a report: ``stems`` ({name: file} of the stems written), ``mix`` (file
    of the stereo mix-down), ``cleaning`` (what happened to each input stem),
    ``settings`` (per stem moves) and ``master``.
    """
    if style not in STYLES:
        raise ValueError(f"Unknown style: {style}")
    st = STYLES[style]
    ref = neutral_reference()

    def tell(pct, text):
        if progress:
            progress(float(pct), text)

    tell(2, "Loading stems")
    stems = {k: _load_sources(p) for k, p in stem_paths.items()}
    if not stems:
        raise ValueError("No stems to remix")
    n = min(v.shape[1] for v in stems.values())
    stems = {k: v[:, :n] for k, v in stems.items()}
    fam = {k: (families or {}).get(k) or FAMILY.get(k, "other") for k in stems}
    report = {"style": style, "cleaning": {}, "settings": {}}

    # ---- optional: dry the lead vocal
    if dereverb is not None and "vocals" in stems:
        tell(6, "Drying the lead vocal")
        try:
            dry = dereverb(stems["vocals"])[:, :n]
            lift = dsp.loudness(stems["vocals"])[0] - dsp.loudness(dry)[0]
            if np.isfinite(lift) and abs(lift) < 24:
                stems["vocals"] = (dry * _db(lift) * dry_share
                                   + stems["vocals"] * (1 - dry_share)).astype(np.float32)
                report["dereverb"] = {"lift_db": round(float(lift), 1), "dry_share": dry_share}
        except Exception as exc:          # the remix must not fail on the optional helper
            report["dereverb"] = {"error": str(exc)}

    # ---- 1. cleaning
    tell(12, "Cleaning the stems")
    mix_lufs = dsp.loudness(sum(stems.values()))[0]
    measured = {k: dsp.loudness(v) for k, v in stems.items()}
    state = {}
    for k, (lv, act) in measured.items():
        if lv - mix_lufs < EMPTY_LU or act < 0.02:
            state[k] = "empty"
    if "kick" in stems and "kick" not in state:
        for k in KIT:
            if k in stems and k not in state and measured[k][0] < measured["kick"][0] - 30:
                state[k] = "empty"
    live = {k: v for k, v in stems.items() if k not in state}
    if not live:
        raise ValueError("Every stem is empty")
    cleaned, share = dsp.clean_stems(live)
    del live
    for k in cleaned:
        lv = dsp.loudness(cleaned[k])[0]
        state[k] = "bleed" if (share[k] > BLEED_SHARE or lv - mix_lufs < EMPTY_LU) else "kept"
    # A harmonic stem that only shows up now and then is a passage of the main
    # harmonic instrument that the separation filed under another name.
    harm = [k for k in cleaned if state[k] == "kept" and fam[k] in HARMONIC]
    if len(harm) > 1:
        main = max(harm, key=lambda k: measured[k][0])
        for k in harm:
            if k != main and measured[k][1] < SPARSE_ACTIVE:
                cleaned[main] = cleaned[main] + cleaned[k]
                state[k] = "folded into " + main
    for k in stems:
        report["cleaning"][k] = {"state": state[k], "bleed_share": round(share.get(k, 1.0), 2),
                                 "level_lu": round(measured[k][0] - mix_lufs, 1),
                                 "active": round(measured[k][1], 2)}
    proc = {k: cleaned[k] for k in cleaned if state[k] == "kept"}
    del cleaned, stems
    if not proc:
        raise ValueError("Nothing left after cleaning")
    families = {}
    for k in proc:
        families.setdefault(fam[k], []).append(k)
    has_kit = any(k in proc for k in KIT)
    # level of each family in the source, relative to the whole recording
    family_lu = {f: dsp.loudness(sum(proc[k] for k in members))[0] - mix_lufs
                 for f, members in families.items()}

    # ---- 2. per stem: tone, phrase gate, dynamics
    step = 0
    for f, members in families.items():
        cur = dsp.ltas(sum(proc[k] for k in members))
        target = ref.get(f)
        if target and target.get("n", 0) >= MIN_REFERENCE_SONGS:
            base = dsp.match_curve(cur, target["ltas"], max_boost=MAX_BOOST[f])
        else:
            base = np.zeros(len(FC))
        base = base + dsp.high_pass(HIGH_PASS[f]) + dsp.bumps(st["tone"].get(f))
        if f == "bass":
            base = base + dsp.low_pass(BASS_LOW_PASS)
        for k in members:
            step += 1
            tell(20 + 35 * step / len(proc), f"Shaping {k}")
            curve = base + (dsp.through(KIT_TONE[k]) if k in KIT_TONE else 0)
            x = dsp.eq_fir(proc[k], curve)
            x *= dsp.expand_gain(x)
            reduction = 0.0
            if f == "drums":
                if k in KIT_PUNCH:
                    x *= dsp.transient_gain(x, 0.75 * st["punch"], 5.0)
                elif k == "drums" and not has_kit:
                    x *= dsp.transient_gain(x, st["punch"], 7.0)
            else:
                thr = dsp.peak_threshold(x) + 3.0 * (1 - st["comp"])
                g, reduction = dsp.compress_gain(x, thr, 1 + RATIO.get(f, 1.0) * st["comp"],
                                                 att_ms=20 if f == "bass" else 8, rel_ms=140)
                x *= g
            proc[k] = x
            report["settings"][k] = {
                "family": f,
                "eq_db": {str(int(fc)): round(float(v), 1) for fc, v in zip(FC, curve)},
                "compression_db": round(reduction, 1), "gain_db": 0.0, "pan": 0.0}

    # ---- 3. balance
    tell(58, "Balancing")

    def trim(k, g):
        proc[k] = proc[k] * _db(g)
        report["settings"][k]["gain_db"] = round(report["settings"][k]["gain_db"] + g, 1)

    if "kick" in proc:
        kick = dsp.loudness(proc["kick"])[0]
        for k in KIT:
            if k in proc and k != "kick":
                trim(k, float(np.clip(KIT_LEVEL[k] - (dsp.loudness(proc[k])[0] - kick), -6, 10)))
    if "vocals" in proc and "backing_vocals" in proc:
        gap = dsp.loudness(proc["backing_vocals"])[0] - dsp.loudness(proc["vocals"])[0]
        trim("backing_vocals", float(np.clip(BACKING_VOCALS_LEVEL - gap, -6, 6)))
    level = {f: dsp.loudness(sum(proc[k] for k in members))[0] for f, members in families.items()}
    anchor = "vocals" if "vocals" in families else ("drums" if "drums" in families
                                                    else max(level, key=level.get))
    want = dict(st["balance"], vocals=0.0)
    for f, members in families.items():
        g = float(np.clip((want[f] - want[anchor]) - (level[f] - level[anchor]), -12, MAX_LIFT))
        if family_lu[f] < BACKGROUND_LU:
            g = min(g, 0.0)       # a faint family stays in the background
        for k in members:
            trim(k, g)

    # ---- 4. stereo image, reverb
    tell(64, "Building the stereo image")
    spread = sorted((k for k in proc if fam[k] in HARMONIC),
                    key=lambda k: -dsp.loudness(proc[k])[0])
    for i, k in enumerate(spread):
        p = 0.0 if len(spread) == 1 or i >= len(PAN_SLOTS) else PAN_SLOTS[i]
        proc[k] = dsp.pan(dsp.widen(proc[k], st["width"]), p)
        report["settings"][k]["pan"] = p
    if "backing_vocals" in proc:
        proc["backing_vocals"] = dsp.widen(proc["backing_vocals"], 0.6)
    if "cymbals" in proc:
        proc["cymbals"] = dsp.widen_highs(proc["cymbals"], 0.45, 600.0)
    if "toms" in proc:
        proc["toms"] = dsp.widen_highs(proc["toms"], 0.3, 300.0)
    if "drums" in proc:
        proc["drums"] = dsp.widen_highs(proc["drums"], 0.45, 1500.0)
    vocal_wet, vocal_rt, drum_wet = st["verb"]
    if "vocals" in proc:
        proc["vocals"] = proc["vocals"] + dsp.reverb(
            proc["vocals"], dsp.reverb_ir(vocal_rt, 400, 7000, 25, 1), vocal_wet)
    if "drums" in families:
        members = families["drums"]
        carrier = "drums" if "drums" in members else max(members, key=lambda k: dsp.loudness(proc[k])[0])
        room = dsp.reverb(sum(proc[k] for k in members), dsp.reverb_ir(0.45, 300, 9000, 5, 2), drum_wet)
        proc[carrier] = proc[carrier] + room

    # ---- 5. master, applied to every stem so they still add up to the mix
    if not master:
        tell(72, "Setting the level")
        bus = sum(proc.values())
        gain_db = min(PREMIX_LUFS - dsp.loudness(bus)[0],
                      -1.0 - 20 * np.log10(float(np.abs(bus).max()) + 1e-9))
        g = np.float32(_db(gain_db))
        bus = (bus * g).astype(np.float32)
        report["master"] = {"skipped": True, "gain_db": round(float(gain_db), 1),
                            "lufs": round(dsp.loudness(bus)[0], 1),
                            "crest_db": round(dsp.crest(bus), 1),
                            "stereo_correlation": round(float(np.corrcoef(bus[0], bus[1])[0, 1]), 3)}
        return _write(proc, g, bus, out_dir, ext, ffmpeg, report, tell)
    tell(72, "Mastering")
    low_shelf, high_shelf, glue = st["master"]
    bus = sum(proc.values())
    curve = np.clip((np.asarray(ref["mix"]["ltas"]) - dsp.ltas(bus)) * 0.5, -4, 4)
    curve = np.convolve(np.pad(curve, 2, mode="edge"), np.ones(5) / 5, mode="valid")
    curve = (curve + low_shelf * np.clip(np.log2(240 / FC), 0, 1)
             + high_shelf * np.clip(np.log2(FC / 3000), 0, 1))
    for k in proc:
        proc[k] = dsp.eq_fir(proc[k], curve)
    bus = sum(proc.values())
    thr = 20 * np.log10(np.percentile(np.abs(bus).max(axis=0)[::64], 99) + 1e-9) - 4.0
    g, glue_db = dsp.compress_gain(bus, float(thr), glue, att_ms=30, rel_ms=250)
    limit_db = 0.0
    for _ in range(2):
        g = g * _db(TARGET_LUFS - dsp.loudness(bus * g)[0])
        lg, limit_db = dsp.limit_gain(bus * g)
        g = (g * lg).astype(np.float32)
    bus = (bus * g).astype(np.float32)
    report["master"] = {"glue_db": round(glue_db, 1), "limiter_db": round(limit_db, 1),
                        "lufs": round(dsp.loudness(bus)[0], 1), "crest_db": round(dsp.crest(bus), 1),
                        "stereo_correlation": round(float(np.corrcoef(bus[0], bus[1])[0, 1]), 3)}

    return _write(proc, g, bus, out_dir, ext, ffmpeg, report, tell)


def _write(proc, g, bus, out_dir, ext, ffmpeg, report, tell):
    """Write every stem with the bus gain ``g`` (a curve or one value), then the mix-down."""
    os.makedirs(out_dir, exist_ok=True)
    report["stems"] = {}
    for i, k in enumerate(proc):
        tell(82 + 14 * i / len(proc), f"Writing {k}")
        path = os.path.join(out_dir, f"{k}.{ext}")
        write_audio(path, proc[k] * g, ffmpeg)
        report["stems"][k] = path
    tell(97, "Writing the mix")
    report["mix"] = os.path.join(out_dir, f"mix.{ext}")
    write_audio(report["mix"], bus, ffmpeg)
    tell(100, "Done")
    return report
