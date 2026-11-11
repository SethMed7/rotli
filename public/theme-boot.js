// Runs before the first paint (a classic script in index.html's <head>): the
// theme the last launch applied replaces index.html's light default, so a
// dark-theme window doesn't show a light ground while settings load. The app
// writes the key (src/state/theme.ts LAST_THEME_KEY) and applies the real
// setting on its first render. Unknown values are ignored; the pattern is
// pinned to DATA_THEMES by src/state/theme.test.ts.
(function () {
  try {
    var theme = window.localStorage.getItem("rotli.lastDataTheme");
    if (theme && /^(light|dark|paper|charcoal|(ocean|grove|iris|blossom|midnight)-(light|dark))$/.test(theme)) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (_) {
    // storage unavailable: keep the light default
  }
})();
