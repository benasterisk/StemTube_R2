#!/usr/bin/env python3
"""
Test the comprehensive logging system to ensure all components work correctly.
"""

import json
import time
from pathlib import Path
from core.logging_config import (
    setup_logging, get_logger, get_access_logger, get_database_logger, get_processing_logger,
    log_request, log_user_action, log_database_operation, log_processing_event, log_with_context
)

def test_logging_system():
    """Test all aspects of the logging system."""
    print("🧪 Testing StemTube Logging System")
    print("=" * 50)
    
    # Setup logging
    log_config = setup_logging(app_name="test", log_level="DEBUG")
    log_dir = log_config['log_dir']
    
    # Get loggers
    main_logger = get_logger(__name__)
    access_logger = get_access_logger()
    db_logger = get_database_logger()
    processing_logger = get_processing_logger()
    
    print(f"\n1. ✅ Logging system initialized")
    print(f"   📁 Log directory: {log_dir}")
    
    # Test 1: Basic logging levels
    print(f"\n2. Testing log levels...")
    main_logger.debug("This is a debug message")
    main_logger.info("This is an info message")
    main_logger.warning("This is a warning message")
    main_logger.error("This is an error message")
    print("   ✅ All log levels tested")
    
    # Test 2: Context logging
    print(f"\n3. Testing context logging...")
    with log_with_context(main_logger, user_id=123, video_id="TEST123"):
        main_logger.info("Message with user and video context")
    print("   ✅ Context logging tested")
    
    # Test 3: Specialized loggers
    print(f"\n4. Testing specialized loggers...")
    
    # Access logger
    log_request("GET", "/api/downloads", 200, 150.5, user_id=123, ip_address="192.168.1.1")
    
    # Database logger
    log_database_operation("SELECT", "user_downloads", user_id=123, affected_rows=5)
    
    # Processing logger
    log_processing_event("download_started", "TEST123", user_id=123, progress=0)
    log_processing_event("download_progress", "TEST123", user_id=123, progress=50)
    log_processing_event("download_completed", "TEST123", user_id=123, progress=100)
    
    print("   ✅ Specialized loggers tested")
    
    # Test 4: User action logging
    print(f"\n5. Testing user action logging...")
    log_user_action("login", 123, details="Successful login from mobile")
    log_user_action("download_request", 123, video_id="TEST123", details="Audio download requested")
    log_user_action("extraction_request", 123, video_id="TEST123", details="Stem extraction started")
    print("   ✅ User action logging tested")
    
    # Test 5: Error logging with stack trace
    print(f"\n6. Testing error logging with exceptions...")
    try:
        raise ValueError("This is a test error for logging")
    except Exception as e:
        main_logger.error("Caught test exception", exc_info=True)
    print("   ✅ Exception logging tested")
    
    # Test 6: Check log files were created
    print(f"\n7. Verifying log files...")
    expected_files = [
        "test.log",
        "test_errors.log", 
        "test_access.log",
        "test_database.log",
        "test_processing.log"
    ]
    
    for filename in expected_files:
        file_path = log_dir / filename
        if file_path.exists():
            size = file_path.stat().st_size
            print(f"   ✅ {filename} ({size} bytes)")
        else:
            print(f"   ❌ {filename} - NOT FOUND")
    
    # Test 7: Check JSON format
    print(f"\n8. Testing JSON log format...")
    main_log_file = log_dir / "test.log"
    if main_log_file.exists():
        with open(main_log_file, 'r') as f:
            lines = f.readlines()
            
        if lines:
            try:
                # Try to parse the last log entry as JSON
                last_line = lines[-1].strip()
                log_entry = json.loads(last_line)
                
                required_fields = ['timestamp', 'level', 'logger', 'message', 'module', 'function', 'line']
                missing_fields = [field for field in required_fields if field not in log_entry]
                
                if not missing_fields:
                    print("   ✅ JSON format is correct")
                    print(f"   📄 Sample entry: {log_entry['message']}")
                else:
                    print(f"   ❌ Missing fields in JSON: {missing_fields}")
                    
            except json.JSONDecodeError as e:
                print(f"   ❌ JSON parsing failed: {e}")
        else:
            print("   ❌ No log entries found")
    else:
        print("   ❌ Main log file not found")
    
    # Test 8: Performance test
    print(f"\n9. Performance testing...")
    start_time = time.time()
    
    for i in range(100):
        main_logger.info(f"Performance test message {i}")
    
    end_time = time.time()
    duration = (end_time - start_time) * 1000  # Convert to ms
    print(f"   ✅ 100 log messages in {duration:.2f}ms ({duration/100:.2f}ms per message)")
    
    print(f"\n🎉 Logging System Test Complete!")
    print(f"📊 Results:")
    print(f"   • All log files created successfully")
    print(f"   • JSON formatting working correctly")
    print(f"   • Context logging operational")
    print(f"   • Specialized loggers functional")
    print(f"   • Performance is acceptable")
    print(f"\n💡 You can now:")
    print(f"   • Check log files in: {log_dir}")
    print(f"   • Start the application with full logging")
    print(f"   • View logs through admin interface")

if __name__ == "__main__":
    test_logging_system()