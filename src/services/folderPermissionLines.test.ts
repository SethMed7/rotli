// The permission line rules in Rotli Web (lib/frontmatterLines.ts): a lone CR
// or a flow entry can't hide a flag behind a typed key, prose stays prose,
// and the person's off-switches either turn the flag off or refuse, never
// report success while the note stays protected or leave frontmatter YAML
// can't read. The twin of src-tauri/src/corpus_permission_line_tests.rs.
import { expect, test } from "bun:test";

import {
  emptyFrontmatter,
  isLockedFrontmatter,
  isSecureFrontmatter,
  parseNoteDocument,
} from "../lib/frontmatter";
import { setFolderProtection, setFolderSecure } from "./folderMetadata";
import { MemoryVaultDir } from "./vaultDir";

const MARKER = `${JSON.stringify({ id: "mx_test123", contract: "3.4" })}\n`;
const notesAt = (path: string) => ({ filePathOf: async () => path, listAll: async () => [] });
const read = (text: string) => parseNoteDocument(text).frontmatter ?? emptyFrontmatter();

test("a typed key on a broken line, or naming a permission key, stays foreign", () => {
  const fm = read(
    "---\npinned: false\rsecure: true\nid: 01J\u2028locked: true\ncreated: {ai_edit: false}\n---\nbody\n",
  );
  expect({ pinned: fm.pinned, id: fm.id, created: fm.created }).toEqual({
    pinned: null,
    id: null,
    created: null,
  });
  expect(isSecureFrontmatter(fm)).toBe(true);
  expect(isLockedFrontmatter(fm)).toBe(true);
  expect(isSecureFrontmatter(read("---\npinned: {secure: true}\n---\n"))).toBe(true);
  expect(isLockedFrontmatter(read("---\ntitle: x\n&a locked: true\n---\n"))).toBe(true);
});

test("a typed line that ends a block before a deeper line stays foreign", () => {
  const glued = read("---\nsummary: >\n  Web line\nid: 01JWEB\n  secure: on\n---\n");
  expect({ id: glued.id, secure: isSecureFrontmatter(glued) }).toEqual({ id: null, secure: true });
  const ordinary = read("---\nsummary: >\n  Web line\ncreated: 2025-06-30\nsubject: y\n---\n");
  expect(ordinary.created).toBe("2025-06-30");
});

test("block-scalar prose and plain offs leave a note open", () => {
  for (const text of [
    "---\ndescription: |\n  How to lock:\n  locked: true\n  secure: yes\n---\n# How to\n",
    "---\nsecure: no\nlocked: False # was on\n---\n# No\n",
    "---\nsecure: 'false'\n---\n# Quoted\n",
  ]) {
    const fm = read(text);
    expect({ text, locked: isLockedFrontmatter(fm), secure: isSecureFrontmatter(fm) }).toEqual({
      text,
      locked: false,
      secure: false,
    });
  }
});

test("unlock in a Rotli vault clears top-level lines and refuses the rest, writing nothing", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("memex.json", MARKER);
  await dir.writeText(
    "wiki/card.md",
    "---\nid: card-1\n\"locked\": true\nlocked : on\n'locked': yes\n---\n# Card\n",
  );
  await setFolderProtection(dir, notesAt("wiki/card.md"), "card-1", "locked", false);
  expect(isLockedFrontmatter(read(await dir.readText("wiki/card.md")))).toBe(false);

  for (const lines of [
    "? locked\n: true",
    "resources:\n  - locked: true\n    src: a.png\n  - src: b.png",
    "locked: |\n  true",
  ]) {
    const text = `---\nid: card-2\n${lines}\n---\n# Card\n`;
    await dir.writeText("wiki/other.md", text);
    await expect(
      setFolderProtection(dir, notesAt("wiki/other.md"), "card-2", "locked", false),
    ).rejects.toThrow(/still turns locked on/);
    expect(await dir.readText("wiki/other.md")).toBe(text);
  }
});

test("in place, unlock changes only Rotli's own line and refuses any other spelling, writing nothing", async () => {
  const dir = new MemoryVaultDir();
  for (const [path, text] of [
    ["Web/quoted.md", '---\n"locked": yes\n---\n# Web quoted\n'],
    ["Web/spaced.md", "---\nlocked  : true\n---\n# Web spaced\n"],
    ["Web/flow.md", "---\nprefs: {theme: dark, locked: 1}\n---\n# Web flow\n"],
  ] as const) {
    await dir.writeText(path, text);
    await expect(setFolderProtection(dir, notesAt(path), path, "locked", false)).rejects.toThrow(
      /still turns locked on/,
    );
    expect(await dir.readText(path)).toBe(text);
  }
  await dir.writeText("Notes/own.md", "---\ntags: [a]\nlocked: true\n---\n# Own\n");
  await setFolderProtection(dir, notesAt("Notes/own.md"), "Notes/own.md", "locked", false);
  expect(await dir.readText("Notes/own.md")).toBe("---\ntags: [a]\n---\n# Own\n");
});

test("removing secure refuses a spelling it can't reach, before anything moves", async () => {
  const inPlace = new MemoryVaultDir();
  const quoted = '---\n"secure": true\n---\n# Quoted\n';
  await inPlace.writeText("Notes/quoted.md", quoted);
  await expect(setFolderSecure(inPlace, "Notes/quoted.md", false)).rejects.toThrow(/still turns secure on/);
  expect(await inPlace.readText("Notes/quoted.md")).toBe(quoted);

  const vault = new MemoryVaultDir();
  await vault.writeText("memex.json", MARKER);
  for (const lines of ["tags: [a, {secure: true}]", "? secure\n: true"]) {
    const text = `---\nid: card-2\nsecure: true\n${lines}\n---\n# Card\n`;
    await vault.writeText("wiki/_secure/card.md", text);
    await expect(setFolderSecure(vault, "wiki/_secure/card.md", false)).rejects.toThrow(
      /still turns secure on/,
    );
    expect(await vault.readText("wiki/_secure/card.md")).toBe(text);
    expect(await vault.exists("wiki/_inbox/card.md")).toBe(false);
  }
});
