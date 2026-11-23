"""Stem -> notes.

Pitched stems go through Basic Pitch; drum pieces are read from their attacks.
Notes are (start_s, end_s, midi_pitch, velocity 1..127), sorted by start.
"""
import numpy as np

from . import basic_pitch

SR = basic_pitch.AUDIO_SAMPLE_RATE

# stem -> lowest Hz, highest Hz, one note at a time, plays chords/arpeggios
PITCHED = {
    "vocals": dict(lo=80, hi=1100, mono=True, chords=False),
    "backing_vocals": dict(lo=80, hi=1100, mono=False, chords=True),
    "bass": dict(lo=30, hi=400, mono=True, chords=False),
    "guitar": dict(lo=75, hi=1400, mono=False, chords=True),
    "electric_guitar": dict(lo=75, hi=1400, mono=False, chords=True),
    "acoustic_guitar": dict(lo=75, hi=1400, mono=False, chords=True),
    "piano": dict(lo=27, hi=4200, mono=False, chords=True),
    "organ": dict(lo=27, hi=4200, mono=False, chords=True),
    "synth": dict(lo=27, hi=4200, mono=False, chords=True),
    "brass": dict(lo=50, hi=1500, mono=False, chords=True),
    "winds": dict(lo=100, hi=2500, mono=False, chords=False),
    "strings": dict(lo=50, hi=3000, mono=False, chords=True),
    "other": dict(lo=50, hi=3000, mono=False, chords=True),
}
DRUM_STEMS = ("drums", "kick", "snare", "toms", "cymbals")

# General MIDI percussion keys
KICK, SNARE, CLOSED_HAT, OPEN_HAT, CRASH, RIDE = 36, 38, 42, 46, 49, 51
TOM_LOW, TOM_MID, TOM_HIGH = 43, 45, 48


def kind_of(stem):
    if stem in DRUM_STEMS:
        return "drums"
    if stem in PITCHED:
        return "pitched"
    return None


def load_mono(path):
    import librosa
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float32)


def _activity(y, floor_db=-28.0):
    """Per 50 ms block: is the stem really sounding (not just bleed)?"""
    hop = int(0.05 * SR)
    n = len(y) // hop
    if n == 0:
        return np.zeros(0, bool), hop
    rms = np.sqrt((y[:n * hop].reshape(n, hop) ** 2).mean(axis=1))
    ref = np.percentile(rms, 95) + 1e-9
    return rms > ref * 10 ** (floor_db / 20), hop


def pitched_notes(y, lo, hi, mono):
    events = basic_pitch.predict(y, min_freq=lo, max_freq=hi)
    if not events:
        return []
    amp = np.array([e[3] for e in events])
    floor = np.percentile(amp, 90) * 0.35          # faint detections are bleed and noise
    active, hop = _activity(y)
    notes = []
    for s, e, p, a in events:
        if a < floor:
            continue
        b0, b1 = int(s * SR / hop), max(int(s * SR / hop) + 1, int(e * SR / hop))
        if len(active) and not active[b0:b1].any():
            continue                               # the stem is silent there
        notes.append([s, e, p, a])
    if mono:
        out = []
        for nt in notes:
            if out and nt[0] < out[-1][1]:
                if nt[3] >= out[-1][3] * 0.8:
                    out[-1][1] = nt[0]
                else:
                    continue
            out.append(nt)
        notes = [nt for nt in out if nt[1] - nt[0] >= 0.06]
    if not notes:
        return []
    top = np.percentile([nt[3] for nt in notes], 95) + 1e-9
    return [(float(s), float(e), int(p), int(45 + 80 * min(1.0, a / top))) for s, e, p, a in notes]


def _hits(y, delta=0.12, floor=0.12):
    """Attack times of a percussive signal with a 0..1 strength."""
    import librosa
    if not len(y) or float(np.abs(y).max()) < 1e-5:
        return []
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=256)
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=256,
                                        backtrack=False, delta=delta, wait=4)
    if not len(frames):
        return []
    times = librosa.frames_to_time(frames, sr=SR, hop_length=256)
    peak = np.array([np.abs(y[int(t * SR):int(t * SR) + 1024]).max() if int(t * SR) < len(y) else 0.0
                     for t in times])
    ref = np.percentile(peak, 95) + 1e-9
    keep = peak > ref * floor
    return [(float(t), float(min(1.0, p / ref))) for t, p in zip(times[keep], peak[keep])]


