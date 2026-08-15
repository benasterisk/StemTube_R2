/**
 * Stage View — detach the Lyrics Focus / Chords Grid View dialogs into their
 * own always-on-top system window (Document Picture-in-Picture API,
 * Chrome/Edge 116+). Drag it to the stage monitor; it stays visible when the
 * browser is minimized. Falls back to the in-page popup when unsupported.
 *
 * How it works: the popup's WHOLE dialog element (header, transport slot with
 * the real transport bar, size slider, content) is MOVED - not cloned - into
 * the PiP document, so every control keeps its live event handlers and every
 * display driver (karaoke word highlight, chord-grid beat highlight,
 * auto-scroll) keeps updating the same DOM nodes. Page stylesheets and theme
 * classes are mirrored into the PiP document. Closing the window (or the
 * popup) moves the dialog back into its overlay.
 *
 * TOP-LEVEL ONLY: Chrome refuses documentPictureInPicture.requestWindow()
 * from an iframe ("only allowed from a top-level browsing context"), and no
 * allow= attribute changes that. The mixer normally runs inside the app's
 * <iframe id=mixerFrame>, so this module works in two roles:
 *   - inside the iframe (mixer page): asks the parent to open the window
 *     (postMessage) and provides the dialog element;
 *   - in the top-level app page: owns the PiP window and adopts the dialog
 *     from the iframe document (same origin => direct DOM access). The user
 *     activation of the click inside the iframe propagates to the parent's
 *     message handler because we post synchronously in the click.
 * The mixer page loaded standalone (no parent) opens the window itself.
 */
