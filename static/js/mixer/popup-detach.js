/**
 * Popup detach — pop the Lyrics Focus / Chords Grid content out of the browser
 * into its own always-on-top system window (Document Picture-in-Picture API,
 * Chrome/Edge 116+). The window can be dragged to a second screen (stage
 * monitor) and stays visible when the browser is minimized.
 *
 * How it works: the popup content element is MOVED (not cloned) into the PiP
 * document, so everything that already drives it — karaoke word highlighting,
 * chord-grid beat highlight, auto-scroll — keeps working: the DOM nodes are
 * the same objects the display code holds references to. The page's
 * stylesheets are copied into the PiP document so it looks identical.
 * Closing the PiP window (or the popup) moves the content back.
 *
 * On browsers without the API, the button is hidden.
 */
(function () {
    'use strict';

    const supported = 'documentPictureInPicture' in window;

    // Registry of detachable popups: key -> { pip, contentEl, placeholder, btn }
    const state = {};

    async function copyStyles(targetDoc) {
        // Same-origin sheets: clone rules; cross-origin (CDN fonts/icons): relink.
        for (const sheet of document.styleSheets) {
            try {
                const rules = [...sheet.cssRules].map(r => r.cssText).join('\n');
                const style = targetDoc.createElement('style');
                style.textContent = rules;
                targetDoc.head.appendChild(style);
            } catch (e) {
                if (sheet.href) {
                    const link = targetDoc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = sheet.href;
                    targetDoc.head.appendChild(link);
                }
            }
        }
        // Theme classes drive the CSS variables: mirror them on the PiP body.
        targetDoc.documentElement.className = document.documentElement.className;
        targetDoc.body.className = document.body.className;
        for (const a of ['data-theme']) {
            const v = document.body.getAttribute(a);
            if (v) targetDoc.body.setAttribute(a, v);
        }
    }

    // Keep the PiP body in sync with the page's CSS variables (theme tokens
    // are declared on :root/body in the copied sheets, so class mirroring
    // covers it; this handles inline overrides too).
    function mirrorInlineVars(targetDoc) {
        const src = document.documentElement.style;
        for (let i = 0; i < src.length; i++) {
            const name = src[i];
            targetDoc.documentElement.style.setProperty(name, src.getPropertyValue(name));
        }
    }

    async function detach(key, opts) {
        if (!supported) return false;
        const cur = state[key];
        if (cur && cur.pip && !cur.pip.closed) { cur.pip.focus(); return true; }

        const contentEl = document.querySelector(opts.contentSelector);
        if (!contentEl) return false;

        let pip;
        try {
            pip = await window.documentPictureInPicture.requestWindow({
                width: opts.width || Math.min(1200, screen.availWidth * 0.7),
                height: opts.height || Math.min(800, screen.availHeight * 0.7),
            });
        } catch (e) {
            console.warn('[PopupDetach] PiP window refused:', e.message);
            return false;
        }

        await copyStyles(pip.document);
        mirrorInlineVars(pip.document);
        pip.document.title = opts.title || document.title;

        // Stage-shell wrapper inside the PiP window: same classes as the popup
        // body so the popup CSS applies (dialog look, scroll container...).
        const shell = pip.document.createElement('div');
        shell.className = opts.shellClass || '';
        shell.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-primary,#111);';
        const scroller = pip.document.createElement('div');
        scroller.className = opts.scrollerClass || '';
        scroller.style.cssText = 'flex:1;min-height:0;overflow-y:auto;';
        shell.appendChild(scroller);
        pip.document.body.style.margin = '0';
        pip.document.body.appendChild(shell);

        // Move the live element.
        const placeholder = document.createElement('div');
        placeholder.className = 'popup-detach-placeholder';
        placeholder.textContent = opts.placeholderText || 'Showing in the detached window';
        placeholder.style.cssText = 'padding:2rem;text-align:center;opacity:.6;';
        contentEl.parentNode.insertBefore(placeholder, contentEl);
        scroller.appendChild(contentEl);

        state[key] = { pip, contentEl, placeholder, scroller };
        if (opts.onDetached) opts.onDetached(pip, scroller);

        // Escape closes the PiP window; closing it (any way) re-attaches.
        pip.document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pip.close(); });
        pip.addEventListener('pagehide', () => reattach(key));
        return true;
    }

    function reattach(key) {
        const cur = state[key];
        if (!cur) return;
        const { pip, contentEl, placeholder } = cur;
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.replaceChild(contentEl, placeholder);
        }
        delete state[key];
        if (pip && !pip.closed) { try { pip.close(); } catch (e) { /* already closing */ } }
        if (cur.onReattached) cur.onReattached();
    }

    function isDetached(key) {
        const cur = state[key];
        return !!(cur && cur.pip && !cur.pip.closed);
    }

    // The scroll container the display code should target while detached
    // (karaoke-display / chord-display look for the popup content element;
    // we expose the PiP scroller under the same role).
    function scrollerFor(key) {
        const cur = state[key];
        return cur ? cur.scroller : null;
    }

    function mountButton(hostSelector, key, opts) {
        const host = document.querySelector(hostSelector);
        if (!host || host.querySelector('.popup-detach-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'popup-detach-btn';
        btn.type = 'button';
        btn.title = supported
            ? 'Open in a separate always-on-top window (drag it to your stage screen)'
            : 'Detached window requires Chrome or Edge 116+';
        btn.innerHTML = '<i class="fas fa-external-link-alt"></i><span>Detach</span>';
        btn.disabled = !supported;
        btn.addEventListener('click', () => detach(key, opts));
        host.insertBefore(btn, host.firstChild.nextSibling || null);
    }

    window.PopupDetach = { detach, reattach, isDetached, scrollerFor, mountButton, supported };
})();
