#!/usr/bin/env python3
"""
Re-analyze Neil Young "Heart of Gold" with fixed BPM detection and key-aware chord detection.
"""

import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sqlite3
from core.downloads_db import update_download_analysis
from core.download_manager import DownloadManager
from core.chord_detector import analyze_audio_file

def reanalyze_song(video_id):
    """Re-analyze a song with improved BPM and chord detection."""

    # Get download info from database
    conn = sqlite3.connect('stemtubes.db')
    cursor = conn.cursor()
    cursor.execute("SELECT title, file_path FROM global_downloads WHERE video_id = ?", (video_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        print(f"❌ Download not found: {video_id}")
        return False

    title, audio_path = row

    print(f"\n{'='*60}")
    print(f"Re-analyzing: {title}")
    print(f"{'='*60}\n")
    if not os.path.exists(audio_path):
        print(f"❌ Audio file not found: {audio_path}")
        return False

    # Step 1: Re-run audio analysis (BPM + Key detection with improved algorithm)
    print("Step 1: Audio Analysis (BPM + Key)...")
    dm = DownloadManager()
    analysis_results = dm.analyze_audio_with_librosa(audio_path)

    if not analysis_results or not analysis_results.get('bpm'):
        print("❌ Audio analysis failed")
        return False

    detected_bpm = analysis_results.get('bpm')
    detected_key = analysis_results.get('key')
    confidence = analysis_results.get('confidence')

    print(f"✅ BPM: {detected_bpm}")
    print(f"✅ Key: {detected_key} (confidence: {confidence})")
    print()

    # Step 2: Re-run chord detection with key-aware mode
    print("Step 2: Chord Detection (Key-Aware Hybrid)...")
    chords_json, beat_offset, beat_times = analyze_audio_file(
        audio_path,
        bpm=detected_bpm,
        detected_key=detected_key,
        use_hybrid=True
    )

    if not chords_json:
        print("❌ Chord detection failed")
        return False

    import json
    chords = json.loads(chords_json)
    print(f"✅ Detected {len(chords)} chord changes")
    print(f"✅ Beat offset: {beat_offset:.3f}s")

    # Count chord frequency
    chord_counts = {}
    for chord in chords:
        chord_name = chord['chord']
        chord_counts[chord_name] = chord_counts.get(chord_name, 0) + 1

    # Show top chords
    sorted_chords = sorted(chord_counts.items(), key=lambda x: x[1], reverse=True)
    print(f"\nTop chords detected:")
    for chord_name, count in sorted_chords[:10]:
        print(f"  {chord_name}: {count}x")
    print()

    # Step 3: Save to database
    print("Step 3: Saving to database...")
    update_download_analysis(
        video_id=video_id,
        detected_bpm=detected_bpm,
        detected_key=detected_key,
        analysis_confidence=confidence,
        chords_data=chords_json,
        beat_offset=beat_offset,
        beat_times=beat_times
    )

    print("✅ Re-analysis complete!\n")
    return True


if __name__ == "__main__":
    # Neil Young - Heart of Gold (Live)
    video_id = "WZn9QZykx10"

    success = reanalyze_song(video_id)

    if success:
        print("\n" + "="*60)
        print("SUCCESS! Neil Young has been re-analyzed.")
        print("Reload the mixer to see improved chord timeline.")
        print("="*60)
    else:
        print("\n❌ Re-analysis failed")
        sys.exit(1)
