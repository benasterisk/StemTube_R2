"""Sampled instruments: General MIDI SoundFont played by TinySoundFont.

The bank is GeneralUser GS by S. Christian Collins (about 31 MB, free to use and
redistribute, see its licence in the repository below). It is not shipped: it is
downloaded on first use next to the other model files (``core.config.MODELS_DIR``,
which is not tracked by git, so it survives an update of the code).

The player itself (tinysoundfont, a small binary wheel) is installed on first
need too, without its dependencies: it declares PyAudio, which it only needs to
play live and which has no Linux wheel, so a plain install fails there.
"""
import importlib
import os
import subprocess
import sys
import threading
import urllib.request

import numpy as np

SR = 44100
SF_URL = "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"
SF_MIN_BYTES = 20_000_000
_lock = threading.Lock()
_install_tried = False


def _sf_path():
    try:
        from core.config import MODELS_DIR
        base = MODELS_DIR
    except Exception:           # used outside the app (tests, command line)
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
    return os.path.join(base, "soundfonts", "GeneralUser-GS.sf2")


def available():
    """Is the SoundFont player importable?"""
    try:
        import tinysoundfont  # noqa: F401
        return True
    except Exception:
        return False


def ensure_player():
    """available(), after one attempt to install the player when it is missing."""
    global _install_tried
    if available():
        return True
    with _lock:
        if _install_tried:
            return available()
        _install_tried = True
        try:
            kwargs = {"creationflags": 0x08000000} if os.name == "nt" else {}
            subprocess.run([sys.executable, "-m", "pip", "install", "--no-input", "--no-deps",
                            "--disable-pip-version-check", "tinysoundfont"],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300, **kwargs)
            importlib.invalidate_caches()
        except Exception:
            return False
    return available()


def ensure_soundfont():
    with _lock:
        SF_PATH = _sf_path()
        if os.path.exists(SF_PATH) and os.path.getsize(SF_PATH) > SF_MIN_BYTES:
            return SF_PATH
        os.makedirs(os.path.dirname(SF_PATH), exist_ok=True)
        tmp = SF_PATH + ".part"
        req = urllib.request.Request(SF_URL, headers={"User-Agent": "stemtube"})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        if os.path.getsize(tmp) < SF_MIN_BYTES:
            os.remove(tmp)
            raise RuntimeError("SoundFont download incomplete")
        os.replace(tmp, SF_PATH)
        return SF_PATH


def render(notes, length_s, program=0, drums=False):
    """notes: [(start_s, end_s, pitch, velocity)] -> (2, n) float32."""
    if not ensure_player():
        raise RuntimeError("The sampled instruments are not available (tinysoundfont could not be installed)")
    import tinysoundfont
    synth = tinysoundfont.Synth(samplerate=SR, gain=-6)
    sfid = synth.sfload(ensure_soundfont())
    chan = 9 if drums else 0
    try:
        synth.program_select(chan, sfid, 128 if drums else 0, int(program), drums)
    except Exception:
        synth.program_select(chan, sfid, 128 if drums else 0, 0, drums)
    events = []
    for s, e, p, v in notes:
        events.append((s, 1, int(p), int(v)))
        events.append((max(e, s + 0.03), 0, int(p), 0))
    events.sort(key=lambda ev: (ev[0], ev[1]))
    n_total = int(length_s * SR)
    out = np.zeros((n_total, 2), np.float32)
    pos = 0
    for t, on, p, v in events:
        target = min(n_total, int(t * SR))
        if target > pos:
            out[pos:target] = np.frombuffer(synth.generate(target - pos), dtype=np.float32).reshape(-1, 2)
            pos = target
        if on:
            synth.noteon(chan, p, max(1, min(127, v)))
        else:
            synth.noteoff(chan, p)
    if pos < n_total:
        out[pos:] = np.frombuffer(synth.generate(n_total - pos), dtype=np.float32).reshape(-1, 2)
    return out.T.copy()
