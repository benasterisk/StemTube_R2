"""Offline generator for the metronome instrument one-shots.

Run once to (re)produce the WAV samples under core/poc/samples/. Unlike the live
synth this can afford heavier DSP (modal synthesis, multi-band noise, transients)
because the result is baked to a file and only loaded at runtime.

Each instrument writes two files: <id>.wav (normal) and <id>_accent.wav (downbeat).
All are 44.1 kHz mono float→int16, peak-normalized. Re-run:

    py -3 -m core.poc.gen_samples

Sounds are SYNTHESIZED here (no third-party samples → no licensing concerns) but
aimed to read as real percussion: congas use a pitched membrane with a noisy slap
transient, claves/woodblocks use sharp modal resonators, rimshot/cowbell stack
detuned partials with a click, brush is band-passed shaped noise.
"""
from __future__ import annotations
import os
import numpy as np
import soundfile as sf

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "samples")


# ── primitives ────────────────────────────────────────────────────────────────
def _t(n):
    return np.arange(n) / SR


def _ar(n, attack_s, decay_s, curve=3.0):
    """Attack-decay envelope, exponential decay (curve = steepness)."""
    idx = np.arange(n).astype(np.float64)
    a = int(max(1, attack_s * SR))
    atk = np.clip(idx / a, 0.0, 1.0)
    dec = np.exp(-curve * np.maximum(0.0, idx - a) / max(1.0, decay_s * SR))
    return (atk * dec).astype(np.float64)


def _modal(n, freq, decay_s, curve=4.0, phase=0.0):
    """A single damped sine (modal resonator partial)."""
    t = _t(n)
    return np.sin(2 * np.pi * freq * t + phase) * np.exp(-curve * t / max(1e-4, decay_s))


def _noise(n, seed):
    rng = np.random.RandomState(seed)
    return rng.uniform(-1.0, 1.0, n)


def _onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y


def _onepole_hp(x, fc):
    return x - _onepole_lp(x, fc)


def _bandpass(x, lo, hi):
    return _onepole_hp(_onepole_lp(x, hi), lo)


def _norm(x, peak=0.95):
    m = float(np.max(np.abs(x)))
    return (x * (peak / m)) if m > 1e-9 else x


def _soft_clip(x, drive=1.0):
    return np.tanh(drive * x)


# ── instruments: each returns (normal, accent) float arrays ─────────────────────
def conga():
    """Pitched membrane + noisy slap. Accent = open high tone; normal = low tone."""
    def hit(f0, dur, slap_amt, bright):
        n = int(dur * SR)
        # membrane: a few inharmonic modes with a fast downward pitch glide (skin tension)
        t = _t(n)
        glide = 1.0 + 0.5 * np.exp(-t / 0.012)
        modes = [(1.00, 0.45, 0.30), (1.58, 0.30, 0.22), (2.30, 0.18, 0.14)]
        body = np.zeros(n)
        for mult, amp, dec in modes:
            ph = 2 * np.pi * np.cumsum(f0 * mult * glide) / SR
            body += amp * np.sin(ph) * np.exp(-t / dec)
        # slap transient: short band-passed noise burst at the attack
        nz = _bandpass(_noise(n, 11), 1200, 6500) * _ar(n, 0.0004, 0.012, curve=6) * slap_amt
        x = body + nz
        x = _onepole_lp(x, bright)
        x *= _ar(n, 0.0008, dur * 0.6, curve=2.2)   # overall shape
        return _norm(_soft_clip(x, 1.2))
    normal = hit(196.0, 0.32, slap_amt=0.5, bright=5200)   # low conga
    accent = hit(311.0, 0.30, slap_amt=0.8, bright=7000)   # high/open conga
    return normal, accent


def clave():
    """Two-mode ringing wooden resonator — very tonal, short."""
    def hit(f1, dur):
        n = int(dur * SR)
        x = (_modal(n, f1, dur * 0.9, curve=3.0) * 1.0 +
             _modal(n, f1 * 1.52, dur * 0.6, curve=4.0) * 0.35)
        x *= _ar(n, 0.0003, dur * 0.8, curve=2.0)
        # tiny click at onset for the "tock"
        x[:int(0.0015 * SR)] += _noise(int(0.0015 * SR), 5) * 0.3
        return _norm(x)
    return hit(2050.0, 0.10), hit(2500.0, 0.10)


