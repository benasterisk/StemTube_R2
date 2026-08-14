"""One-time fetcher: download curated CC0 one-shots from Freesound (HQ previews),
convert to mono 44.1k WAV, trim + normalize, install into core/poc/samples/.

Run:  FREESOUND_API_KEY=<key>  py -3 -m core.poc.fetch_samples

Only the HQ preview (OGG) is fetched — that needs just the API key (no OAuth). All
chosen sounds are license = Creative Commons 0 (public domain); a CREDITS.txt is
written listing them. The API key is read from the environment and never stored.

'click' and 'beep' are intentionally NOT fetched — a synthesized click reads
crisper for a metronome; gen_samples.py still produces those two.
"""
from __future__ import annotations
import io
import os
import json
import urllib.request
import urllib.parse
import numpy as np
import soundfile as sf

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "samples")
API = "https://freesound.org/apiv2"

# instrument → (normal_id, accent_id). Curated, all verified CC0. accent = a brighter
# / higher / harder hit of the same family so downbeats read clearly.
CURATED = {
    "conga":     (455637, 455630),   # FD808A Conga low / hi
    "clave":     (375641, 634863),   # Claves mf / clave4
    "rimshot":   (125269, 125270),   # Sidestick 1 / 2 — dry cross-stick "tac"
    "cowbell":   (455635, 148931),   # FD808A cowbell / Cowbell.wav
    "woodblock": (692828, 692818),   # Woodblock soft / hard
    "shaker":    (199823, 199821),   # Egg Shaker throw / accent
}


def _key():
    k = os.environ.get("FREESOUND_API_KEY") or os.environ.get("FS_KEY")
    if not k:
        raise SystemExit("Set FREESOUND_API_KEY in the environment first.")
    return k


def _get_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def _sound_info(sid, key):
    params = urllib.parse.urlencode(
        {"fields": "id,name,license,username,previews", "token": key})
    return _get_json(f"{API}/sounds/{sid}/?{params}")


def _fetch_audio(url):
    req = urllib.request.Request(url, headers={"User-Agent": "stemtube/1.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    x, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    if getattr(x, "ndim", 1) > 1:          # mono-mix
        x = x.mean(axis=1)
    if sr != SR:                            # linear resample (short one-shots)
        n = int(round(len(x) * SR / sr))
        x = np.interp(np.linspace(0, 1, n, endpoint=False),
                      np.linspace(0, 1, len(x), endpoint=False), x).astype(np.float32)
    return np.asarray(x, dtype=np.float32)


def _trim(x, thresh=0.005, pad_ms=4):
    """Strip leading/trailing near-silence, keep a few ms of head/tail padding."""
    nz = np.where(np.abs(x) > thresh)[0]
    if nz.size == 0:
        return x
    pad = int(pad_ms * SR / 1000)
    a = max(0, nz[0] - pad)
    b = min(len(x), nz[-1] + pad)
    return x[a:b]


def _norm(x, peak=0.95):
    m = float(np.max(np.abs(x)))
    return (x * (peak / m)).astype(np.float32) if m > 1e-9 else x


def _fade(x, in_ms=0.5, out_ms=6):
    """De-click the edges: a VERY short fade-in (so the percussive attack transient
    — which is usually the peak — is preserved) and a longer fade-out."""
    ni = int(in_ms * SR / 1000)
    no = int(out_ms * SR / 1000)
    x = x.copy()
    if ni > 0 and len(x) > ni:
        x[:ni] *= np.linspace(0, 1, ni)
    if no > 0 and len(x) > no:
        x[-no:] *= np.linspace(1, 0, no)
    return x


def fetch(out_dir=OUT_DIR):
    key = _key()
    os.makedirs(out_dir, exist_ok=True)
    credits = ["Metronome instrument samples — sourced from Freesound, license CC0 (public domain).",
               "https://creativecommons.org/publicdomain/zero/1.0/", ""]
    for inst, (n_id, a_id) in CURATED.items():
        for suffix, sid in (("", n_id), ("_accent", a_id)):
            info = _sound_info(sid, key)
            lic = info.get("license", "")
            if "publicdomain/zero" not in lic:
                raise SystemExit(f"#{sid} is NOT CC0 ({lic}) — aborting, curate a different id.")
            url = info["previews"].get("preview-hq-ogg") or info["previews"].get("preview-hq-mp3")
            x = _norm(_fade(_trim(_fetch_audio(url))))   # fade first, normalize last
            path = os.path.join(out_dir, f"{inst}{suffix}.wav")
            sf.write(path, x, SR)
            dur = len(x) / SR * 1000
            print(f"  {inst}{suffix:<7} <- #{sid} {info['name'][:36]!r:38} {dur:5.0f}ms")
            credits.append(f"{inst}{suffix}.wav  <-  Freesound #{sid} \"{info['name']}\" by {info['username']} (CC0)")
    with open(os.path.join(out_dir, "CREDITS.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(credits) + "\n")
    print(f"\ninstalled {2*len(CURATED)} samples + CREDITS.txt into {out_dir}")


if __name__ == "__main__":
    fetch()
