"""
Music Start Detector — Detect where actual music begins in an audio file.

Uses Harmonic/Percussive Source Separation (HPSS) to distinguish tonal instrument
content from broadband noise (applause, crowd, SFX). The key discriminator is the
Harmonic-to-Percussive ratio (H/P): music has high H/P, applause/noise has low H/P.

Returns the timestamp (seconds) where music starts, or 0.0 if music starts immediately.
"""

import numpy as np
from typing import Optional, List


def detect_music_start(
    audio_path: str,
    min_sustained_sec: float = 2.0,
    max_scan_sec: float = 120.0,
    beat_times: Optional[List[float]] = None
) -> float:
    """
    Detect where actual music begins, skipping non-musical intros.

    Uses HPSS to separate harmonic (instruments, vocals) from percussive
    (applause, noise) components, then uses the H/P energy ratio as the
    primary discriminator. Music has H/P >> 1, applause has H/P < 1.

    Args:
        audio_path: Path to the audio file.
        min_sustained_sec: Minimum duration of sustained musical content to confirm music start.
        max_scan_sec: Maximum seconds to scan from the start.
        beat_times: Optional list of beat timestamps to snap the result to the nearest beat.

    Returns:
        Timestamp in seconds where music starts, or 0.0 if music starts immediately.
    """
    try:
        import librosa

        # Load audio (resampled to 22050 Hz mono for fast analysis)
        y, sr = librosa.load(audio_path, sr=22050, mono=True, duration=max_scan_sec)

        if len(y) < sr * 2:
            return 0.0

        # Harmonic/Percussive Source Separation
        y_harmonic, y_percussive = librosa.effects.hpss(y)

        # Analysis parameters: 0.5s hop, 1.0s window
        hop_samples = sr // 2  # 0.5s
        frame_samples = sr     # 1.0s
        n_frames = 1 + (len(y) - frame_samples) // hop_samples

        if n_frames < 2:
            return 0.0

        rms_values = np.zeros(n_frames)
        harmonic_rms = np.zeros(n_frames)
        percussive_rms = np.zeros(n_frames)
        hp_ratio = np.zeros(n_frames)
        chroma_concentration = np.zeros(n_frames)

        for i in range(n_frames):
            start = i * hop_samples
            end = start + frame_samples
            frame = y[start:end]
            h_frame = y_harmonic[start:end]
            p_frame = y_percussive[start:end]

            # Full signal RMS
            rms_values[i] = np.sqrt(np.mean(frame ** 2))

            # Harmonic and percussive RMS
            harmonic_rms[i] = np.sqrt(np.mean(h_frame ** 2))
            percussive_rms[i] = np.sqrt(np.mean(p_frame ** 2))

            # H/P ratio: the key discriminator
            # Music (instruments, vocals): high harmonic, moderate percussive → ratio > 1.5
            # Applause/noise: low harmonic, high percussive → ratio < 1.0
            hp_ratio[i] = harmonic_rms[i] / (percussive_rms[i] + 1e-10)

            # Chroma concentration: max/mean ratio of chroma energy
            # Music has strong peaks at specific pitches, noise is uniform
            chroma = np.abs(librosa.feature.chroma_stft(
                y=frame, sr=sr, n_fft=2048, hop_length=frame_samples
            ))
            chroma_mean = np.mean(chroma, axis=1)
            mean_val = np.mean(chroma_mean)
            if mean_val > 1e-10:
                chroma_concentration[i] = np.max(chroma_mean) / mean_val
            else:
                chroma_concentration[i] = 1.0

        # Minimum energy floor — reject silence and very quiet sections
        # Use 15% of the top-quartile median to ensure only clearly audible sections pass
        sorted_rms = np.sort(rms_values)
        top_q_rms = sorted_rms[int(len(sorted_rms) * 0.75):]
        min_energy = np.median(top_q_rms) * 0.15 if len(top_q_rms) > 0 else 0.001

        # Also require meaningful harmonic energy (not just ratio)
        sorted_h_rms = np.sort(harmonic_rms)
        top_q_h = sorted_h_rms[int(len(sorted_h_rms) * 0.75):]
        min_harmonic = np.median(top_q_h) * 0.15 if len(top_q_h) > 0 else 0.001

        # H/P ratio threshold: frames where harmonic dominates percussive
        # For music: guitar, vocals, keys → H/P typically 1.5-5.0+
        # For applause: broadband noise → H/P typically 0.3-0.9
        hp_threshold = 1.2

        # Classify: require both meaningful energy AND harmonic dominance
        is_musical = (
            # Primary: harmonic dominates percussive AND both energies are significant
            ((hp_ratio > hp_threshold) & (rms_values > min_energy) & (harmonic_rms > min_harmonic))
            # Secondary: very strong pitch concentration with moderate H/P and energy
            | ((chroma_concentration > 3.5) & (hp_ratio > 0.8) & (rms_values > min_energy) & (harmonic_rms > min_harmonic))
        )

        # Find first sustained musical region
        min_frames = max(1, int(min_sustained_sec / 0.5))

        for i in range(len(is_musical) - min_frames + 1):
            if np.all(is_musical[i:i + min_frames]):
                music_start = i * 0.5  # Convert frame index to seconds

                # If music starts within the first 5s, consider it starts immediately.
                # Skip Intro is for long non-musical intros (applause, dialogue, SFX),
                # not for the first few beats of a song.
                if music_start < 5.0:
                    return 0.0

                # Snap to nearest beat if beat_times provided
                if beat_times and len(beat_times) > 0:
                    music_start = _snap_to_nearest_beat(music_start, beat_times)

                return round(music_start, 2)

        # No sustained musical content found — return 0.0 (assume music throughout)
        return 0.0

    except Exception as e:
        print(f"[MUSIC_START] Detection error: {e}")
        return 0.0


def _snap_to_nearest_beat(time_sec: float, beat_times: List[float]) -> float:
    """Snap a timestamp to the nearest beat in the beat map."""
    if not beat_times:
        return time_sec

    best = beat_times[0]
    best_dist = abs(time_sec - best)

    for bt in beat_times:
        dist = abs(time_sec - bt)
        if dist < best_dist:
            best = bt
            best_dist = dist
        elif bt > time_sec + best_dist:
            break  # Beat times are sorted, no point continuing

    return best
