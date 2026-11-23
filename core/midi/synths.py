"""Built-in synthesizers of the MIDI tracks (numba-compiled, no external engine).

Five engines, each the classic way of making one family of sounds:

  analog     virtual analog: band-limited saw/pulse oscillators, sub oscillator,
             unison detune, 4-pole resonant ladder filter with its own envelope
  fm         phase modulation, one carrier and two modulators with decaying
             indexes and feedback (DX-style electric pianos, basses, bells)
  wavetable  morphing band-limited wavetables scanned by an envelope
  pluck      plucked string physical model (extended Karplus-Strong) with pick
             position, damping, and an amp stage for the overdriven guitar
  organ      tonewheel organ: nine drawbars, key click, rotary chorus
  drums      analog drum machine voices (sine sweeps, filtered noise, metallic
             square clusters) in the manner of the TR-808 / TR-909

Notes are (start_s, end_s, midi_pitch, velocity 1..127). Every engine renders a
whole track into a (2, n) float32 buffer at SR.
"""
import numpy as np

try:
    from numba import njit
    HAVE_NUMBA = True
except Exception:                                   # pragma: no cover
    HAVE_NUMBA = False

    def njit(*args, **kwargs):
        def wrap(f):
            return f
        return wrap(args[0]) if args and callable(args[0]) else wrap

SR = 44100
TWO_PI = 2.0 * np.pi


def _arrays(notes, length_s, tail_s):
    n = int(length_s * SR)
    starts = np.array([int(s * SR) for s, _, _, _ in notes], np.int64)
    gates = np.array([max(int((e - s) * SR), int(0.02 * SR)) for s, e, _, _ in notes], np.int64)
    freqs = np.array([440.0 * 2 ** ((p - 69) / 12.0) for _, _, p, _ in notes], np.float64)
    vels = np.array([v / 127.0 for _, _, _, v in notes], np.float64)
    return np.zeros((2, n + int(tail_s * SR)), np.float64), starts, gates, freqs, vels, n


@njit(cache=True)
def _env(i, gate, a, d, s, r):
    """Exponential ADSR, times in samples; ``i`` counts from the note start."""
    if i < gate:
        if i < a:
            return i / a
        return s + (1.0 - s) * np.exp(-5.0 * (i - a) / d)
    if gate < a:
        level = gate / a
    else:
        level = s + (1.0 - s) * np.exp(-5.0 * (gate - a) / d)
    return level * np.exp(-5.0 * (i - gate) / r)


@njit(cache=True)
def _blep(t, dt):
    if t < dt:
        t = t / dt
        return t + t - t * t - 1.0
    if t > 1.0 - dt:
        t = (t - 1.0) / dt
        return t * t + t + t + 1.0
    return 0.0


