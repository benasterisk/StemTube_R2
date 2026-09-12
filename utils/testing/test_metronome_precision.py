#!/usr/bin/env python3
"""
Test metronome precision by comparing detected beats against a reference BPM grid.

Analyzes a track with madmom beat detection, then measures:
1. Beat detection consistency (interval regularity)
2. Drift over time vs. constant BPM grid
3. Onset alignment (do detected beats land on actual audio onsets?)

Usage:
    python utils/testing/test_metronome_precision.py [audio_file]

Default: Selah Sue - Alone
"""

import sys
import os
import json
import numpy as np

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Monkey-patch numpy for madmom compatibility
if not hasattr(np, 'int'):
    np.int = np.int64
if not hasattr(np, 'float'):
    np.float = np.float64
if not hasattr(np, 'bool'):
    np.bool = np.bool_

DEFAULT_TRACK = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "core/downloads/Selah Sue - Alone (Official Video)/audio/Selah_Sue_-_Alone_Official_Video.mp3"
)


def regularize_beat_times(beat_times):
    """Python replica of JS setBeatTimes: linear regression to find true interval."""
    n = len(beat_times)
    indices = np.arange(n)
    # Linear regression: beat_time[i] = offset + i * interval
    slope, intercept = np.polyfit(indices, beat_times, 1)
    regularized = [intercept + i * slope for i in range(n)]
    return regularized, slope, intercept


def detect_onsets(audio_path):
    """Detect audio onsets using spectral flux for comparison."""
    import soundfile as sf
    from scipy import signal as scipy_signal

    y, sr = sf.read(audio_path, dtype='float32')
    if len(y.shape) > 1:
        y = np.mean(y, axis=1)

    # Compute onset strength envelope
    hop = 512
    n_fft = 2048
    f, t, Zxx = scipy_signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft - hop)
    mag = np.abs(Zxx)
    onset_env = np.sum(np.maximum(0, np.diff(mag, axis=1, prepend=0)), axis=0)
    if np.max(onset_env) > 0:
        onset_env = onset_env / np.max(onset_env)

    frame_times = np.arange(len(onset_env)) * hop / sr

    # Pick peaks
    from scipy.signal import find_peaks
    peaks, props = find_peaks(onset_env, height=0.15, distance=int(sr / hop * 0.1))
    onset_times = frame_times[peaks]

    return onset_times, onset_env, frame_times


