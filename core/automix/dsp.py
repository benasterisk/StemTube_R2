"""Signal analysis and processing blocks of the auto remix (numpy/scipy only).

Everything works on float32 arrays shaped (2, samples) at SR. Dynamics blocks
return a per-sample linear gain curve instead of the processed signal, so the
same curve can be applied to several stems: the stems then still add up to the
processed bus.
"""
import numpy as np
import scipy.signal as sg
from scipy.ndimage import minimum_filter1d, uniform_filter, uniform_filter1d

try:                                   # optional: only speeds up the two envelope loops
    from numba import njit
except Exception:                      # pragma: no cover
    def njit(*args, **kwargs):
        return (lambda f: f) if not (args and callable(args[0])) else args[0]

SR = 44100
# Third-octave band centres used for every spectrum and EQ curve.
FC = np.array([25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
               630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
               8000, 10000, 12500, 16000, 20000], float)


# ---------------------------------------------------------------- analysis
def _kfilter(x):
    """BS.1770 K-weighting (high shelf + high-pass)."""
    def norm(b, a):
        return np.array(b) / a[0], np.array(a) / a[0]
    gain, q, fc = 4.0, 1 / np.sqrt(2), 1500.0
    amp = 10 ** (gain / 40)
    w = 2 * np.pi * fc / SR
    al, c = np.sin(w) / (2 * q), np.cos(w)
    b1, a1 = norm([amp * ((amp + 1) + (amp - 1) * c + 2 * np.sqrt(amp) * al),
                   -2 * amp * ((amp - 1) + (amp + 1) * c),
                   amp * ((amp + 1) + (amp - 1) * c - 2 * np.sqrt(amp) * al)],
                  [(amp + 1) - (amp - 1) * c + 2 * np.sqrt(amp) * al,
                   2 * ((amp - 1) - (amp + 1) * c),
                   (amp + 1) - (amp - 1) * c - 2 * np.sqrt(amp) * al])
    q, fc = 0.5, 38.0
    w = 2 * np.pi * fc / SR
    al, c = np.sin(w) / (2 * q), np.cos(w)
    b2, a2 = norm([(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al])
    return sg.lfilter(b2, a2, sg.lfilter(b1, a1, x, axis=-1), axis=-1)


def block_loudness(x):
    """Momentary loudness (LUFS) per 400 ms block, 100 ms hop."""
    y = _kfilter(x.astype(np.float64))
    p = (y ** 2).sum(axis=0)
    hop, win = int(0.1 * SR), int(0.4 * SR)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, max(1, len(p) - win), hop)
    ms = (cs[starts + win] - cs[starts]) / win
    return -0.691 + 10 * np.log10(ms + 1e-12)


def loudness(x):
    """Integrated loudness (BS.1770 gating) and the share of blocks that pass the gate."""
    lv = block_loudness(x)
    keep = lv > -70
    if not keep.any():
        return -120.0, 0.0
    rel = 10 * np.log10(np.mean(10 ** (lv[keep] / 10))) - 10
    keep = keep & (lv > rel)
    if not keep.any():
        return -120.0, 0.0
    return float(10 * np.log10(np.mean(10 ** (lv[keep] / 10)))), float(keep.mean())


def ltas(x):
    """Long-term average spectrum of the active frames: third-octave bands, dB re total."""
    f, _, z = sg.stft(x.mean(axis=0), SR, nperseg=8192, noverlap=4096)
    p = np.abs(z) ** 2
    e = p.sum(axis=0)
    act = e > np.percentile(e, 95) * 1e-3
    pm = p[:, act].mean(axis=1) if act.any() else p.mean(axis=1)
    out = np.empty(len(FC))
    for i, fc in enumerate(FC):
        sel = (f >= fc / 2 ** (1 / 6)) & (f < fc * 2 ** (1 / 6))
        if not sel.any():
            sel = np.zeros_like(f, bool)
            sel[np.argmin(np.abs(f - fc))] = True
        out[i] = pm[sel].sum()
    return 10 * np.log10(out + 1e-20) - 10 * np.log10(out.sum() + 1e-20)


def crest(x):
    """Peak-to-RMS ratio (dB) over the active 50 ms blocks."""
    m = x.mean(axis=0)
    hop = int(0.05 * SR)
    n = len(m) // hop
    b = m[:n * hop].reshape(n, hop)
    pk, rm = np.abs(b).max(axis=1), np.sqrt((b ** 2).mean(axis=1))
    act = rm > rm.max() * 0.03
    if not act.any():
        return 0.0
    return float(20 * np.log10(np.percentile(pk[act], 95) / (np.median(rm[act]) + 1e-12)))


