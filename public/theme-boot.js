// Runs before the first paint (a classic script in index.html's <head>): the
// theme the last launch applied replaces index.html's light default, so a
// dark-theme window doesn't show a light ground while settings load. With the
// System setting, the last launch also left its light and dark pair, and the
// OS appearance picks between them now (it may have changed since). The app
// writes these keys (src/state/theme.ts) and applies the real setting on its
// first render. Unknown values are ignored; the patterns are pinned to
// DATA_THEMES, the custom sheet's grammar and the engine's roles by
// src/state/themeBoot.test.ts.
//
// A custom theme repaints from the sheet the last launch cached, and only if
// every line matches the sheet grammar and every role is on the list below.
// Anything else paints the theme's base family instead.
(function () {
  var THEME = /^(light|dark|paper|charcoal|(ocean|grove|iris|blossom|midnight|tesven|custom)-(light|dark))$/;
  var BUILT_IN = /^(light|dark|paper|charcoal|(ocean|grove|iris|blossom|midnight|tesven)-(light|dark))$/;
  var THEME_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
  var SHEET_LINE =
    /^:root\[data-theme="custom-(light|dark)"\]\[data-theme-id\](\[data-accent="(blue|green|violet|rose|amber|custom)"\]|:not\(\[data-syntax-palette="mono"\]\))? \{( --[a-z0-9-]+: (#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\));)+ \}$/;
  var ROLES = [
    "--ground", "--surface", "--surface-2", "--tint", "--text", "--text-muted", "--border", "--accent",
    "--theme-accent-swatch", "--accent-text", "--on-accent", "--theme-on-accent", "--success", "--failure",
    "--syntax-blue", "--hov", "--act", "--scrim", "--quokka-line-auto", "--accent-swatch-blue",
    "--accent-swatch-green", "--accent-swatch-violet", "--accent-swatch-rose", "--accent-swatch-amber",
    "--accent-swatch-orange", "--accent-swatch-cyan", "--accent-swatch-brown", "--chat-welcome-morning",
    "--chat-welcome-morning-detail", "--chat-welcome-morning-ground", "--chat-welcome-noon",
    "--chat-welcome-noon-detail", "--chat-welcome-noon-ground", "--chat-welcome-afternoon",
    "--chat-welcome-afternoon-detail", "--chat-welcome-afternoon-ground", "--chat-welcome-evening",
    "--chat-welcome-evening-detail", "--chat-welcome-evening-ground"
  ];

  function sheetChecksOut(css) {
    if (typeof css !== "string" || css.length === 0 || css.length > 65536) return false;
    var lines = css.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (!SHEET_LINE.test(lines[i])) return false;
      var names = lines[i].match(/--[a-z0-9-]+(?=:)/g) || [];
      for (var j = 0; j < names.length; j++) if (ROLES.indexOf(names[j]) < 0) return false;
    }
    return true;
  }

  function paint(css) {
    var Sheet = window.CSSStyleSheet;
    if (document.adoptedStyleSheets && Sheet && Sheet.prototype && "replaceSync" in Sheet.prototype) {
      var sheet = new Sheet();
      sheet.replaceSync(css);
      sheet.rotliCustomTheme = true;
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
    } else {
      var style = document.createElement("style");
      style.id = "rotli-custom-theme";
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  try {
    var theme = window.localStorage.getItem("rotli.lastDataTheme");
    var pair = (window.localStorage.getItem("rotli.lastSystemThemes") || "").split(" ");
    if (pair.length === 2 && THEME.test(pair[0]) && THEME.test(pair[1])) {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      theme = dark ? pair[1] : pair[0];
    }
    if (theme && THEME.test(theme) && theme.indexOf("custom-") === 0) {
      var mode = theme === "custom-dark" ? 1 : 0;
      var cache = null;
      try {
        cache = JSON.parse(window.localStorage.getItem("rotli.customThemeBoot") || "null");
      } catch (_) {
        cache = null;
      }
      var base = cache && Object.prototype.toString.call(cache.base) === "[object Array]" ? cache.base[mode] : null;
      if (cache && typeof cache.id === "string" && THEME_ID.test(cache.id) && sheetChecksOut(cache.css)) {
        paint(cache.css);
        document.documentElement.setAttribute("data-theme-id", cache.id);
      } else {
        theme = typeof base === "string" && BUILT_IN.test(base) ? base : null;
      }
    }
    if (theme && THEME.test(theme)) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (_) {
    // storage unavailable: keep the light default
  }
})();
