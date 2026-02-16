#!/usr/bin/env python3
"""
Script to add lyrics_data column to database
"""

import sqlite3
import sys

def add_lyrics_column():
    """Add lyrics_data column to global_downloads and user_downloads tables"""

    db_path = "stemtubes.db"

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if column already exists in global_downloads
        cursor.execute("PRAGMA table_info(global_downloads)")
        columns = [col[1] for col in cursor.fetchall()]

        if 'lyrics_data' not in columns:
            print("Adding lyrics_data column to global_downloads...")
            cursor.execute("""
                ALTER TABLE global_downloads
                ADD COLUMN lyrics_data TEXT
            """)
            print("✅ Column added to global_downloads")
        else:
            print("ℹ️  lyrics_data column already exists in global_downloads")

        # Check if column exists in user_downloads
        cursor.execute("PRAGMA table_info(user_downloads)")
        columns = [col[1] for col in cursor.fetchall()]

        if 'lyrics_data' not in columns:
            print("Adding lyrics_data column to user_downloads...")
            cursor.execute("""
                ALTER TABLE user_downloads
                ADD COLUMN lyrics_data TEXT
            """)
            print("✅ Column added to user_downloads")
        else:
            print("ℹ️  lyrics_data column already exists in user_downloads")

        conn.commit()
        conn.close()

        print("\n✅ Database schema updated successfully!")

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    add_lyrics_column()