# ------------------------------------------------------------------ analog
@njit(cache=True)
def _analog(out, starts, gates, freqs, vels, p):
    saw_mix, pulse_mix, pw, sub_mix = p[0], p[1], p[2], p[3]
    detune, unison, spread = p[4], int(p[5]), p[6]
    cutoff, reso, env_amt, keytrack = p[7], p[8], p[9], p[10]
    fa, fd, fs, fr = p[11] * SR, p[12] * SR, p[13], p[14] * SR
    aa, ad, as_, ar = p[15] * SR, p[16] * SR, p[17], p[18] * SR
    vel_cut, drive = p[19], p[20]
    n_out = out.shape[1]
    for k in range(len(starts)):
        f0 = freqs[k]
        vel = vels[k]
        total = min(gates[k] + int(ar * 1.4), n_out - starts[k])
        if total <= 0:
            continue
        phases = np.zeros(unison)
        incs = np.zeros(unison)
        gl = np.zeros(unison)
        gr = np.zeros(unison)
        for u in range(unison):
            off = 0.0 if unison == 1 else (2.0 * u / (unison - 1) - 1.0)
            incs[u] = f0 * 2.0 ** (off * detune / 1200.0) / SR
            phases[u] = (0.37 * u + 0.11 * k) % 1.0
            pn = off * spread
            gl[u] = np.sqrt(0.5 * (1.0 - pn))
            gr[u] = np.sqrt(0.5 * (1.0 + pn))
        sub_ph = 0.0
        sub_inc = 0.5 * f0 / SR
        base = cutoff * (f0 / 261.6) ** keytrack * 2.0 ** (vel_cut * (vel - 0.5) * 2.0)
        l1 = l2 = l3 = l4 = 0.0
        r1 = r2 = r3 = r4 = 0.0
        norm = 1.0 / np.sqrt(unison)
        amp = (0.25 + 0.75 * vel) * 0.5
        for i in range(total):
            xl = 0.0
            xr = 0.0
            for u in range(unison):
                t = phases[u]
                dt = incs[u]
                v = 0.0
                if saw_mix > 0.0:
                    v += saw_mix * (2.0 * t - 1.0 - _blep(t, dt))
                if pulse_mix > 0.0:
                    sq = 1.0 if t < pw else -1.0
                    sq += _blep(t, dt)
                    sq -= _blep((t + 1.0 - pw) % 1.0, dt)
                    v += pulse_mix * sq
                xl += v * gl[u]
                xr += v * gr[u]
                t += dt
                if t >= 1.0:
                    t -= 1.0
                phases[u] = t
            sub = sub_mix * (1.0 if sub_ph < 0.5 else -1.0)
            sub_ph += sub_inc
            if sub_ph >= 1.0:
                sub_ph -= 1.0
            xl = xl * norm + sub * 0.7
            xr = xr * norm + sub * 0.7
            fe = _env(i, gates[k], fa, fd, fs, fr)
            fc = base * 2.0 ** (env_amt * fe)
            if fc > 14000.0:
                fc = 14000.0
            g = 1.0 - np.exp(-TWO_PI * fc / SR)
            fb = reso * 3.8
            xl = np.tanh((xl - fb * l4) * drive) / drive
            l1 += g * (xl - l1)
            l2 += g * (l1 - l2)
            l3 += g * (l2 - l3)
            l4 += g * (l3 - l4)
            xr = np.tanh((xr - fb * r4) * drive) / drive
            r1 += g * (xr - r1)
            r2 += g * (r1 - r2)
            r3 += g * (r2 - r3)
            r4 += g * (r3 - r4)
            a = amp * _env(i, gates[k], aa, ad, as_, ar)
            out[0, starts[k] + i] += l4 * a
            out[1, starts[k] + i] += r4 * a


# ---------------------------------------------------------------------- fm
@njit(cache=True)
def _fm(out, starts, gates, freqs, vels, p):
    c_ratio = p[0]
    m1_ratio, m1_index, m1_decay, m1_sus = p[1], p[2], p[3] * SR, p[4]
    m2_ratio, m2_index, m2_decay = p[5], p[6], p[7] * SR
    feedback, detune = p[8], p[9]
    aa, ad, as_, ar = p[10] * SR, p[11] * SR, p[12], p[13] * SR
    vel_index, keyscale = p[14], p[15]
    n_out = out.shape[1]
    for k in range(len(starts)):
        f0 = freqs[k]
        vel = vels[k]
        total = min(gates[k] + int(ar * 1.4), n_out - starts[k])
        if total <= 0:
            continue
        scale = (1.0 - vel_index + vel_index * vel) * (261.6 / f0) ** keyscale
        amp = (0.2 + 0.8 * vel) * 0.4
        for side in range(2):
            f = f0 * 2.0 ** ((side * 2 - 1) * detune / 1200.0)
            wc = TWO_PI * f * c_ratio / SR
            w1 = TWO_PI * f * m1_ratio / SR
            w2 = TWO_PI * f * m2_ratio / SR
            pc = p1 = p2 = 0.0
            prev = 0.0
            for i in range(total):
                i1 = m1_index * scale * (m1_sus + (1.0 - m1_sus) * np.exp(-i / m1_decay))
                i2 = m2_index * scale * np.exp(-i / m2_decay)
                mod1 = np.sin(p1 + feedback * prev)
                prev = mod1
                y = np.sin(pc + i1 * mod1 + i2 * np.sin(p2))
                pc += wc
                p1 += w1
                p2 += w2
                out[side, starts[k] + i] += y * amp * _env(i, gates[k], aa, ad, as_, ar)


