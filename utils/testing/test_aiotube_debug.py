#!/usr/bin/env python3
"""
Test script to debug aiotube search issues between local and Codespaces environments.
Uses existing StemTube Web aiotube client methods to isolate the problem.
"""

import sys
import os
import json
import time
import traceback
from pathlib import Path

# Add the project root to Python path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# Import the existing aiotube client
from core.aiotube_client import AiotubeClient


def detect_environment():
    """Detect if running locally or in GitHub Codespaces."""
    if os.environ.get('CODESPACES'):
        return "GitHub Codespaces"
    elif os.environ.get('GITHUB_WORKSPACE'):
        return "GitHub Actions"
    elif os.environ.get('CI'):
        return "CI Environment"
    else:
        return "Local Environment"


def test_raw_aiotube():
    """Test raw aiotube library directly."""
    print("\n=== Testing Raw Aiotube Library ===")
    try:
        import aiotube
        print("✓ Aiotube imported successfully")
        
        # Test basic search
        query = "fortnite"
        print(f"Searching for '{query}' with limit=5...")
        
        start_time = time.time()
        results = aiotube.Search.videos(query, limit=5)
        search_time = time.time() - start_time
        
        print(f"✓ Search completed in {search_time:.2f}s")
        print(f"✓ Found {len(results)} video IDs: {results}")
        
        # Test metadata extraction for first video
        if results:
            first_video_id = results[0]
            print(f"\nTesting metadata extraction for: {first_video_id}")
            
            try:
                start_time = time.time()
                video = aiotube.Video(first_video_id)
                metadata = video.metadata
                metadata_time = time.time() - start_time
                
                print(f"✓ Metadata extracted in {metadata_time:.2f}s")
                print(f"✓ Title: {metadata.get('title', 'N/A')}")
                print(f"✓ Channel: {metadata.get('channel', {}).get('name', 'N/A')}")
                print(f"✓ Duration: {metadata.get('duration', 'N/A')} seconds")
                print(f"✓ Views: {metadata.get('views', 'N/A')}")
                
                # Check thumbnails structure
                thumbnails = metadata.get('thumbnails', [])
                print(f"✓ Thumbnails count: {len(thumbnails)}")
                if thumbnails:
                    print(f"  First thumbnail: {thumbnails[0]}")
                
                return True, None
                
            except Exception as e:
                error_msg = f"✗ Metadata extraction failed: {e}"
                print(error_msg)
                print(f"  Full traceback:\n{traceback.format_exc()}")
                return False, error_msg
        else:
            error_msg = "✗ No video IDs returned from search"
            print(error_msg)
            return False, error_msg
            
    except Exception as e:
        error_msg = f"✗ Raw aiotube test failed: {e}"
        print(error_msg)
        print(f"  Full traceback:\n{traceback.format_exc()}")
        return False, error_msg


def test_stemtube_client():
    """Test StemTube's AiotubeClient wrapper."""
    print("\n=== Testing StemTube AiotubeClient ===")
    try:
        client = AiotubeClient()
        print("✓ AiotubeClient initialized")
        
        # Test search
        query = "fortnite"
        max_results = 5
        print(f"Searching for '{query}' with max_results={max_results}...")
        
        start_time = time.time()
        response = client.search_videos(query, max_results=max_results)
        search_time = time.time() - start_time
        
        print(f"✓ Search completed in {search_time:.2f}s")
        
        if "error" in response:
            error_msg = f"✗ Search returned error: {response['error']}"
            print(error_msg)
            return False, error_msg
        
        items = response.get("items", [])
        print(f"✓ Found {len(items)} processed results")
        
        if items:
            # Show details of first result
            first_item = items[0]
            print(f"✓ First result:")
            print(f"  ID: {first_item.get('id', 'N/A')}")
            print(f"  Title: {first_item.get('snippet', {}).get('title', 'N/A')}")
            print(f"  Channel: {first_item.get('snippet', {}).get('channelTitle', 'N/A')}")
            print(f"  Duration: {first_item.get('contentDetails', {}).get('duration', 'N/A')}")
            print(f"  Views: {first_item.get('statistics', {}).get('viewCount', 'N/A')}")
            
            # Check thumbnail
            thumbnail_url = first_item.get('snippet', {}).get('thumbnails', {}).get('medium', {}).get('url', '')
            print(f"  Thumbnail: {thumbnail_url}")
            
            return True, None
        else:
            error_msg = "✗ No processed results returned"
            print(error_msg)
            return False, error_msg
            
    except Exception as e:
        error_msg = f"✗ StemTube client test failed: {e}"
        print(error_msg)
        print(f"  Full traceback:\n{traceback.format_exc()}")
        return False, error_msg


