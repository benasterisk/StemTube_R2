#!/usr/bin/env python3
"""
Test the comprehensive removal fix
"""

import sqlite3
from pathlib import Path
import json

# Add some test data to simulate the issue
DB_PATH = Path(__file__).parent / "stemtubes.db"

def setup_test_data():
    """Create test data that simulates stuck records."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Clean up any existing test data first
        cursor.execute("DELETE FROM user_downloads WHERE video_id LIKE 'TEST_%'")
        cursor.execute("DELETE FROM global_downloads WHERE video_id LIKE 'TEST_%'")
        
        # Create test global download
        cursor.execute("""
            INSERT INTO global_downloads
                (video_id, title, file_path, media_type, quality, extracted, extraction_model, stems_paths)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'TEST_VIDEO_123',
            'Test Video for Removal',
            '/fake/path/test.mp3',
            'audio',
            'best',
            1,  # extracted
            'htdemucs',
            json.dumps({'vocals': '/fake/stems/vocals.mp3', 'drums': '/fake/stems/drums.mp3'})
        ))
        global_id = cursor.lastrowid
        
        # Create user access records for both users
        for user_id in [1, 2]:
            cursor.execute("""
                INSERT INTO user_downloads
                    (user_id, global_download_id, video_id, title, file_path, media_type, quality, extracted, extraction_model, stems_paths)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user_id,
                global_id,
                'TEST_VIDEO_123',
                'Test Video for Removal',
                '/fake/path/test.mp3',
                'audio',
                'best',
                1,  # extracted
                'htdemucs',
                json.dumps({'vocals': '/fake/stems/vocals.mp3', 'drums': '/fake/stems/drums.mp3'})
            ))
        
        # Create a stuck extraction record (extracting=1 but extracted=1 - inconsistent)
        cursor.execute("""
            INSERT INTO global_downloads
                (video_id, title, file_path, media_type, quality, extracted, extracting, extraction_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'TEST_STUCK_456',
            'Test Stuck Extraction',
            '/fake/path/stuck.mp3',
            'audio',
            'best',
            1,  # extracted
            1,  # extracting (inconsistent!)
            'htdemucs'
        ))
        stuck_global_id = cursor.lastrowid
        
        cursor.execute("""
            INSERT INTO user_downloads
                (user_id, global_download_id, video_id, title, file_path, media_type, quality, extracted, extracting, extraction_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            1,  # user 1
            stuck_global_id,
            'TEST_STUCK_456',
            'Test Stuck Extraction',
            '/fake/path/stuck.mp3',
            'audio',
            'best',
            1,  # extracted
            1,  # extracting (inconsistent!)
            'htdemucs'
        ))
        
        conn.commit()
        print("✅ Created test data")

def test_user_list_before_removal():
    """Check what shows up in user lists before removal."""
    from core.downloads_db import list_for, list_extractions_for
    
    print("\n📋 USER LISTS BEFORE REMOVAL:")
    for user_id in [1, 2]:
        downloads = list_for(user_id)
        extractions = list_extractions_for(user_id)
        
        print(f"\n👤 User {user_id}:")
        print(f"  Downloads: {len(downloads)}")
        for dl in downloads:
            if dl['video_id'].startswith('TEST_'):
                print(f"    - {dl['video_id']}: {dl['title']} (file_path: {dl['file_path']})")
        
        print(f"  Extractions: {len(extractions)}")
        for ext in extractions:
            if ext['video_id'].startswith('TEST_'):
                print(f"    - {ext['video_id']}: {ext['title']} (extracted: {ext['extracted']})")

def test_removal_functions():
    """Test the removal functions."""
    from core.downloads_db import remove_user_download_access, remove_user_extraction_access, force_remove_all_user_access
    
    print("\n🗑️  TESTING REMOVAL FUNCTIONS:")
    
    # Test regular download removal for user 1
    print("\n1. Testing remove_user_download_access for user 1, TEST_VIDEO_123")
    success, message = remove_user_download_access(1, 'TEST_VIDEO_123')
    print(f"   Result: {'✅ SUCCESS' if success else '❌ FAILED'} - {message}")
    
    # Test extraction removal for user 2
    print("\n2. Testing remove_user_extraction_access for user 2, TEST_VIDEO_123")
    success, message = remove_user_extraction_access(2, 'TEST_VIDEO_123')
    print(f"   Result: {'✅ SUCCESS' if success else '❌ FAILED'} - {message}")
    
    # Test force removal for the stuck record
    print("\n3. Testing force_remove_all_user_access for user 1, TEST_STUCK_456")
    success, message = force_remove_all_user_access(1, 'TEST_STUCK_456')
    print(f"   Result: {'✅ SUCCESS' if success else '❌ FAILED'} - {message}")

def test_user_list_after_removal():
    """Check what shows up in user lists after removal."""
    from core.downloads_db import list_for, list_extractions_for
    
    print("\n📋 USER LISTS AFTER REMOVAL:")
    for user_id in [1, 2]:
        downloads = list_for(user_id)
        extractions = list_extractions_for(user_id)
        
        print(f"\n👤 User {user_id}:")
        print(f"  Downloads: {len(downloads)}")
        for dl in downloads:
            if dl['video_id'].startswith('TEST_'):
                print(f"    - {dl['video_id']}: {dl['title']} (file_path: {dl['file_path']})")
        
        print(f"  Extractions: {len(extractions)}")
        for ext in extractions:
            if ext['video_id'].startswith('TEST_'):
                print(f"    - {ext['video_id']}: {ext['title']} (extracted: {ext['extracted']})")

def test_comprehensive_cleanup():
    """Test the comprehensive cleanup function."""
    from core.downloads_db import comprehensive_cleanup
    
    print("\n🧹 TESTING COMPREHENSIVE CLEANUP:")
    comprehensive_cleanup()
    print("   Cleanup completed")

def cleanup_test_data():
    """Remove test data."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM user_downloads WHERE video_id LIKE 'TEST_%'")
        cursor.execute("DELETE FROM global_downloads WHERE video_id LIKE 'TEST_%'")
        conn.commit()
        print("\n🧽 Cleaned up test data")

def main():
    print("================================================================================")
    print("COMPREHENSIVE REMOVAL FIX TEST")
    print("================================================================================")
    
    # Setup test data
    setup_test_data()
    
    # Check initial state
    test_user_list_before_removal()
    
    # Test removal functions
    test_removal_functions()
    
    # Check state after removals
    test_user_list_after_removal()
    
    # Test comprehensive cleanup
    test_comprehensive_cleanup()
    
    # Final state check
    test_user_list_after_removal()
    
    # Cleanup
    cleanup_test_data()
    
    print("\n✅ Test completed! If no TEST_ records appear in the final lists, the fix is working.")

if __name__ == "__main__":
    main()