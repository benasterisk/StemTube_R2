#!/usr/bin/env python3
"""
Analyze beat timing precision and tempo stability for a track.
Creates a tempo alignment graph showing:
- Instantaneous BPM per beat
- Deviation from median BPM
- Cumulative drift from a constant-BPM grid
"""

import sys
import os
import json
import numpy as np

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

def analyze_from_db(video_id):
    """Load beat data from database and analyze."""
    from core.db.connection import _conn
    with _conn() as conn:
        row = conn.execute(
            "SELECT title, detected_bpm, beat_times, beat_positions FROM global_downloads WHERE video_id=?",
            (video_id,)
        ).fetchone()

    if not row:
        print(f"Video {video_id} not found in DB")
        return

    title = row['title']
    detected_bpm = row['detected_bpm']
    beat_times = json.loads(row['beat_times']) if row['beat_times'] else []
    beat_positions = json.loads(row['beat_positions']) if row['beat_positions'] else []

    print(f"Track: {title}")
    print(f"Detected BPM: {detected_bpm}")
    print(f"Beats: {len(beat_times)}, Positions: {len(beat_positions)}")

    if len(beat_times) < 3:
        print("Not enough beats to analyze")
        return

    analyze_beats(beat_times, beat_positions, title, detected_bpm)


def analyze_beats(beat_times, beat_positions, title, detected_bpm):
    """Full tempo analysis with graph output."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    bt = np.array(beat_times)
    intervals = np.diff(bt)
    instantaneous_bpm = 60.0 / intervals

    median_bpm = np.median(instantaneous_bpm)
    mean_bpm = np.mean(instantaneous_bpm)
    std_bpm = np.std(instantaneous_bpm)
    min_bpm = np.min(instantaneous_bpm)
    max_bpm = np.max(instantaneous_bpm)

    print(f"\n=== TEMPO STATISTICS ===")
    print(f"Median BPM:  {median_bpm:.2f}")
    print(f"Mean BPM:    {mean_bpm:.2f}")
    print(f"Std BPM:     {std_bpm:.2f}")
    print(f"Range:       {min_bpm:.1f} - {max_bpm:.1f} BPM")
    print(f"CV (coeff of variation): {std_bpm/mean_bpm*100:.2f}%")

    # Deviation from median
    deviation_pct = (instantaneous_bpm - median_bpm) / median_bpm * 100

    print(f"\n=== DEVIATION FROM MEDIAN ===")
    print(f"Max speedup:  +{np.max(deviation_pct):.1f}%")
    print(f"Max slowdown: {np.min(deviation_pct):.1f}%")
    print(f"Within ±2%:   {np.sum(np.abs(deviation_pct) < 2) / len(deviation_pct) * 100:.1f}% of beats")
    print(f"Within ±5%:   {np.sum(np.abs(deviation_pct) < 5) / len(deviation_pct) * 100:.1f}% of beats")
    print(f"Within ±10%:  {np.sum(np.abs(deviation_pct) < 10) / len(deviation_pct) * 100:.1f}% of beats")

    # Cumulative drift: expected position with constant BPM vs actual
    constant_interval = 60.0 / median_bpm
    expected_times = bt[0] + np.arange(len(bt)) * constant_interval
    drift_ms = (bt - expected_times) * 1000  # in ms

    print(f"\n=== CUMULATIVE DRIFT (vs constant {median_bpm:.1f} BPM grid) ===")
    print(f"Max drift:    {np.max(np.abs(drift_ms)):.0f} ms")
    print(f"Final drift:  {drift_ms[-1]:.0f} ms")
    print(f"Mean |drift|: {np.mean(np.abs(drift_ms)):.0f} ms")

    # Identify significant tempo changes (>5% deviation sustained for 3+ beats)
    print(f"\n=== NOTABLE TEMPO CHANGES ===")
    in_change = False
    change_start = 0
    for i, dev in enumerate(deviation_pct):
        if abs(dev) > 5:
            if not in_change:
                change_start = i
                in_change = True
        else:
            if in_change and (i - change_start) >= 3:
                avg_dev = np.mean(deviation_pct[change_start:i])
                t_start = bt[change_start]
                t_end = bt[i]
                direction = "ACCEL" if avg_dev > 0 else "DECEL"
                print(f"  {direction}: {t_start:.1f}s - {t_end:.1f}s ({i - change_start} beats, "
                      f"avg {avg_dev:+.1f}%, ~{median_bpm + median_bpm*avg_dev/100:.1f} BPM)")
            in_change = False
    # Check if we ended in a change
    if in_change and (len(deviation_pct) - change_start) >= 3:
        avg_dev = np.mean(deviation_pct[change_start:])
        t_start = bt[change_start]
        direction = "ACCEL" if avg_dev > 0 else "DECEL"
        print(f"  {direction}: {t_start:.1f}s - END ({len(deviation_pct) - change_start} beats, "
              f"avg {avg_dev:+.1f}%, ~{median_bpm + median_bpm*avg_dev/100:.1f} BPM)")

    # Downbeat analysis if positions available
    if beat_positions and len(beat_positions) == len(beat_times):
        bp = np.array(beat_positions)
        downbeat_idx = np.where(bp == 1)[0]
        if len(downbeat_idx) > 1:
            bar_intervals = np.diff(bt[downbeat_idx])
            beats_per_bar_detected = np.diff(downbeat_idx)
            bar_bpm = 60.0 * beats_per_bar_detected / bar_intervals
            print(f"\n=== BAR-LEVEL ANALYSIS ===")
            print(f"Bars: {len(downbeat_idx)}")
            print(f"Beats per bar: {np.median(beats_per_bar_detected):.0f} (median)")
            print(f"Bar BPM: {np.median(bar_bpm):.1f} median, {np.std(bar_bpm):.1f} std")

    # ===================== GRAPH =====================
    fig, axes = plt.subplots(4, 1, figsize=(16, 14), sharex=True)
    fig.suptitle(f'Tempo Analysis: {title}', fontsize=14, fontweight='bold')

    beat_centers = (bt[:-1] + bt[1:]) / 2  # midpoint of each interval

    # 1. Instantaneous BPM
    ax1 = axes[0]
    ax1.plot(beat_centers, instantaneous_bpm, 'b-', linewidth=0.5, alpha=0.6, label='Instantaneous BPM')
    # Rolling average (window=8 beats)
    if len(instantaneous_bpm) > 8:
        rolling = np.convolve(instantaneous_bpm, np.ones(8)/8, mode='valid')
        rolling_x = beat_centers[3:-4] if len(rolling) == len(beat_centers) - 7 else beat_centers[:len(rolling)]
        ax1.plot(rolling_x, rolling, 'r-', linewidth=2, label='8-beat rolling avg')
    ax1.axhline(y=median_bpm, color='green', linestyle='--', linewidth=1, label=f'Median ({median_bpm:.1f})')
    ax1.axhline(y=median_bpm * 1.05, color='orange', linestyle=':', alpha=0.5, label='±5%')
    ax1.axhline(y=median_bpm * 0.95, color='orange', linestyle=':', alpha=0.5)
    ax1.set_ylabel('BPM')
    ax1.set_title('Instantaneous Tempo')
    ax1.legend(loc='upper right', fontsize=8)
    ax1.grid(True, alpha=0.3)

    # 2. Deviation from median (%)
    ax2 = axes[1]
    colors = ['red' if abs(d) > 5 else 'orange' if abs(d) > 2 else 'green' for d in deviation_pct]
    ax2.bar(beat_centers, deviation_pct, width=constant_interval * 0.8, color=colors, alpha=0.7)
    ax2.axhline(y=0, color='black', linewidth=0.5)
    ax2.axhline(y=5, color='red', linestyle=':', alpha=0.5)
    ax2.axhline(y=-5, color='red', linestyle=':', alpha=0.5)
    ax2.axhline(y=2, color='orange', linestyle=':', alpha=0.5)
    ax2.axhline(y=-2, color='orange', linestyle=':', alpha=0.5)
    ax2.set_ylabel('Deviation (%)')
    ax2.set_title('Tempo Deviation from Median')
    ax2.grid(True, alpha=0.3)

    # 3. Cumulative drift
    ax3 = axes[2]
    ax3.plot(bt, drift_ms, 'purple', linewidth=1.5)
    ax3.fill_between(bt, drift_ms, alpha=0.2, color='purple')
    ax3.axhline(y=0, color='black', linewidth=0.5)
    ax3.axhline(y=50, color='red', linestyle=':', alpha=0.5, label='±50ms')
    ax3.axhline(y=-50, color='red', linestyle=':', alpha=0.5)
    ax3.set_ylabel('Drift (ms)')
    ax3.set_title(f'Cumulative Drift vs Constant Grid ({median_bpm:.1f} BPM)')
    ax3.legend(loc='upper right', fontsize=8)
    ax3.grid(True, alpha=0.3)

    # 4. Beat intervals (raw)
    ax4 = axes[3]
    ax4.plot(beat_centers, intervals * 1000, 'darkblue', linewidth=0.8)
    ax4.axhline(y=constant_interval * 1000, color='green', linestyle='--', label=f'Median ({constant_interval*1000:.0f}ms)')
    ax4.set_ylabel('Interval (ms)')
    ax4.set_xlabel('Time (seconds)')
    ax4.set_title('Beat Intervals')
    ax4.legend(loc='upper right', fontsize=8)
    ax4.grid(True, alpha=0.3)

    # Mark downbeats on all plots
    if beat_positions and len(beat_positions) == len(beat_times):
        bp = np.array(beat_positions)
        downbeat_times = bt[bp == 1]
        for ax in axes:
            for dt in downbeat_times[::4]:  # Mark every 4th downbeat to avoid clutter
                ax.axvline(x=dt, color='gray', linewidth=0.3, alpha=0.3)

    plt.tight_layout()
    output_path = os.path.join(os.path.dirname(__file__), 'tempo_analysis.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"\nGraph saved to: {output_path}")
    plt.close()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python analyze_tempo_alignment.py <video_id>")
        print("Example: python analyze_tempo_alignment.py 9gWIIIr2Asw")
        sys.exit(1)

    os.chdir(os.path.join(os.path.dirname(__file__), '..', '..'))
    analyze_from_db(sys.argv[1])
