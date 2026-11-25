import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { THEME_SHEET_LINE, customThemeCss } from "../brand/customThemeSheet";
import { accentVariants } from "../brand/themeEngine/accents";
import { appliedTokenNames, appliedTokens } from "../brand/themeEngine/derive";
import goldens from "../brand/themeEngine/goldens.json";
import { MODES } from "../brand/themeEngine/policy";
import { resolveSeeds } from "../brand/themeEngine/resolve";
import {
  CUSTOM_THEME_BOOT_KEY,
  DATA_THEMES,
  LAST_SYSTEM_PAIR_KEY,
  LAST_THEME_KEY,
  applyTheme,
  isDarkDataTheme,
  readThemeSignature,
  rememberAppliedTheme,
  setCustomThemeTarget,
} from "./theme";

const BOOT = readFileSync(new URL("../../public/theme-boot.js", import.meta.url), "utf8");

/** Run public/theme-boot.js against stored keys and an OS appearance; answer
 * the theme it set. */
function bootWith(
  stored: Record<string, string | null>,
  { osDark = false, storage = "ok" }: { osDark?: boolean; storage?: "ok" | "throws" } = {},
): string {
  return bootDom(stored, { osDark, storage }).attributes.get("data-theme")!;
}

/** The same, answering every attribute it set and any sheet it painted (as a
 * `<style>`: the fake has no constructed stylesheets). */
function bootDom(
  stored: Record<string, string | null>,
  { osDark = false, storage = "ok" }: { osDark?: boolean; storage?: "ok" | "throws" } = {},
): { attributes: Map<string, string>; styles: string[] } {
  const attributes = new Map([["data-theme", "light"]]);
  const styles: string[] = [];
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => {
        if (storage === "throws") throw new Error("SecurityError");
        return stored[key] ?? null;
      },
    },
    matchMedia: (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && osDark }),
  };
  const fakeDocument = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (node: { textContent: string }) => styles.push(node.textContent) },
  };
  runInNewContext(BOOT, { window: fakeWindow, document: fakeDocument });
  return { attributes, styles };
}

/** A real custom sheet, from the engine, for the forest-paper fixture. */
function forestSheet(): string {
  const resolved = resolveSeeds(goldens.named["forest-paper"].seeds)!;
  const modes = Object.fromEntries(
    MODES.map((mode) => {
      const tokens = appliedTokens(resolved[mode].tokens);
      return [
        mode,
        { tokens, variants: accentVariants(mode, resolved[mode].seeds, tokens, "standard", 210) },
      ];
    }),
  ) as Parameters<typeof customThemeCss>[0]["modes"];
  return customThemeCss({ modes });
}
const customBoot = (theme: string, css = forestSheet(), extra: Record<string, unknown> = {}) => ({
  [LAST_THEME_KEY]: theme,
  [CUSTOM_THEME_BOOT_KEY]: JSON.stringify({
    id: "forest-paper",
    base: ["grove-light", "grove-dark"],
    css,
    ...extra,
  }),
});
const last = (theme: string | null) => ({ [LAST_THEME_KEY]: theme });

test("the pre-paint script reads the keys the app writes", () => {
  expect(BOOT).toContain(`"${LAST_THEME_KEY}"`);
  expect(BOOT).toContain(`"${LAST_SYSTEM_PAIR_KEY}"`);
});

test("the pre-paint script restores every theme there is, and nothing else", () => {
  for (const theme of DATA_THEMES)
    expect(bootWith(theme.startsWith("custom-") ? customBoot(theme) : last(theme))).toBe(theme);
  for (const bad of ["", "ocean", "warm", "dark ", "midnight-dim", "light;x", '"><script>', "DARK"])
    expect(bootWith(last(bad))).toBe("light");
  expect(bootWith(last(null))).toBe("light");
  // storage that refuses (a locked-down browser) keeps the default, never throws
  expect(bootWith(last("dark"), { storage: "throws" })).toBe("light");
});

