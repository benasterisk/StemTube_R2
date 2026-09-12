#!/usr/bin/env python3
"""
Test beat detection pipeline — reproduces exact logic from:
  1. download_manager.analyze_audio_with_librosa() → BPM hint (autocorrelation)
  2. chord_detector.analyze_audio_file() → librosa beat_track + octave correction

Usage: python test_beat_detection.py <audio_file>
"""

import sys
import os
import numpy as np
import soundfile as sf
from scipy import signal


def detect_bpm_autocorrelation(audio_path):
    """
    Reproduce download_manager.analyze_audio_with_librosa() BPM detection.
    This is what runs at download time and becomes detected_bpm in the DB.
    """
    print("=" * 70)
    print("STEP 1: Autocorrelation BPM (download_manager logic)")
    print("=" * 70)

    y, sr = sf.read(audio_path, dtype='float32')
    if len(y.shape) > 1:
        y = np.mean(y, axis=1)

    # Limit to 60 seconds
    max_samples = int(sr * 60)
    if len(y) > max_samples:
        y = y[:max_samples]

    print(f"  Audio: {len(y)} samples at {sr} Hz ({len(y)/sr:.1f}s)")

    hop_length = 512
    n_fft = 2048

    f, t, Zxx = signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft - hop_length)
    magnitude = np.abs(Zxx)
    onset_env = np.sum(np.diff(magnitude, axis=1, prepend=0), axis=0)
    onset_env = np.maximum(0, onset_env)

    autocorr = np.correlate(onset_env, onset_env, mode='full')
    autocorr = autocorr[len(autocorr) // 2:]

    min_lag = int(sr / hop_length * 60 / 200)  # 200 BPM
    max_lag = int(sr / hop_length * 60 / 60)   # 60 BPM

    if max_lag < len(autocorr):
        autocorr_region = autocorr[min_lag:max_lag]
        peak_lag = np.argmax(autocorr_region) + min_lag
        tempo_period = peak_lag * hop_length / sr
        detected_tempo = 60.0 / tempo_period if tempo_period > 0 else 120.0

        # Octave correction — prefer 80-140 range
        candidate_tempos = [detected_tempo]
        if detected_tempo > 140:
            half = detected_tempo / 2
            if half >= 60:
                candidate_tempos.append(half)
        if detected_tempo < 90:
            double = detected_tempo * 2
            if double <= 200:
                candidate_tempos.append(double)

        preferred = [t for t in candidate_tempos if 80 <= t <= 140]
        final_tempo = preferred[0] if preferred else detected_tempo
        final_tempo = np.clip(final_tempo, 60, 200)
    else:
        final_tempo = 120.0

    print(f"  Raw autocorrelation tempo: {detected_tempo:.1f} BPM")
    print(f"  After octave correction:   {final_tempo:.1f} BPM")
    print()
    return round(float(final_tempo), 1)


def detect_beats_librosa(audio_path, bpm_hint):
    """
    Reproduce chord_detector.analyze_audio_file() beat detection.
    This is what runs for beat detection (both at download and Reanalyze).
    """
    import librosa

    print("=" * 70)
    print(f"STEP 2: Librosa beat_track (bpm hint={bpm_hint})")
    print("=" * 70)

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    print(f"  Audio: {len(y)} samples at {sr} Hz ({len(y)/sr:.1f}s)")

    # --- Without hint ---
    print("\n  [A] Without BPM hint:")
    tempo_raw, frames_raw = librosa.beat.beat_track(y=y, sr=sr, units='frames')
    times_raw = librosa.frames_to_time(frames_raw, sr=sr)
    t_raw = float(tempo_raw) if not hasattr(tempo_raw, '__len__') else float(tempo_raw[0])
    print(f"      Detected tempo: {t_raw:.1f} BPM, {len(times_raw)} beats")
    if len(times_raw) > 1:
        intervals_raw = np.diff(times_raw)
        print(f"      Mean interval: {np.mean(intervals_raw)*1000:.1f} ms (={60/np.mean(intervals_raw):.1f} BPM)")
        print(f"      Median interval: {np.median(intervals_raw)*1000:.1f} ms (={60/np.median(intervals_raw):.1f} BPM)")

    # --- With hint ---
    print(f"\n  [B] With BPM hint={bpm_hint}:")
    tempo_hint, frames_hint = librosa.beat.beat_track(y=y, sr=sr, bpm=float(bpm_hint), units='frames')
    times_hint = librosa.frames_to_time(frames_hint, sr=sr)
    t_hint = float(tempo_hint) if not hasattr(tempo_hint, '__len__') else float(tempo_hint[0])
    print(f"      Detected tempo: {t_hint:.1f} BPM, {len(times_hint)} beats")
    if len(times_hint) > 1:
        intervals_hint = np.diff(times_hint)
        print(f"      Mean interval: {np.mean(intervals_hint)*1000:.1f} ms (={60/np.mean(intervals_hint):.1f} BPM)")
        print(f"      Median interval: {np.median(intervals_hint)*1000:.1f} ms (={60/np.median(intervals_hint):.1f} BPM)")

    # --- Octave correction (actual app logic) ---
    beat_times = [round(float(t), 4) for t in times_hint]
    detected_tempo = t_hint

    print(f"\n  [C] Octave correction (ratio = {detected_tempo:.1f} / {bpm_hint} = {detected_tempo/bpm_hint:.2f}):")
    ratio = detected_tempo / float(bpm_hint)
    if 1.7 < ratio < 2.3:
        print(f"      HALVING: {detected_tempo:.1f} is ~2x hint, taking every other beat")
        beat_times = beat_times[::2]
        detected_tempo = detected_tempo / 2
    elif 0.43 < ratio < 0.6:
        print(f"      DOUBLING: {detected_tempo:.1f} is ~0.5x hint, interpolating beats")
        doubled = []
        for j in range(len(beat_times)):
            doubled.append(beat_times[j])
            if j < len(beat_times) - 1:
                doubled.append(round((beat_times[j] + beat_times[j + 1]) / 2, 4))
        beat_times = doubled
        detected_tempo = detected_tempo * 2
    else:
        print(f"      No correction needed (ratio {ratio:.2f} is close to 1.0)")

    print(f"\n  Final: {len(beat_times)} beats, tempo={detected_tempo:.1f} BPM")
    if len(beat_times) > 1:
        final_intervals = np.diff(beat_times)
        final_bpm = 60.0 / np.median(final_intervals)
        print(f"  BPM from intervals: {final_bpm:.1f}")

    return beat_times, detected_tempo


def analyze_halftime(beat_times):
    """
    Show what halftime resolution would produce.
    Halftime = every other beat. Show both even and odd phase.
    """
    print("\n" + "=" * 70)
    print("STEP 3: Halftime analysis")
    print("=" * 70)

    if len(beat_times) < 4:
        print("  Not enough beats for halftime analysis")
        return

    even_beats = beat_times[0::2]  # beats 0, 2, 4, ...
    odd_beats = beat_times[1::2]   # beats 1, 3, 5, ...

    print(f"\n  Even phase (beats 0,2,4,...): {len(even_beats)} clicks")
    if len(even_beats) > 1:
        ev_int = np.diff(even_beats)
        print(f"    Mean interval: {np.mean(ev_int)*1000:.1f} ms (={60/np.mean(ev_int):.1f} BPM)")

    print(f"\n  Odd phase (beats 1,3,5,...): {len(odd_beats)} clicks")
    if len(odd_beats) > 1:
        od_int = np.diff(odd_beats)
        print(f"    Mean interval: {np.mean(od_int)*1000:.1f} ms (={60/np.mean(od_int):.1f} BPM)")

    # Show first 16 beats with halftime marking
    print(f"\n  First 16 beats with halftime phase:")
    print(f"  {'Beat#':>6} {'Time':>8} {'Interval':>10} {'HT-even':>8} {'HT-odd':>8}")
    for i in range(min(16, len(beat_times))):
        t = beat_times[i]
        interval = f"{(beat_times[i] - beat_times[i-1])*1000:.0f}ms" if i > 0 else "---"
        ht_even = "CLICK" if i % 2 == 0 else ""
        ht_odd = "CLICK" if i % 2 == 1 else ""
        print(f"  {i:>6} {t:>8.3f} {interval:>10} {ht_even:>8} {ht_odd:>8}")


def show_metronome_grid(beat_times, bpm):
    """
    Show what the metronome constant-BPM grid produces at different resolutions.
    This reproduces _scheduleFromConstantBPM logic.
    """
    print("\n" + "=" * 70)
    print("STEP 4: Metronome grid (constant BPM, as used in app)")
    print("=" * 70)

    if not beat_times or bpm <= 0:
        print("  No beats or BPM")
        return

    beat_offset = beat_times[0]
    base_duration = 60.0 / bpm

    print(f"  BPM: {bpm:.1f}, beat_offset: {beat_offset:.4f}s, beat_duration: {base_duration*1000:.1f}ms")

    # Show grid for first ~10 seconds
    max_time = min(beat_offset + 10, beat_times[-1] if beat_times else 10)

    for res_name, res in [("ontime (1x)", 1.0), ("halftime (0.5x)", 0.5), ("double (2x)", 2.0)]:
        step = 1.0 / res
        click_duration = base_duration * step

        print(f"\n  Resolution: {res_name} — click every {click_duration*1000:.0f}ms")
        print(f"  {'Click#':>7} {'SongTime':>10} {'Interval':>10}")
        prev_t = None
        for i in range(50):
            t = beat_offset + i * step * base_duration
            if t < 0:
                continue
            if t > max_time:
                break
            interval = f"{(t - prev_t)*1000:.0f}ms" if prev_t is not None else "---"
            print(f"  {i:>7} {t:>10.3f} {interval:>10}")
            prev_t = t


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_beat_detection.py <audio_file>")
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}")
        sys.exit(1)

    print(f"Analyzing: {os.path.basename(audio_path)}\n")

    # Step 1: Autocorrelation BPM (download_manager)
    bpm_hint = detect_bpm_autocorrelation(audio_path)

    # Step 2: Librosa beat detection (chord_detector)
    beat_times, final_tempo = detect_beats_librosa(audio_path, bpm_hint)

    # Step 3: Halftime analysis
    analyze_halftime(beat_times)

    # Step 4: Metronome grid simulation
    # Use BPM from linear regression of beat_times (like setBeatTimes does)
    if len(beat_times) > 2:
        from numpy.polynomial import polynomial as P
        indices = np.arange(len(beat_times))
        coeffs = P.polyfit(indices, beat_times, 1)
        reg_duration = coeffs[1]
        reg_bpm = round(60.0 / reg_duration, 1)
        reg_offset = round(float(coeffs[0]), 4)
        print(f"\n  Linear regression: BPM={reg_bpm}, offset={reg_offset}s (vs raw tempo={final_tempo:.1f})")
        show_metronome_grid(beat_times, reg_bpm)
    else:
        show_metronome_grid(beat_times, final_tempo)

    print("\n" + "=" * 70)
    print("DONE")
    print("=" * 70)
