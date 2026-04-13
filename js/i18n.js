// ── i18n language switching ──────────────────────────────────────
(function () {
    const LANG_LABELS = { en: 'EN', fr: 'FR', es: 'ES', de: 'DE', pt: 'PT', it: 'IT', nl: 'NL', sv: 'SV', pl: 'PL', ru: 'RU', uk: 'UK', tr: 'TR', ar: 'AR', hi: 'HI', zh: 'ZH', ja: 'JA', ko: 'KO', th: 'TH', vi: 'VI', id: 'ID' };
    const RTL_LANGS = ['ar'];
    let currentLang = localStorage.getItem('stemtube_lang') || navigator.language.slice(0, 2) || 'en';
    if (!LANG_LABELS[currentLang]) currentLang = 'en';

    async function loadTranslations(lang) {
        try {
            const resp = await fetch(`lang/${lang}.json`);
            if (!resp.ok) throw new Error(resp.status);
            return await resp.json();
        } catch {
            if (lang !== 'en') return loadTranslations('en');
            return {};
        }
    }

    function applyTranslations(translations) {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (translations[key]) el.textContent = translations[key];
        });
        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            if (translations[key]) el.innerHTML = translations[key];
        });
    }

    function setDirection(lang) {
        if (RTL_LANGS.includes(lang)) {
            document.documentElement.setAttribute('dir', 'rtl');
            document.documentElement.setAttribute('lang', lang);
        } else {
            document.documentElement.removeAttribute('dir');
            document.documentElement.setAttribute('lang', lang);
        }
    }

    async function switchLang(lang) {
        currentLang = lang;
        localStorage.setItem('stemtube_lang', lang);
        const label = document.getElementById('lang-label');
        if (label) label.textContent = LANG_LABELS[lang] || lang.toUpperCase();
        setDirection(lang);
        const translations = await loadTranslations(lang);
        applyTranslations(translations);
        // Mark active in dropdown
        document.querySelectorAll('.lang-dropdown a').forEach(a => {
            a.classList.toggle('active', a.dataset.lang === lang);
        });
    }

    // Language switcher toggle
    const btn = document.querySelector('.lang-current');
    const dropdown = document.querySelector('.lang-dropdown');
    if (btn && dropdown) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });
        document.addEventListener('click', () => dropdown.classList.remove('open'));
        dropdown.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                switchLang(a.dataset.lang);
                dropdown.classList.remove('open');
            });
        });
    }

    // Apply on load (skip if English — HTML is already in English)
    if (currentLang !== 'en') {
        switchLang(currentLang);
    } else {
        const label = document.getElementById('lang-label');
        if (label) label.textContent = 'EN';
        document.querySelectorAll('.lang-dropdown a').forEach(a => {
            a.classList.toggle('active', a.dataset.lang === 'en');
        });
    }
})();
