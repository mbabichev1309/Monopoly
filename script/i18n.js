const I18N = (() => {
    const AVAILABLE = ["ru-RU", "en-EN", "ua-UA", "pl-PL"];
    const DEFAULT_LANG = "ru-RU";

    let currentLang = localStorage.getItem("locale") || DEFAULT_LANG;
    if (!AVAILABLE.includes(currentLang)) currentLang = DEFAULT_LANG;

    const cache = {};

    async function load(scope) {
        const key = `${currentLang}/${scope}`;
        if (cache[key]) return cache[key];
        try {
            const r = await fetch(`/locales/${currentLang}/${scope}.json`);
            const data = await r.json();
            cache[key] = data;
            return data;
        } catch (e) {
            console.warn(`[i18n] failed to load ${key}`, e);
            return {};
        }
    }

    function t(key, params, dict) {
        const map = dict || cache[`${currentLang}/lobby`] || cache[`${currentLang}/game`] || {};
        let s = map[key];
        if (s === undefined) return key;
        if (params) {
            for (const k in params) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), params[k]);
        }
        return s;
    }

    function applyTranslations(rootEl = document, dict) {
        const map = dict || cache[`${currentLang}/lobby`] || cache[`${currentLang}/game`] || {};
        rootEl.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            if (map[key] !== undefined) el.textContent = map[key];
        });
        rootEl.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
            const key = el.getAttribute("data-i18n-placeholder");
            if (map[key] !== undefined) el.placeholder = map[key];
        });
        rootEl.querySelectorAll("[data-i18n-title]").forEach((el) => {
            const key = el.getAttribute("data-i18n-title");
            if (map[key] !== undefined) el.title = map[key];
        });
    }

    function getLang() { return currentLang; }
    function setLang(lang) {
        if (!AVAILABLE.includes(lang)) return;
        currentLang = lang;
        localStorage.setItem("locale", lang);
    }
    function languages() { return AVAILABLE.slice(); }

    return { load, t, applyTranslations, getLang, setLang, languages };
})();
window.I18N = I18N;
