"""
Musical key (tonality) detection — Krumhansl-Schmuckler with TEMPERLEY profiles
over a librosa CQT chroma, reinforced by the bass pitch-class distribution.

Why this and not StemTube's "loudest chroma bin": the tonic is often NOT the most
played pitch, and naive KS frequently locks onto the dominant. We use:
  • Temperley (Kostka-Payne) key profiles — measured to beat Krumhansl-Kessler on
    real tonal music.
  • a harmonic-percussive split (drop drums/transients) before the chroma.
  • a BASS chroma (low-pass) blended in: the bass overwhelmingly plays the tonic,
    so it disambiguates tonic-vs-dominant (the usual KS failure).

Returns {tonic, mode, key, confidence, score, alternates}. Confidence is the gap
to the runner-up; `alternates` lists the next best guesses (useful when low conf).
"""
from __future__ import annotations
import numpy as np

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Temperley / Kostka-Payne tonal profiles (better than Krumhansl-Kessler on
# real-world tonal music; major and minor).
_MAJOR = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
_MINOR = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt(np.sum(a * a) * np.sum(b * b))
    return float(np.dot(a, b) / d) if d > 0 else 0.0


def _chroma_mean(y, sr):
    import librosa
    if y.size == 0:
        return np.ones(12) / 12.0
    ch = librosa.feature.chroma_cqt(y=y, sr=sr, bins_per_octave=36).mean(axis=1)
    s = ch.sum()
    return ch / s if s > 0 else ch


def detect_key(audio_path: str, max_sec: float = 90.0):
    import librosa
    y, sr = librosa.load(audio_path, sr=22050, mono=True, duration=max_sec)
    if y.size == 0:
        return {"tonic": "C", "mode": "major", "key": "C major",
                "confidence": 0.0, "score": 0.0, "alternates": []}

    # Harmonic content for the main chroma (drums removed).
    y_harm = librosa.effects.harmonic(y, margin=4.0)
    chroma = _chroma_mean(y_harm, sr)

    # Bass chroma: low-pass ~250 Hz then chroma — the bass mostly states the tonic.
    try:
        from scipy.signal import butter, sosfiltfilt
        sos = butter(4, 250.0, btype="low", fs=sr, output="sos")
        y_bass = sosfiltfilt(sos, y).astype(np.float32)
        bass_chroma = _chroma_mean(y_bass, sr)
    except Exception:
        bass_chroma = chroma

    # Score the 24 keys with the main chroma; add a bass-tonic bonus so the key
    # whose ROOT matches the strongest bass pitch-class is favored (breaks the
    # tonic/dominant tie). Weight kept modest so it nudges, not overrides.
    bass_w = 0.30
    scores = []  # (score, tonic, mode)
    for tonic in range(12):
        maj = _corr(chroma, np.roll(_MAJOR, tonic)) + bass_w * bass_chroma[tonic]
        minr = _corr(chroma, np.roll(_MINOR, tonic)) + bass_w * bass_chroma[tonic]
        scores.append((maj, tonic, "major"))
        scores.append((minr, tonic, "minor"))

    scores.sort(key=lambda s: s[0], reverse=True)
    best, btonic, bmode = scores[0]
    confidence = max(0.0, min(1.0, best - scores[1][0]))
    alternates = [{"key": f"{NOTE_NAMES[t]} {m}", "score": round(float(sc), 3)}
                  for sc, t, m in scores[1:4]]

    name = NOTE_NAMES[btonic]
    return {
        "tonic": name,
        "mode": bmode,
        "key": f"{name} {bmode}",
        "confidence": round(float(confidence), 3),
        "score": round(float(best), 3),
        "alternates": alternates,
    }
