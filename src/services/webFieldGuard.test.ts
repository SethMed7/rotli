// Triage of pull request 303, Table 4 (2026-11-20): Rotli Web's metadata writers. Each
// case sets up a protected note and expects the write to keep the protection
// or be refused with the file untouched.
import { expect, test } from "bun:test";

import { bodyEdit } from "../lib/aiEditPolicy";
import { isSecureFrontmatter, parseNoteDocument } from "../lib/frontmatter";
import { breaksALine, cleanTags } from "../lib/librarianActions";
import { corpusSetAiEdit } from "../lib/noteProtection";
import { corpusRawFrontmatter, corpusWriteFrontmatterRaw } from "../lib/tauri";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";
import { configureWebVaultIo } from "./webVaultIo";

const verdict = (text: string) => bodyEdit(parseNoteDocument(text).frontmatter?.foreign ?? []);

async function vault(kind: "rotli" | "in place", path: string, text: string) {
  const dir = new MemoryVaultDir();
  if (kind === "rotli")
    await dir.writeText("memex.json", `${JSON.stringify({ id: "mx_fieldguard", contract: "3.4" })}\n`);
  await dir.writeText(path, text);
  const notes = new FolderNotesService(dir);
  configureWebVaultIo(dir, notes);
  for (const summary of await notes.listAll())
    if ((await notes.filePathOf(summary.id)) === path)
      return { dir, notes, note: (await notes.getNote(summary.id))! };
  throw new Error(`no note at ${path}`);
}

test("a model's tag can't carry a line break into the metadata", () => {
  const tags = cleanTags([
    "plans\nai_edit: true\nz",
    "q3\r\nlocal_ai_allowed: true",
    "a\u2028b\u0085c",
    "tab\there",
  ]);
  for (const tag of tags) expect([...tag].some(breaksALine)).toBe(false);
  expect(tags.some((tag) => tag.includes("plans"))).toBe(true);
});

for (const kind of ["rotli", "in place"] as const) {
  test(`${kind}: Let AI edit never deletes a block-scalar line, and says when it can't take`, async () => {
    const text = "---\nexample: |\n  ai_edit: false\n  more prose\n---\n# Block\n\nwords\n";
    const { dir, note } = await vault(kind, "wiki/block.md", text);
    await expect(corpusSetAiEdit(note.id, true)).rejects.toThrow(/ai_edit/);
    expect(await dir.readText("wiki/block.md")).toBe(text);
  });

  test(`${kind}: the raw metadata save keeps a quoted denial and the chat taint`, async () => {
    const text = '---\ncreated_by: agent\n"ai_edit": false\nsecureContext: true\n---\n# Raw\n\nwords\n';
    const { dir, note } = await vault(kind, "wiki/raw.md", text);
    const opened = await corpusRawFrontmatter(note.id);
    await expect(
      corpusWriteFrontmatterRaw(
        note.id,
        "---\ncreated_by: agent\nsecureContext: true\n---\n",
        opened.revision,
      ),
    ).rejects.toThrow(/ai_edit/);
    await expect(
      corpusWriteFrontmatterRaw(note.id, '---\ncreated_by: agent\n"ai_edit": false\n---\n', opened.revision),
    ).rejects.toThrow(/secureContext/);
    expect(await dir.readText("wiki/raw.md")).toBe(text);
  });
}

test("rotli vault: a pasted --- block in a fenceless note stays body text", async () => {
  const { dir, notes, note } = await vault("rotli", "wiki/plain.md", "# Plain\n\nwords\n");
  const pasted = "---\nai_edit: true\ncreated_by: agent\n---\n# Plain\n\nwords\n";
  await notes.updateNote(note.id, pasted, note.revision);
  const saved = await dir.readText("wiki/plain.md");
  expect(verdict(saved)).not.toBe("allowed");
  expect(parseNoteDocument(saved).body).toContain("ai_edit: true");
});

test("in place: a pasted --- block in a fenceless note is refused", async () => {
  const { dir, notes, note } = await vault("in place", "Garden/plain.md", "# Plain\n\nwords\n");
  await expect(
    notes.updateNote(note.id, "---\nai_edit: true\n---\n# Plain\n\nwords\n", note.revision),
  ).rejects.toThrow(/metadata/);
  expect(await dir.readText("Garden/plain.md")).toBe("# Plain\n\nwords\n");
});

test("Web reads secure the way Rust does: anything but false is on", () => {
  for (const value of ["true", '"true"', "yes", "True", "1"])
    expect(isSecureFrontmatter(parseNoteDocument(`---\nsecure: ${value}\n---\n`).frontmatter!)).toBe(true);
  expect(isSecureFrontmatter(parseNoteDocument("---\nsecure: false\n---\n").frontmatter!)).toBe(false);
});