# --------------------------------------------------------------- wavetable
@njit(cache=True)
def _wavetable(out, starts, gates, freqs, vels, tables, p):
    """tables: (frames, mips, size); mip m holds harmonics up to tables' own limit / 2**m."""
    pos0, pos1, sweep, detune = p[0], p[1], p[2] * SR, p[3]
    aa, ad, as_, ar = p[4] * SR, p[5] * SR, p[6], p[7] * SR
    lfo_rate, lfo_depth, max_harm = p[8], p[9], p[10]
    frames, mips, size = tables.shape
    n_out = out.shape[1]
    for k in range(len(starts)):
        f0 = freqs[k]
        vel = vels[k]
        total = min(gates[k] + int(ar * 1.4), n_out - starts[k])
        if total <= 0:
            continue
        m = 0
        harm = max_harm
        while m < mips - 1 and f0 * harm > 0.45 * SR:
            m += 1
            harm *= 0.5
        amp = (0.2 + 0.8 * vel) * 0.4
        for side in range(2):
            inc = f0 * 2.0 ** ((side * 2 - 1) * detune / 1200.0) * size / SR
            ph = (0.31 * side + 0.17 * k) * size % size
            for i in range(total):
                pos = pos1 + (pos0 - pos1) * np.exp(-i / sweep)
                pos += lfo_depth * np.sin(TWO_PI * lfo_rate * i / SR + side)
                if pos < 0.0:
                    pos = 0.0
                if pos > 1.0:
                    pos = 1.0
                fp = pos * (frames - 1)
                fi = int(fp)
                if fi >= frames - 1:
                    fi = frames - 2
                ff = fp - fi
                j = int(ph)
                frac = ph - j
                j2 = j + 1
                if j2 >= size:
                    j2 = 0
                a = tables[fi, m, j] + frac * (tables[fi, m, j2] - tables[fi, m, j])
                b = tables[fi + 1, m, j] + frac * (tables[fi + 1, m, j2] - tables[fi + 1, m, j])
                out[side, starts[k] + i] += (a + ff * (b - a)) * amp * _env(i, gates[k], aa, ad, as_, ar)
                ph += inc
                if ph >= size:
                    ph -= size


_TABLE_CACHE = {}


def wavetable(kind, frames=16, size=2048, max_harm=256, mips=7):
    """Band-limited tables: (frames, mips, size). Built once per kind."""
    if kind in _TABLE_CACHE:
        return _TABLE_CACHE[kind]
    t = np.arange(size) / size
    h = np.arange(1, max_harm + 1)
    out = np.zeros((frames, mips, size))
    for fr in range(frames):
        x = fr / (frames - 1)
        if kind == "sweep":          # sine opening into a full saw
            amps = (1.0 / h) * np.clip(1.0 - (h - 1) / (1 + x * x * max_harm), 0, 1)
        elif kind == "pulse":        # square narrowing into a thin pulse
            width = 0.5 - 0.45 * x
            amps = np.abs(np.sin(np.pi * h * width)) / h
        elif kind == "vowel":        # formant sets, "oo" to "ah" to "ee"
            f1 = np.interp(x, [0, 0.5, 1], [350, 800, 300])
            f2 = np.interp(x, [0, 0.5, 1], [800, 1200, 2300])
            f3 = np.interp(x, [0, 0.5, 1], [2400, 2600, 3000])
            fh = h * 180.0           # formants laid out for a 180 Hz voice
            amps = (1.0 / h ** 0.6) * (np.exp(-0.5 * ((fh - f1) / 120) ** 2)
                                         + 0.6 * np.exp(-0.5 * ((fh - f2) / 160) ** 2)
                                         + 0.3 * np.exp(-0.5 * ((fh - f3) / 220) ** 2) + 0.02)
        else:                        # "digital": bright odd/even shifting spectrum
            amps = (1.0 / h) * (0.5 + 0.5 * np.cos(np.pi * h * (0.05 + 0.4 * x)))
        for m in range(mips):
            limit = max(1, max_harm >> m)
            wave = np.zeros(size)
            for hh in range(1, limit + 1):
                wave += amps[hh - 1] * np.sin(TWO_PI * hh * t)
            peak = np.abs(wave).max()
            out[fr, m] = wave / peak if peak > 0 else wave
    _TABLE_CACHE[kind] = out
    return out


