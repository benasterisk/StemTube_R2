"""
Script to re-analyze all existing downloads with improved beat grid chord detection.
This will update chord timestamps and beat offsets for all existing tracks.
"""

import sqlite3
import os
import sys
from pathlib import Path

# Add core to path
sys.path.insert(0, str(Path(__file__).parent))

from core.chord_detector import analyze_audio_file
from core.downloads_db import update_download_analysis

DB_PATH = 'stemtubes.db'

def reanalyze_all_chords():
    """Re-analyze all downloads with the new beat grid chord detection."""

    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Get all downloads that have audio files and BPM detected
        cursor.execute("""
            SELECT id, video_id, file_path, detected_bpm, detected_key, analysis_confidence
            FROM global_downloads
            WHERE file_path IS NOT NULL
            AND file_path != ''
            AND detected_bpm IS NOT NULL
            ORDER BY id
        """)

        downloads = cursor.fetchall()
        total = len(downloads)

        if total == 0:
            print("No downloads found with BPM detection.")
            return

        print("=" * 70)
        print(f"Re-analyzing {total} downloads with improved beat grid detection")
        print("=" * 70)
        print()

        success_count = 0
        error_count = 0
        skipped_count = 0

        for idx, download in enumerate(downloads, 1):
            video_id = download['video_id']
            file_path = download['file_path']
            bpm = download['detected_bpm']
            key = download['detected_key']
            confidence = download['analysis_confidence']

            print(f"[{idx}/{total}] {video_id}")
            print(f"  File: {file_path}")
            print(f"  Current BPM: {bpm}, Key: {key}")

            # Check if file exists
            if not os.path.exists(file_path):
                print(f"  [SKIP] File not found")
                skipped_count += 1
                print()
                continue

            try:
                # Re-analyze chords with BPM-based beat grid
                print(f"  [ANALYZING] Using BPM={bpm} for beat grid...")
                chords_data, beat_offset, beat_times = analyze_audio_file(file_path, bpm=bpm)

                if chords_data:
                    # Update database
                    update_download_analysis(
                        video_id=video_id,
                        detected_bpm=bpm,
                        detected_key=key,
                        analysis_confidence=confidence,
                        chords_data=chords_data,
                        beat_offset=beat_offset,
                        beat_times=beat_times
                    )

                    # Parse to count chords
                    import json
                    chords = json.loads(chords_data) if isinstance(chords_data, str) else chords_data

                    print(f"  [SUCCESS] {len(chords)} chords detected, beat_offset={beat_offset:.3f}s")
                    success_count += 1
                else:
                    print(f"  [WARNING] No chords detected")
                    # Still update with beat_offset
                    update_download_analysis(
                        video_id=video_id,
                        detected_bpm=bpm,
                        detected_key=key,
                        analysis_confidence=confidence,
                        chords_data=None,
                        beat_offset=beat_offset,
                        beat_times=beat_times
                    )
                    success_count += 1

            except Exception as e:
                print(f"  [ERROR] {e}")
                error_count += 1

            print()

        print("=" * 70)
        print("Re-analysis Complete")
        print("=" * 70)
        print(f"Total downloads: {total}")
        print(f"Successfully analyzed: {success_count}")
        print(f"Errors: {error_count}")
        print(f"Skipped (file not found): {skipped_count}")
        print()

        if success_count > 0:
            print("All chord data has been updated with beat grid alignment!")
            print("Restart the app and reload the mixer to see aligned beat counters.")

    except Exception as e:
        print(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == "__main__":
    print()
    print("=" * 70)
    print("StemTube - Re-analyze All Chords with Beat Grid Detection")
    print("=" * 70)
    print()
    print("This will re-analyze all existing downloads using the improved")
    print("beat grid detection system (like Chordify/Moises).")
    print()

    # Check for --yes flag to skip confirmation
    import sys
    if '--yes' in sys.argv or '-y' in sys.argv:
        print("Running with auto-confirmation...")
        print()
        reanalyze_all_chords()
    else:
        response = input("Continue? (yes/no): ").strip().lower()

        if response == 'yes':
            print()
            reanalyze_all_chords()
        else:
            print("Cancelled.")
