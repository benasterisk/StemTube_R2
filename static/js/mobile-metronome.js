/**
 * Mobile metronome control — the POC engine's server-rendered metronome on the
 * mobile PWA. Replaces the JamMetronome widget (client-synthesized clicks and
 * count-in, the pre-rewrite design) with the same model as the desktop mixer:
 * the metronome is a sample-locked WAV STEM played by the engine, the count-in
 * is a baked WAV lead-in, the timbre is rendered server-side.
 *
 * Mounts into every `.mobile-metronome-container` (mixer + practice tabs):
 *   - a beat dot pulsing on the REAL beats of the song (meta.beats/positions),
 *     read from the engine clock (accent on downbeats)
 *   - tap = toggle the metronome stem's mute
 *   - long-press / gear = popover: volume, timbre (8 sounds), resolution
 *     (½× / 1× / 2×), count-in (off/2/4/8), metronome stop marker at
 *     playhead, loop A/B at playhead
 * All actions go through window.MobilePOC and the /poc-mixer routes.
 */
(function () {
    'use strict';

    const B = () => window.MobilePOC;
    let containers = [];
    let dots = [];
    let popover = null;
    let beatTimer = null;
    let lastBeatIdx = -1;
    let instCatalogue = null;

    function meta() { const b = B(); return b && b.meta; }
    function stem() { const b = B(); return b && b.stems && b.stems.metronome; }

    // ── beat dot ─────────────────────────────────────────────────────

    function findBeatIdx(beats, t) {
        let lo = 0, hi = beats.length - 1, best = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
        return best;
    }

    function beatTick() {
        const b = B(); const m = meta();
        if (!b || !m || !m.beats || !m.beats.length) return;
        const t = b.pos();
        const idx = findBeatIdx(m.beats, t);
        if (idx === lastBeatIdx) return;
        lastBeatIdx = idx;
        if (idx < 0) return;
        const down = m.positions && m.positions[idx] === 1;
        dots.forEach((d) => {
            d.classList.remove('metronome-dot-beat', 'metronome-dot-down');
            void d.offsetWidth;
            d.classList.add(down ? 'metronome-dot-down' : 'metronome-dot-beat');
        });
    }

    function syncMuteState() {
        const s = stem();
        const on = !!(s && !s.muted);
        containers.forEach((c) => c.classList.toggle('metronome-on', on));
    }

    // ── popover ──────────────────────────────────────────────────────

    function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    async function ensureCatalogue() {
        if (instCatalogue) return instCatalogue;
        try { instCatalogue = await API.metroInstruments(); } catch (e) { instCatalogue = { instruments: [{ id: 'click', label: 'Click' }], default: 'click' }; }
        return instCatalogue;
    }

    async function buildPopover(anchor) {
        closePopover();
        const b = B(); const m = meta(); if (!b || !m) return;
        const cat = await ensureCatalogue();
        popover = el('div', 'metronome-precount-popover mobile-metro-popover');

        // Volume
        const volRow = el('div', 'mobile-metro-row');
        volRow.append(el('span', 'mobile-metro-label', 'Volume'));
        const vol = el('input', 'metronome-volume-slider'); vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05';
        vol.value = String((stem() && stem().vol) != null ? stem().vol : 1);
        vol.oninput = () => b.setVol('metronome', parseFloat(vol.value));
        volRow.append(vol);
        popover.append(volRow);

        // Timbre
        const instRow = el('div', 'mobile-metro-row');
        instRow.append(el('span', 'mobile-metro-label', 'Sound'));
        const sel = el('select', 'mobile-metro-select');
        const cur = m.metro_instrument || cat.default || 'click';
        (cat.instruments || []).forEach((it) => { const o = el('option', null, it.label); o.value = it.id; if (it.id === cur) o.selected = true; sel.append(o); });
        sel.onchange = async () => {
            const instrument = sel.value; sel.disabled = true;
            try {
                const r = await API.setMetroInstrument(b.job, instrument);
                if (r && r.error) throw new Error(r.error);
                m.metro_instrument = r.instrument || instrument;
                const tag = 'inst-' + (r.instrument || instrument);
                await b.engine.reloadMetroBuffers(b.job, r.metronome_resolutions || m.metronome_resolutions, tag);
                if (r.precount && window.PreCount && PreCount.applyServerPlan) await PreCount.applyServerPlan(r.precount, tag);
            } catch (e) { console.warn('[MobileMetro] set instrument failed:', e); sel.value = cur; }
            sel.disabled = false;
        };
        instRow.append(sel);
        popover.append(instRow);

        // Resolution
        const resRow = el('div', 'mobile-metro-row');
        resRow.append(el('span', 'mobile-metro-label', 'Click'));
        const resWrap = el('div', 'mobile-metro-seg');
        [['0.5', '½×'], ['1', '1×'], ['2', '2×']].forEach(([v, label]) => {
            const btn = el('button', 'mobile-metro-seg-btn' + ((b.engine.metroRes || '1') === v ? ' on' : ''), label);
            btn.type = 'button';
            btn.onclick = () => { b.setMetroResolution(v); resWrap.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn)); };
            resWrap.append(btn);
        });
        resRow.append(resWrap);
        popover.append(resRow);

        // Count-in
        const pcRow = el('div', 'mobile-metro-row');
        pcRow.append(el('span', 'mobile-metro-label', 'Count-in'));
        const pcWrap = el('div', 'mobile-metro-seg');
        [0, 2, 4, 8].forEach((n) => {
            const btn = el('button', 'mobile-metro-seg-btn' + (b.precountBeats === n ? ' on' : ''), n === 0 ? 'Off' : String(n));
            btn.type = 'button';
            btn.onclick = () => { b.setPrecountBeats(n); pcWrap.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn)); };
            pcWrap.append(btn);
        });
        pcRow.append(pcWrap);
        popover.append(pcRow);

        // Stop marker + Loop
        const actRow = el('div', 'mobile-metro-row mobile-metro-actions');
        const stopBtn = el('button', 'mobile-metro-action', (window.PreCount && PreCount.stopTime != null) ? 'Clear metronome stop' : 'Metronome stop here');
        stopBtn.type = 'button';
        stopBtn.onclick = async () => { if (window.PreCount && PreCount.toggleStopAtPlayhead) { await PreCount.toggleStopAtPlayhead(); stopBtn.textContent = (PreCount.stopTime != null) ? 'Clear metronome stop' : 'Metronome stop here'; } };
        const loopA = el('button', 'mobile-metro-action', 'Loop A'); loopA.type = 'button';
        const loopB = el('button', 'mobile-metro-action', 'Loop B'); loopB.type = 'button';
        const loopOff = el('button', 'mobile-metro-action', 'Loop off'); loopOff.type = 'button';
        let a = null, bb = null;
        loopA.onclick = () => { a = b.pos(); loopA.textContent = 'A ' + a.toFixed(1) + 's'; if (bb != null && bb > a) b.setLoop(a, bb, true); };
        loopB.onclick = () => { bb = b.pos(); loopB.textContent = 'B ' + bb.toFixed(1) + 's'; if (a != null && bb > a) b.setLoop(a, bb, true); };
        loopOff.onclick = () => { a = bb = null; loopA.textContent = 'Loop A'; loopB.textContent = 'Loop B'; b.setLoop(0, 0, false); };
        actRow.append(stopBtn, loopA, loopB, loopOff);
        popover.append(actRow);

        document.body.appendChild(popover);
        // position under the anchor, clamped to the viewport
        const r = anchor.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.top = Math.min(window.innerHeight - popover.offsetHeight - 8, r.bottom + 6) + 'px';
        popover.style.left = Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, r.left)) + 'px';
        popover.style.zIndex = '2000';
        setTimeout(() => document.addEventListener('pointerdown', onOutside, { capture: true }), 0);
    }

    function onOutside(e) { if (popover && !popover.contains(e.target)) closePopover(); }
    function closePopover() {
        if (!popover) return;
        document.removeEventListener('pointerdown', onOutside, { capture: true });
        popover.remove(); popover = null;
    }

    // ── mount ────────────────────────────────────────────────────────

    function mount() {
        containers = [...document.querySelectorAll('.mobile-metronome-container')];
        dots = [];
        containers.forEach((c) => {
            if (c.dataset.pocMounted) { dots.push(c.querySelector('.metronome-dot')); return; }
            c.dataset.pocMounted = '1';
            c.innerHTML = '';
            const dot = el('span', 'metronome-dot');
            const gear = el('button', 'mobile-metro-gear', '⚙'); gear.type = 'button'; gear.title = 'Metronome settings';
            c.append(dot, gear);
            dots.push(dot);
            let pressTimer = null;
            dot.addEventListener('pointerdown', () => { pressTimer = setTimeout(() => { pressTimer = null; buildPopover(dot); }, 450); });
            dot.addEventListener('pointerup', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; const s = stem(); if (s && B()) { B().setMute('metronome', !s.muted); syncMuteState(); } } });
            dot.addEventListener('pointerleave', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
            gear.addEventListener('click', () => buildPopover(gear));
        });
        syncMuteState();
        if (!beatTimer) beatTimer = setInterval(beatTick, 40);
    }

    // Re-mount when the app (re)loads a song (containers exist from the start; the
    // stem appears after loadAll). Cheap to poll.
    setInterval(() => { if (B() && B().meta) { mount(); syncMuteState(); } }, 1000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

    window.MobileMetronome = { mount, closePopover };
})();
