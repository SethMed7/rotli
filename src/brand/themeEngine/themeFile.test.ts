import { expect, test } from "bun:test";

import { ENGINE_VERSION } from "./policy";
import { resolveSeeds } from "./resolve";
import {
  MAX_THEME_FILE_BYTES,
  type ThemeFileRead,
  canOverwrite,
  cleanThemeName,
  parseThemeFileText,
  readThemeFile,
  serializeThemeFile,
} from "./themeFile";

const forest = {
  rotliTheme: 1,
  id: "forest-paper",
  name: "Forest Paper",
  base: "grove",
  contrast: "standard",
  seeds: {
    light: { page: "#f6f1e7", accent: "#3f7d51" },
    dark: { page: "#101814", accent: "#82be96" },
  },
};

const ok = (read: ThemeFileRead) => {
  if (!read.ok) throw new Error(`expected a readable theme: ${read.problems.join(" ")}`);
  return read;
};

// the plan's sweep list, plus prototype-chain keys a naive reader would accept
const HOSTILE: unknown[] = [
  null,
  42,
  "theme",
  [],
  {},
  { rotliTheme: "1" },
  { rotliTheme: 1 },
  { rotliTheme: 1, seeds: 7 },
  { rotliTheme: 1, seeds: { light: { page: "red", accent: "#12" } } },
  { rotliTheme: 1, seeds: { light: { page: "#fff; } body { display:none", accent: "url(http://x)" } } },
  { rotliTheme: 1, seeds: { light: { page: "rgb(1,2,3)", accent: "oklch(50% 0.1 20)" } } },
  { rotliTheme: 1, name: "x".repeat(500), seeds: { dark: { page: "#101814", accent: "#82be96" } } },
  { rotliTheme: 9, seeds: { light: { page: "#f6f1e7", accent: "#3f7d51" } }, future: { anything: true } },
  {
    rotliTheme: 1,
    seeds: { light: { page: "#000000", accent: "#000000" }, dark: { page: "#ffffff", accent: "#ffffff" } },
  },
  { rotliTheme: 1, seeds: { light: { page: "#ff00ff", accent: "#00ff00", ink: "#ffff00" } } },
  JSON.parse(
    '{"rotliTheme":1,"contrast":"constructor","seeds":{"light":{"page":"#f6f1e7","accent":"#3f7d51"}}}',
  ),
  JSON.parse(
    '{"rotliTheme":1,"contrast":"__proto__","seeds":{"__proto__":{"light":{"page":"#f6f1e7","accent":"#3f7d51"}}}}',
  ),
  JSON.parse('{"rotliTheme":1.5,"seeds":{"light":{"page":"#f6f1e7","accent":"#3f7d51"}}}'),
];

test("malformed and hostile files never throw, and every usable one passes the gate", () => {
  let usable = 0;
  for (const raw of HOSTILE) {
    const read = readThemeFile(raw);
    if (!read.ok) {
      expect(read.problems.length).toBeGreaterThan(0);
      continue;
    }
    usable++;
    expect(read.theme.contrast).toMatch(/^(soft|standard|high)$/);
    expect(resolveSeeds(read.theme.seeds, read.theme.contrast)!.ok).toBe(true);
  }
  // the plan's 15 gave 11 refused and 4 usable; "constructor" reads as Standard,
  // a "__proto__" seeds key is data not a prototype, and 1.5 is no version
  expect(usable).toBe(5);
});

test("a string from a file is never a colour unless it parses as one", () => {
  const read = readThemeFile(HOSTILE[9]);
  expect(read.ok).toBe(false);
  if (!read.ok) expect(read.problems).toEqual(["The day half needs a page color and an accent, as #rrggbb."]);
});

test("names lose control characters and stop at 48 characters", () => {
  expect(cleanThemeName("Forest\u0000\u001b[31m Paper\u0085")).toBe("Forest[31m Paper");
  expect([...cleanThemeName("é".repeat(80))]).toHaveLength(48);
  expect(cleanThemeName(42)).toBe("");
  expect(ok(readThemeFile({ ...forest, name: "  \u0007 " })).theme.name).toBe("Untitled theme");
});

test("ids must be a filename stem, and base a plain word", () => {
  expect(ok(readThemeFile({ ...forest, id: "../etc/passwd" })).theme.id).toBeNull();
  expect(ok(readThemeFile({ ...forest, id: "Forest" })).theme.id).toBeNull();
  expect(ok(readThemeFile({ ...forest, id: "a".repeat(49) })).theme.id).toBeNull();
  expect(ok(readThemeFile({ ...forest, base: "<script>" })).theme.base).toBeNull();
  expect(ok(readThemeFile(forest)).theme).toMatchObject({ id: "forest-paper", base: "grove" });
});

test("one readable half is enough; the other is worked out and never written", () => {
  const read = ok(
    readThemeFile({ rotliTheme: 1, seeds: { light: forest.seeds.light, dark: { page: "blue" } } }),
  );
  expect(read.derived).toEqual(["dark"]);
  expect(read.problems).toEqual(["The night half needs a page color and an accent, as #rrggbb."]);
  const written = JSON.parse(serializeThemeFile(read.theme, read)!);
  // the unreadable half stays as the person wrote it, not stamped over
  expect(written.seeds.dark).toEqual({ page: "blue" });
});

