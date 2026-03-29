#!/usr/bin/env python3
"""
One-time backfill script: populate artist, album, duration columns
from existing title strings and Spotify playlist data.

Run from project root:
    source venv/bin/activate
    python utils/database/backfill_metadata.py
"""
import json
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from core.db.connection import _conn


def backfill():
    conn = _conn()

    # 1. Build lookup from Spotify playlists
    playlist_lookup = {}  # video_id -> {artist, album, duration}
    rows = conn.execute("SELECT tracks_json FROM playlists WHERE tracks_json IS NOT NULL").fetchall()
    for row in rows:
        try:
            tracks = json.loads(row['tracks_json'])
        except (json.JSONDecodeError, TypeError):
            continue
        for t in tracks:
            vid = t.get('video_id')
            if vid and t.get('artist'):
                playlist_lookup[vid] = {
                    'artist': t['artist'],
                    'album': t.get('album', ''),
                    'duration': (t.get('duration_ms') or 0) / 1000.0,
                }
    print(f"Spotify lookup: {len(playlist_lookup)} tracks with metadata")

    # 2. Get all global_downloads missing artist
    rows = conn.execute("""
        SELECT id, video_id, title, artist, album, duration
        FROM global_downloads
        WHERE file_path IS NOT NULL
    """).fetchall()

    updated = 0
    for row in rows:
        vid = row['video_id']
        title = row['title'] or ''
        current_artist = row['artist']
        current_album = row['album']
        current_duration = row['duration']

        new_artist = current_artist
        new_album = current_album
        new_duration = current_duration

        # Try Spotify lookup first (best quality)
        if vid in playlist_lookup:
            sp = playlist_lookup[vid]
            if not new_artist:
                new_artist = sp['artist']
            if not new_album and sp.get('album'):
                new_album = sp['album']
            if not new_duration and sp.get('duration'):
                new_duration = sp['duration']

        # Parse from title as fallback
        if not new_artist and ' - ' in title:
            new_artist = title.split(' - ', 1)[0].strip()

        # Check if anything changed
        if (new_artist != current_artist or new_album != current_album or new_duration != current_duration):
            conn.execute("""
                UPDATE global_downloads SET artist=?, album=?, duration=? WHERE id=?
            """, (new_artist or None, new_album or None, new_duration or None, row['id']))
            # Also update user_downloads
            conn.execute("""
                UPDATE user_downloads SET artist=?, album=?, duration=?
                WHERE video_id=?
            """, (new_artist or None, new_album or None, new_duration or None, vid))
            updated += 1
            if new_artist:
                short_title = title[:50] + ('...' if len(title) > 50 else '')
                print(f"  {short_title} -> artist='{new_artist}'" +
                      (f", album='{new_album}'" if new_album else ''))

    conn.commit()
    conn.close()

    # Stats
    conn2 = _conn()
    total = conn2.execute("SELECT count(*) FROM global_downloads WHERE file_path IS NOT NULL").fetchone()[0]
    with_artist = conn2.execute("SELECT count(*) FROM global_downloads WHERE artist IS NOT NULL AND file_path IS NOT NULL").fetchone()[0]
    with_album = conn2.execute("SELECT count(*) FROM global_downloads WHERE album IS NOT NULL AND file_path IS NOT NULL").fetchone()[0]
    conn2.close()

    print(f"\nDone! Updated {updated} tracks.")
    print(f"  Total: {total}, With artist: {with_artist}, With album: {with_album}")


if __name__ == '__main__':
    backfill()
