"""
Redis-backed cache for YouTube search results, video info, and suggestions.
Replaces the SQLite youtube_cache.db.
"""
import json
import hashlib
import os
import redis as redis_lib

_redis_client = None


def get_redis():
    """Get or create the Redis client singleton."""
    global _redis_client
    if _redis_client is None:
        url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
        _redis_client = redis_lib.Redis.from_url(url, decode_responses=True)
    return _redis_client


class YouTubeCache:
    """YouTube data cache with automatic TTL expiry."""

    SEARCH_TTL = 86400      # 24 hours
    VIDEO_TTL = 86400        # 24 hours
    SUGGEST_TTL = 604800     # 7 days

    @staticmethod
    def _hash(*parts):
        raw = '|'.join(str(p) for p in parts)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    # ── Search cache ─────────────────────────────────────────

    @classmethod
    def get_search(cls, query, max_results, page_token='', filters='{}'):
        try:
            key = f"yt:search:{cls._hash(query, max_results, page_token, filters)}"
            data = get_redis().get(key)
            return json.loads(data) if data else None
        except Exception:
            return None

    @classmethod
    def set_search(cls, query, max_results, page_token='', filters='{}', response=None):
        try:
            key = f"yt:search:{cls._hash(query, max_results, page_token, filters)}"
            get_redis().setex(key, cls.SEARCH_TTL, json.dumps(response))
        except Exception:
            pass

    # ── Video info cache ─────────────────────────────────────

    @classmethod
    def get_video(cls, video_id):
        try:
            key = f"yt:video:{video_id}"
            data = get_redis().get(key)
            return json.loads(data) if data else None
        except Exception:
            return None

    @classmethod
    def set_video(cls, video_id, info):
        try:
            key = f"yt:video:{video_id}"
            get_redis().setex(key, cls.VIDEO_TTL, json.dumps(info))
        except Exception:
            pass

    # ── Suggestions cache ────────────────────────────────────

    @classmethod
    def get_suggestions(cls, query):
        try:
            key = f"yt:suggest:{cls._hash(query)}"
            data = get_redis().get(key)
            return json.loads(data) if data else None
        except Exception:
            return None

    @classmethod
    def set_suggestions(cls, query, suggestions):
        try:
            key = f"yt:suggest:{cls._hash(query)}"
            get_redis().setex(key, cls.SUGGEST_TTL, json.dumps(suggestions))
        except Exception:
            pass