# -------------------------------------------------------------------- pluck
@njit(cache=True)
def _pluck(out, starts, gates, freqs, vels, p, seed):
    bright, sustain, pick, release, body = p[0], p[1], p[2], p[3] * SR, p[4]
    n_out = out.shape[1]
    state = seed
    for k in range(len(starts)):
        f0 = freqs[k]
        vel = vels[k]
        period = SR / f0
        size = int(period)
        if size < 2:
            continue
        frac = period - size
        coef = (1.0 - frac) / (1.0 + frac)        # all-pass for the fractional delay
        total = min(gates[k] + int(release * 5.0), n_out - starts[k])
        if total <= 0:
            continue
        buf = np.zeros(size)
        # excitation: noise burst, low-passed by how hard the string is struck
        lp = 0.0
        tone = 0.25 + 0.7 * bright * (0.4 + 0.6 * vel)
        for j in range(size):
            state = (state * 1103515245 + 12345) % 2147483648
            x = state / 1073741824.0 - 1.0
            lp += tone * (x - lp)
            buf[j] = lp
        # pick position: a comb that removes the harmonics with a node there
        d = int(pick * size)
        if d > 0:
            tmp = buf.copy()
            for j in range(size):
                buf[j] = tmp[j] - tmp[(j - d) % size]
        # loop loss tuned so the note rings ``sustain`` seconds at 110 Hz, shorter higher up
        t60 = sustain * (110.0 / f0) ** 0.35
        rho = 10.0 ** (-3.0 / (t60 * f0))
        rho_off = 10.0 ** (-3.0 / (0.12 * f0))
        damp = 0.5 - 0.42 * bright                # loop low-pass: 0.5 dull .. 0.08 bright
        idx = 0
        prev = 0.0
        ap_x = 0.0
        ap_y = 0.0
        amp = (0.3 + 0.7 * vel) * 0.9
        bl = 0.0
        for i in range(total):
            y = buf[idx]
            s = (1.0 - damp) * y + damp * prev
            prev = y
            s *= rho if i < gates[k] else rho_off
            ap_y = coef * (s - ap_y) + ap_x
            ap_x = s
            buf[idx] = ap_y
            idx += 1
            if idx >= size:
                idx = 0
            bl += body * (y - bl)                 # body: blend in a warmer copy
            v = (y * (1.0 - 0.5 * body) + bl * body) * amp
            out[0, starts[k] + i] += v
            out[1, starts[k] + i] += v
    return state


# -------------------------------------------------------------------- organ
@njit(cache=True)
def _organ(out, starts, gates, freqs, vels, bars, p):
    click, perc, rotary_rate, rotary_depth = p[0], p[1], p[2], p[3]
    ratios = np.array([0.5, 1.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0])
    n_out = out.shape[1]
    att = 0.004 * SR
    rel = 0.03 * SR
    for k in range(len(starts)):
        f0 = freqs[k]
        total = min(gates[k] + int(rel * 6), n_out - starts[k])
        if total <= 0:
            continue
        w = np.zeros(9)
        ph = np.zeros(9)
        for b in range(9):
            w[b] = TWO_PI * f0 * ratios[b] / SR
            if f0 * ratios[b] > 0.45 * SR:
                w[b] = 0.0
        for i in range(total):
            y = 0.0
            for b in range(9):
                if bars[b] > 0.0 and w[b] > 0.0:
                    y += bars[b] * np.sin(ph[b])
                    ph[b] += w[b]
            y += perc * np.exp(-i / (0.12 * SR)) * np.sin(2.0 * ph[2])
            if i < 200:
                y += click * (1.0 - i / 200.0) * np.sin(i * 0.9)
            if i < gates[k]:
                e = 1.0 if i >= att else i / att
            else:
                e = np.exp(-(i - gates[k]) / rel)
            t = (starts[k] + i) / SR
            lfo = np.sin(TWO_PI * rotary_rate * t)
            v = y * e * 0.12
            out[0, starts[k] + i] += v * (1.0 + rotary_depth * lfo)
            out[1, starts[k] + i] += v * (1.0 - rotary_depth * lfo)


