#!/usr/bin/env python3
"""
Regenerate beat timestamps for existing downloads using madmom beat tracker.
This populates the beat_times field for songs that were analyzed before beat tracking was stored.
"""

import sys
import sqlite3
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from core.downloads_db import update_download_analysis, resolve_file_path


def get_downloads_without_beat_times():
    """Get all extracted downloads that don't have beat_times yet."""
    db_path = PROJECT_ROOT / "stemtubes.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT DISTINCT video_id, file_path, detected_bpm, detected_key,
               analysis_confidence, chords_data, beat_offset, structure_data,
               lyrics_data, title
        FROM global_downloads
        WHERE beat_times IS NULL
          AND extracted = 1
          AND file_path IS NOT NULL
          AND file_path != ''
        ORDER BY created_at DESC
    """)

    downloads = cursor.fetchall()
    conn.close()
    return downloads


def main():
    print("=" * 80)
    print("  Beat Times Regeneration - Variable Tempo Metronome")
    print("=" * 80)
    print()

    downloads = get_downloads_without_beat_times()

    if not downloads:
        print("All downloads already have beat_times. Nothing to do.")
        return

    print(f"Found {len(downloads)} downloads without beat_times\n")
    print("This will run madmom beat tracking on each audio file.")
    print("Existing analysis data (chords, structure, lyrics) will be preserved.\n")

    response = input("Proceed? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    # Import madmom detector (slow import, do it once)
    try:
        from core.madmom_chord_detector import MadmomChordDetector
        detector = MadmomChordDetector()
    except ImportError as e:
        print(f"Error: madmom not available: {e}")
        return

    print("\n" + "=" * 80)
    print("Starting beat detection...")
    print("=" * 80 + "\n")

    success_count = 0
    failed_count = 0
    skipped_count = 0

    for i, download in enumerate(downloads, 1):
        video_id = download['video_id']
        file_path = resolve_file_path(download['file_path'])
        bpm = download['detected_bpm']
        title = download['title'] or video_id

        print(f"[{i}/{len(downloads)}] {title}")
        print(f"  File: {file_path}")

        if not file_path or not Path(file_path).exists():
            print(f"  File not found - skipping")
            skipped_count += 1
            continue

        try:
            beat_offset, beats, beat_positions = detector._detect_beats(file_path, bpm)
            beat_times = [round(float(b), 4) for b in beats]

            if not beat_times:
                print(f"  No beats detected - skipping")
                skipped_count += 1
                continue

            # Preserve existing analysis data
            import json
            structure_data = download['structure_data']
            if isinstance(structure_data, str):
                try:
                    structure_data = json.loads(structure_data)
                except Exception:
                    structure_data = None

            lyrics_data = download['lyrics_data']
            if isinstance(lyrics_data, str):
                try:
                    lyrics_data = json.loads(lyrics_data)
                except Exception:
                    lyrics_data = None

            update_download_analysis(
                video_id,
                download['detected_bpm'],
                download['detected_key'],
                download['analysis_confidence'],
                download['chords_data'],
                beat_offset,
                structure_data,
                lyrics_data,
                beat_times=beat_times,
                beat_positions=beat_positions
            )

            print(f"  {len(beat_times)} beats detected, {len(beat_positions)} positions (offset: {beat_offset:.3f}s)")
            success_count += 1

        except Exception as e:
            print(f"  Error: {e}")
            failed_count += 1

    print("\n" + "=" * 80)
    print(f"Done! Success: {success_count}, Failed: {failed_count}, Skipped: {skipped_count}")
    print("=" * 80)


if __name__ == '__main__':
    main()
