"""Seat a rendered MIDI track in the mix of the audio stems.

A synth plays dry, full range and at an arbitrary level; next to recorded stems
it sticks out. Two things are decided here:

* the level the track must reach (``targets``). Copying the level of the stem it
  doubles is wrong whenever that stem is not clean: on a rehearsal recording the
  toms stem is mostly bleed and reads louder than the snare. Kit pieces therefore
  follow the standard kit balance of the auto remix, anchored on the level of the
  recorded drums as a whole; a pitched track takes the level of its stem minus the
  share of that stem that is bleed (``bleed_shares``).
* the processing (``process``): the family chain of the auto remix in a lighter
  form -- corrective EQ toward the neutral spectrum of the instrument, high-pass,
  the tone of the style when the song is a remix, and a room, so the track sounds
  recorded in the same place as the stems. Dynamics are evened out on the notes
  themselves (``even_velocities``), which costs nothing at render time.
"""
import numpy as np
import scipy.signal as sg

from core.automix import dsp
from core.automix.engine import MIN_REFERENCE_SONGS, neutral_reference
from core.automix.styles import BASS_LOW_PASS, FAMILY, HIGH_PASS, KIT, KIT_LEVEL, STYLES

ANALYSIS_SR = 22050
_EDGES = np.geomspace(40.0, 10000.0, 49)
# High-pass of each kit piece (Hz): samples and drum machines need no other correction.
KIT_HIGH_PASS = {"kick": 30, "snare": 90, "toms": 55, "cymbals": 280, "drums": 30}
MAX_BLEED_CUT_DB = 6.0      # most a pitched track goes under its stem because of bleed
# Reverb when the song has no style (not a remix): vocal level dB, vocal time s, drum room dB
DEFAULT_VERB = (-19.0, 1.2, -22.0)
ROOM_DB = -21.0             # room of the other instruments
MATCH_STRENGTH = 0.6
MAX_BOOST, MAX_CUT = 6.0, 10.0


def band_power(y):
    """Power of a mono signal at ANALYSIS_SR in 48 log bands per STFT frame."""
    f, _, z = sg.stft(y, ANALYSIS_SR, nperseg=2048, noverlap=1024)
    p = (np.abs(z) ** 2).astype(np.float32)
    return np.stack([p[(f >= a) & (f < b)].sum(axis=0) for a, b in zip(_EDGES[:-1], _EDGES[1:])])


def bleed_shares(powers, lo=0.08, hi=0.35):
    """Share of the energy of each stem that sits where other stems own the sound.

    ``powers``: {stem: band_power(...)} of every stem of the song. Same ownership
    rule as the cleaning of the auto remix (dsp.clean_stems), on a coarser grid.
    """
    if not powers:
        return {}
    n = min(p.shape[1] for p in powers.values())
    tot = sum(p[:, :n] for p in powers.values()) + 1e-12
    out = {}
    for k, p in powers.items():
        p = p[:, :n]
        g = np.clip((p / tot - lo) / (hi - lo), 0, 1)
        out[k] = float((p * (1 - g) ** 2).sum() / (float(p.sum()) + 1e-12))
    return out


def _power_sum(levels):
    levels = [v for v in levels if v > -100]
    if not levels:
        return -120.0
    return float(10 * np.log10(sum(10 ** (v / 10) for v in levels)))


def targets(levels, bleed, midi_stems):
    """Loudness (LUFS) each MIDI track must reach.

    ``levels``: {stem: integrated loudness} of every audio stem of the song,
    ``bleed``: {stem: share} from bleed_shares, ``midi_stems``: stems that have a
    MIDI track.
    """
    out = {}
    pieces = [k for k in midi_stems if k in KIT]
    if pieces:
        bus = _power_sum(levels[k] for k in levels if FAMILY.get(k) == "drums")
        base = bus - _power_sum(KIT_LEVEL[k] for k in pieces)
        for k in pieces:
            out[k] = base + KIT_LEVEL[k]
    for k in midi_stems:
        if k in out:
            continue
        cut = 0.0
        if FAMILY.get(k, "other") != "drums":
            cut = min(MAX_BLEED_CUT_DB, -10 * np.log10(max(1e-3, 1.0 - bleed.get(k, 0.0))))
        out[k] = levels[k] - cut
    return {k: round(float(v), 2) for k, v in out.items()}


def even_velocities(notes, amount=0.45):
    """Pull the velocities of a pitched track toward their median (a compressor on the notes).

    A transcription gives every note the loudness it had in the stem, bleed and
    all; played as is, a sampled instrument jumps from note to note.
    """
    if not notes:
        return notes
    mid = float(np.median([n[3] for n in notes]))
    return [(s, e, p, int(round(min(127, max(1, v + (mid - v) * amount))))) for s, e, p, v in notes]


def balance_db(x):
    """Left/right balance of a stem in dB (positive = louder on the left)."""
    e = (x.astype(np.float64) ** 2).sum(axis=1) + 1e-12
    return float(np.clip(10 * np.log10(e[0] / e[1]), -6, 6))


def eq_curve(x, stem, style=None):
    """EQ of a rendered track, in dB at the dsp.FC band centres."""
    f = FAMILY.get(stem, "other")
    st = STYLES.get(style) if style else None
    tone = dsp.bumps(st["tone"].get(f)) if st else np.zeros(len(dsp.FC))
    if f == "drums":
        return dsp.high_pass(KIT_HIGH_PASS.get(stem, 30)) + tone
    ref = neutral_reference().get(f)
    if ref and ref.get("n", 0) >= MIN_REFERENCE_SONGS:
        curve = dsp.match_curve(dsp.ltas(x), ref["ltas"], strength=MATCH_STRENGTH,
                                max_boost=MAX_BOOST, max_cut=MAX_CUT)
    else:
        curve = np.zeros(len(dsp.FC))
    curve = curve + dsp.high_pass(HIGH_PASS[f]) + tone
    if f == "bass":
        curve = curve + dsp.low_pass(BASS_LOW_PASS)
    return curve


def process(x, stem, style=None, curve=None):
    """EQ, dynamics and room of one rendered track ((2, n) float32). Level is set by the caller.

    ``curve``: an EQ already computed by eq_curve for this stem and instrument
    (it depends on the sound, hardly on the notes, so the caller may keep it).
    """
    f = FAMILY.get(stem, "other")
    st = STYLES.get(style) if style else None
    if curve is None:
        curve = eq_curve(x, stem, style)
    x = dsp.eq_fir(x, np.asarray(curve, float))
    vocal_wet, vocal_rt, drum_wet = st["verb"] if st else DEFAULT_VERB
    if f == "vocals":
        x = x + dsp.reverb(x, dsp.reverb_ir(vocal_rt, 400, 7000, 25, 1), vocal_wet)
    elif f == "drums":
        x = x + dsp.reverb(x, dsp.reverb_ir(0.45, 300, 9000, 5, 2), drum_wet)
    elif f != "bass":
        x = x + dsp.reverb(x, dsp.reverb_ir(0.7, 300, 8000, 12, 3), ROOM_DB)
    return x.astype(np.float32)


def finish(x, target_lufs, pan_db=0.0):
    """Bring a processed track to its level and keep its peaks under the ceiling."""
    if pan_db:
        g = 10 ** (pan_db / 40)
        x = np.stack([x[0] * g, x[1] / g])
    level = dsp.loudness(x)[0]
    if level > -100:
        x = x * 10 ** ((target_lufs - level) / 20)
    if float(np.abs(x).max()) > 0.89:
        gain, _ = dsp.limit_gain(x, ceil_db=-1.0)
        x = x * gain
    return x.astype(np.float32)
