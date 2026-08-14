"""
Auto-detect a sensible musical START point: the first DOWNBEAT at which the
tempo settles onto the song's main groove. This skips erratic intros (e.g. The
Lazy Song's whispered intro that madmom tracks at ~66 BPM while the real song is
~86 BPM) and lands on the first strong beat the user should count into.

The result is only a *proposal* — the UI lets the user drag the Start marker to
any beat. We return the beat index (and time) so the front-end can snap to it.
"""
from __future__ import annotations
import statistics


def _intervals(beats):
    return [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]


def detect_start(beats, positions, settle_beats: int = 4, tol_frac: float = 0.12):
    """
    Return (start_index, start_time). Strategy:
      1. Compute the median inter-beat interval over the WHOLE song (robust tempo).
      2. Walk downbeats (position==1) and pick the first one whose next
         `settle_beats` intervals are all within tol_frac of that median —
         i.e. the groove is now steady (intro instability is over).
      3. Fallbacks: first downbeat, else beat 0.
    """
    n = len(beats)
    if n == 0:
        return 0, 0.0
    ibis = _intervals(beats)
    if not ibis:
        return 0, float(beats[0])

    median_ibi = statistics.median(ibis)
    tol = tol_frac * median_ibi

    downbeats = [i for i in range(n) if i < len(positions) and positions[i] == 1]

    for di in downbeats:
        # check the next `settle_beats` intervals starting at this downbeat
        ok = True
        checked = 0
        for k in range(di, min(di + settle_beats, len(ibis))):
            checked += 1
            if abs(ibis[k] - median_ibi) > tol:
                ok = False
                break
        if ok and checked >= min(settle_beats, len(ibis) - di, 2):
            return di, float(beats[di])

    # fallbacks
    if downbeats:
        return downbeats[0], float(beats[downbeats[0]])
    return 0, float(beats[0])
