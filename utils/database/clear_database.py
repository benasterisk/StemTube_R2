#!/usr/bin/env python3
"""
Script to clear all download and extraction records from the StemTube database.
This will give you a fresh start for testing the deduplication fixes.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "stemtubes.db"

def clear_database():
    """Clear all download and extraction records."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        
        print("=== CLEARING DATABASE ===")
        
        # Show current counts before clearing
        cursor.execute("SELECT COUNT(*) FROM global_downloads")
        global_count = cursor.fetchone()[0]
        print(f"Current global_downloads records: {global_count}")
        
        cursor.execute("SELECT COUNT(*) FROM user_downloads")
        user_count = cursor.fetchone()[0]
        print(f"Current user_downloads records: {user_count}")
        
        if global_count == 0 and user_count == 0:
            print("Database is already empty!")
            return
        
        print("\nClearing all records...")
        
        # Clear user_downloads first (has foreign key to global_downloads)
        cursor.execute("DELETE FROM user_downloads")
        print(f"Cleared user_downloads table")
        
        # Clear global_downloads
        cursor.execute("DELETE FROM global_downloads")
        print(f"Cleared global_downloads table")
        
        # Reset auto-increment counters
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='global_downloads'")
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='user_downloads'")
        print("Reset auto-increment counters")
        
        conn.commit()
        
        # Verify clearing
        cursor.execute("SELECT COUNT(*) FROM global_downloads")
        global_count_after = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM user_downloads")
        user_count_after = cursor.fetchone()[0]
        
        print(f"\n=== RESULTS ===")
        print(f"global_downloads records: {global_count_after}")
        print(f"user_downloads records: {user_count_after}")
        
        if global_count_after == 0 and user_count_after == 0:
            print("✅ Database successfully cleared!")
            print("\nYou can now test the deduplication fix with a fresh database.")
        else:
            print("❌ Error: Database was not fully cleared")

if __name__ == "__main__":
    clear_database()