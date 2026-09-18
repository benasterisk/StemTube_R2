"""
Shared YouTube cookie jar for every yt-dlp session (ported from DeezpotHiFi).

Why: with ``cookiefile=`` each YoutubeDL instance loads its own copy of
core/youtube_cookies.txt and rewrites the whole file when it closes
(YoutubeDL.save_cookies). Concurrent downloads, searches and metadata lookups
race: the last session to close overwrites the rolling session cookies YouTube
handed the others (SIDCC, __Secure-*, CONSISTENCY, YSC), and every save drops
cookies http.cookiejar considers discardable, so the file degrades over time.

The broker owns ONE jar in memory, bound to every session with
``get_broker().attach_to(ydl)`` right after ``YoutubeDL(...)`` is built (no
``cookiefile`` option any more). Writes are atomic (temp file + os.replace) and
throttled; a file replaced from outside (admin upload, bookmarklet) is detected
by size + SHA-1 and reloaded. While downloads are idle a keep-alive request
refreshes the short-lived cookies YouTube's bot check looks at, and
``rescue_botcheck()`` lets a download retry once after "Sign in to confirm
you're not a bot".
"""

import hashlib
import http.cookiejar
import logging
import os
import tempfile
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

COOKIES_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'youtube_cookies.txt')

FLUSH_WINDOW_S = 2.0          # many mark_dirty() calls collapse into one write per window
HEARTBEAT_INTERVAL_S = 180.0  # keep-alive cadence while idle
HEARTBEAT_IDLE_MIN_S = 120.0  # no keep-alive while YouTube was used this recently
HEARTBEAT_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'  # "Me at the zoo", always public
HEARTBEAT_TIMEOUT_S = 15

AUTH_COOKIE_NAMES = ('SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'LOGIN_INFO',
                     '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID')

# Error texts of a YouTube bot-check / throttling rejection (kept broad: a false
# positive only costs one extra retry).
BOTCHECK_PATTERNS = ('sign in to confirm', "confirm you're not a bot", 'confirm you’re not a bot',
                     'http error 429', 'too many requests')


def _new_jar(path: str) -> http.cookiejar.MozillaCookieJar:
    # yt-dlp's own jar class: its HTTP layer calls methods (get_cookie_header,
    # get_cookies_for_url) a plain MozillaCookieJar does not have.
    try:
        from yt_dlp.cookies import YoutubeDLCookieJar
        return YoutubeDLCookieJar(path)
    except Exception:
        return http.cookiejar.MozillaCookieJar(path)


def is_botcheck_error(error: BaseException) -> bool:
    message = str(error).lower()
    return any(pattern in message for pattern in BOTCHECK_PATTERNS)


