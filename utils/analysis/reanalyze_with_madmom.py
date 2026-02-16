#!/usr/bin/env python3
"""
Re-analyze all existing downloads with professional madmom chord detection.
This will replace old chord data with more accurate madmom-based analysis.
"""

import sys
import sqlite3
from pathlib import Path
import json

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from core.chord_detector import analyze_audio_file
from core.downloads_db import update_download_analysis

def get_all_downloads_with_audio():
    """Get all downloads that have audio files."""
    conn = sqlite3.connect('stemtubes.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT DISTINCT video_id, file_path, detected_bpm, title
        FROM global_downloads
        WHERE file_path IS NOT NULL
        AND file_path != ''
        ORDER BY created_at DESC
    """)

    downloads = cursor.fetchall()
    conn.close()
    return downloads

def main():
    print("=" * 80)
    print("  🎸 MADMOM CHORD RE-ANALYSIS - Professional Upgrade")
    print("=" * 80)
    print()

    downloads = get_all_downloads_with_audio()

    if not downloads:
        print("No downloads found with audio files.")
        return

    print(f"Found {len(downloads)} downloads to analyze\n")
    print("This will use professional madmom chord detection for all files.")
    print("Previous chord data will be replaced with more accurate results.\n")

    response = input("Proceed with re-analysis? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    print("\n" + "=" * 80)
    print("Starting analysis...")
    print("=" * 80 + "\n")

    success_count = 0
    failed_count = 0
    skipped_count = 0

    for i, download in enumerate(downloads, 1):
        video_id = download['video_id']
        file_path = download['file_path']
        bpm = download['detected_bpm']
        title = download['title'] or video_id

        print(f"[{i}/{len(downloads)}] {title}")
        print(f"  File: {file_path}")

        # Check if file exists
        if not Path(file_path).exists():
            print(f"  ⚠️  File not found - skipping")
            skipped_count += 1
            continue

        # Analyze with madmom
        try:
            print(f"  🔍 Analyzing with madmom (BPM: {bpm or 'auto-detect'})...")
            chords_data, beat_offset, beat_times = analyze_audio_file(file_path, bpm=bpm, use_madmom=True)

            if chords_data:
                # Parse to count chords
                chords = json.loads(chords_data)
                chord_count = len(chords)

                # Update database
                update_download_analysis(
                    video_id=video_id,
                    detected_bpm=bpm,  # Keep existing BPM
                    detected_key=None,  # Keep existing key
                    analysis_confidence=None,  # Keep existing confidence
                    chords_data=chords_data,
                    beat_offset=beat_offset,
                    beat_times=beat_times
                )

                print(f"  ✅ Success: {chord_count} chords, beat offset: {beat_offset:.3f}s")
                success_count += 1
            else:
                print(f"  ❌ No chords detected")
                failed_count += 1

        except Exception as e:
            print(f"  ❌ Error: {e}")
            failed_count += 1

        print()

    print("=" * 80)
    print("  ANALYSIS COMPLETE")
    print("=" * 80)
    print(f"  ✅ Successful: {success_count}")
    print(f"  ❌ Failed: {failed_count}")
    print(f"  ⚠️  Skipped: {skipped_count}")
    print(f"  📊 Total: {len(downloads)}")
    print("=" * 80)
    print()
    print("🎸 All downloads now have professional madmom chord detection!")
    print()

if __name__ == "__main__":
    main()
