// theme.js — theme switcher. One attribute flip on <body data-theme="…">
// restyles the whole app (every colour is a CSS variable; alternative themes
// override the same names on body[data-theme="…"] in index.html). The choice is
// remembered across reloads in localStorage, keyed "poc_theme" to match the
// "poc_*" convention used by state.js.
//
// Anti-FOUC: the chosen theme must be on <body> BEFORE first paint, so an inline
// bootstrap right after <body> calls Theme.applyStored() synchronously. This file
// then wires the swatch buttons once the DOM is ready.
const Theme = {
  KEY: "poc_theme",
  THEMES: ["poc", "dark", "cyberpunk", "neumorphic"],
  DEFAULT: "poc",

  // Read the saved theme, falling back to the default for missing/unknown values.
  stored(){
    let t;
    try { t = localStorage.getItem(this.KEY); } catch(e){ t = null; }
    return this.THEMES.includes(t) ? t : this.DEFAULT;
  },

  // Set the theme: flip the attribute, persist, and ring the active swatch.
  set(theme){
    if(!this.THEMES.includes(theme)) theme = this.DEFAULT;
    document.body.setAttribute("data-theme", theme);
    try { localStorage.setItem(this.KEY, theme); } catch(e){}
    this._ring(theme);
  },

  // Apply the stored theme to <body> without persisting (used by the bootstrap
  // before paint, and again on DOM-ready to be safe).
  applyStored(){
    const t = this.stored();
    document.body.setAttribute("data-theme", t);
    return t;
  },

  // Highlight whichever swatch matches the active theme.
  _ring(theme){
    document.querySelectorAll("#themeSwitch .swatch").forEach(b=>{
      b.classList.toggle("on", b.dataset.theme === theme);
    });
  },

  // Wire the swatch buttons; reflect the current theme's ring.
  init(){
    const active = document.body.getAttribute("data-theme") || this.applyStored();
    this._ring(active);
    const sw = document.getElementById("themeSwitch");
    if(sw){
      sw.addEventListener("click", e=>{
        const btn = e.target.closest(".swatch");
        if(btn && btn.dataset.theme) this.set(btn.dataset.theme);
      });
    }
  },
};

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ()=>Theme.init());
} else {
  Theme.init();
}
