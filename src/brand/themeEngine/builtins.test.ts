import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import baseline from "./builtinBaseline.json";
import { BUILT_IN_ENVIRONMENTS, builtInFailures, compareWithBaseline } from "./builtins";

// Today's built-ins do not all meet the gate custom themes are held to. Their
// failing pairs are recorded in builtinBaseline.json, which may only shrink:
// a new failure is a regression, and a fixed pair must be deleted from the
// baseline so it can never quietly come back. check:design-system runs the
// same comparison.

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const css = [read("brand/tokens/colors.css"), read("styles/base.css"), read("styles/themes.css")].join("\n");

test("the built-in environments fail no pair beyond the recorded baseline, and every recorded pair still fails", () => {
  expect(compareWithBaseline(builtInFailures(css), baseline)).toEqual({ added: [], fixed: [] });
});

test("the baseline covers exactly the sixteen built-in environments", () => {
  expect(Object.keys(baseline).sort()).toEqual([...BUILT_IN_ENVIRONMENTS].sort());
});

test("a darker tint is caught as a regression and a fixed pair must leave the baseline", () => {
  const darker = css.replace("--tint: #c4d9e7;", "--tint: #5a7f99;");
  expect(darker).not.toBe(css);
  expect(compareWithBaseline(builtInFailures(darker), baseline).added).toEqual([
    "ocean-light: Text on Tint",
    "ocean-light: Links on Tint",
    "ocean-light: Code syntax on Tint",
    "ocean-light: Text, hover and press on Tint hover",
    "ocean-light: Text, hover and press on Tint press",
    "ocean-light: Accent fill and focus ring on Tint",
  ]);
  const pretendFixed = { ...baseline, "tesven-dark": [] };
  expect(compareWithBaseline(builtInFailures(css), pretendFixed).added.length).toBeGreaterThan(0);
  const pretendWorse = { ...baseline, "tesven-light": ["Text on Page"] };
  expect(compareWithBaseline(builtInFailures(css), pretendWorse).fixed).toEqual([
    "tesven-light: Text on Page",
  ]);
});
