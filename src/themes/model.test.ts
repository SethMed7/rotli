import { expect, test } from "bun:test";

import { parseThemeFileText } from "../brand/themeEngine/themeFile";
import {
  FOREST_PAPER,
  FROM_THE_FUTURE,
  NEON,
  NO_COLORS,
  themeText,
} from "../brand/themeEngine/themes.fixtures";
import {
  type ThemeEntry,
  keepBothId,
  movedColors,
  parseCustomThemeSelection,
  planApply,
  planImport,
  themeIdFor,
} from "./model";

const entry = (id: string, theme: object | string): ThemeEntry => ({
  id,
  read: parseThemeFileText(typeof theme === "string" ? theme : themeText(theme)),
});
const forest = entry("forest-paper", FOREST_PAPER);
const selected = { id: "forest-paper", name: "Forest Paper", source: "mac" as const };

test("the selection setting reads only a theme id from this Mac", () => {
  expect(parseCustomThemeSelection(selected)).toEqual(selected);
  expect(parseCustomThemeSelection({ id: "forest-paper", source: "mac" })).toEqual({
    ...selected,
    name: "forest-paper",
  });
  for (const bad of [
    null,
    "forest-paper",
    [],
    { id: "../x", source: "mac" },
    { id: "a", source: "vault" },
    { id: 7 },
  ])
    expect(parseCustomThemeSelection(bad)).toBeNull();
});

test("a readable theme that passes applies, as its file's id", () => {
  const plan = planApply(selected, [{ ...forest, id: "forest-paper" }], "Grove");
  expect(plan.kind).toBe("custom");
  if (plan.kind === "custom")
    expect([plan.id, plan.theme.name, plan.readOnly]).toEqual(["forest-paper", "Forest Paper", false]);
});

test("the filename is the id: a disagreeing id inside the file is ignored", () => {
  const renamed = entry("my-copy", { ...FOREST_PAPER, id: "something-else" });
  const plan = planApply({ ...selected, id: "my-copy" }, [renamed], "Grove");
  expect(plan.kind === "custom" && plan.id).toBe("my-copy");
  expect(plan.kind === "custom" && plan.theme.id).toBe("my-copy");
});

test("no selection is the base family, with nothing to say", () => {
  expect(planApply(null, [forest], "Grove")).toEqual({ kind: "base", notice: null });
});

test("the selected file is gone: the base family, and why", () => {
  expect(planApply(selected, [], "Grove")).toEqual({
    kind: "base",
    notice: "Forest Paper isn't on this Mac. Showing Grove.",
  });
});

test("a file that can't be read is never applied", () => {
  for (const text of [
    "{ not json",
    "[]",
    '{"name":"no version"}',
    themeText({ ...FOREST_PAPER, pad: "x".repeat(70_000) }),
  ])
    expect(planApply(selected, [entry("forest-paper", text)], "Grove")).toEqual({
      kind: "base",
      notice: "Couldn't read forest-paper.json. Showing Grove.",
    });
});

test("a theme the gate rejects after derivation applies the base family instead", () => {
  const failing = (() => ({ ok: false })) as unknown as Parameters<typeof planApply>[3];
  expect(planApply(selected, [forest], "Grove", failing)).toEqual({
    kind: "base",
    notice: "Forest Paper didn't pass Rotli's readability check. Showing Grove.",
  });
});

test("seeds outside the bands are moved, the theme still applies, and the moves are listed", () => {
  const plan = planApply({ ...selected, id: "neon" }, [entry("neon", NEON)], "Rotli");
  if (plan.kind !== "custom") throw new Error("neon should apply");
  const moved = movedColors(plan.resolved);
  expect(moved.map((m) => `${m.mode} ${m.role}`)).toEqual([
    "light Page",
    "light Accent",
    "dark Page",
    "dark Accent",
  ]);
});

test("a newer theme applies from what this build reads, and is read-only", () => {
  const plan = planApply({ ...selected, id: "tomorrow" }, [entry("tomorrow", FROM_THE_FUTURE)], "Rotli");
  expect(plan.kind === "custom" && plan.readOnly).toBe(true);
});

test("an import must read and have colours; one already here is reported, not replaced", () => {
  expect(planImport("{ not json", [])).toEqual({ ok: false, problem: "This isn't a theme file." });
  expect(planImport(themeText(NO_COLORS), [])).toMatchObject({ ok: false });
  const fresh = planImport(themeText(FOREST_PAPER), []);
  expect(fresh).toMatchObject({ ok: true, id: "forest-paper", existing: null });
  const again = planImport(themeText(FOREST_PAPER), [forest]);
  expect(again.ok && again.existing?.id).toBe("forest-paper");
  if (again.ok) expect(keepBothId(again, [forest])).toBe("forest-paper-2");
});

test("an import without an id takes one from its name", () => {
  const { id: _id, ...noId } = FOREST_PAPER;
  expect(planImport(themeText({ ...noId, name: "Café au Lait!" }), [])).toMatchObject({
    ok: true,
    id: "cafe-au-lait",
  });
});

test("ids from names are filename-safe and unique", () => {
  const taken = new Set(["dusk", "dusk-2"]);
  expect(themeIdFor("Dusk", taken)).toBe("dusk-3");
  expect(themeIdFor("../../etc", new Set())).toBe("etc");
  expect(themeIdFor("   ", new Set())).toBe("theme");
  expect(themeIdFor("海", new Set())).toBe("theme");
  expect(themeIdFor("a".repeat(80), new Set())).toHaveLength(40);
});
