"""
Musixmatch API Client - Direct track search and lyrics fetching by track ID.

Reuses the syncedlyrics token cache at ~/.cache/syncedlyrics/musixmatch_token.json
so tokens are shared with the syncedlyrics library.
"""

import os
import json
import time
import logging
import requests
from typing import List, Dict, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Shared token cache path (same as syncedlyrics library)
TOKEN_CACHE_DIR = Path.home() / ".cache" / "syncedlyrics"
TOKEN_CACHE_FILE = TOKEN_CACHE_DIR / "musixmatch_token.json"

API_BASE = "https://apic-desktop.musixmatch.com/ws/1.1/"
APP_ID = "web-desktop-app-v1.0"


class MusixmatchClient:
    """Thin Musixmatch API wrapper with shared token caching."""

    def __init__(self):
        self._token = None
        self._token_expiry = 0

    def _get_token(self) -> str:
        """Read cached token, fetch new if expired, write back to shared cache."""
        now = time.time()

        # Try reading from cache
        if self._token and now < self._token_expiry:
            return self._token

        try:
            if TOKEN_CACHE_FILE.exists():
                data = json.loads(TOKEN_CACHE_FILE.read_text())
                token = data.get("token")
                expiry = data.get("expiry", 0)
                if token and now < expiry:
                    self._token = token
                    self._token_expiry = expiry
                    return self._token
        except Exception as e:
            logger.debug(f"[MUSIXMATCH] Failed to read token cache: {e}")

        # Fetch new token
        try:
            resp = requests.get(
                API_BASE + "token.get",
                params={"app_id": APP_ID},
                headers={"Cookie": "x-mxm-token-guid="},
                timeout=10
            )
            resp.raise_for_status()
            body = resp.json()
            token = body["message"]["body"]["user_token"]
            if not token or token == "MusixmatchUsertoken":
                raise ValueError("Invalid token received")

            # Cache for 10 minutes
            self._token = token
            self._token_expiry = now + 600

            # Write to shared cache
            try:
                TOKEN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                TOKEN_CACHE_FILE.write_text(json.dumps({
                    "token": token,
                    "expiry": self._token_expiry
                }))
            except Exception as e:
                logger.debug(f"[MUSIXMATCH] Failed to write token cache: {e}")

            return self._token

        except Exception as e:
            logger.error(f"[MUSIXMATCH] Failed to get token: {e}")
            raise

    def _api_get(self, action: str, params: dict = None) -> dict:
        """Authenticated GET to Musixmatch desktop API."""
        token = self._get_token()
        all_params = {
            "app_id": APP_ID,
            "usertoken": token,
            "format": "json",
        }
        if params:
            all_params.update(params)

        resp = requests.get(
            API_BASE + action,
            params=all_params,
            timeout=15
        )
        resp.raise_for_status()
        return resp.json()

    def search_tracks(self, artist: str = "", track: str = "", page_size: int = 10) -> List[Dict]:
        """
        Search for tracks on Musixmatch using separate artist/track fields.

        Uses q_artist + q_track for precise matching when both are provided,
        falls back to q= combined query otherwise.

        Returns list of {track_id, track_name, artist_name, album_name,
                         has_richsync, has_subtitles}
        """
        try:
            params = {
                "page_size": page_size,
                "page": 1,
                "s_track_rating": "desc",
            }

            # Use separate fields for better matching
            if artist and track:
                params["q_artist"] = artist
                params["q_track"] = track
                log_query = f"{artist} - {track}"
            else:
                params["q"] = f"{artist} {track}".strip()
                log_query = params["q"]

            data = self._api_get("track.search", params)

            track_list = (data.get("message", {})
                          .get("body", {})
                          .get("track_list", []))

            results = []
            for item in track_list:
                t = item.get("track", {})
                results.append({
                    "track_id": t.get("track_id"),
                    "track_name": t.get("track_name", ""),
                    "artist_name": t.get("artist_name", ""),
                    "album_name": t.get("album_name", ""),
                    "has_richsync": bool(t.get("has_richsync", 0)),
                    "has_subtitles": bool(t.get("has_subtitles", 0)),
                })

            logger.info(f"[MUSIXMATCH] Search '{log_query}': {len(results)} results")
            return results

        except Exception as e:
            logger.error(f"[MUSIXMATCH] Search failed: {e}")
            raise

    def fetch_lyrics_by_track_id(self, track_id: int) -> Optional[List[Dict]]:
        """
        Fetch lyrics for a specific track ID.
        Tries richsync (word-level) first, falls back to subtitle (line-level).
        Converts to segment list via Enhanced LRC parsing.

        Returns segments list or None.
        """
        # Try richsync (word-level timestamps)
        try:
            data = self._api_get("track.richsync.get", {
                "track_id": track_id,
            })

            status_code = (data.get("message", {})
                           .get("header", {})
                           .get("status_code"))

            if status_code == 200:
                richsync_body = (data.get("message", {})
                                 .get("body", {})
                                 .get("richsync", {}))
                richsync_str = richsync_body.get("richsync_body")

                if richsync_str:
                    logger.info(f"[MUSIXMATCH] Got richsync for track {track_id}")
                    lrc = self._richsync_to_enhanced_lrc(richsync_str)
                    if lrc:
                        from core.syncedlyrics_client import parse_enhanced_lrc
                        segments = parse_enhanced_lrc(lrc)
                        if segments:
                            total_words = sum(len(s.get('words', [])) for s in segments)
                            logger.info(f"[MUSIXMATCH] Parsed richsync: {len(segments)} lines, {total_words} words")
                            return segments

        except Exception as e:
            logger.warning(f"[MUSIXMATCH] Richsync failed for track {track_id}: {e}")

        # Fallback: try subtitle (line-level)
        try:
            data = self._api_get("track.subtitle.get", {
                "track_id": track_id,
                "subtitle_format": "lrc",
            })

            status_code = (data.get("message", {})
                           .get("header", {})
                           .get("status_code"))

            if status_code == 200:
                subtitle_body = (data.get("message", {})
                                 .get("body", {})
                                 .get("subtitle", {}))
                subtitle_str = subtitle_body.get("subtitle_body")

                if subtitle_str:
                    logger.info(f"[MUSIXMATCH] Got subtitle (line-level) for track {track_id}")
                    from core.syncedlyrics_client import _parse_standard_lrc
                    segments = _parse_standard_lrc(subtitle_str)
                    if segments:
                        logger.info(f"[MUSIXMATCH] Parsed subtitle: {len(segments)} lines")
                        return segments

        except Exception as e:
            logger.warning(f"[MUSIXMATCH] Subtitle failed for track {track_id}: {e}")

        logger.warning(f"[MUSIXMATCH] No lyrics found for track {track_id}")
        return None

    @staticmethod
    def _richsync_to_enhanced_lrc(richsync_body: str) -> Optional[str]:
        """
        Convert Musixmatch richsync JSON to Enhanced LRC string.

        Richsync format (JSON array of objects):
        [{"ts": 1.19, "te": 6.5, "l": [{"c": "Well, ", "o": 0.0}, {"c": "someone ", "o": 0.28}, ...], "x": "..."}, ...]

        Enhanced LRC format:
        [00:01.19] <00:01.19> Well, <00:01.47> someone ...
        """
        try:
            lines = json.loads(richsync_body)
        except (json.JSONDecodeError, TypeError):
            logger.warning("[MUSIXMATCH] Failed to parse richsync JSON")
            return None

        lrc_lines = []
        for line in lines:
            ts = float(line.get("ts", 0))
            words = line.get("l", [])

            if not words:
                continue

            # Build Enhanced LRC line
            line_min = int(ts) // 60
            line_sec = ts - (line_min * 60)
            lrc = f"[{line_min:02d}:{line_sec:05.2f}]"

            for word_data in words:
                char = word_data.get("c", "")
                offset = float(word_data.get("o", 0))

                # Skip empty strings and pure newlines
                if not char or char == "\n":
                    continue

                word_ts = ts + offset
                w_min = int(word_ts) // 60
                w_sec = word_ts - (w_min * 60)
                lrc += f" <{w_min:02d}:{w_sec:05.2f}> {char}"

            lrc_lines.append(lrc)

        if not lrc_lines:
            return None

        return "\n".join(lrc_lines)


# Module-level convenience functions
_client = None


def _get_client() -> MusixmatchClient:
    global _client
    if _client is None:
        _client = MusixmatchClient()
    return _client


def search_tracks(artist: str = "", track: str = "", page_size: int = 10) -> List[Dict]:
    """Search Musixmatch tracks. Returns list of track info dicts."""
    return _get_client().search_tracks(artist=artist, track=track, page_size=page_size)


def fetch_lyrics_by_track_id(track_id: int) -> Optional[List[Dict]]:
    """Fetch lyrics by Musixmatch track ID. Returns segments or None."""
    return _get_client().fetch_lyrics_by_track_id(track_id)
