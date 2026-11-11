// An error line a person can't see must still be heard: every element whose
// class names it an error (`…-err`, `…-error`) carries a live-region role, so
// a screen reader announces it when it appears (system audit 2026-09-02 §4
// #13: the Quick Note and preview errors were silent). A wrapper that is the
// live region (`.sb-error role="alert"`) covers the text inside it.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = new URL("../src/components/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
  });
}

// an opening JSX tag with a literal className, attributes spanning lines and
// one level of nested braces (style={{ … }})
const ATTRS = String.raw`(?:[^<>{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*?`;
const TAG = new RegExp(String.raw`<([a-z]+)\s(${ATTRS})className="([^"]*)"(${ATTRS})>`, "g");

test("every error line is a live region a screen reader announces", () => {
  const silent: string[] = [];
  for (const file of sources(COMPONENTS)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(TAG)) {
      const classes = (match[3] ?? "").split(/\s+/);
      if (!classes.some((name) => /-(err|error)$/.test(name))) continue;
      if (/\brole=/.test(`${match[2]}${match[4]}`)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      silent.push(`${file.slice(COMPONENTS.length)}:${line} ${match[0].replace(/\s+/g, " ")}`);
    }
  }
  expect(silent).toEqual([]);
});

test("the scan sees a multi-line tag and one with a style object", () => {
  const sample = `<p\n  className="file-err"\n  style={{ padding: "0 22px" }}\n>x</p><p className="quick-err" role="alert">y</p>`;
  const hits = [...sample.matchAll(TAG)].map((match) => /\brole=/.test(`${match[2]}${match[4]}`));
  expect(hits).toEqual([false, true]);
});