# -------------------------------------------------------------------- drums
def _drum_voice(key, vel, kit, rng):
    """One analog drum hit, mono float64."""
    k = kit
    if key in (35, 36):                                   # kick: sine falling in pitch + click
        n = int(k["kick_len"] * SR)
        t = np.arange(n) / SR
        f = k["kick_f"] + k["kick_sweep"] * np.exp(-t / k["kick_sweep_t"])
        y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / (k["kick_len"] / 5))
        y += k["kick_click"] * np.exp(-t / 0.002) * rng.standard_normal(n)
        return np.tanh(y * k["kick_drive"]) * 1.0 * vel
    if key in (37, 38, 39, 40):                           # snare: two tones + filtered noise
        n = int(0.28 * SR)
        t = np.arange(n) / SR
        tone = (np.sin(TWO_PI * k["snare_f"] * t) + 0.6 * np.sin(TWO_PI * k["snare_f"] * 1.78 * t))
        tone *= np.exp(-t / 0.06)
        noise = rng.standard_normal(n)
        noise = np.diff(noise, prepend=0.0) * 0.6 + noise * 0.4
        noise *= np.exp(-t / k["snare_decay"])
        return (k["snare_tone"] * tone + (1 - k["snare_tone"]) * noise) * 0.7 * vel
    if key in (41, 43, 45, 47, 48, 50):                   # toms: sine sweep per size
        f0 = {41: 80, 43: 95, 45: 120, 47: 145, 48: 170, 50: 200}[key]
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        f = f0 * (1 + 0.6 * np.exp(-t / 0.03))
        return np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 0.12) * 0.8 * vel
    # cymbals: cluster of detuned squares, high-passed, with a decay per piece
    decay = {42: 0.035, 44: 0.035, 46: 0.22, 49: 0.9, 57: 0.9, 51: 0.5, 59: 0.5, 53: 0.4}.get(key, 0.08)
    n = int(min(2.5, decay * 6) * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0):
        y += np.sign(np.sin(TWO_PI * f * k["metal"] * t))
    y += rng.standard_normal(n) * k["hat_noise"] * 3
    y = np.diff(np.diff(y, prepend=0.0), prepend=0.0)     # steep high-pass
    y /= np.abs(y).max() + 1e-9
    return y * np.exp(-t / decay) * (0.35 if key in (42, 44, 46) else 0.45) * vel


KITS = {
    "808": dict(kick_f=48, kick_sweep=110, kick_sweep_t=0.025, kick_len=0.75, kick_click=0.05, kick_drive=1.2,
                snare_f=180, snare_tone=0.45, snare_decay=0.09, metal=1.0, hat_noise=0.1),
    "909": dict(kick_f=55, kick_sweep=260, kick_sweep_t=0.012, kick_len=0.4, kick_click=0.35, kick_drive=2.5,
                snare_f=200, snare_tone=0.3, snare_decay=0.13, metal=1.35, hat_noise=0.5),
}


def drum_machine(notes, length_s, kit="808"):
    n = int(length_s * SR)
    out = np.zeros(n + 3 * SR)
    rng = np.random.default_rng(7)
    params = KITS.get(kit, KITS["808"])
    cache = {}
    for s, _, key, v in notes:
        level = round(v / 127.0, 1)
        if (key, level) not in cache:
            cache[(key, level)] = _drum_voice(int(key), max(0.2, level), params, rng)
        hit = cache[(key, level)]
        i = int(s * SR)
        if i >= n:
            continue
        out[i:i + len(hit)] += hit[:len(out) - i]
    out = out[:n]
    return np.stack([out, out]).astype(np.float32)


