#!/usr/bin/env python3
"""Detect song structure (MSAF sections) for every downloaded song.

Fills `structure_data` for songs that have none, or for every song with --force.
Sections are similarity clusters labelled A, B, C... (see
core/msaf_structure_detector.py); MSAF does not name verses or choruses.

Usage (from the project root, venv active):
    python utils/analysis/reanalyze_all_structure.py [--force] [--limit N]
"""

import argparse
import os
import sys
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)
os.chdir(PROJECT_ROOT)

from core.db.connection import _conn  # noqa: E402
from core.downloads_db import resolve_file_path, update_download_analysis  # noqa: E402
from core.msaf_structure_detector import detect_song_structure_msaf  # noqa: E402


def songs_to_analyze(force: bool):
    with _conn() as conn:
        rows = conn.execute(
            "SELECT video_id, title, file_path, structure_data FROM global_downloads "
            "WHERE file_path IS NOT NULL AND file_path != '' ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows if force or not r['structure_data']]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--force', action='store_true', help='Re-analyze songs that already have sections')
    parser.add_argument('--limit', type=int, default=0, help='Stop after N songs')
    args = parser.parse_args()

    songs = songs_to_analyze(args.force)
    if args.limit:
        songs = songs[:args.limit]
    print(f"{len(songs)} song(s) to analyze")

    done = failed = skipped = 0
    for i, song in enumerate(songs, 1):
        path = resolve_file_path(song['file_path']) or song['file_path']
        label = (song['title'] or song['video_id'])[:60]
        if not os.path.exists(path):
            print(f"[{i}/{len(songs)}] SKIP (audio missing) {label}")
            skipped += 1
            continue
        t0 = time.time()
        sections = detect_song_structure_msaf(path)
        if not sections:
            print(f"[{i}/{len(songs)}] FAIL {label}")
            failed += 1
            continue
        # Only structure_data is passed; every other field stays as stored.
        update_download_analysis(song['video_id'], None, None, None, structure_data=sections)
        pattern = ' '.join(s['label'] for s in sections)
        print(f"[{i}/{len(songs)}] OK {len(sections)} sections in {time.time() - t0:.1f}s  {pattern}  {label}")
        done += 1

    print(f"\nDone: {done} analyzed, {failed} failed, {skipped} skipped")
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