def test_madmom_beats(audio_path):
    """Run madmom beat detection and analyze precision."""
    from core.madmom_chord_detector import MadmomChordDetector

    print(f"\n{'='*70}")
    print(f"METRONOME PRECISION TEST")
    print(f"{'='*70}")
    print(f"File: {os.path.basename(audio_path)}")
    print()

    # Step 1: Detect beats with madmom
    print("[1/4] Running madmom beat detection...")
    detector = MadmomChordDetector()
    beat_offset, beats, beat_positions = detector._detect_beats(audio_path)

    if len(beats) == 0:
        print("ERROR: No beats detected!")
        return

    beat_times = [float(b) for b in beats]
    print(f"  Detected {len(beat_times)} beats")
    print(f"  Beat offset (first downbeat): {beat_offset:.4f}s")
    if beat_positions:
        downbeats = [i for i, p in enumerate(beat_positions) if p == 1]
        print(f"  Downbeats: {len(downbeats)} (positions where beat_position == 1)")
    print()

    # Step 2: Analyze interval consistency
    print("[2/4] Beat interval analysis...")
    intervals = np.diff(beat_times)
    median_interval = np.median(intervals)
    detected_bpm = 60.0 / median_interval

    print(f"  Median interval: {median_interval:.4f}s ({detected_bpm:.1f} BPM)")
    print(f"  Mean interval:   {np.mean(intervals):.4f}s ({60.0/np.mean(intervals):.1f} BPM)")
    print(f"  Std deviation:   {np.std(intervals)*1000:.2f}ms")
    print(f"  Min interval:    {np.min(intervals)*1000:.1f}ms")
    print(f"  Max interval:    {np.max(intervals)*1000:.1f}ms")
    print(f"  Range:           {(np.max(intervals) - np.min(intervals))*1000:.1f}ms")
    print()

    # Classify interval regularity
    jitter_ms = np.std(intervals) * 1000
    if jitter_ms < 5:
        quality = "EXCELLENT (< 5ms jitter)"
    elif jitter_ms < 15:
        quality = "GOOD (< 15ms jitter)"
    elif jitter_ms < 30:
        quality = "FAIR (< 30ms jitter)"
    else:
        quality = "POOR (> 30ms jitter)"
    print(f"  Regularity: {quality}")
    print()

    # Step 3: Drift analysis vs. constant BPM grid
    print("[3/4] Drift analysis (detected beats vs. constant BPM grid)...")
    # Build ideal constant grid from first beat
    ideal_times = np.array([beat_times[0] + i * median_interval for i in range(len(beat_times))])
    drift = np.array(beat_times) - ideal_times
    drift_ms = drift * 1000

    print(f"  Max drift from grid: {np.max(np.abs(drift_ms)):.1f}ms")
    print(f"  Mean drift:          {np.mean(drift_ms):.1f}ms")
    print(f"  Drift at 30s:        ", end="")
    # Find beat closest to 30s
    idx_30s = np.argmin(np.abs(np.array(beat_times) - 30.0))
    print(f"{drift_ms[idx_30s]:.1f}ms (beat #{idx_30s})")

    idx_60s = np.argmin(np.abs(np.array(beat_times) - 60.0))
    print(f"  Drift at 60s:        {drift_ms[idx_60s]:.1f}ms (beat #{idx_60s})")

    idx_120s = np.argmin(np.abs(np.array(beat_times) - 120.0))
    if beat_times[idx_120s] > 90:
        print(f"  Drift at 120s:       {drift_ms[idx_120s]:.1f}ms (beat #{idx_120s})")

    idx_180s = np.argmin(np.abs(np.array(beat_times) - 180.0))
    if beat_times[idx_180s] > 150:
        print(f"  Drift at 180s:       {drift_ms[idx_180s]:.1f}ms (beat #{idx_180s})")
    print()

    # Is the song truly constant tempo or does it have tempo changes?
    # Check if drift grows linearly (= wrong BPM estimate) or randomly (= variable tempo)
    # Linear fit on drift
    x = np.arange(len(drift_ms))
    slope, intercept = np.polyfit(x, drift_ms, 1)
    corrected_bpm = 60.0 / (median_interval + slope / 1000)
    print(f"  Drift slope: {slope:.3f}ms/beat")
    if abs(slope) > 0.5:
        print(f"  -> Suggests BPM should be {corrected_bpm:.2f} instead of {detected_bpm:.2f}")
        # Recompute with corrected interval
        corrected_interval = 60.0 / corrected_bpm
        ideal_corrected = np.array([beat_times[0] + i * corrected_interval for i in range(len(beat_times))])
        drift_corrected = (np.array(beat_times) - ideal_corrected) * 1000
        print(f"  Corrected max drift: {np.max(np.abs(drift_corrected)):.1f}ms")
    else:
        print(f"  -> BPM is stable (slope < 0.5ms/beat)")
    print()

    # Step 4: Onset alignment
    print("[4/4] Onset alignment check...")
    onset_times, _, _ = detect_onsets(audio_path)
    print(f"  Detected {len(onset_times)} audio onsets")

    # For each beat, find nearest onset
    onset_errors = []
    for bt in beat_times:
        if len(onset_times) == 0:
            break
        nearest_idx = np.argmin(np.abs(onset_times - bt))
        error = (onset_times[nearest_idx] - bt) * 1000  # ms
        onset_errors.append(error)

    onset_errors = np.array(onset_errors)
    aligned = np.sum(np.abs(onset_errors) < 50)  # within 50ms
    print(f"  Beats aligned with onset (< 50ms): {aligned}/{len(beat_times)} ({100*aligned/len(beat_times):.0f}%)")
    print(f"  Mean onset error: {np.mean(np.abs(onset_errors)):.1f}ms")
    print(f"  Median onset error: {np.median(np.abs(onset_errors)):.1f}ms")
    print()

    # Step 5: Regularization (same algorithm as JS setBeatTimes)
    print("[REGULARIZATION] Simulating JS linear regression regularization...")
    regularized, true_interval, true_offset = regularize_beat_times(beat_times)
    true_bpm = 60.0 / true_interval
    reg_intervals = np.diff(regularized)
    print(f"  True BPM (regression): {true_bpm:.2f}")
    print(f"  True interval: {true_interval*1000:.2f}ms")
    print(f"  True offset: {true_offset:.4f}s")
    print(f"  BEFORE: interval std = {np.std(intervals)*1000:.2f}ms, range = {(np.max(intervals)-np.min(intervals))*1000:.1f}ms")
    print(f"  AFTER:  interval std = {np.std(reg_intervals)*1000:.4f}ms (perfectly regular)")

    # Check displacement from original
    displacements = np.array(regularized) - np.array(beat_times)
    print(f"  Max displacement from original: {np.max(np.abs(displacements))*1000:.1f}ms")
    print(f"  Mean displacement: {np.mean(np.abs(displacements))*1000:.1f}ms")

    # Check onset alignment after regularization
    reg_onset_errors = []
    for bt in regularized:
        nearest_idx = np.argmin(np.abs(onset_times - bt))
        error = abs(onset_times[nearest_idx] - bt) * 1000
        reg_onset_errors.append(error)
    reg_aligned = np.sum(np.array(reg_onset_errors) < 50)
    print(f"  Onset alignment after regularization: {reg_aligned}/{len(regularized)} ({100*reg_aligned/len(regularized):.0f}%)")

    # Drift check with regularized grid
    ideal_reg = np.array([regularized[0] + i * true_interval for i in range(len(regularized))])
    drift_reg = (np.array(regularized) - ideal_reg) * 1000
    print(f"  Max drift from regularized grid: {np.max(np.abs(drift_reg)):.4f}ms (should be ~0)")
    print()

    # Step 6: What the metronome actually does
    print("=" * 70)
    print("METRONOME SCHEDULING SIMULATION")
    print("=" * 70)
    print()

    # Simulate what _scheduleFromBeatMap does with the beat map
    print("Beat map mode (using detected beats directly):")
    print(f"  First 20 beat times:")
    for i, t in enumerate(beat_times[:20]):
        interval_str = ""
        if i > 0:
            iv = (beat_times[i] - beat_times[i-1]) * 1000
            interval_str = f"  (interval: {iv:.1f}ms)"
        pos_str = ""
        if beat_positions and i < len(beat_positions):
            pos_str = f"  [beat {beat_positions[i]} in bar]"
        print(f"    beat {i:3d}: {t:.4f}s{interval_str}{pos_str}")
    print()

    # Simulate constant BPM mode
    print(f"Constant BPM mode ({detected_bpm:.1f} BPM, offset={beat_offset:.4f}s):")
    const_interval = 60.0 / detected_bpm
    print(f"  Beat interval: {const_interval*1000:.1f}ms")
    print(f"  First 20 scheduled clicks:")
    for i in range(20):
        t = beat_offset + i * const_interval
        # Find actual beat error
        if i < len(beat_times):
            err = (t - beat_times[i]) * 1000
            print(f"    click {i:3d}: {t:.4f}s  (vs actual: {err:+.1f}ms)")
        else:
            print(f"    click {i:3d}: {t:.4f}s")
    print()

    # Final verdict
    print("=" * 70)
    print("VERDICT")
    print("=" * 70)

    issues = []
    if jitter_ms > 30:
        issues.append(f"HIGH JITTER: {jitter_ms:.1f}ms std dev in beat intervals")
    if abs(slope) > 1.0:
        issues.append(f"BPM DRIFT: {slope:.2f}ms/beat slope suggests wrong BPM ({detected_bpm:.1f} vs {corrected_bpm:.1f})")
    if aligned / len(beat_times) < 0.6:
        issues.append(f"POOR ONSET ALIGNMENT: only {100*aligned/len(beat_times):.0f}% of beats near audio onsets")

    max_drift = np.max(np.abs(drift_ms))
    if max_drift > 100:
        issues.append(f"LARGE DRIFT: {max_drift:.0f}ms max deviation from constant grid")

    if issues:
        print("ISSUES FOUND:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("ALL CHECKS PASSED")
        print(f"  - Jitter: {jitter_ms:.1f}ms (< 30ms)")
        print(f"  - Max drift: {max_drift:.0f}ms")
        print(f"  - Onset alignment: {100*aligned/len(beat_times):.0f}%")
        print(f"  - BPM: {detected_bpm:.1f}")

    print()

    # Check: is the song better served by beat map or constant BPM?
    # If drift is large but jitter is low, the song has tempo changes -> use beat map
    # If drift is small and jitter is low -> constant BPM is fine
    if max_drift > 50 and jitter_ms < 20:
        print("RECOMMENDATION: Song has tempo variations. Use BEAT MAP mode (beat_times array).")
        print("  The metronome should use _scheduleFromBeatMap, NOT _scheduleFromConstantBPM.")
    elif jitter_ms > 30:
        print("RECOMMENDATION: Beat detection is noisy. Consider using CONSTANT BPM mode.")
    else:
        print("RECOMMENDATION: Both modes should work well for this track.")

    # Check if beat_times are stored in DB
    print()
    print("-" * 70)
    print("DATABASE CHECK")
    print("-" * 70)
    try:
        from core.db.connection import _conn
        with _conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT video_id, detected_bpm, beat_offset, beat_times, beat_positions FROM global_downloads WHERE title LIKE '%Selah%'")
            row = cursor.fetchone()
            if row:
                vid, bpm, offset, bt_json, bp_json = row
                print(f"  video_id: {vid}")
                print(f"  detected_bpm: {bpm}")
                print(f"  beat_offset: {offset}")
                bt = json.loads(bt_json) if bt_json else []
                bp = json.loads(bp_json) if bp_json else []
                print(f"  beat_times: {len(bt)} entries {'(stored)' if bt else '(EMPTY - needs regeneration!)'}")
                print(f"  beat_positions: {len(bp)} entries {'(stored)' if bp else '(EMPTY - needs regeneration!)'}")
                if bt:
                    db_intervals = np.diff(bt[:20])
                    print(f"  DB beat intervals (first 20): mean={np.mean(db_intervals)*1000:.1f}ms, std={np.std(db_intervals)*1000:.1f}ms")
            else:
                print("  No Selah Sue entry found in global_downloads")
    except Exception as e:
        print(f"  DB check error: {e}")

    print()


if __name__ == "__main__":
    audio_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TRACK

    if not os.path.exists(audio_path):
        print(f"ERROR: File not found: {audio_path}")
        sys.exit(1)

    test_madmom_beats(audio_path)
