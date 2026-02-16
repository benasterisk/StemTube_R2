#!/usr/bin/env python3
"""
Script to update missing thumbnails in the database.
Fetches thumbnail URLs from YouTube for all videos with missing thumbnails.
"""

import sqlite3
import sys
import os
from pathlib import Path

# Add parent directory to path to import core modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.aiotube_client import AiotubeClient
import asyncio


def update_missing_thumbnails():
    """Update all missing thumbnails in the database."""

    DB_PATH = Path("stemtubes.db")

    if not DB_PATH.exists():
        print(f"❌ Database not found at {DB_PATH}")
        return

    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Find all videos with missing thumbnails
    cursor.execute("""
        SELECT id, video_id, title
        FROM global_downloads
        WHERE thumbnail IS NULL OR thumbnail = ''
        ORDER BY created_at DESC
    """)

    videos = cursor.fetchall()

    if not videos:
        print("✅ All videos already have thumbnails!")
        conn.close()
        return

    print(f"📊 Found {len(videos)} videos with missing thumbnails")
    print("=" * 60)

    # Initialize aiotube client
    client = AiotubeClient()

    updated_count = 0
    failed_count = 0
    skipped_count = 0

    for idx, (db_id, video_id, title) in enumerate(videos, 1):
        print(f"\n[{idx}/{len(videos)}] Processing: {title[:50]}...")
        print(f"    Video ID: {video_id}")

        # Skip upload files (they don't have YouTube thumbnails)
        if video_id.startswith("upload_"):
            print(f"    ⏭️  Skipped (uploaded file)")
            skipped_count += 1
            continue

        try:
            # Fetch video metadata (synchronous call, not async)
            result = client.get_video_info(video_id)

            if result and "items" in result and len(result["items"]) > 0:
                item = result["items"][0]
                snippet = item.get("snippet", {})
                thumbnails = snippet.get("thumbnails", {})

                # Try to get the best quality thumbnail available
                thumbnail_url = None
                for quality in ["medium", "high", "standard", "default"]:
                    if quality in thumbnails and "url" in thumbnails[quality]:
                        thumbnail_url = thumbnails[quality]["url"]
                        break

                if thumbnail_url:
                    # Update database
                    cursor.execute("""
                        UPDATE global_downloads
                        SET thumbnail = ?
                        WHERE id = ?
                    """, (thumbnail_url, db_id))

                    conn.commit()
                    print(f"    ✅ Updated with thumbnail: {thumbnail_url[:60]}...")
                    updated_count += 1
                else:
                    print(f"    ⚠️  No thumbnail found in metadata")
                    failed_count += 1
            else:
                print(f"    ❌ Failed to fetch metadata")
                failed_count += 1

        except Exception as e:
            print(f"    ❌ Error: {str(e)}")
            failed_count += 1

        # Small delay to avoid rate limiting
        if idx < len(videos):
            import time
            time.sleep(0.5)

    conn.close()

    # Print summary
    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    print(f"✅ Updated:  {updated_count}")
    print(f"⏭️  Skipped:  {skipped_count} (uploaded files)")
    print(f"❌ Failed:   {failed_count}")
    print(f"📝 Total:    {len(videos)}")
    print("=" * 60)

    if updated_count > 0:
        print("\n✨ Thumbnails updated successfully!")
        print("   Refresh your browser to see the changes.")


def main():
    """Main entry point."""
    print("=" * 60)
    print("🖼️  THUMBNAIL UPDATE UTILITY")
    print("=" * 60)
    print("This script will fetch and update missing thumbnails")
    print("for all videos in the database.")
    print("=" * 60)

    # Ask for confirmation
    response = input("\nDo you want to proceed? [y/N]: ").strip().lower()

    if response not in ['y', 'yes']:
        print("\n❌ Cancelled by user")
        return

    print("\n🚀 Starting thumbnail update...\n")

    # Run the function
    update_missing_thumbnails()


if __name__ == "__main__":
    main()
