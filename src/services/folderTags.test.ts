import { afterEach, beforeEach, expect, test } from "bun:test";

import { corpusChangeTags, corpusListTags } from "../lib/corpusTags";
import { protection } from "../lib/protectionRule";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";
import { configureWebVaultIo } from "./webVaultIo";

let dir: MemoryVaultDir;
let notes: FolderNotesService;

beforeEach(() => {
  dir = new MemoryVaultDir();
  notes = new FolderNotesService(dir);
  configureWebVaultIo(dir, notes);
});
afterEach(() => configureWebVaultIo(null, null));

const LOCKED =
  '---\nlocked: true\nsecure: true\nweather: grey # kept\ntags: ["x: y", prior]\n---\n# Garden\n\nWords.\n';

test("the person tags a locked, secure note and every other byte stays", async () => {
  await dir.writeText("Garden.md", LOCKED);
  const out = await corpusChangeTags("Garden.md", { add: ["#Harvest", "PRIOR"] });
  expect(out.tags).toEqual(["x: y", "prior", "Harvest"]);
  expect(await dir.readText("Garden.md")).toBe(
    LOCKED.replace('tags: ["x: y", prior]', 'tags: ["x: y", prior, Harvest]'),
  );
  const removed = await corpusChangeTags("Garden.md", { remove: ["prior"] }, out.revision);
  expect(removed.tags).toEqual(["x: y", "Harvest"]);
});

test("a hostile or malformed tag is refused and the note is untouched", async () => {
  await dir.writeText("Garden.md", LOCKED);
  for (const hostile of [
    "y\nlocked: false",
    "y]",
    "c; d",
    "'z'",
    "y\u2029ai_edit: true",
    "No",
    " ",
    "two words",
  ])
    await expect(corpusChangeTags("Garden.md", { add: [hostile] })).rejects.toThrow();
  await expect(corpusChangeTags("Garden.md", {})).rejects.toThrow("at least one tag");
  await expect(corpusChangeTags("Garden.md", { add: ["x"] }, "stale")).rejects.toThrow("revision");
  expect(await dir.readText("Garden.md")).toBe(LOCKED);
});

test("tags named like permission keys change no protection", async () => {
  const text = "---\nai_edit: false\ntags:\n  - a\n---\n# Garden\n";
  await dir.writeText("Garden.md", text);
  const keys = ["locked", "secure", "ai_edit", "created_by", "local_ai_allowed", "secureContext"];
  await corpusChangeTags("Garden.md", { add: keys });
  expect(protection(await dir.readText("Garden.md"))).toEqual(protection(text));
  await corpusChangeTags("Garden.md", { remove: keys });
  expect(await dir.readText("Garden.md")).toBe(text);
});

test("a tags field Rotli can't follow is never rewritten", async () => {
  const text = "---\ntags: [a] # mine\n---\n# Garden\n";
  await dir.writeText("Garden.md", text);
  await expect(corpusChangeTags("Garden.md", { add: ["b"] })).rejects.toThrow("Show file metadata");
  expect(await dir.readText("Garden.md")).toBe(text);
});

test("the list counts each note once, under the most common spelling, outside Trash", async () => {
  await dir.writeText("One.md", "---\ntags: [Launch, q3]\n---\n# One\n");
  await dir.writeText("Two.md", "---\ntags: [launch, LAUNCH]\n---\n# Two\n");
  await dir.writeText("Three.md", "---\ntags:\n  - launch\n---\n# Three\n");
  await dir.writeText("Trash/Gone.md", "---\ntags: [gone]\n---\n# Gone\n");
  const tags = await corpusListTags();
  expect(tags.map(({ tag, count }) => [tag, count])).toEqual([
    ["launch", 3],
    ["q3", 1],
  ]);
  expect(tags[0]!.ids.length).toBe(3);
});

test("a hand-made note in a Rotli vault gains only its tags line", async () => {
  await dir.writeText("memex.json", '{"id":"mx_tagsunit0001","contract":"3.4"}\n');
  const text = "---\nlocked: true\nweather: grey # kept\n---\n# Garden\n";
  await dir.writeText("wiki/garden.md", text);
  await corpusChangeTags("wiki/garden.md", { add: ["harvest"] });
  expect(await dir.readText("wiki/garden.md")).toBe(text.replace("# kept\n", "# kept\ntags: [harvest]\n"));
});

test("a fenceless note in a folder opened in place gains only a tags block", async () => {
  // no Rotli marker: an Obsidian or Markdown folder the person brought
  const text = "# Plan\n\nSteps.\n";
  await dir.writeText("Projects/Plan.md", text);
  await corpusChangeTags("Projects/Plan.md", { add: ["plans"] });
  expect(await dir.readText("Projects/Plan.md")).toBe(`---\ntags: [plans]\n---\n${text}`);
});