test("an unreadable ink is reported and Rotli picks one", () => {
  const read = ok(
    readThemeFile({ rotliTheme: 1, seeds: { light: { ...forest.seeds.light, ink: "black" } } }),
  );
  expect(read.theme.seeds.light?.ink).toBeUndefined();
  expect(read.problems).toEqual(["The day half's ink color wasn't readable, so Rotli picked one."]);
});

test("a save keeps unknown fields at every depth", () => {
  const original = {
    ...forest,
    overrides: { card: "#ffffff" },
    shape: { radius: "soft" },
    seeds: {
      ...forest.seeds,
      sepia: { page: "#f0e0c0", accent: "#804020" },
      light: { ...forest.seeds.light, glaze: 0.2, notes: ["kept"] },
    },
  };
  const read = ok(readThemeFile(JSON.parse(JSON.stringify(original))));
  const renamed = { ...read.theme, name: "Forest Paper 2" };
  const written = JSON.parse(serializeThemeFile(renamed, read)!);
  expect(written).toEqual({ ...original, name: "Forest Paper 2" });
});

test("a round trip through text is stable", () => {
  const first = serializeThemeFile(ok(readThemeFile(forest)).theme)!;
  const second = serializeThemeFile(ok(parseThemeFileText(first)).theme, parseThemeFileText(first))!;
  expect(second).toBe(first);
  expect(JSON.parse(first)).toEqual(forest);
});

test("a newer theme file is usable here but read-only", () => {
  const newer = { ...forest, rotliTheme: ENGINE_VERSION + 1, gradients: [{ from: "#000000" }] };
  const read = ok(readThemeFile(newer));
  expect(read.readOnly).toBe(true);
  expect(resolveSeeds(read.theme.seeds)!.ok).toBe(true);
  expect(canOverwrite(read)).toBe(false);
  expect(serializeThemeFile(read.theme, read)).toBeNull();
});

test("a file Rotli could not read is never overwritten", () => {
  const unreadable = parseThemeFileText("{ not json");
  expect(unreadable.ok).toBe(false);
  expect(canOverwrite(unreadable)).toBe(false);
  expect(serializeThemeFile(ok(readThemeFile(forest)).theme, unreadable)).toBeNull();
  expect(canOverwrite(null)).toBe(true);
});

test("a file over 64 KB is refused unread", () => {
  const padded = JSON.stringify({ ...forest, pad: "x".repeat(MAX_THEME_FILE_BYTES) });
  expect(parseThemeFileText(padded)).toEqual({
    ok: false,
    problems: ["This file is too large to be a theme."],
  });
});

test("a file right at the cap saves compact rather than locking itself out", () => {
  const pad = "x".repeat(MAX_THEME_FILE_BYTES - JSON.stringify({ ...forest, pad: "" }).length - 1);
  const atCap = `${JSON.stringify({ ...forest, pad })}\n`;
  expect(new TextEncoder().encode(atCap).length).toBe(MAX_THEME_FILE_BYTES);
  const read = ok(parseThemeFileText(atCap));
  // pretty-printing would push it over the cap; the compact text still fits
  const saved = serializeThemeFile({ ...read.theme, name: "Paper Forest" }, read);
  expect(saved).not.toBeNull();
  expect(new TextEncoder().encode(saved!).length).toBeLessThanOrEqual(MAX_THEME_FILE_BYTES);
  expect(ok(parseThemeFileText(saved!)).theme.name).toBe("Paper Forest");
  // a change that can't fit even compact is refused, never written over the cap
  expect(serializeThemeFile({ ...read.theme, name: "Forest Paper, longer" }, read)).toBeNull();
});

test("a byte-order mark before the JSON is not a reason to refuse a theme", () => {
  expect(ok(parseThemeFileText(`\uFEFF${JSON.stringify(forest)}`)).theme.name).toBe("Forest Paper");
});

test("an object whose properties throw when read is refused, not thrown", () => {
  const hostile = Object.defineProperty({}, "rotliTheme", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  expect(readThemeFile(hostile)).toEqual({ ok: false, problems: ["This isn't a theme file."] });
});

test("a save drops an invalid id or base from the old file and re-emits colours from numbers", () => {
  const read = ok(readThemeFile({ ...forest, id: "../etc", base: "<b>" }));
  const written = JSON.parse(serializeThemeFile({ ...read.theme, id: null, base: null }, read)!);
  expect(written.id).toBeUndefined();
  expect(written.base).toBeUndefined();
  const shouting = { ...read.theme, seeds: { light: { page: "#F6F1E7", accent: "#3F7D51" } } };
  expect(JSON.parse(serializeThemeFile(shouting, read)!).seeds.light).toEqual(forest.seeds.light);
  expect(
    serializeThemeFile({ ...read.theme, seeds: { light: { page: "red", accent: "#3f7d51" } } }, read),
  ).toBeNull();
});
