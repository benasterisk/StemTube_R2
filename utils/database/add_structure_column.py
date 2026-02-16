#!/usr/bin/env python3
"""
Database Migration: Add structure_data column to global_downloads table

This script adds the structure_data column to store JSON-formatted
music structure analysis results (sections with labels and timestamps).
"""

import sqlite3
import sys
import os

def add_structure_column():
    """Add structure_data column to global_downloads table"""

    db_path = "stemtubes.db"

    if not os.path.exists(db_path):
        print(f"ERROR: Database not found at {db_path}")
        print("Make sure you're running this script from the project root directory.")
        sys.exit(1)

    try:
        print("="*70)
        print("DATABASE MIGRATION: Add structure_data column")
        print("="*70)

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if column already exists
        cursor.execute("PRAGMA table_info(global_downloads)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'structure_data' in columns:
            print("\n✓ Column 'structure_data' already exists in global_downloads table")
            print("  No migration needed.")
            conn.close()
            return True

        print("\nAdding 'structure_data' column to global_downloads table...")

        # Add the column
        cursor.execute("""
            ALTER TABLE global_downloads
            ADD COLUMN structure_data TEXT
        """)

        conn.commit()

        # Verify the column was added
        cursor.execute("PRAGMA table_info(global_downloads)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'structure_data' not in columns:
            print("\n✗ ERROR: Column was not added successfully")
            conn.close()
            return False

        print("✓ Column added successfully!")

        # Show updated schema
        print("\nUpdated global_downloads schema:")
        cursor.execute("PRAGMA table_info(global_downloads)")

        print(f"\n{'Column':<25} {'Type':<15} {'NotNull':<10} {'Default':<15}")
        print("-"*70)

        for row in cursor.fetchall():
            col_id, name, col_type, not_null, default_val, pk = row
            print(f"{name:<25} {col_type:<15} {not_null:<10} {str(default_val):<15}")

        conn.close()

        print("\n" + "="*70)
        print("✓ Migration completed successfully!")
        print("="*70)
        print("\nThe structure_data column is now ready to store JSON arrays")
        print("containing music structure analysis results.")
        print("\nExample format:")
        print('[')
        print('  {"start": 0, "end": 15.3, "label": "Intro", "confidence": 0.92},')
        print('  {"start": 15.3, "end": 45.1, "label": "Verse", "confidence": 0.87},')
        print('  {"start": 45.1, "end": 75.8, "label": "Chorus", "confidence": 0.95}')
        print(']\n')

        return True

    except sqlite3.Error as e:
        print(f"\n✗ Database error: {e}")
        return False
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        return False


def verify_migration():
    """Verify the migration was successful"""

    db_path = "stemtubes.db"

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check column exists and get its details
        cursor.execute("PRAGMA table_info(global_downloads)")
        columns = {row[1]: row for row in cursor.fetchall()}

        if 'structure_data' not in columns:
            return False, "Column not found"

        col_info = columns['structure_data']
        col_type = col_info[2]

        if col_type != 'TEXT':
            return False, f"Column type is {col_type}, expected TEXT"

        conn.close()
        return True, "Column verified successfully"

    except Exception as e:
        return False, str(e)


def main():
    """Main migration function"""

    print("\nStemTube Database Migration Tool")
    print("Adding structure_data column for music structure analysis\n")

    # Run migration
    success = add_structure_column()

    if not success:
        print("\n✗ Migration failed!")
        sys.exit(1)

    # Verify migration
    print("\nVerifying migration...")
    verified, message = verify_migration()

    if verified:
        print(f"✓ {message}")
        print("\nVous pouvez maintenant lancer l'analyse de structure MSAF :")
        print("  source venv/bin/activate")
        print("  python - <<'PY'")
        print("  from core.msaf_structure_detector import detect_song_structure_msaf")
        print("  sections = detect_song_structure_msaf('path/to/audio.mp3')")
        print("  print(sections)")
        print("  PY")
        sys.exit(0)
    else:
        print(f"✗ Verification failed: {message}")
        sys.exit(1)


if __name__ == "__main__":
    main()
