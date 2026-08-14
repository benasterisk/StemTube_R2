"""Beat & downbeat detection (madmom)."""
from __future__ import annotations


def detect(audio_path: str) -> tuple[list[float], list[int]]:
    """
    madmom RNN + DBN downbeat tracking on the full mix.
    Returns (beat_times_sec, bar_positions) where position 1 = downbeat.
    """
    from madmom.features.downbeats import RNNDownBeatProcessor, DBNDownBeatTrackingProcessor
    print("[BEATS] madmom downbeat detection…")
    act = RNNDownBeatProcessor()(audio_path)
    proc = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)
    result = proc(act)  # Nx2: [time, beat_in_bar]
    beats = [round(float(t), 4) for t in result[:, 0]]
    positions = [int(p) for p in result[:, 1]]
    print(f"[BEATS] {len(beats)} beats, {sum(1 for p in positions if p == 1)} downbeats")
    return beats, positions