# ------------------------------------------------------------------ presets
def _p(*values):
    return np.array(values, np.float64)


# analog: saw, pulse, pw, sub, detune cents, unison, spread, cutoff Hz, reso, env octaves, keytrack,
#         filter A D S R, amp A D S R, velocity->cutoff, drive
ANALOG = {
    "bass": _p(0.7, 0.5, 0.45, 0.6, 6, 1, 0, 180, 0.35, 3.2, 0.3, 0.002, 0.18, 0.15, 0.12, 0.003, 0.3, 0.75, 0.10, 0.6, 1.6),
    "acid": _p(1.0, 0.0, 0.5, 0.0, 0, 1, 0, 260, 0.82, 3.6, 0.4, 0.002, 0.14, 0.05, 0.10, 0.002, 0.2, 0.7, 0.08, 0.9, 2.2),
    "lead": _p(0.8, 0.4, 0.35, 0.2, 9, 2, 0.5, 900, 0.3, 2.2, 0.5, 0.01, 0.4, 0.5, 0.25, 0.008, 0.3, 0.8, 0.22, 0.5, 1.3),
    "pad": _p(0.9, 0.3, 0.4, 0.0, 16, 3, 0.9, 700, 0.15, 1.6, 0.4, 0.5, 1.2, 0.7, 0.9, 0.35, 0.8, 0.85, 0.9, 0.3, 1.0),
    "strings": _p(1.0, 0.0, 0.5, 0.0, 22, 3, 1.0, 1800, 0.05, 0.8, 0.5, 0.2, 0.8, 0.8, 0.5, 0.12, 0.5, 0.9, 0.5, 0.3, 1.0),
    "brass": _p(1.0, 0.2, 0.4, 0.0, 7, 2, 0.4, 420, 0.2, 2.8, 0.5, 0.05, 0.35, 0.55, 0.2, 0.03, 0.2, 0.85, 0.18, 0.8, 1.2),
    "pluck": _p(0.8, 0.5, 0.3, 0.0, 8, 2, 0.6, 500, 0.3, 3.5, 0.5, 0.001, 0.12, 0.0, 0.15, 0.002, 0.25, 0.0, 0.2, 0.6, 1.2),
}
# fm: carrier ratio, mod1 ratio/index/decay s/sustain, mod2 ratio/index/decay s, feedback, detune cents,
#     amp A D S R, velocity->index, key scaling
FM = {
    "epiano": _p(1, 1, 1.4, 0.9, 0.25, 14, 0.9, 0.06, 0.0, 4, 0.002, 1.6, 0.0, 0.25, 0.7, 0.25),
    "bass": _p(1, 1, 3.2, 0.14, 0.2, 2, 0.8, 0.05, 0.4, 0, 0.002, 0.5, 0.5, 0.08, 0.6, 0.1),
    "bell": _p(1, 3.5, 2.6, 2.5, 0.1, 7.1, 1.2, 0.4, 0.0, 5, 0.001, 3.0, 0.0, 1.2, 0.5, 0.3),
    "brass": _p(1, 1, 2.6, 0.25, 0.75, 2, 0.4, 0.3, 0.6, 5, 0.04, 0.3, 0.85, 0.15, 0.8, 0.25),
    "organ": _p(1, 2, 0.8, 5.0, 0.9, 3, 0.3, 5.0, 0.2, 3, 0.004, 0.2, 1.0, 0.05, 0.1, 0.0),
    "clav": _p(1, 3, 3.0, 0.3, 0.1, 1, 1.5, 0.1, 0.5, 0, 0.001, 0.5, 0.0, 0.08, 0.7, 0.2),
    "marimba": _p(1, 4, 1.2, 0.05, 0.0, 9.5, 0.4, 0.02, 0.0, 0, 0.001, 0.5, 0.0, 0.3, 0.6, 0.3),
}
# wavetable: table kind, then: start pos, end pos, sweep s, detune cents, amp A D S R, lfo Hz, lfo depth
WAVETABLE = {
    "sweep": ("sweep", _p(0.9, 0.25, 0.35, 8, 0.004, 0.5, 0.7, 0.25, 0.0, 0.0)),
    "pad": ("digital", _p(0.2, 0.7, 2.0, 14, 0.4, 1.0, 0.85, 0.9, 0.25, 0.15)),
    "lead": ("pulse", _p(0.6, 0.2, 0.4, 9, 0.008, 0.3, 0.8, 0.2, 5.0, 0.05)),
    "voice": ("vowel", _p(0.1, 0.55, 0.25, 6, 0.04, 0.3, 0.9, 0.2, 5.2, 0.04)),
    "bass": ("sweep", _p(0.7, 0.1, 0.15, 4, 0.002, 0.3, 0.7, 0.1, 0.0, 0.0)),
}
# pluck: brightness, sustain s at 110 Hz, pick position, release s, body; then drive (0 = clean)
PLUCK = {
    "nylon": (_p(0.45, 3.0, 0.22, 0.08, 0.45), 0.0),
    "steel": (_p(0.8, 5.0, 0.13, 0.10, 0.25), 0.0),
    "electric": (_p(0.7, 7.0, 0.18, 0.08, 0.1), 0.0),
    "overdrive": (_p(0.75, 9.0, 0.16, 0.06, 0.05), 6.0),
    "bass": (_p(0.4, 6.0, 0.2, 0.06, 0.3), 0.0),
    "harp": (_p(0.6, 4.0, 0.4, 0.5, 0.3), 0.0),
}
# organ: nine drawbars (16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1'), then click, percussion, rotary Hz, depth
ORGAN = {
    "jazz": (_p(8, 8, 8, 0, 0, 0, 0, 0, 0) / 8, _p(0.25, 0.6, 0.8, 0.12)),
    "rock": (_p(8, 8, 8, 8, 0, 0, 0, 0, 8) / 8, _p(0.4, 0.0, 6.5, 0.25)),
    "gospel": (_p(8, 0, 8, 8, 0, 8, 0, 0, 8) / 8, _p(0.2, 0.0, 6.5, 0.3)),
    "church": (_p(8, 4, 8, 8, 4, 8, 2, 4, 6) / 8, _p(0.0, 0.0, 0.3, 0.03)),
}
TAILS = {"analog": 2.0, "fm": 4.0, "wavetable": 2.0, "pluck": 3.0, "organ": 0.5}


