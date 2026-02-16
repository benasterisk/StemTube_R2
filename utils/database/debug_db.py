#!/usr/bin/env python3
"""
Debug script to examine the database state for extraction persistence issue.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "stemtubes.db"

def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def show_all_extractions():
    """Show all extraction-related data in the database."""
    with _conn() as conn:
        print("=== GLOBAL DOWNLOADS (extractions) ===")
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, video_id, title, extracted, extracting, extraction_model, 
                   stems_paths, stems_zip_path, extracted_at
            FROM global_downloads 
            WHERE extracted=1 OR extracting=1 OR extraction_model IS NOT NULL
            ORDER BY id DESC
        """)
        global_extractions = cursor.fetchall()
        
        for row in global_extractions:
            print(f"ID: {row['id']}")
            print(f"  Video ID: '{row['video_id']}'")
            print(f"  Title: {row['title']}")
            print(f"  Extracted: {row['extracted']}")
            print(f"  Extracting: {row['extracting']}")
            print(f"  Model: {row['extraction_model']}")
            print(f"  Stems paths: {row['stems_paths']}")
            print(f"  Zip path: {row['stems_zip_path']}")
            print(f"  Extracted at: {row['extracted_at']}")
            print()
        
        print(f"Found {len(global_extractions)} global extraction records")
        print()
        
        print("=== USER DOWNLOADS (extractions) ===")
        cursor.execute("""
            SELECT id, user_id, video_id, title, extracted, extracting, extraction_model,
                   stems_paths, stems_zip_path, extracted_at
            FROM user_downloads 
            WHERE extracted=1 OR extracting=1 OR extraction_model IS NOT NULL
            ORDER BY id DESC
        """)
        user_extractions = cursor.fetchall()
        
        for row in user_extractions:
            print(f"ID: {row['id']}")
            print(f"  User ID: {row['user_id']}")
            print(f"  Video ID: '{row['video_id']}'")
            print(f"  Title: {row['title']}")
            print(f"  Extracted: {row['extracted']}")
            print(f"  Extracting: {row['extracting']}")
            print(f"  Model: {row['extraction_model']}")
            print(f"  Stems paths: {row['stems_paths']}")
            print(f"  Zip path: {row['stems_zip_path']}")
            print(f"  Extracted at: {row['extracted_at']}")
            print()
        
        print(f"Found {len(user_extractions)} user extraction records")

def test_deduplication(video_id, model_name):
    """Test the deduplication logic for a specific video and model."""
    print(f"=== TESTING DEDUPLICATION ===")
    print(f"Video ID: '{video_id}'")
    print(f"Model: '{model_name}'")
    print()
    
    with _conn() as conn:
        cursor = conn.cursor()
        
        # Test the exact query used by find_global_extraction
        cursor.execute("""
            SELECT * FROM global_downloads 
            WHERE video_id=? AND extracted=1 AND extraction_model=?
        """, (video_id, model_name))
        result = cursor.fetchone()
        
        if result:
            print("✅ DEDUPLICATION SHOULD WORK - Found global extraction:")
            print(f"  ID: {result['id']}")
            print(f"  Video ID: '{result['video_id']}'")
            print(f"  Extracted: {result['extracted']}")
            print(f"  Model: {result['extraction_model']}")
        else:
            print("❌ DEDUPLICATION WILL FAIL - No global extraction found")
            
            # Debug: Show what DOES exist for this video_id
            cursor.execute("SELECT id, video_id, extracted, extraction_model FROM global_downloads WHERE video_id=?", (video_id,))
            debug_results = cursor.fetchall()
            print(f"Records for video_id '{video_id}':")
            for r in debug_results:
                print(f"  ID {r['id']}: extracted={r['extracted']}, model='{r['extraction_model']}'")
                
if __name__ == "__main__":
    show_all_extractions()
    
    # Test deduplication for existing extractions
    print("=== TESTING DEDUPLICATION ===")
    test_deduplication("xV5kXfaEBdE", "htdemucs")  # The latest extraction
    test_deduplication("7ejYNYwrryw", "htdemucs")  # The older extraction