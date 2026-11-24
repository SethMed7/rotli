import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { appliedTokenNames, appliedTokens, counterpartSeeds, deriveMode, type ModeSeeds } from "./derive";
import type { GateRow } from "./gate";
import goldens from "./goldens.json";
import { CONTRAST_LEVELS, type ContrastLevel, MODES } from "./policy";
import { resolveSeeds } from "./resolve";

// goldens.json was generated from the prototype engine the plan's numbers
// came from (_review/boards-chats-2026-11-24/themes/prototype.html), before
// this port existed. It freezes engine v1: the same seeds give the same tokens,
// byte for byte, so a saved theme never shifts colour after an update.

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const rowsKey = (rows: GateRow[]) =>
  rows.map((r) => [r.group, r.role, r.on, r.fg, r.bg, r.ratio.toFixed(6), r.min, r.pass]);

interface GoldenMode {
  /** Named fixtures carry the full token set; random ones a hash of it
   * under `roles`. */
  tokens?: Record<string, string>;
  roles?: string;
  notes: unknown;
  rows: string;
  pass: boolean;
}
interface GoldenEntry {
  seeds: { light: ModeSeeds; dark: ModeSeeds };
  levels: Record<ContrastLevel, Record<"light" | "dark", GoldenMode>>;
}

test("named themes derive exactly the v1 tokens, notes and gate rows", () => {
  for (const [name, entry] of Object.entries(goldens.named as Record<string, GoldenEntry>)) {
    for (const level of CONTRAST_LEVELS) {
      const resolved = resolveSeeds(entry.seeds, level)!;
      for (const mode of MODES) {
        const golden = entry.levels[level][mode];
        expect({ name, level, mode, tokens: resolved[mode].tokens }).toEqual({
          name,
          level,
          mode,
          tokens: golden.tokens as Record<string, string>,
        });
        expect(resolved[mode].notes).toEqual(golden.notes as never);
        expect(hash(rowsKey(resolved[mode].rows))).toBe(golden.rows);
        expect(resolved[mode].ok).toBe(golden.pass);
      }
    }
  }
});

test("random seed sets derive exactly the v1 tokens at every level", () => {
  for (const entry of goldens.random as GoldenEntry[]) {
    for (const level of CONTRAST_LEVELS) {
      const resolved = resolveSeeds(entry.seeds, level)!;
      for (const mode of MODES) {
        const golden = entry.levels[level][mode];
        expect(hash(resolved[mode].tokens)).toBe(golden.roles ?? "");
        expect(hash(resolved[mode].notes)).toBe(golden.notes as string);
        expect(hash(rowsKey(resolved[mode].rows))).toBe(golden.rows);
      }
    }
  }
});

test("a missing half is worked out the v1 way", () => {
  for (const { from, mode, to } of goldens.counterpart as {
    from: ModeSeeds;
    mode: "light" | "dark";
    to: ModeSeeds;
  }[])
    expect(counterpartSeeds(from, mode)).toEqual(to);
});

test("a page and accent that already pass are returned exactly as given", () => {
  const forest = deriveMode("light", { page: "#f6f1e7", accent: "#3f7d51" });
  expect(forest.tokens["--ground"]).toBe("#f6f1e7");
  expect(forest.tokens["--accent"]).toBe("#3f7d51");
  expect(forest.notes).toEqual([]);
});

test("an unreadable contrast level is Standard, never a prototype key", () => {
  const seeds = { page: "#f6f1e7", accent: "#3f7d51" };
  const standard = deriveMode("light", seeds, "standard").tokens;
  for (const level of ["constructor", "__proto__", "toString", "HIGH", ""])
    expect(deriveMode("light", seeds, level as ContrastLevel).tokens).toEqual(standard);
});

test("every seed paints the same roles, and the chart proposal is never painted", () => {
  const names = appliedTokenNames();
  expect(names.some((name) => name.startsWith("--chart-seq-"))).toBe(false);
  expect(names).toContain("--ground");
  for (const mode of MODES)
    expect(
      Object.keys(
        appliedTokens(deriveMode(mode, { page: "#3a00ff", accent: "#220044", ink: "#ffff00" }).tokens),
      ),
    ).toEqual(names);
});
