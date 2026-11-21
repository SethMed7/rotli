// The permission line rules in Rotli Web (lib/frontmatterLines.ts): a lone CR
// can't hide a flag behind a typed key, and the person's off-switches either
// turn the flag off or refuse, never report success while the note stays
// protected. The twin of src-tauri/src/corpus_permission_line_tests.rs.
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

test("a typed key on a broken line stays foreign, where the readers see its flag", () => {
  const fm = read("---\npinned: false\rsecure: true\nid: 01J locked: true\n---\nbody\n");
  expect({ pinned: fm.pinned, id: fm.id }).toEqual({ pinned: null, id: null });
  expect(isSecureFrontmatter(fm)).toBe(true);
  expect(isLockedFrontmatter(fm)).toBe(true);
});

test("unlock in a Rotli vault clears every block spelling of locked", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("memex.json", MARKER);
  await dir.writeText(
    "wiki/card.md",
    '---\nid: card-1\n"locked": true\n- locked: yes\n  locked: on\n---\n# Card\n',
  );
  await setFolderProtection(dir, notesAt("wiki/card.md"), "card-1", "locked", false);
  expect(isLockedFrontmatter(read(await dir.readText("wiki/card.md")))).toBe(false);
});

test("unlock turns a lock it finds off, or refuses and writes nothing", async () => {
  const dir = new MemoryVaultDir();
  for (const [path, text] of [
    ["Notes/quoted.md", '---\n"locked": true\n---\n# Quoted\n'],
    ["Notes/flow.md", "---\nmeta: {locked: true, mood: calm}\n---\n# Flow\n"],
  ] as const) {
    await dir.writeText(path, text);
    const refused = await setFolderProtection(dir, notesAt(path), path, "locked", false).then(
      () => null,
      (error: Error) => error.message,
    );
    const after = await dir.readText(path);
    if (refused === null) expect(isLockedFrontmatter(read(after))).toBe(false);
    else
      expect({ refused: /still turns locked on/.test(refused), after }).toEqual({
        refused: true,
        after: text,
      });
  }
  // a flow entry inside another key is beyond every switch: it refuses
  await expect(
    setFolderProtection(dir, notesAt("Notes/flow.md"), "Notes/flow.md", "locked", false),
  ).rejects.toThrow(/still turns locked on/);
});

test("removing secure refuses a spelling it can't reach, before anything moves", async () => {
  const inPlace = new MemoryVaultDir();
  const quoted = '---\n"secure": true\n---\n# Quoted\n';
  await inPlace.writeText("Notes/quoted.md", quoted);
  await expect(setFolderSecure(inPlace, "Notes/quoted.md", false)).rejects.toThrow(/still turns secure on/);
  expect(await inPlace.readText("Notes/quoted.md")).toBe(quoted);

  const vault = new MemoryVaultDir();
  await vault.writeText("memex.json", MARKER);
  const flow = "---\nid: card-2\nsecure: true\ntags: [a, {secure: true}]\n---\n# Card\n";
  await vault.writeText("wiki/_secure/card.md", flow);
  await expect(setFolderSecure(vault, "wiki/_secure/card.md", false)).rejects.toThrow(
    /still turns secure on/,
  );
  expect(await vault.readText("wiki/_secure/card.md")).toBe(flow);
  expect(await vault.exists("wiki/_inbox/card.md")).toBe(false);
});
