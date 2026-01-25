"""
YouTube API client using aiotube for StemTubes application.
Alternative implementation that doesn't require an API key.
"""
import os
import json
import time
import sqlite3
import threading
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path

# aiotube is deprecated/broken - using yt-dlp instead
# import aiotube
# pytubefix is also blocked by YouTube bot detection, so we use yt-dlp
import yt_dlp
import re
import requests
from bs4 import BeautifulSoup

from .config import get_setting
from .download_manager import get_youtube_cookies_config

# Constants
MAX_RESULTS_PER_PAGE = 50  # Increased limit to allow more results
SEARCH_CACHE_DURATION = 86400  # 24 hours

# Database for caching
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "youtube_cache.db")


class AiotubeClient:
    """Client for interacting with YouTube using aiotube library."""

    def __init__(self):
        """Initialize the aiotube client."""
        # Cache for search results
        self._search_cache = {}
        self._search_cache_timestamps = {}

        # Initialize SQLite cache
        self._init_cache_db()

    def _init_cache_db(self):
        """Initialize SQLite cache database."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # Table for searches
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS search_cache (
            query TEXT,
            max_results INTEGER,
            page_token TEXT,
            filters TEXT,
            response TEXT,
            timestamp INTEGER,
            PRIMARY KEY (query, max_results, page_token, filters)
        )
        ''')

        # Table for suggestions
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS suggestions_cache (
            query TEXT PRIMARY KEY,
            suggestions TEXT,
            timestamp INTEGER
        )
        ''')

        # Table for video information
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS video_info_cache (
            video_id TEXT PRIMARY KEY,
            info TEXT,
            timestamp INTEGER
        )
        ''')

        conn.commit()
        conn.close()

    def search_videos(self, query: str, max_results: int = 5, 
                     page_token: Optional[str] = None, 
                     filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Search for YouTube videos.

        Args:
            query: Search query.
            max_results: Maximum number of results to return.
            page_token: Token for pagination (not used with aiotube, kept for compatibility).
            filters: Additional filters for the search (not used with aiotube, kept for compatibility).

        Returns:
            Dictionary containing search results and pagination info.
        """
        # Validate max_results (allow up to 50)
        max_results = min(max(max_results, 1), 50)

        # Check cache in SQLite
        filters_str = json.dumps(filters or {}) if filters else "{}"
        page_token_str = page_token or ""

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT response, timestamp FROM search_cache WHERE query = ? AND max_results = ? AND page_token = ? AND filters = ?",
            (query, max_results, page_token_str, filters_str)
        )
        result = cursor.fetchone()

        if result:
            response_str, timestamp = result
            # Check if cache is still valid
            if time.time() - timestamp < SEARCH_CACHE_DURATION:
                conn.close()
                return json.loads(response_str)

        try:
            # Use yt-dlp to search for videos (aiotube and pytubefix are blocked by YouTube)
            print(f"[YtDlpClient] Searching for '{query}' with limit={max_results}")

            # Use yt-dlp search
            ydl_opts = {
                'quiet': True,
                'extract_flat': True,
                'no_warnings': True,
                # YouTube 403 Fix: Use iOS client to bypass SABR streaming blocks (Jan 2026)
                'extractor_args': {
                    'youtube': {
                        'player_client': ['ios', 'web']
                    }
                },
            }
            # Add cookies configuration (file or browser, with fallback)
            ydl_opts.update(get_youtube_cookies_config())

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                search_results = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)

            entries = search_results.get('entries', [])
            print(f"[YtDlpClient] yt-dlp returned {len(entries)} results")

            # Create a response structure similar to YouTube API
            response = {
                "items": [],
                "pageInfo": {
                    "totalResults": len(entries),
                    "resultsPerPage": len(entries)
                }
            }

            # Add video details for each result
            for entry in entries:
                try:
                    video_id = entry.get('id', '')  # 11-char YouTube ID

                    # DEBUG: Log each video_id from search results
                    print(f"[YTDLP DEBUG] Processing video_id: '{video_id}' (length: {len(video_id)})")

                    # Extract thumbnail URL - yt-dlp provides thumbnails array
                    thumbnail_url = ""
                    thumbnails = entry.get('thumbnails', [])
                    if thumbnails:
                        # Get medium quality thumbnail
                        thumbnail_url = thumbnails[0].get('url', '')
                        for t in thumbnails:
                            if t.get('width', 0) >= 320 and t.get('width', 0) <= 480:
                                thumbnail_url = t.get('url', '')
                                break
                    if not thumbnail_url:
                        thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

                    # Clean up the thumbnail URL
                    if thumbnail_url and '?' in thumbnail_url:
                        thumbnail_url = thumbnail_url.split('?')[0]

                    title = entry.get('title', '')

                    # Debug: Show metadata to understand the structure
                    print(f"DEBUG - Video ID: {video_id}")
                    print(f"DEBUG - Thumbnail URL: {thumbnail_url}")
                    print(f"DEBUG - Title: {title}")

                    # Extract duration correctly
                    duration = ""
                    total_seconds = int(entry.get('duration', 0) or 0)
                    if total_seconds > 0:
                        # Convert seconds to detailed ISO 8601 format (with H, M, S as needed)
                        hours = total_seconds // 3600
                        minutes = (total_seconds % 3600) // 60
                        seconds = total_seconds % 60

                        duration = "PT"
                        if hours > 0:
                            duration += f"{hours}H"
                        if minutes > 0 or hours > 0:  # Include M even if 0 when there are hours
                            duration += f"{minutes}M"
                        duration += f"{seconds}S"

                    # DEBUG: Log the video_id being returned
                    print(f"[YTDLP DEBUG] Returning video_id: '{video_id}' with title: '{title[:50] if title else ''}...'")

                    # Create a structure similar to YouTube API response
                    item = {
                        "id": video_id,
                        "snippet": {
                            "title": title,
                            "channelTitle": entry.get('channel', '') or entry.get('uploader', ''),
                            "publishedAt": entry.get('upload_date', '') or "",
                            "thumbnails": {
                                "medium": {
                                    "url": thumbnail_url
                                }
                            }
                        },
                        "contentDetails": {
                            "duration": duration
                        },
                        "statistics": {
                            "viewCount": str(entry.get('view_count', 0) or 0),
                            "likeCount": str(entry.get('like_count', 0) or 0)
                        }
                    }

                    response["items"].append(item)
                except Exception as e:
                    print(f"Error getting video details: {e}")
                    continue
            
            # Cache results in SQLite
            cursor.execute(
                "INSERT OR REPLACE INTO search_cache VALUES (?, ?, ?, ?, ?, ?)",
                (query, max_results, page_token_str, filters_str, json.dumps(response), int(time.time()))
            )
            conn.commit()
            
            return response
        except Exception as e:
            print(f"Error searching videos: {e}")
            return {"items": [], "error": str(e)}
        finally:
            conn.close()

    def get_video_info(self, video_id: str) -> Dict[str, Any]:
        """Get detailed information about a specific video."""
        # Check if it's an ID or a URL
        if "youtube.com/" in video_id or "youtu.be/" in video_id:
            # It's a URL, let's try to extract the ID
            print(f"YouTube URL detected: {video_id}", end="")
            try:
                # Extract video ID from URL
                if "youtube.com/watch" in video_id:
                    # Format standard: https://www.youtube.com/watch?v=VIDEO_ID
                    match = re.search(r'v=([^&]+)', video_id)
                    if match:
                        video_id = match.group(1)
                elif "youtu.be/" in video_id:
                    # Short format: https://youtu.be/VIDEO_ID
                    # Handle additional parameters like "si="
                    match = re.search(r'youtu\.be/([^?&]+)', video_id)
                    if match:
                        video_id = match.group(1)
                elif "youtube.com/embed/" in video_id:
                    # Format embed: https://www.youtube.com/embed/VIDEO_ID
                    match = re.search(r'embed/([^?&]+)', video_id)
                    if match:
                        video_id = match.group(1)
                elif "youtube.com/shorts/" in video_id:
                    # Format shorts: https://www.youtube.com/shorts/VIDEO_ID
                    match = re.search(r'shorts/([^?&]+)', video_id)
                    if match:
                        video_id = match.group(1)
                
                print(f" -> Extracted ID: {video_id}")
            except Exception as e:
                print(f"Error extracting ID: {e}")
                return {"error": f"Error extracting ID: {e}"}
        
        # Check if cache exists
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute(
            "SELECT info, timestamp FROM video_info_cache WHERE video_id = ?",
            (video_id,)
        )
        result = cursor.fetchone()

        if result:
            info_str, timestamp = result
            # Check if cache is still valid
            if time.time() - timestamp < SEARCH_CACHE_DURATION:
                conn.close()
                return json.loads(info_str)

        try:
            # Detect if the ID starts with a dash causing issues with aiotube
            if video_id.startswith('-'):
                # Alternative approach for IDs starting with a dash
                import requests
                from bs4 import BeautifulSoup
                
                # Create a basic response with the ID
                response = {
                    "items": [{
                        "id": {
                            "videoId": video_id  # Format compatible with frontend (item.id.videoId)
                        },
                        "snippet": {
                            "title": "",
                            "description": "",
                            "channelTitle": "",
                            "publishedAt": "",
                            "thumbnails": {
                                "default": {"url": f"https://i.ytimg.com/vi/{video_id}/default.jpg"},
                                "medium": {"url": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"},
                                "high": {"url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"}
                            }
                        },
                        "contentDetails": {
                            "duration": ""
                        },
                        "statistics": {
                            "viewCount": "0",
                            "likeCount": "0"
                        }
                    }]
                }

                # Try to retrieve at least the title from the YouTube page
                try:
                    url = f"https://www.youtube.com/watch?v={video_id}"
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                    r = requests.get(url, headers=headers)
                    if r.status_code == 200:
                        soup = BeautifulSoup(r.text, 'html.parser')
                        # Search for title in different ways
                        title = None
                        # Method 1: title tag
                        if soup.title:
                            title_text = soup.title.string
                            if ' - YouTube' in title_text:
                                title = title_text.replace(' - YouTube', '')
                        
                        if title:
                            response["items"][0]["snippet"]["title"] = title
                except Exception as web_error:
                    print(f"Error retrieving web information: {web_error}")
                    # Continue with basic information, without stopping the process
            else:
                # Use yt-dlp for standard IDs (aiotube and pytubefix are blocked by YouTube)
                url = f"https://www.youtube.com/watch?v={video_id}"

                ydl_opts = {
                    'quiet': True,
                    'no_warnings': True,
                    # YouTube 403 Fix: Use iOS client to bypass SABR streaming blocks (Jan 2026)
                    'extractor_args': {
                        'youtube': {
                            'player_client': ['ios', 'web']
                        }
                    },
                }
                # Add cookies configuration (file or browser, with fallback)
                ydl_opts.update(get_youtube_cookies_config())

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)

                # Extract thumbnail URL
                thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
                thumbnails = info.get('thumbnails', [])
                if thumbnails:
                    for t in thumbnails:
                        if t.get('width', 0) >= 320 and t.get('width', 0) <= 480:
                            thumbnail_url = t.get('url', '')
                            break
                    if not thumbnail_url:
                        thumbnail_url = thumbnails[-1].get('url', '') if thumbnails else f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

                # Clean up the thumbnail URL
                if thumbnail_url and '?' in thumbnail_url:
                    thumbnail_url = thumbnail_url.split('?')[0]

                title = info.get('title', '')

                # Debug: Show metadata to understand the structure
                print(f"DEBUG - Video ID: {video_id}")
                print(f"DEBUG - Thumbnail URL: {thumbnail_url}")
                print(f"DEBUG - Title: {title}")

                # Extract duration correctly
                duration = ""
                total_seconds = int(info.get('duration', 0) or 0)
                if total_seconds > 0:
                    # Convert seconds to detailed ISO 8601 format (with H, M, S as needed)
                    hours = total_seconds // 3600
                    minutes = (total_seconds % 3600) // 60
                    seconds = total_seconds % 60

                    duration = "PT"
                    if hours > 0:
                        duration += f"{hours}H"
                    if minutes > 0 or hours > 0:  # Include M even if 0 when there are hours
                        duration += f"{minutes}M"
                    duration += f"{seconds}S"

                # Create a structure similar to YouTube API response
                response = {
                    "items": [{
                        "id": {
                            "videoId": video_id  # Format compatible with frontend (item.id.videoId)
                        },
                        "snippet": {
                            "title": title,
                            "description": info.get('description', '') or "",
                            "channelTitle": info.get('channel', '') or info.get('uploader', '') or "",
                            "publishedAt": info.get('upload_date', '') or "",
                            "thumbnails": {
                                "default": {"url": thumbnail_url},
                                "medium": {"url": thumbnail_url},
                                "high": {"url": thumbnail_url}
                            }
                        },
                        "contentDetails": {
                            "duration": duration
                        },
                        "statistics": {
                            "viewCount": str(info.get('view_count', 0) or 0),
                            "likeCount": str(info.get('like_count', 0) or 0)
                        }
                    }]
                }
            
            # Cache results in SQLite
            cursor.execute(
                "INSERT OR REPLACE INTO video_info_cache VALUES (?, ?, ?)",
                (video_id, json.dumps(response), int(time.time()))
            )
            conn.commit()

            return response
        except Exception as e:
            print(f"Error getting video info: {e}")
            return {"error": str(e)}
        finally:
            conn.close()

    def get_search_suggestions(self, query: str) -> List[str]:
        """Get search suggestions for a query.

        Args:
            query: Partial search query.

        Returns:
            List of search suggestions.
        """
        if not query:
            return []

        # Check cache in SQLite
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT suggestions, timestamp FROM suggestions_cache WHERE query = ?",
            (query,)
        )
        result = cursor.fetchone()

        if result:
            suggestions_str, timestamp = result
            # Check if cache is still valid
            if time.time() - timestamp < SEARCH_CACHE_DURATION * 7:  # 7 days for suggestions
                conn.close()
                return json.loads(suggestions_str)

        try:
            # Search for videos using yt-dlp (aiotube and pytubefix are blocked by YouTube)
            ydl_opts = {
                'quiet': True,
                'extract_flat': True,
                'no_warnings': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                search_results = ydl.extract_info(f"ytsearch3:{query}", download=False)

            entries = search_results.get('entries', [])

            # Extract titles as suggestions
            suggestions = []
            for entry in entries:
                try:
                    title = entry.get('title', '') or ""
                    if title and title not in suggestions:
                        suggestions.append(title)
                except Exception as e:
                    print(f"Error getting video title: {e}")
                    continue
            
            # Cache results in SQLite
            cursor.execute(
                "INSERT OR REPLACE INTO suggestions_cache VALUES (?, ?, ?)",
                (query, json.dumps(suggestions), int(time.time()))
            )
            conn.commit()
            
            return suggestions
        except Exception as e:
            print(f"Error getting search suggestions: {e}")
            return []
        finally:
            conn.close()

    def parse_video_duration(self, duration: str) -> int:
        """Parse duration format to seconds.

        Args:
            duration: Duration string.

        Returns:
            Duration in seconds.
        """
        if not duration:
            return 0
        
        try:
            # Parse duration in format like "3:45" or "1:23:45"
            parts = duration.split(':')
            if len(parts) == 2:  # MM:SS
                return int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:  # HH:MM:SS
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            else:
                return 0
        except (ValueError, IndexError):
            return 0

    def get_quota_remaining(self):
        """Get remaining quota for today.
        Included for compatibility with the original API client.
        aiotube doesn't use quotas.
        
        Returns:
            A high number to indicate unlimited quota.
        """
        return 1000000  # Effectively unlimited


# Create a singleton instance
_aiotube_client = None

def get_aiotube_client():
    """Get the aiotube client singleton instance.
    
    Returns:
        AiotubeClient instance.
    """
    global _aiotube_client
    if _aiotube_client is None:
        _aiotube_client = AiotubeClient()
    return _aiotube_client
