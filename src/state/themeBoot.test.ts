import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { DATA_THEMES, LAST_SYSTEM_PAIR_KEY, LAST_THEME_KEY, applyTheme, rememberAppliedTheme } from "./theme";

const BOOT = readFileSync(new URL("../../public/theme-boot.js", import.meta.url), "utf8");

/** Run public/theme-boot.js against stored keys and an OS appearance; answer
 * the theme it set. */
function bootWith(
  stored: Record<string, string | null>,
  { osDark = false, storage = "ok" }: { osDark?: boolean; storage?: "ok" | "throws" } = {},
): string {
  const attributes = new Map([["data-theme", "light"]]);
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
  };
  runInNewContext(BOOT, { window: fakeWindow, document: fakeDocument });
  return attributes.get("data-theme")!;
}
const last = (theme: string | null) => ({ [LAST_THEME_KEY]: theme });

test("the pre-paint script reads the keys the app writes", () => {
  expect(BOOT).toContain(`"${LAST_THEME_KEY}"`);
  expect(BOOT).toContain(`"${LAST_SYSTEM_PAIR_KEY}"`);
});

test("the pre-paint script restores every theme there is, and nothing else", () => {
  for (const theme of DATA_THEMES) expect(bootWith(last(theme))).toBe(theme);
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
