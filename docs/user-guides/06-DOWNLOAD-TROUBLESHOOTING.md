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

**Solution:** Install Deno and ensure it's in the system PATH.

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Add to PATH (in ~/.bashrc or service script)
export PATH="$HOME/.deno/bin:$PATH"
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
| **Deno** | JavaScript runtime for nsig challenges |
| **Firefox OR cookies.txt** | YouTube authentication |
| **yt-dlp nightly** | Latest YouTube fixes |

### Cookie Configuration Options

#### Option A: Desktop Server with Firefox (Recommended)
If your server has a graphical interface with Firefox:
1. Log into YouTube in Firefox
2. StemTube will automatically use Firefox cookies

#### Option B: Headless Server with Bookmarklet
For servers without a GUI:
1. Go to **Admin Panel → YouTube Cookies**
2. Click **"Générer Bookmarklet"**
3. Drag the bookmarklet link to your browser's bookmarks bar
4. Visit **youtube.com** and log in
5. Click the bookmarklet to send cookies to your server

#### Option C: Manual cookies.txt Upload
1. Export cookies from your browser using an extension like "Get cookies.txt LOCALLY"
2. Place the file at: `core/youtube_cookies.txt`

### Cookie Priority
StemTube checks for cookies in this order:
1. `core/youtube_cookies.txt` (uploaded via admin or manual)
2. Firefox browser cookies (if Firefox profile exists)
3. No cookies (limited functionality)

---

## Troubleshooting

### Check yt-dlp Version
```bash
source venv/bin/activate
yt-dlp --version
# Should be 2026.01.xx or newer (nightly)
```

### Check Deno Installation
```bash
which deno
deno --version
# Should return valid paths and version
```

### Test Download Manually
```bash
source venv/bin/activate
export PATH="$HOME/.deno/bin:$PATH"

yt-dlp --cookies-from-browser firefox \
       --extractor-args "youtube:player_client=ios,web" \
       -f "bestaudio/best[acodec!=none]" \
       "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Check Service Logs
```bash
sudo tail -f /path/to/stemtube/logs/stemtube_app.log | grep -i "cookie\|error\|deno"
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `n challenge solving failed` | Deno not in PATH | Add Deno to service PATH |
| `403 Forbidden` | Missing/expired cookies | Refresh cookies via bookmarklet |
| `Requested format not available` | SABR blocking | Use iOS player client |
| `No cookies available` | No Firefox or cookies.txt | Upload cookies via admin |

---

## Files Modified for YouTube Fix

| File | Changes |
|------|---------|
| `start_service.sh` | Added Deno to PATH |
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
