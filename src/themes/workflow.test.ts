import { expect, test } from "bun:test";

import { FOREST_PAPER, FROM_THE_FUTURE, themeText } from "../brand/themeEngine/themes.fixtures";
import type { ThemeFileStore } from "./ports";
import { deleteTheme, exportText, importTheme, loadThemeEntries, renameTheme } from "./workflow";

function memoryStore(initial: Record<string, string> = {}): ThemeFileStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    list: async () => [...files.keys()].sort(),
    read: async (id) => files.get(id) ?? null,
    write: async (id, text) => void files.set(id, text),
    remove: async (id) => void files.delete(id),
  };
}

test("listing reads every file and keeps the unreadable ones, untouched", async () => {
  const store = memoryStore({ "forest-paper": themeText(FOREST_PAPER), broken: "{ not json" });
  const entries = await loadThemeEntries(store);
  expect(entries.map((e) => [e.id, e.read.ok])).toEqual([
    ["broken", false],
    ["forest-paper", true],
  ]);
  expect(store.files.get("broken")).toBe("{ not json");
});

test("a store that fails a read lists that theme as unreadable", async () => {
  const store = { ...memoryStore({ a: "{}" }), read: async () => Promise.reject(new Error("disk")) };
  expect((await loadThemeEntries(store))[0]?.read.ok).toBe(false);
});

test("import copies the file as written, asks before replacing, and can keep both", async () => {
  const store = memoryStore();
  const text = themeText(FROM_THE_FUTURE);
  expect(await importTheme(store, text, [])).toEqual({ status: "saved", id: "tomorrow", name: "Tomorrow" });
  // a newer theme's own fields survive the copy
  expect(store.files.get("tomorrow")).toBe(text);
  const entries = await loadThemeEntries(store);
  expect((await importTheme(store, text, entries)).status).toBe("exists");
  expect(await importTheme(store, text, entries, "keep-both")).toMatchObject({
    status: "saved",
    id: "tomorrow-2",
  });
  expect(await importTheme(store, text, entries, "replace")).toMatchObject({
    status: "saved",
    id: "tomorrow",
  });
  expect([...store.files.keys()].sort()).toEqual(["tomorrow", "tomorrow-2"]);
});

test("import never replaces a file Rotli couldn't read", async () => {
  const store = memoryStore({ "forest-paper": "{ not json" });
  const entries = await loadThemeEntries(store);
  const result = await importTheme(store, themeText(FOREST_PAPER), entries, "replace");
  expect(result.status).toBe("refused");
  expect(store.files.get("forest-paper")).toBe("{ not json");
});

test("an unreadable or colourless import is refused with a reason", async () => {
  const store = memoryStore();
  expect(await importTheme(store, "nope", [])).toEqual({
    status: "refused",
    problem: "This isn't a theme file.",
  });
  expect(store.files.size).toBe(0);
});

test("rename changes the name only, keeps unknown fields, and refuses a newer theme", async () => {
  const store = memoryStore({
    "forest-paper": themeText({ ...FOREST_PAPER, shape: { radius: "soft" } }),
    tomorrow: themeText(FROM_THE_FUTURE),
  });
  const [forest, tomorrow] = await loadThemeEntries(store);
  expect(await renameTheme(store, forest!, "Forest at Dusk")).toEqual({ ok: true });
  expect(JSON.parse(store.files.get("forest-paper")!)).toEqual({
    ...FOREST_PAPER,
    shape: { radius: "soft" },
    name: "Forest at Dusk",
  });
  expect(await renameTheme(store, tomorrow!, "Nope")).toEqual({
    ok: false,
    problem: "This theme was made by a newer Rotli; it's read-only here.",
  });
  expect(store.files.get("tomorrow")).toBe(themeText(FROM_THE_FUTURE));
});

test("delete removes the file; export hands back the file as it is", async () => {
  const text = themeText(FOREST_PAPER);
  const store = memoryStore({ "forest-paper": text, broken: "{" });
  expect(await exportText(store, "forest-paper")).toBe(text);
  expect(await exportText(store, "broken")).toBeNull();
  await deleteTheme(store, "forest-paper");
  expect(store.files.has("forest-paper")).toBe(false);
});

test("a rename that would push the file over the cap says so and leaves the file alone", async () => {
  const pad = "x".repeat(65_536 - JSON.stringify({ ...FOREST_PAPER, pad: "" }).length - 1);
  const atCap = `${JSON.stringify({ ...FOREST_PAPER, pad })}\n`;
  const store = memoryStore({ "forest-paper": atCap });
  const [forest] = await loadThemeEntries(store);
  expect(forest?.read.ok).toBe(true);
  expect(await renameTheme(store, forest!, "Forest Paper, with a much longer name")).toEqual({
    ok: false,
    problem: "That won't fit: the theme file would go over 64 KB.",
  });
  expect(store.files.get("forest-paper")).toBe(atCap);
});