class CookieBroker:
    """Owns the canonical jar; every read and write goes through one re-entrant lock."""

    def __init__(self, path: str = COOKIES_FILE_PATH):
        self._path = path
        self._lock = threading.RLock()
        self._jar = _new_jar(path)
        self._loaded = False
        self._dirty = False
        self._fingerprint = (0, '')      # (size, sha1) of the file as we last saw/wrote it
        self._last_flush_ts = 0.0
        self._last_activity_ts = 0.0
        self._last_heartbeat_ts = 0.0
        self._last_heartbeat_ok: Optional[bool] = None
        self._attached = 0
        self._stop = threading.Event()

    # ---- lifecycle ---------------------------------------------------

    def bootstrap(self):
        with self._lock:
            if self._loaded:
                return
            self._load_locked()
            self._loaded = True
        threading.Thread(target=self._flusher_loop, name='CookieBroker-flusher', daemon=True).start()
        threading.Thread(target=self._heartbeat_loop, name='CookieBroker-heartbeat', daemon=True).start()

    def shutdown(self):
        self._stop.set()
        self.flush_now()

    # ---- yt-dlp sessions ---------------------------------------------

    def has_cookies(self) -> bool:
        with self._lock:
            self._reload_if_changed_locked()
            return len(self._jar) > 0

    def attach_to(self, ydl: Any):
        """Bind a YoutubeDL instance to the shared jar (call before extract_info)."""
        with self._lock:
            self._reload_if_changed_locked()
            ydl.cookiejar = self._jar
            # The HTTP layer captures the jar when it is first built: rebuild it if
            # something already created it with yt-dlp's own jar.
            director = ydl.__dict__.pop('_request_director', None)
            if director is not None:
                director.close()
            self._attached += 1
            self._last_activity_ts = time.time()

    def detach(self, ydl: Any = None):
        """End of a session: count it and schedule a write of the cookies it received."""
        with self._lock:
            self._attached = max(0, self._attached - 1)
            self._dirty = True
            self._last_activity_ts = time.time()

    def rescue_botcheck(self) -> bool:
        """After a bot-check rejection: persist the jar and refresh the short-lived cookies."""
        self.flush_now()
        return self._heartbeat(force=True)

    # ---- external file changes -----------------------------------------

    def merge_cookie_header(self, cookie_header: str) -> Dict[str, int]:
        """
        Merge ``document.cookie`` from youtube.com (bookmarklet) into the jar and write it.

        Merged, not replaced: document.cookie never contains HttpOnly cookies, which
        include Google's session cookies (HSID, SSID, __Secure-3PSID...). Replacing
        the file would log the account out; merging refreshes the readable cookies
        and keeps those imported from a cookies.txt export.
        """
        with self._lock:
            self._reload_if_changed_locked()
            existing = {}
            for cookie in self._jar:
                if cookie.domain.lstrip('.').endswith('youtube.com'):
                    existing.setdefault(cookie.name, []).append(cookie)
            updated = added = 0
            for pair in (cookie_header or '').split(';'):
                name, sep, value = pair.strip().partition('=')
                if not sep or not name:
                    continue
                if name in existing:
                    for cookie in existing[name]:
                        cookie.value = value
                    updated += 1
                else:
                    self._jar.set_cookie(http.cookiejar.Cookie(
                        0, name, value, None, False, '.youtube.com', True, True, '/', False,
                        True, None, True, None, None, {}))
                    added += 1
            self._flush_locked(force=True, create=True)
            return {'updated': updated, 'added': added, 'total': len(self._jar)}

    def reload_from_disk(self):
        """Take the file on disk as the truth (after an admin upload or deletion)."""
        with self._lock:
            self._load_locked()

    def snapshot(self) -> Dict[str, Any]:
        """Health data for the admin cookies status."""
        with self._lock:
            now = time.time()
            names = {cookie.name for cookie in self._jar}
            age = lambda ts: int(now - ts) if ts else None  # noqa: E731
            return {
                'jar_cookies': len(self._jar),
                'auth_cookies_present': sorted(n for n in AUTH_COOKIE_NAMES if n in names),
                'consistency_present': 'CONSISTENCY' in names,
                'attached_sessions': self._attached,
                'dirty_pending': self._dirty,
                'last_flush_age_s': age(self._last_flush_ts),
                'last_activity_age_s': age(self._last_activity_ts),
                'last_heartbeat_age_s': age(self._last_heartbeat_ts),
                'last_heartbeat_ok': self._last_heartbeat_ok,
            }

    # ---- load / save -----------------------------------------------------

    def _file_fingerprint(self):
        try:
            with open(self._path, 'rb') as handle:
                data = handle.read()
            return len(data), hashlib.sha1(data).hexdigest()
        except OSError:
            return 0, ''

    def _load_locked(self):
        jar = _new_jar(self._path)
        if os.path.exists(self._path) and os.path.getsize(self._path) > 0:
            try:
                jar.load(ignore_discard=True, ignore_expires=True)
            except Exception as e:
                logger.warning(f"[Cookies] Could not load {self._path}: {e}; using an empty jar")
        self._jar = jar
        self._dirty = False
        self._fingerprint = self._file_fingerprint()

    def _reload_if_changed_locked(self):
        if not self._loaded:
            return
        current = self._file_fingerprint()
        if current != self._fingerprint:
            logger.info("[Cookies] Cookie file changed on disk; reloading the shared jar")
            self._load_locked()

    def flush_now(self):
        with self._lock:
            self._flush_locked(force=True)

    def _flush_locked(self, force: bool = False, create: bool = False):
        if not (force or self._dirty):
            return
        if not os.path.exists(self._path) and not create:
            # No cookie file uploaded (or it was deleted): the visitor cookies a
            # session picks up are not worth creating one.
            self._dirty = False
            return
        # A file replaced from outside since our last look wins over the jar.
        if not create and self._file_fingerprint() != self._fingerprint:
            self._load_locked()
            return
        directory = os.path.dirname(self._path) or '.'
        fd, tmp_path = tempfile.mkstemp(prefix='.youtube_cookies.', suffix='.tmp', dir=directory)
        os.close(fd)
        try:
            self._jar.save(tmp_path, ignore_discard=True, ignore_expires=True)
            os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, self._path)
            self._fingerprint = self._file_fingerprint()
            self._dirty = False
            self._last_flush_ts = time.time()
        except Exception as e:
            logger.warning(f"[Cookies] Atomic write failed: {e}")
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    # ---- background threads --------------------------------------------

    def _flusher_loop(self):
        while not self._stop.wait(FLUSH_WINDOW_S):
            with self._lock:
                self._flush_locked()

    def _heartbeat_loop(self):
        while not self._stop.wait(HEARTBEAT_INTERVAL_S):
            with self._lock:
                idle = time.time() - self._last_activity_ts >= HEARTBEAT_IDLE_MIN_S
                ready = idle and self._attached == 0 and os.path.exists(self._path)
            if ready:
                self._heartbeat(force=False)

    def _heartbeat(self, force: bool) -> bool:
        """One full metadata request on a public video: YouTube answers with fresh
        CONSISTENCY / YSC cookies, which land in the shared jar."""
        try:
            import yt_dlp
            opts = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'noprogress': True,
                    'socket_timeout': HEARTBEAT_TIMEOUT_S, 'js_runtimes': {'deno': {}, 'node': {}}}
            with yt_dlp.YoutubeDL(opts) as ydl:
                self.attach_to(ydl)
                try:
                    ydl.extract_info(HEARTBEAT_URL, download=False)
                finally:
                    self.detach(ydl)
            ok = True
        except Exception as e:
            logger.warning(f"[Cookies] Keep-alive {'(rescue) ' if force else ''}failed: {e}")
            ok = False
        with self._lock:
            self._last_heartbeat_ts = time.time()
            self._last_heartbeat_ok = ok
        if ok:
            logger.info(f"[Cookies] Keep-alive {'(rescue) ' if force else ''}ok")
        return ok


_broker: Optional[CookieBroker] = None
_broker_lock = threading.Lock()


def get_broker() -> CookieBroker:
    """Process-wide broker, loaded and started on first use."""
    global _broker
    if _broker is None:
        with _broker_lock:
            if _broker is None:
                broker = CookieBroker()
                broker.bootstrap()
                _broker = broker
    return _broker


@contextmanager
def youtube_dl(opts: Dict[str, Any]):
    """``yt_dlp.YoutubeDL(opts)`` bound to the shared cookie jar (never pass cookiefile)."""
    import yt_dlp
    broker = get_broker()
    with yt_dlp.YoutubeDL(opts) as ydl:
        broker.attach_to(ydl)
        try:
            yield ydl
        finally:
            broker.detach(ydl)
