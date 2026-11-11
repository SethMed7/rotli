// Runs before the first paint (a classic script in index.html's <head>): the
// theme the last launch applied replaces index.html's light default, so a
// dark-theme window doesn't show a light ground while settings load. With the
// System setting, the last launch also left its light and dark pair, and the
// OS appearance picks between them now (it may have changed since). The app
// writes both keys (src/state/theme.ts) and applies the real setting on its
// first render. Unknown values are ignored; the pattern is pinned to
// DATA_THEMES by src/state/themeBoot.test.ts.
(function () {
  var THEME = /^(light|dark|paper|charcoal|(ocean|grove|iris|blossom|midnight)-(light|dark))$/;
  try {
    var theme = window.localStorage.getItem("rotli.lastDataTheme");
    var pair = (window.localStorage.getItem("rotli.lastSystemThemes") || "").split(" ");
    if (pair.length === 2 && THEME.test(pair[0]) && THEME.test(pair[1])) {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      theme = dark ? pair[1] : pair[0];
    }
    if (theme && THEME.test(theme)) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (_) {
    // storage unavailable: keep the light default
  }
})();
