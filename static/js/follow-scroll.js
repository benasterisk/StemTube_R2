/**
 * FollowScroll - lets the user scroll a "follow the song" container by hand.
 *
 * Lyrics and chord views keep the current line / bar in view while the song plays,
 * which made manual scrolling impossible: every sync snapped the view back. This
 * helper pauses that auto-follow as soon as the user scrolls (wheel, touch, scrollbar)
 * and overlays a "back to now" button that resumes it.
 *
 * Usage (both desktop mixer and mobile app):
 *   FollowScroll.scroll(container, top)          // instead of container.scrollTop = top
 *   FollowScroll.scroll(container, top, 'smooth') // instead of container.scrollTo({top, behavior})
 *   FollowScroll.isPaused(container)             // true while the user is browsing
 *   FollowScroll.resume(container)               // programmatic "back to now"
 * The first call attaches the listeners and the button to the container.
 */
(function () {
    // Scroll events this soon after our own scroll are ours (a smooth scroll keeps
    // firing them for up to a second on a long jump).
    const OWN_WINDOW_MS = { instant: 400, smooth: 1500 };

    function attach(container) {
        if (container.__follow) return container.__follow;
        const state = { paused: false, ownUntil: 0, button: null, onResume: null };
        container.__follow = state;

        const pause = () => {
            if (state.paused) return;
            state.paused = true;
            showButton(container, state);
        };
        // Pointer-driven scrolling
        container.addEventListener('wheel', pause, { passive: true });
        container.addEventListener('touchmove', pause, { passive: true });
        // Scrollbar drags and keyboard scrolling only show up as scroll events: treat
        // any scroll we did not just trigger ourselves as the user's.
        container.addEventListener('scroll', () => {
            if (performance.now() > state.ownUntil) pause();
        }, { passive: true });
        return state;
    }

    function showButton(container, state) {
        if (state.button) { state.button.hidden = false; return; }
        const host = container.parentElement || container;
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'follow-scroll-btn';
        btn.title = 'Back to the current position';
        btn.setAttribute('aria-label', 'Back to the current position');
        btn.innerHTML = '<i class="fas fa-location-crosshairs"></i><span>Now</span>';
        btn.addEventListener('click', (e) => { e.stopPropagation(); resume(container); });
        host.appendChild(btn);
        state.button = btn;
    }

    function resume(container) {
        const state = container.__follow;
        if (!state) return;
        state.paused = false;
        if (state.button) state.button.hidden = true;
        if (typeof state.onResume === 'function') {
            try { state.onResume(); } catch (e) { /* view-specific */ }
        }
    }

    // Auto-follow scroll: a no-op while the user is browsing. Returns true if scrolled.
    function scroll(container, top, behavior) {
        if (!container) return false;
        const state = attach(container);
        if (state.paused) return false;
        state.ownUntil = performance.now() + (behavior === 'smooth' ? OWN_WINDOW_MS.smooth : OWN_WINDOW_MS.instant);
        if (behavior === 'smooth') container.scrollTo({ top, behavior: 'smooth' });
        else container.scrollTop = top;
        return true;
    }

    function isPaused(container) {
        return !!(container && container.__follow && container.__follow.paused);
    }

    // What "back to now" should do for this container (re-sync the view immediately).
    function onResume(container, fn) {
        attach(container).onResume = fn;
    }

    window.FollowScroll = { scroll, resume, isPaused, onResume, attach };
})();