(function () {
    'use strict';

    const supported = 'documentPictureInPicture' in window;
    const isTop = (window.top === window);

    // ── shared helpers ───────────────────────────────────────────────

    function copyStyles(fromDoc, targetDoc) {
        for (const sheet of fromDoc.styleSheets) {
            try {
                const style = targetDoc.createElement('style');
                style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
                targetDoc.head.appendChild(style);
            } catch (e) {
                if (sheet.href) {           // cross-origin (CDN icons/fonts): relink
                    const link = targetDoc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = sheet.href;
                    targetDoc.head.appendChild(link);
                }
            }
        }
        targetDoc.documentElement.className = fromDoc.documentElement.className;
        targetDoc.body.className = fromDoc.body.className;
        const theme = fromDoc.body.getAttribute('data-theme');
        if (theme) targetDoc.body.setAttribute('data-theme', theme);
        const rootStyle = fromDoc.documentElement.style;
        for (let i = 0; i < rootStyle.length; i++) {
            targetDoc.documentElement.style.setProperty(rootStyle[i], rootStyle.getPropertyValue(rootStyle[i]));
        }
    }

    // ── the window owner (top-level page, or standalone mixer) ───────

    const owned = {};   // key -> { pip, dialog, placeholder, sourceWin }

    async function openWindow(key, dialog, sourceWin, opts) {
        if (!supported) return false;
        const cur = owned[key];
        if (cur && cur.pip && !cur.pip.closed) { cur.pip.focus(); return true; }

        let pip;
        try {
            pip = await window.documentPictureInPicture.requestWindow({
                width: opts.width || Math.round(Math.min(1400, screen.availWidth * 0.75)),
                height: opts.height || Math.round(Math.min(900, screen.availHeight * 0.8)),
            });
        } catch (e) {
            console.warn('[StageView] window refused:', e.message);
            return false;
        }

        copyStyles(sourceWin.document, pip.document);
        pip.document.title = opts.title || sourceWin.document.title;
        pip.document.body.style.cssText = 'margin:0;background:var(--bg-primary,#111);';
        const shell = pip.document.createElement('div');
        shell.className = 'stage-view-shell';
        shell.style.cssText = 'position:fixed;inset:0;display:flex;';
        pip.document.body.appendChild(shell);

        const placeholder = sourceWin.document.createElement('div');
        placeholder.className = 'stage-view-placeholder';
        placeholder.textContent = 'Showing in the Stage View window - close it to bring this back here.';
        dialog.parentNode.insertBefore(placeholder, dialog);
        shell.appendChild(dialog);           // adopts the node across documents
        dialog.classList.add('in-stage-view');

        owned[key] = { pip, dialog, placeholder, sourceWin };

        pip.document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') pip.close();
            else if (e.key === ' ' && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) {
                e.preventDefault();
                const b = sourceWin.document.getElementById('playBtn'); if (b) b.click();
            }
        });
        pip.addEventListener('pagehide', () => closeWindow(key));
        return true;
    }

    function closeWindow(key) {
        const cur = owned[key];
        if (!cur) return;
        const { pip, dialog, placeholder, sourceWin } = cur;
        dialog.classList.remove('in-stage-view');
        if (placeholder && placeholder.parentNode) placeholder.parentNode.replaceChild(dialog, placeholder);
        delete owned[key];
        if (pip && !pip.closed) { try { pip.close(); } catch (e) { /* closing */ } }
        // tell the source page its dialog is back
        try { sourceWin.postMessage({ type: 'stage_view_closed', key }, '*'); } catch (e) { /* gone */ }
    }

    // ── top-level page: serve requests coming from the mixer iframe ──
    //
    // Two channels: (1) a DIRECT call - the iframe is same-origin, so it can
    // invoke window.parent.__stageViewOpen(...) synchronously INSIDE its click
    // handler; the user activation is still live at that point (postMessage
    // is async and would drop out of the activation window); (2) postMessage
    // as a fallback/close channel.
    if (isTop) {
        window.__stageViewOpen = function (key, dialog, sourceWin, opts) {
            return openWindow(key, dialog, sourceWin, opts || {});
        };
        window.__stageViewClose = function (key) { closeWindow(key); };
    }

    if (isTop) {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            const src = event.source;
            if (!src || src === window) return;
            if (data.type === 'stage_view_open') {
                let dialog = null;
                try { dialog = src.document && src.document.querySelector(data.dialogSelector); } catch (e) { /* cross-origin */ }
                if (!dialog) { try { src.postMessage({ type: 'stage_view_result', key: data.key, ok: false }, '*'); } catch (e) {} return; }
                openWindow(data.key, dialog, src, { title: data.title }).then((ok) => {
                    try { src.postMessage({ type: 'stage_view_result', key: data.key, ok }, '*'); } catch (e) {}
                });
            } else if (data.type === 'stage_view_close') {
                closeWindow(data.key);
            }
        });
    }

    // ── mixer page API (used by the Stage View button) ───────────────

    const pending = {};     // key -> resolve() of an in-flight request via parent
    const detachedKeys = new Set();
    const onClosedCbs = {};

    if (!isTop) {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'stage_view_result') {
                if (data.ok) detachedKeys.add(data.key);
                const r = pending[data.key]; delete pending[data.key];
                if (r) r(!!data.ok);
            } else if (data.type === 'stage_view_closed') {
                detachedKeys.delete(data.key);
                const cb = onClosedCbs[data.key]; delete onClosedCbs[data.key];
                if (typeof cb === 'function') cb();
            }
        });
    }

    async function detach(key, opts) {
        if (!supported) return false;
        onClosedCbs[key] = opts.onClosed;
        if (isTop) {
            const dialog = document.querySelector(opts.dialogSelector);
            if (!dialog) return false;
            const ok = await openWindow(key, dialog, window, opts);
            if (ok) detachedKeys.add(key);
            return ok;
        }
        // inside the app iframe: the parent must open the window. Prefer the
        // synchronous direct call (keeps the click's user activation alive).
        try {
            const parentOpen = window.parent && window.parent.__stageViewOpen;
            if (typeof parentOpen === 'function') {
                const dialog = document.querySelector(opts.dialogSelector);
                if (!dialog) return false;
                const ok = await parentOpen(key, dialog, window, { title: opts.title });
                if (ok) detachedKeys.add(key);
                return ok;
            }
        } catch (e) { /* cross-origin parent: fall through to postMessage */ }
        return new Promise((resolve) => {
            pending[key] = resolve;
            try {
                window.parent.postMessage({ type: 'stage_view_open', key, dialogSelector: opts.dialogSelector, title: opts.title }, '*');
            } catch (e) { delete pending[key]; resolve(false); return; }
            setTimeout(() => { if (pending[key]) { delete pending[key]; resolve(false); } }, 4000);
        });
    }

    function reattach(key) {
        if (isTop) { closeWindow(key); return; }
        if (!detachedKeys.has(key)) return;
        try {
            if (window.parent && typeof window.parent.__stageViewClose === 'function') { window.parent.__stageViewClose(key); return; }
        } catch (e) { /* cross-origin */ }
        try { window.parent.postMessage({ type: 'stage_view_close', key }, '*'); } catch (e) { /* gone */ }
    }

    // top-level: closeWindow also fires 'stage_view_closed' to itself via postMessage
    if (isTop) {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (data && data.type === 'stage_view_closed' && event.source === window) {
                detachedKeys.delete(data.key);
                const cb = onClosedCbs[data.key]; delete onClosedCbs[data.key];
                if (typeof cb === 'function') cb();
            }
        });
    }

    function isDetached(key) { return detachedKeys.has(key); }

    window.StageView = { detach, reattach, isDetached, supported, isTop };
})();
