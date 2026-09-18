# YouTube Download Issues & Solutions

## Problem Overview

YouTube constantly updates its anti-bot measures, which can cause yt-dlp downloads to fail with errors like:
- `HTTP Error 403: Forbidden`
- `Access forbidden - Video may be private, age-restricted, or geo-blocked`
- `Requested format is not available`
- `n challenge solving failed`

## Root Causes (January 2026)

### 1. SABR Streaming Enforcement
YouTube is forcing SABR (Server-Assisted Bitrate) streaming for web clients, blocking direct format downloads.

**Solution:** Use `player_client: ['ios', 'web']` in extractor_args.

### 2. JavaScript Challenge (nsig)
YouTube requires solving JavaScript challenges to get valid download URLs. This requires an external JS runtime.

**Solution:** Install Node.js (20+):

```bash
# Ubuntu/Debian
sudo apt-get install -y nodejs

# macOS
brew install node
```

### 3. PO Tokens
YouTube requires Proof of Origin tokens for certain clients and formats.

**Partial Solution:** Use iOS client which has fewer restrictions, combined with browser cookies.

### 4. Cookie Authentication
Many downloads require authenticated YouTube sessions to bypass restrictions.

**Solution:** Use cookies from a logged-in browser session.

---

## StemTube Configuration

### Server Requirements

| Requirement | Purpose |
|-------------|---------|
| **Node.js** | JavaScript runtime (20+) |
| **YouTube cookies** (admin upload or bookmarklet) | YouTube authentication |
| **yt-dlp nightly** | Latest YouTube fixes |

### Cookie Configuration Options

Use a **dedicated (throwaway) Google account**: a cookies file is a full login for that
account, and YouTube may restrict an account used for automated downloads.

#### Option A: cookies.txt Upload (recommended first step)
1. Log into YouTube with the dedicated account and export its cookies with an extension
   such as "Get cookies.txt LOCALLY"
2. **Admin Panel → YouTube Cookies → Upload** the file (only `youtube.com` / `google.com`
   cookies are kept: a whole-browser export has every other site's session in it)

This is the only way to import Google's HttpOnly session cookies (`HSID`, `SSID`,
`__Secure-3PSID`…), which a page script cannot read.

#### Option B: Bookmarklet (refresh from any browser)
1. **Admin Panel → YouTube Cookies → Generate Bookmarklet** and drag the link to your
   bookmarks bar (the link carries a one-time token: generate a new one for each use)
2. Open **youtube.com** while logged in and click the bookmarklet

The bookmarklet sends `document.cookie`, which never includes HttpOnly cookies, so it
**merges** into the stored cookies (updates values, adds new ones) instead of replacing
them: it refreshes a session imported with option A without logging it out.

### How StemTube Uses the Cookies
- `core/youtube_cookies.txt` is loaded once into a **shared cookie jar**
  (`core/cookie_broker.py`) bound to every yt-dlp session: downloads, search, format
  listing, lyrics metadata. yt-dlp is never given `cookiefile`, so concurrent sessions no
  longer overwrite each other's rolling cookies when they close.
- The jar is written back atomically (temp file + rename, mode 600) at most every 2 s;
  a file replaced by an upload is detected (size + SHA-1) and reloaded.
- While nothing uses YouTube, a keep-alive request every 3 min refreshes the short-lived
  `CONSISTENCY` / `YSC` cookies (only when a cookies file exists).
- A download rejected by the bot check ("Sign in to confirm you're not a bot", HTTP 429)
  is retried once after the jar is saved and a keep-alive request is made.
- Without a cookies file, yt-dlp runs anonymously (no file is created).
- The admin status shows the auth cookies found, the shared jar size, the last
  keep-alive and a warning when cookies of other sites are stored.

---

## Troubleshooting

### Check yt-dlp Version
```bash
source venv/bin/activate
yt-dlp --version
# Should be 2026.01.xx or newer (nightly)
```

### Check Node.js Installation
```bash
node --version
# Should return v20.x.x or higher
```

### Test Download Manually
```bash
source venv/bin/activate

yt-dlp --js-runtimes node \
       --extractor-args "youtube:player_client=ios,web" \
       -f "bestaudio/best[acodec!=none]" \
       "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Check Service Logs
```bash
sudo tail -f /path/to/stemtube/logs/stemtube_app.log | grep -i "cookie\|error\|node"
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `n challenge solving failed` | Node.js not installed | Install Node.js 20+ |
| `403 Forbidden` | Missing/expired cookies | Re-upload cookies.txt, or refresh with the bookmarklet |
| `Requested format not available` | SABR blocking | Use iOS player client |
| `Sign in to confirm you're not a bot` | Bot check (retried once automatically) | Refresh cookies; use a dedicated account |
| `No cookies file` warning | No cookies uploaded | Upload cookies via admin |

---

## Files Modified for YouTube Fix

| File | Changes |
|------|---------|
| `start_service.sh` | Service startup script |
| `core/download_manager.py` | Cookie fallback, iOS client |
| `core/aiotube_client.py` | Cookie fallback, iOS client |
| `app.py` | Cookie upload API, yt-dlp nightly auto-update |
| `templates/admin_embedded.html` | Cookie management UI |

---

## Keeping Updated

YouTube changes frequently. To stay ahead:

1. **Auto-update yt-dlp** (enabled by default at startup)
2. **Monitor GitHub issues:** https://github.com/yt-dlp/yt-dlp/issues
3. **Refresh cookies** periodically (YouTube rotates them)

## References

- [yt-dlp SABR Issue #12482](https://github.com/yt-dlp/yt-dlp/issues/12482)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [yt-dlp Nightly Builds](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases)