def render(engine, preset, notes, length_s):
    """Render a track. Returns (2, n) float32, not normalised."""
    if engine == "drums":
        return drum_machine(notes, length_s, preset)
    if not HAVE_NUMBA:
        raise RuntimeError("The built-in synthesizers need numba")
    out, starts, gates, freqs, vels, n = _arrays(notes, length_s, TAILS[engine])
    if not len(starts):
        return np.zeros((2, n), np.float32)
    if engine == "analog":
        _analog(out, starts, gates, freqs, vels, ANALOG[preset])
    elif engine == "fm":
        _fm(out, starts, gates, freqs, vels, FM[preset])
    elif engine == "wavetable":
        kind, params = WAVETABLE[preset]
        _wavetable(out, starts, gates, freqs, vels, wavetable(kind), np.append(params, 256.0))
    elif engine == "pluck":
        params, drive = PLUCK[preset]
        _pluck(out, starts, gates, freqs, vels, params, 12345)
        if drive > 0:                 # amp stage: the whole chord goes through the distortion
            import scipy.signal as sg
            x = sg.sosfilt(sg.butter(2, 90, "hp", fs=SR, output="sos"), out, axis=-1)
            x = np.tanh(x * drive * 4.0)
            out = sg.sosfilt(sg.butter(2, [110, 4200], "bp", fs=SR, output="sos"), x, axis=-1) * 0.5
    elif engine == "organ":
        bars, params = ORGAN[preset]
        _organ(out, starts, gates, freqs, vels, bars, params)
    else:
        raise ValueError(f"Unknown engine: {engine}")
    return out[:, :n].astype(np.float32)
