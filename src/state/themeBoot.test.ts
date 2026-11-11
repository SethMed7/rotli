import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DATA_THEMES, LAST_THEME_KEY, applyTheme, rememberAppliedTheme } from "./theme";

const BOOT = readFileSync(new URL("../../public/theme-boot.js", import.meta.url), "utf8");

/** Run public/theme-boot.js against a stored value; answer the theme it set. */
function bootWith(stored: string | null, storage: "ok" | "throws" = "ok"): string {
  const attributes = new Map([["data-theme", "light"]]);
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => {
        if (storage === "throws") throw new Error("SecurityError");
        return key === LAST_THEME_KEY ? stored : null;
      },
    },
  };
  const fakeDocument = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
  };
  new Function("window", "document", BOOT)(fakeWindow, fakeDocument);
  return attributes.get("data-theme")!;
}

test("the pre-paint script reads the key the app writes", () => {
  expect(BOOT).toContain(`"${LAST_THEME_KEY}"`);
});

test("the pre-paint script restores every theme there is, and nothing else", () => {
  for (const theme of DATA_THEMES) expect(bootWith(theme)).toBe(theme);
  for (const bad of ["", "ocean", "warm", "dark ", "midnight-dim", "light;x", '"><script>', "DARK"])
    expect(bootWith(bad)).toBe("light");
  expect(bootWith(null)).toBe("light");
  // storage that refuses (a locked-down browser) keeps the default, never throws
  expect(bootWith("dark", "throws")).toBe("light");
});

const g = globalThis as unknown as { window: unknown; document: unknown };
const realWindow = g.window;
const realDocument = g.document;

function fakeDom(): { stored: Map<string, string>; html: { dataset: Record<string, string> } } {
  const stored = new Map<string, string>();
  const html = { dataset: { theme: "light" } as Record<string, string> };
  g.window = {
    localStorage: { setItem: (key: string, value: string) => stored.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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
  // durable settings: the hydrated theme is written at once, and every change after
  rememberAppliedTheme(true);
  expect(stored.get(LAST_THEME_KEY)).toBe("ocean-dark");
  applyTheme("light", "grove");
  expect(stored.get(LAST_THEME_KEY)).toBe("grove-light");
});