# ---------------------------------------------------------------- cleaning
def clean_stems(stems, floor_db=-14.0, lo=0.08, hi=0.35, seg=1 << 21, margin=8192):
    """Cross-stem dominance gate.

    The stems add up to the recording, so every time-frequency bin has an owner.
    A stem keeps the bins where it holds a real share of the energy; where another
    stem dominates, what it holds is bleed and goes down to ``floor_db``.

    Works in segments to bound memory. Returns the cleaned stems and, per stem,
    the share of its energy that sat under other stems.
    """
    names = list(stems)
    n = stems[names[0]].shape[1]
    floor = 10 ** (floor_db / 20)
    out = {k: np.zeros((2, n), np.float32) for k in names}
    removed = dict.fromkeys(names, 0.0)
    energy = dict.fromkeys(names, 1e-12)
    pos = 0
    while pos < n:
        a, b = max(0, pos - margin), min(n, pos + seg + margin)
        z = {k: np.stack([sg.stft(c[a:b], SR, nperseg=2048, noverlap=1536)[2] for c in stems[k]])
             for k in names}
        p = {k: (np.abs(z[k]) ** 2).sum(axis=0) for k in names}
        tot = sum(p.values()) + 1e-12
        end = min(n, pos + seg)
        for k in names:
            g = np.clip((uniform_filter(p[k] / tot, size=(3, 5)) - lo) / (hi - lo), 0, 1)
            removed[k] += float((p[k] * (1 - g) ** 2).sum())
            energy[k] += float(p[k].sum())
            gain = floor + (1 - floor) * g
            for c in range(2):
                y = sg.istft(z[k][c] * gain, SR, nperseg=2048, noverlap=1536)[1]
                y = np.pad(y, (0, max(0, (b - a) - len(y))))
                out[k][c, pos:end] = y[pos - a:end - a]
        del z, p, tot
        pos = end
    return out, {k: removed[k] / energy[k] for k in names}


# -------------------------------------------------------------- processing
def eq_fir(x, gains_db, taps=4097):
    """Linear-phase FIR drawn through ``gains_db`` at the FC band centres."""
    fgrid = np.geomspace(20, SR / 2, 512)
    g = np.interp(np.log(fgrid), np.log(FC), gains_db)
    freq = np.concatenate([[0], fgrid])
    freq[-1] = SR / 2
    h = sg.firwin2(taps, freq, 10 ** (np.concatenate([[g[0]], g]) / 20), fs=SR)
    return np.stack([sg.oaconvolve(c, h, mode="same") for c in x]).astype(np.float32)


def bumps(points, octaves=0.9):
    """EQ curve made of one bell per (Hz, dB) point."""
    out = np.zeros(len(FC))
    for f, g in points or ():
        out += g * np.exp(-0.5 * (np.log2(FC / f) / octaves) ** 2)
    return out


def through(points):
    """EQ curve interpolated through (Hz, dB) points."""
    f, g = zip(*points)
    return np.interp(np.log(FC), np.log(f), g)


def high_pass(hz, slope=24.0):
    return -slope * np.clip(np.log2(hz / FC), 0, 2)


def low_pass(hz, slope=18.0):
    return -slope * np.clip(np.log2(FC / hz), 0, 2)


def match_curve(cur, ref, strength=0.8, max_boost=10.0, max_cut=12.0):
    """Corrective EQ that moves the spectrum ``cur`` toward ``ref`` (both from ltas)."""
    cur = np.asarray(cur, float)
    d = (np.asarray(ref, float) - cur) * strength
    d = np.convolve(np.pad(d, 1, mode="edge"), [0.25, 0.5, 0.25], mode="valid")
    d = np.clip(d, -max_cut, max_boost)
    # A band far under the stem's own peak holds bleed and noise, not the
    # instrument: boosts fade out between 28 and 48 dB under the peak band.
    room = np.clip((cur - (cur.max() - 48)) / 20.0, 0, 1)
    return np.where(d > 0, d * room, d)


@njit(cache=True)
def _follow(target, aa, ar):
    out = np.empty_like(target)
    s = 0.0
    for i in range(len(target)):
        t = target[i]
        s += (t - s) * (aa if t < s else ar)
        out[i] = s
    return out


@njit(cache=True)
def _hold_release(g, k):
    out = np.empty_like(g)
    s = 1.0
    for i in range(len(g)):
        t = g[i]
        s = t if t < s else s + (1.0 - s) * k
        out[i] = min(s, t)
    return out


def _ballistics(target_db, hop, att_ms, rel_ms, n):
    """Attack/release smoothing of a block-rate gain curve (dB, <= 0 is reduction)."""
    aa = 1 - np.exp(-hop / (SR * att_ms / 1000))
    ar = 1 - np.exp(-hop / (SR * rel_ms / 1000))
    out = _follow(np.ascontiguousarray(target_db, dtype=np.float64), aa, ar)
    return np.interp(np.arange(n), np.arange(len(out)) * hop + hop / 2, out)


def compress_gain(x, thr_db, ratio, att_ms=10.0, rel_ms=120.0, knee=6.0):
    """Feed-forward compressor. Returns (linear gain per sample, typical reduction in dB)."""
    hop = 32
    n = x.shape[1]
    nb = n // hop
    pk = np.abs(x[:, :nb * hop]).max(axis=0).reshape(nb, hop).max(axis=1)
    over = 20 * np.log10(pk + 1e-9) - thr_db
    slope = 1 / ratio - 1
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * slope,
                           slope * (over + knee / 2) ** 2 / (2 * knee)))
    g = _ballistics(gr, hop, att_ms, rel_ms, n)
    return (10 ** (g / 20)).astype(np.float32), float(-np.percentile(g, 5))


