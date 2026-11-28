import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { cssBlocks } from "./builtins";
import { ACCENT_PRESETS, ACCENT_PRESET_NAMES, ALPHA, LABELS, LABEL_NAMES, QUOKKA_LINE } from "./policy";

// The engine measures what Rotli paints only if its fixed inputs are the
// stylesheets' own values. Each mirror is read back from the CSS here.

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const base = read("styles/base.css");
const themes = read("styles/themes.css");
const canvas = read("styles/canvas.css");
const blocks = cssBlocks(`${base}\n${themes}`);
const declsFor = (selector: string) =>
  Object.assign({}, ...blocks.filter((b) => b.selectors.includes(selector)).map((b) => b.decls)) as Record<
    string,
    string
  >;
const percent = (source: string, pattern: RegExp): number => Number(pattern.exec(source)?.[1]) / 100;
const rgbaAlpha = (value: string | undefined): number => Number(/,\s*([\d.]+)\)\s*$/.exec(value ?? "")?.[1]);

test("the selection, current-row and floating-edge washes are base.css's", () => {
  expect(percent(base, /--selected-bg:\s*color-mix\(in srgb, var\(--accent\) (\d+)%/)).toBe(ALPHA.selected);
  expect(percent(base, /--selected-bg-hover:\s*color-mix\(in srgb, var\(--accent\) (\d+)%/)).toBe(
    ALPHA.selectedHover,
  );
  expect(percent(base, /::selection\s*\{[^}]*var\(--accent\) (\d+)%/)).toBe(ALPHA.selection);
  expect(percent(base, /--border-strong:\s*color-mix\(in srgb, var\(--text\) (\d+)%/)).toBe(
    ALPHA.borderStrong,
  );
});

test("hover and press are base.css's state layers", () => {
  const root = declsFor(":root");
  const dark = declsFor(':root[data-theme="dark"]');
  expect([rgbaAlpha(root["--hov"]), rgbaAlpha(root["--act"])]).toEqual([ALPHA.hov.light, ALPHA.act.light]);
  expect([rgbaAlpha(dark["--hov"]), rgbaAlpha(dark["--act"])]).toEqual([ALPHA.hov.dark, ALPHA.act.dark]);
});

test("the board's selected tool and accent mixes are canvas.css's", () => {
  expect(percent(canvas, /var\(--accent\) (\d+)%, var\(--surface\)\)/)).toBe(ALPHA.boardContainer);
  expect(percent(canvas, /var\(--accent\) (\d+)%, var\(--text\)\)/)).toBe(ALPHA.boardAccent);
});

test("the label palette is themes.css's, per scheme", () => {
  const light = declsFor(":root");
  const dark = declsFor(':root[data-theme$="-dark"]');
  for (const name of LABEL_NAMES) {
    expect(light[`--accent-swatch-${name}`]).toBe(LABELS.light[name]);
    expect(dark[`--accent-swatch-${name}`]).toBe(LABELS.dark[name]);
  }
});

test("the Primary-color presets are themes.css's, per scheme", () => {
  for (const name of ACCENT_PRESET_NAMES) {
    expect(declsFor(`:root[data-theme$="-light"][data-accent="${name}"]`)["--accent"]).toBe(
      ACCENT_PRESETS[name].light,
    );
    expect(declsFor(`:root[data-theme$="-dark"][data-accent="${name}"]`)["--accent"]).toBe(
      ACCENT_PRESETS[name].dark,
    );
  }
});

test("the chat buddy's automatic line is themes.css's, per scheme", () => {
  expect(declsFor(":root")["--quokka-line-auto"]).toBe(QUOKKA_LINE.light);
  expect(declsFor(':root[data-theme="charcoal"]')["--quokka-line-auto"]).toBe(QUOKKA_LINE.dark);
});
