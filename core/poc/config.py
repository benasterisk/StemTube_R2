"""Shared constants for the POC pipeline."""

SR = 44100                 # single working sample rate for all audio
DEMUCS_MODEL = "htdemucs"  # 4-stem model (vocals/drums/bass/other)

# Groove-snap tuning (validated on real tracks)
SNAP_WINDOW_SEC = 0.05         # max half-window to search for the drum accent
SNAP_WINDOW_BEAT_FRAC = 0.40   # cap window at this fraction of the local half-beat
SNAP_ACCENT_THRESHOLD = 0.15   # normalized onset-strength floor to count as an accent

# Metronome click
CLICK_FREQ = 1200.0   # Hz
CLICK_DUR = 0.05      # s
CLICK_RAMP = 0.04     # s (exponential decay length)