test("with the System setting, today's OS appearance picks from the remembered pair", () => {
  // applied dark last time, but the Mac is in light mode now: paint light
  const system = { [LAST_THEME_KEY]: "ocean-dark", [LAST_SYSTEM_PAIR_KEY]: "ocean-light ocean-dark" };
  expect(bootWith(system, { osDark: false })).toBe("ocean-light");
  expect(bootWith(system, { osDark: true })).toBe("ocean-dark");
  // a pair that isn't two themes is ignored for the plain remembered theme
  for (const bad of ["ocean-light", "ocean-light ocean-dark extra", "ocean-light nope", ""])
    expect(bootWith({ [LAST_THEME_KEY]: "grove-dark", [LAST_SYSTEM_PAIR_KEY]: bad }, { osDark: false })).toBe(
      "grove-dark",
    );
});

const g = globalThis as unknown as { window: unknown; document: unknown };
const realWindow = g.window;
const realDocument = g.document;

function fakeDom(osDark = false): { stored: Map<string, string>; html: { dataset: Record<string, string> } } {
  const stored = new Map<string, string>();
  const html = { dataset: { theme: "light" } as Record<string, string> };
  g.window = {
    localStorage: {
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
    matchMedia: () => ({ matches: osDark, addEventListener() {}, removeEventListener() {} }),
  };
  g.document = { documentElement: html };
  return { stored, html };
}

afterEach(() => {
  rememberAppliedTheme(false);
  g.window = realWindow;
  g.document = realDocument;
});

test("the app remembers the theme it applies only where settings are durable", () => {
  const { stored, html } = fakeDom();
  // the in-memory twin: applying a theme leaves no launch cache behind
  applyTheme("dark", "ocean");
  expect(html.dataset.theme).toBe("ocean-dark");
  expect(stored.size).toBe(0);
  // durable settings: turning it on writes nothing by itself (the app's first
  // applyTheme comes right after); every apply from then on is remembered
  rememberAppliedTheme(true);
  expect(stored.size).toBe(0);
  applyTheme("light", "grove");
  expect(stored.get(LAST_THEME_KEY)).toBe("grove-light");
  expect(stored.has(LAST_SYSTEM_PAIR_KEY)).toBe(false);
});

test("the System setting also leaves its pair, and leaving System clears it", () => {
  const { stored } = fakeDom(true);
  rememberAppliedTheme(true);
  applyTheme("system", "midnight");
  expect(stored.get(LAST_THEME_KEY)).toBe("midnight-dark");
  expect(stored.get(LAST_SYSTEM_PAIR_KEY)).toBe("midnight-light midnight-dark");
  applyTheme("light", "midnight");
  expect(stored.has(LAST_SYSTEM_PAIR_KEY)).toBe(false);
});

test("the pre-paint script knows exactly the engine's roles and the sheet's grammar", () => {
  const roles = [...(/var ROLES = \[([\s\S]*?)\];/.exec(BOOT)?.[1] ?? "").matchAll(/"(--[a-z0-9-]+)"/g)].map(
    (m) => m[1],
  );
  expect(roles).toEqual(appliedTokenNames());
  expect(/var SHEET_LINE =\s*\/(.*)\/;/.exec(BOOT)?.[1]).toBe(THEME_SHEET_LINE.source);
  for (const line of forestSheet().split("\n")) expect(THEME_SHEET_LINE.test(line)).toBe(true);
});

test("a custom theme repaints from its cached sheet before first paint", () => {
  const css = forestSheet();
  const { attributes, styles } = bootDom(customBoot("custom-dark", css));
  expect(attributes.get("data-theme")).toBe("custom-dark");
  expect(attributes.get("data-theme-id")).toBe("forest-paper");
  expect(styles).toEqual([css]);
});

test("a cached sheet that doesn't check out paints the base family instead", () => {
  const css = forestSheet();
  const firstLine = css.split("\n")[0]!;
  const hostile = [
    css.replace(";", "; } body { display: none;"), // breaks out of the rule
    css.replace("--ground:", "--background-image:"), // a role the engine never paints
    css.replace(/: (#[0-9a-f]{6});/, ": url(https://example.com/x);"), // not a colour
    `${css}\n@import url(https://example.com/x.css);`,
    firstLine.replace("custom-light", "paper"), // not a custom scope
    "",
  ];
  for (const bad of hostile) {
    const { attributes, styles } = bootDom(customBoot("custom-light", bad));
    expect([attributes.get("data-theme"), attributes.has("data-theme-id"), styles]).toEqual([
      "grove-light",
      false,
      [],
    ]);
  }
  // a bad id, or a base that is not a built-in, falls back further: light
  expect(bootWith(customBoot("custom-light", css, { id: "../x" }))).toBe("grove-light");
  expect(bootWith(customBoot("custom-dark", "", { base: ["custom-light", "custom-dark"] }))).toBe("light");
  expect(bootWith({ [LAST_THEME_KEY]: "custom-dark", [CUSTOM_THEME_BOOT_KEY]: "{not json" })).toBe("light");
  expect(bootWith(last("custom-light"))).toBe("light");
});

test("applying a custom theme leaves its sheet and base for the next launch, and leaving it clears them", () => {
  const { stored, html } = fakeDom(true);
  rememberAppliedTheme(true);
  const css = forestSheet();
  setCustomThemeTarget({ id: "forest-paper", rev: 3, css, remembered: true });
  try {
    applyTheme("system", "grove");
    expect(html.dataset).toMatchObject({ theme: "custom-dark", themeId: "forest-paper", themeRev: "3" });
    expect(stored.get(LAST_SYSTEM_PAIR_KEY)).toBe("custom-light custom-dark");
    expect(JSON.parse(stored.get(CUSTOM_THEME_BOOT_KEY)!)).toEqual({
      id: "forest-paper",
      base: ["grove-light", "grove-dark"],
      css,
    });
    // and the script reads back what the app wrote
    expect(bootWith(Object.fromEntries(stored), { osDark: false })).toBe("custom-light");
  } finally {
    setCustomThemeTarget(null);
  }
  applyTheme("light", "grove");
  expect(html.dataset.theme).toBe("grove-light");
  expect(html.dataset.themeId).toBeUndefined();
  expect(stored.has(CUSTOM_THEME_BOOT_KEY)).toBe(false);
});

test("a theme that won't outlast a reload is painted but not remembered: the next launch paints the family", () => {
  const { stored, html } = fakeDom();
  rememberAppliedTheme(true);
  setCustomThemeTarget({ id: "forest-paper", rev: 1, css: forestSheet(), remembered: false });
  try {
    applyTheme("light", "grove");
    expect(html.dataset.theme).toBe("custom-light");
    expect(stored.get(LAST_THEME_KEY)).toBe("grove-light");
    expect(stored.has(CUSTOM_THEME_BOOT_KEY)).toBe(false);
  } finally {
    setCustomThemeTarget(null);
  }
});

test("the theme signature moves when one custom theme replaces another under the same data-theme", () => {
  const { html } = fakeDom();
  html.dataset.theme = "ocean-dark";
  expect(readThemeSignature()).toBe("ocean-dark");
  setCustomThemeTarget({ id: "forest-paper", rev: 3, css: forestSheet(), remembered: false });
  try {
    applyTheme("dark", "grove");
    expect(readThemeSignature()).toBe("custom-dark#3");
    setCustomThemeTarget({ id: "neon", rev: 4, css: forestSheet(), remembered: false });
    applyTheme("dark", "grove");
    expect(readThemeSignature()).toBe("custom-dark#4");
    expect(isDarkDataTheme("custom-dark")).toBe(true);
    expect(isDarkDataTheme("custom-light")).toBe(false);
  } finally {
    setCustomThemeTarget(null);
  }
});