def woodblock():
    """Hollow wooden knock — modal stack, darker than clave, with body."""
    def hit(f1, dur):
        n = int(dur * SR)
        x = (_modal(n, f1, dur * 0.7, curve=4.0) * 1.0 +
             _modal(n, f1 * 2.05, dur * 0.4, curve=6.0) * 0.4 +
             _modal(n, f1 * 3.1, dur * 0.25, curve=8.0) * 0.18)
        # knock transient
        kn = _bandpass(_noise(n, 13), 800, 4000) * _ar(n, 0.0002, 0.006, curve=8) * 0.6
        x = (x + kn) * _ar(n, 0.0004, dur * 0.6, curve=3.0)
        return _norm(_soft_clip(x, 1.1))
    return hit(1150.0, 0.08), hit(1500.0, 0.08)


def rimshot():
    """Sharp crack: tonal shell + bright noise transient."""
    def hit(f1, dur, bright):
        n = int(dur * SR)
        tone = (_modal(n, f1, dur * 0.5, curve=6.0) +
                _modal(n, f1 * 1.6, dur * 0.3, curve=9.0) * 0.5)
        crack = _bandpass(_noise(n, 17), 1500, bright) * _ar(n, 0.0002, 0.010, curve=9) * 1.2
        x = (tone * 0.7 + crack) * _ar(n, 0.0002, dur * 0.5, curve=4.0)
        return _norm(_soft_clip(x, 1.4))
    return hit(330.0, 0.07, 7000), hit(420.0, 0.07, 9000)


def cowbell():
    """Classic detuned-square metallic clang (two inharmonic partials)."""
    def hit(f1, f2, dur):
        n = int(dur * SR); t = _t(n)
        # square-ish via summed odd harmonics, two detuned fundamentals
        def sq(f):
            return sum(np.sin(2 * np.pi * f * k * t) / k for k in (1, 3, 5, 7))
        x = (sq(f1) * 0.5 + sq(f2) * 0.5)
        x *= _ar(n, 0.0006, dur * 0.55, curve=3.0)
        x = _onepole_hp(x, 400)
        return _norm(_soft_clip(x, 1.2))
    return hit(560.0, 845.0, 0.16), hit(620.0, 935.0, 0.16)


def brush():
    """Soft brushed swish — band-passed noise with a gentle swell."""
    def hit(dur, lo, hi, seed):
        n = int(dur * SR)
        nz = _bandpass(_noise(n, seed), lo, hi)
        env = _ar(n, 0.010, dur * 0.5, curve=2.5)
        x = nz * env
        return _norm(x * 0.9)
    return hit(0.11, 700, 4200, 21), hit(0.12, 900, 5500, 22)


def beep():
    """Soft sine pip — a gentler default than the hard click."""
    def hit(f, dur):
        n = int(dur * SR)
        x = np.sin(2 * np.pi * f * _t(n)) * _ar(n, 0.002, dur * 0.6, curve=3.0)
        return _norm(x * 0.85)
    return hit(880.0, 0.08), hit(1100.0, 0.07)


def click():
    """Crisp click (the classic default) — bright sine burst, fast decay."""
    def hit(f, dur):
        n = int(dur * SR)
        x = np.sin(2 * np.pi * f * _t(n)) * np.exp(-32.0 * _t(n) / dur)
        return _norm(x * 0.9)
    return hit(1200.0, 0.05), hit(1500.0, 0.05)


BUILDERS = {
    "click": click, "beep": beep, "woodblock": woodblock, "clave": clave,
    "rimshot": rimshot, "cowbell": cowbell, "conga": conga, "brush": brush,
}


def generate(out_dir=OUT_DIR):
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for inst, fn in BUILDERS.items():
        normal, accent = fn()
        for suffix, data in (("", normal), ("_accent", accent)):
            path = os.path.join(out_dir, f"{inst}{suffix}.wav")
            sf.write(path, data.astype(np.float32), SR)
            written.append(os.path.basename(path))
    return written


if __name__ == "__main__":
    files = generate()
    print(f"wrote {len(files)} samples to {OUT_DIR}:")
    for f in sorted(files):
        print("  " + f)