def peak_threshold(x, pct=55.0):
    """Level (dBFS) that ``pct`` percent of the active 46 ms peak blocks stay under."""
    pk = np.abs(x).max(axis=0)
    hop = 2048
    b = pk[:len(pk) // hop * hop].reshape(-1, hop).max(axis=1)
    b = b[b > b.max() * 0.03]
    if not len(b):
        return 0.0
    return float(np.percentile(20 * np.log10(b + 1e-9), pct))


def transient_gain(x, amount=0.7, max_db=6.0):
    """Attack lift: the gain follows the fast envelope minus the slow one."""
    a = np.abs(x).max(axis=0).astype(np.float64)

    def env(ms):
        k = np.exp(-1 / (SR * ms / 1000))
        # filtfilt can ring slightly below zero on near-silent input
        return np.maximum(sg.filtfilt([1 - k], [1, -k], a), 0.0)
    d = 20 * np.log10((env(1.0) + 1e-6) / (env(40.0) + 1e-6))
    g = uniform_filter1d(np.clip(amount * d, 0, max_db), int(0.002 * SR))
    return (10 ** (g / 20)).astype(np.float32)


def expand_gain(x, range_db=10.0, below_db=22.0):
    """Soft downward expander: residue between phrases goes down by up to ``range_db``."""
    lv = block_loudness(x)
    if not (lv > -70).any():
        return np.ones(x.shape[1], np.float32)
    ref = np.percentile(lv[lv > -70], 90)
    t = uniform_filter1d(np.clip((ref - below_db - lv) / 10.0, 0, 1) * -range_db, 5)
    g = np.interp(np.arange(x.shape[1]), np.arange(len(t)) * int(0.1 * SR) + int(0.2 * SR), t)
    return (10 ** (g / 20)).astype(np.float32)


def limit_gain(x, ceil_db=-1.0, look_ms=4.0, rel_ms=120.0):
    """Look-ahead peak limiter. Returns (linear gain per sample, max reduction in dB)."""
    c = 10 ** (ceil_db / 20)
    hop = 16
    n = x.shape[1]
    nb = int(np.ceil(n / hop))
    pk = np.pad(np.abs(x).max(axis=0), (0, nb * hop - n)).reshape(nb, hop).max(axis=1)
    g = minimum_filter1d(np.minimum(1.0, c / (pk + 1e-9)), int(look_ms * SR / 1000 / hop) * 2 + 1)
    k = 1 - np.exp(-hop / (SR * rel_ms / 1000))
    out = _hold_release(np.ascontiguousarray(g, dtype=np.float64), k)
    out = uniform_filter1d(minimum_filter1d(out, 3), 3)
    gs = np.interp(np.arange(n), np.arange(nb) * hop + hop / 2, out)
    return gs.astype(np.float32), float(-20 * np.log10(out.min()))


# ------------------------------------------------------------------ stereo
def widen(x, amount=0.3, delay_ms=11.0, hp=250.0):
    """Mono-compatible pseudo-stereo: L = m + s, R = m - s, s = delayed high-passed m."""
    m = x.mean(axis=0)
    s = sg.sosfilt(sg.butter(2, hp, "hp", fs=SR, output="sos"), m)
    d = int(delay_ms * SR / 1000)
    s = np.concatenate([np.zeros(d, s.dtype), s[:-d]]) * amount
    return np.stack([m + s, m - s]).astype(np.float32)


def widen_highs(x, amount=0.45, split_hz=1500.0):
    """Spread only what sits above ``split_hz`` (cymbals), keep the low end centred."""
    hi = sg.sosfilt(sg.butter(2, split_hz, "hp", fs=SR, output="sos"), x, axis=-1).astype(np.float32)
    return (x - hi + widen(hi, amount, 7.0, split_hz)).astype(np.float32)


def pan(x, p):
    """Constant-power pan, p in [-1, 1]; 0 leaves the signal untouched."""
    a = (p + 1) * np.pi / 4
    return np.stack([x[0] * np.cos(a) * np.sqrt(2), x[1] * np.sin(a) * np.sqrt(2)]).astype(np.float32)


def reverb_ir(rt60, lo, hi, predelay_ms, seed):
    """Synthetic stereo room: decaying band-limited noise, decorrelated left/right."""
    rng = np.random.default_rng(seed)
    n = int(rt60 * 1.3 * SR)
    ir = rng.standard_normal((2, n)) * np.exp(-6.91 * np.arange(n) / SR / rt60)
    ir = sg.sosfilt(sg.butter(2, [lo, hi], "bp", fs=SR, output="sos"), ir, axis=-1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    return np.concatenate([np.zeros((2, int(predelay_ms * SR / 1000))), ir], axis=1)


def reverb(x, ir, wet_db):
    """Wet signal only (same length as x)."""
    m = x.mean(axis=0)
    w = np.stack([sg.oaconvolve(m, ir[c])[:x.shape[1]] for c in range(2)])
    return (w * 10 ** (wet_db / 20)).astype(np.float32)