def _velocity(strength):
    return int(35 + 92 * strength ** 0.6)


def _band(y, lo, hi):
    import scipy.signal as sg
    if lo and hi:
        sos = sg.butter(4, [lo, hi], "bp", fs=SR, output="sos")
    elif lo:
        sos = sg.butter(4, lo, "hp", fs=SR, output="sos")
    else:
        sos = sg.butter(4, hi, "lp", fs=SR, output="sos")
    return sg.sosfilt(sos, y).astype(np.float32)


def drum_notes(stem, y):
    """Notes of one drum stem. A kit piece maps to its GM keys; a whole kit is split by band."""
    out = []
    if stem == "kick":
        out = [(t, t + 0.1, KICK, _velocity(v)) for t, v in _hits(y)]
    elif stem == "snare":
        out = [(t, t + 0.1, SNARE, _velocity(v)) for t, v in _hits(y)]
    elif stem == "toms":
        for t, v in _hits(y):
            seg = y[int(t * SR):int(t * SR) + 4096]
            key = TOM_MID
            if len(seg) >= 1024:
                spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
                freqs = np.fft.rfftfreq(len(seg), 1 / SR)
                sel = (freqs > 55) & (freqs < 400)
                f0 = freqs[sel][np.argmax(spec[sel])] if sel.any() else 120
                key = TOM_LOW if f0 < 100 else (TOM_MID if f0 < 150 else TOM_HIGH)
            out.append((t, t + 0.15, key, _velocity(v)))
    elif stem == "cymbals":
        hits = _hits(y)
        # how much the stem hisses between hits: a noisy stem makes every hit look sustained
        floor = float(np.sqrt(np.median(y.astype(np.float64) ** 2))) if len(y) else 0.0
        for j, (t, v) in enumerate(hits):
            i = int(t * SR)
            head = y[i:i + int(0.06 * SR)]
            tail = y[i + int(0.15 * SR):i + int(0.40 * SR)]
            head_rms = np.sqrt((head ** 2).mean()) if len(head) else 0.0
            tail_rms = max(0.0, (np.sqrt((tail ** 2).mean()) if len(tail) else 0.0) - floor)
            ring = tail_rms / (head_rms + 1e-9)
            alone = j + 1 >= len(hits) or hits[j + 1][0] - t > 0.3
            if ring > 0.5 and v > 0.7 and alone:
                key = CRASH
            elif ring > 0.35:
                key = OPEN_HAT
            else:
                key = CLOSED_HAT
            out.append((t, t + 0.1, key, _velocity(v)))
    else:   # whole kit: kick in the lows, snare in the crack band, hats on top
        kicks = _hits(_band(y, None, 150))
        snares = _hits(_band(y, 1500, 5000), delta=0.2, floor=0.3)
        hats = _hits(_band(y, 7000, None), floor=0.2)
        out += [(t, t + 0.1, KICK, _velocity(v)) for t, v in kicks]
        out += [(t, t + 0.1, SNARE, _velocity(v)) for t, v in snares]
        taken = np.array([t for t, _ in snares] + [t for t, _ in kicks])
        for t, v in hats:
            if len(taken) and np.abs(taken - t).min() < 0.03:
                continue
            out.append((t, t + 0.1, CLOSED_HAT, _velocity(v * 0.8)))
    return sorted(out, key=lambda n: n[0])


def transcribe(stem, path):
    """Returns (kind, notes) or (None, []) when the stem has no MIDI equivalent."""
    return transcribe_audio(stem, load_mono(path))


def transcribe_audio(stem, y):
    """transcribe() on a mono signal already loaded at SR."""
    kind = kind_of(stem)
    if kind is None:
        return None, []
    if kind == "drums":
        return kind, drum_notes(stem, y)
    cfg = PITCHED[stem]
    return kind, pitched_notes(y, cfg["lo"], cfg["hi"], cfg["mono"])
