#!/usr/bin/env python3
"""
Re-detect chords and key for extracted songs with the current pipeline
(core/chord_refiner.py): BTC on the harmonic stems, decoded on the stored beat grid,
key estimated from the chords. Only chords_data, detected_key and analysis_confidence
are written; the beat grid, Skip Intro, lyrics and structure are left untouched.

Usage:
    python utils/analysis/reanalyze_all_chords.py [--limit N] [--video-id ID]

Songs whose stems are not on disk (e.g. an unmounted drive) are skipped.
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from core.chord_refiner import harmonic_stem_paths, update_song_chords  # noqa: E402
from core.db.connection import _conn  # noqa: E402


def extracted_songs(video_id=None):
    query = "SELECT video_id, title, stems_paths, chords_data, detected_key FROM global_downloads WHERE extracted=1"
    params = ()
    if video_id:
        query += " AND video_id=?"
        params = (video_id,)
    with _conn() as conn:
        return [dict(row) for row in conn.execute(query, params).fetchall()]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--limit', type=int, help='Analyze at most N songs')
    parser.add_argument('--video-id', help='Analyze this song only')
    args = parser.parse_args()

    songs = extracted_songs(args.video_id)
    if args.limit:
        songs = songs[:args.limit]
    print(f"{len(songs)} extracted song(s)")

    done = failed = skipped = 0
    for i, song in enumerate(songs, 1):
        label = (song['title'] or song['video_id'])[:50]
        try:
            stems = json.loads(song['stems_paths'] or '{}')
        except ValueError:
            stems = {}
        if not harmonic_stem_paths(stems):
            print(f"[{i}/{len(songs)}] SKIP (no harmonic stems on disk) {label}")
            skipped += 1
            continue
        try:
            before = len(json.loads(song['chords_data'] or '[]'))
        except ValueError:
            before = 0
        started = time.time()
        try:
            result = update_song_chords(song['video_id'])
        except Exception as e:
            result = None
            print(f"[{i}/{len(songs)}] ERROR {label}: {e}")
        if not result:
            failed += 1
            continue
        done += 1
        print(f"[{i}/{len(songs)}] OK {before:4d} -> {len(result['chords']):4d} chords | "
              f"key {song['detected_key']} -> {result['key']} | {time.time() - started:.0f}s | {label}")

    print(f"\nDone: {done} analyzed, {failed} failed, {skipped} skipped")


if __name__ == '__main__':
    main()
