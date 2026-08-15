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
 * auto-scroll) keeps updating the same DOM nodes. The page stylesheets and
 * theme classes are mirrored into the PiP document. Closing the window (or
 * the popup) moves the dialog back into its overlay.
 *
 * Note: Chrome only opens the window inside a user gesture (a real click) and
 * inside iframes only if the embedding page delegates
 * allow="picture-in-picture" - the app's mixer iframe does.
 */
(function () {
    'use strict';

    const supported = 'documentPictureInPicture' in window;
    const state = {};   // key -> { pip, dialog, placeholder, onClosed }

    function copyStyles(targetDoc) {
        for (const sheet of document.styleSheets) {
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
        targetDoc.documentElement.className = document.documentElement.className;
        targetDoc.body.className = document.body.className;
        const theme = document.body.getAttribute('data-theme');
        if (theme) targetDoc.body.setAttribute('data-theme', theme);
        const rootStyle = document.documentElement.style;
        for (let i = 0; i < rootStyle.length; i++) {
            targetDoc.documentElement.style.setProperty(rootStyle[i], rootStyle.getPropertyValue(rootStyle[i]));
        }
    }

    /**
     * Detach a popup dialog. opts:
     *   dialogSelector : the dialog element to move (inside the overlay)
     *   title          : PiP window title
     *   onClosed       : callback when the PiP window closes (after re-attach)
     * Returns true when the window opened.
     */
    async function detach(key, opts) {
        if (!supported) return false;
        const cur = state[key];
        if (cur && cur.pip && !cur.pip.closed) { cur.pip.focus(); return true; }

        const dialog = document.querySelector(opts.dialogSelector);
        if (!dialog) return false;

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

        copyStyles(pip.document);
        pip.document.title = opts.title || document.title;
        pip.document.body.style.cssText = 'margin:0;background:var(--bg-primary,#111);';
        // The dialog is styled for the overlay (fixed size, centered): in the
        // PiP window it simply fills the viewport.
        const shell = pip.document.createElement('div');
        shell.className = 'stage-view-shell';
        shell.style.cssText = 'position:fixed;inset:0;display:flex;';
        pip.document.body.appendChild(shell);

        const placeholder = document.createElement('div');
        placeholder.className = 'stage-view-placeholder';
        placeholder.textContent = 'Showing in the Stage View window - close it to bring this back here.';
        dialog.parentNode.insertBefore(placeholder, dialog);
        shell.appendChild(dialog);
        dialog.classList.add('in-stage-view');

        state[key] = { pip, dialog, placeholder, onClosed: opts.onClosed };

        pip.document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') pip.close();
            else if (e.key === ' ' && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) {
                e.preventDefault();
                const b = document.getElementById('playBtn'); if (b) b.click();
            }
        });
        pip.addEventListener('pagehide', () => reattach(key));
        return true;
    }

    function reattach(key) {
        const cur = state[key];
        if (!cur) return;
        const { pip, dialog, placeholder, onClosed } = cur;
        dialog.classList.remove('in-stage-view');
        if (placeholder && placeholder.parentNode) placeholder.parentNode.replaceChild(dialog, placeholder);
        delete state[key];
        if (pip && !pip.closed) { try { pip.close(); } catch (e) { /* closing */ } }
        if (typeof onClosed === 'function') onClosed();
    }

    function isDetached(key) {
        const cur = state[key];
        return !!(cur && cur.pip && !cur.pip.closed);
    }

    function pipDocument(key) {
        const cur = state[key];
        return (cur && cur.pip && !cur.pip.closed) ? cur.pip.document : null;
    }

    window.StageView = { detach, reattach, isDetached, pipDocument, supported };
})();