def test_video_info():
    """Test getting info for a specific video."""
    print("\n=== Testing Video Info Extraction ===")
    try:
        client = AiotubeClient()
        
        # Test with a known popular video ID
        test_video_ids = [
            "dQw4w9WgXcQ",  # Rick Roll - very stable, always available
            "9bZkp7q19f0",  # PSY - Gangnam Style
        ]
        
        for video_id in test_video_ids:
            print(f"\nTesting video ID: {video_id}")
            
            try:
                start_time = time.time()
                response = client.get_video_info(video_id)
                info_time = time.time() - start_time
                
                print(f"✓ Video info retrieved in {info_time:.2f}s")
                
                if "error" in response:
                    print(f"✗ Error: {response['error']}")
                    continue
                
                items = response.get("items", [])
                if items:
                    item = items[0]
                    print(f"✓ Title: {item.get('snippet', {}).get('title', 'N/A')}")
                    print(f"✓ Channel: {item.get('snippet', {}).get('channelTitle', 'N/A')}")
                    print(f"✓ Duration: {item.get('contentDetails', {}).get('duration', 'N/A')}")
                    return True, None
                else:
                    print("✗ No items in response")
                    
            except Exception as e:
                print(f"✗ Error with {video_id}: {e}")
                continue
        
        return False, "All test video IDs failed"
        
    except Exception as e:
        error_msg = f"✗ Video info test failed: {e}"
        print(error_msg)
        print(f"  Full traceback:\n{traceback.format_exc()}")
        return False, error_msg


def test_network_connectivity():
    """Test basic network connectivity to YouTube."""
    print("\n=== Testing Network Connectivity ===")
    try:
        import requests
        
        # Test basic connectivity to YouTube
        urls_to_test = [
            "https://www.youtube.com",
            "https://i.ytimg.com",
            "https://m.youtube.com",
        ]
        
        for url in urls_to_test:
            try:
                print(f"Testing {url}...")
                response = requests.get(url, timeout=10, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                print(f"✓ {url}: Status {response.status_code}")
            except Exception as e:
                print(f"✗ {url}: {e}")
        
        return True, None
        
    except Exception as e:
        error_msg = f"✗ Network test failed: {e}"
        print(error_msg)
        return False, error_msg


def main():
    """Run all tests and provide a comprehensive report."""
    print("=== Aiotube Debug Test Script ===")
    print(f"Environment: {detect_environment()}")
    print(f"Python version: {sys.version}")
    print(f"Working directory: {os.getcwd()}")
    print(f"Project root: {project_root}")
    
    # Show environment variables that might be relevant
    relevant_env_vars = [
        'CODESPACES', 'GITHUB_WORKSPACE', 'CI', 'HTTP_PROXY', 'HTTPS_PROXY',
        'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'
    ]
    
    print("\nRelevant Environment Variables:")
    for var in relevant_env_vars:
        value = os.environ.get(var)
        if value:
            print(f"  {var}={value}")
    
    # Run tests
    test_results = {}
    
    print("\n" + "="*60)
    test_results['network'] = test_network_connectivity()
    
    print("\n" + "="*60)
    test_results['raw_aiotube'] = test_raw_aiotube()
    
    print("\n" + "="*60)
    test_results['stemtube_client'] = test_stemtube_client()
    
    print("\n" + "="*60)
    test_results['video_info'] = test_video_info()
    
    # Summary
    print("\n" + "="*60)
    print("=== TEST SUMMARY ===")
    print(f"Environment: {detect_environment()}")
    
    all_passed = True
    for test_name, (passed, error) in test_results.items():
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{test_name.upper()}: {status}")
        if not passed and error:
            print(f"  Error: {error}")
        all_passed = all_passed and passed
    
    if all_passed:
        print("\n🎉 All tests passed! Aiotube should work in this environment.")
    else:
        print("\n❌ Some tests failed. This explains why search isn't working.")
        print("\nTroubleshooting suggestions:")
        print("1. Check network connectivity and firewall settings")
        print("2. Verify YouTube isn't blocking requests from this IP range")
        print("3. Try using a VPN or different network")
        print("4. Check if there are proxy settings interfering")
        print("5. Consider rate limiting or temporary blocks")
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)