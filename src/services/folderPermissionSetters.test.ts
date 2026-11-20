// Codex review round 5 of pull request 295: now that a permission key denies in any
// spelling, the person's own setting must clear every spelling before it
// writes Rotli's line, or a typed denial outlives the person's "yes". Checked
// on the file as written, in a folder opened in place and in a Rotli vault.
import { describe, expect, test } from "bun:test";

import { bodyEdit } from "../lib/aiEditPolicy";
import { parseNoteDocument } from "../lib/frontmatter";
import { frontmatterField, localAiAllowedOverride } from "../lib/frontmatterKeys";
import {
  readFolderRawMetadata,
  setFolderPinned,
  setFolderProtection,
  writeFolderRawMetadata,
} from "./folderMetadata";
import { MemoryVaultDir } from "./vaultDir";

const MARKER = `${JSON.stringify({ id: "mx_test123", contract: "3.4" })}\n`;
const PATH = "Notes/plan.md";

async function vault(inPlace: boolean, text: string): Promise<MemoryVaultDir> {
  const dir = new MemoryVaultDir();
  if (!inPlace) await dir.writeText("memex.json", MARKER);
  await dir.writeText(PATH, text);
  return dir;
}

const notes = { filePathOf: async () => PATH, listAll: async () => undefined };

async function fields(dir: MemoryVaultDir): Promise<string[]> {
  return parseNoteDocument(await dir.readText(PATH)).frontmatter?.foreign ?? [];
}

const naming = (lines: string[], key: string) =>
  lines.filter((line) => frontmatterField(line)?.key.name === key);

for (const inPlace of [true, false]) {
  describe(inPlace ? "a folder opened in place" : "a Rotli vault", () => {
    test("turning “Let AI edit” on clears every spelling of ai_edit, and the note is editable", async () => {
      const dir = await vault(
        inPlace,
        '---\nid: n1\ntags: [plan]\n  ai_edit: false\n"ai\\u005fedit": false\n---\n# Plan\n\nWords.\n',
      );
      await setFolderProtection(dir, notes, "n1", "ai_edit", true);
      const after = await fields(dir);
      expect(naming(after, "ai_edit")).toEqual(["ai_edit: true"]);
      expect(bodyEdit(after)).toBe("allowed");
      expect(await dir.readText(PATH)).toContain("Words.");
    });

    test("allowing on-device AI clears every spelling of local_ai_allowed, and it reads as granted", async () => {
      const dir = await vault(
        inPlace,
        '---\nid: n2\nsecure: true\n  local_ai_allowed: false\n"local\\u005fai_allowed": false\n---\n# Plan\n\nWords.\n',
      );
      await setFolderProtection(dir, notes, "n2", "local_ai_allowed", true);
      const after = await fields(dir);
      expect(naming(after, "local_ai_allowed")).toEqual(["local_ai_allowed: true"]);
      expect(localAiAllowedOverride(after)).toBe(true);
    });
  });
}

// Claude 2's review of pull request 295: in a folder opened in place, a key
// the person spelled their own way was kept beside the line Rotli wrote.
test("locking in place replaces a lock line spelled another way", async () => {
  for (const spelled of ["locked : false", '"locked": false', "'locked': false"]) {
    const dir = await vault(true, `---\nid: n3\ntags: [plan]\n${spelled}\n---\n# Plan\n\nWords.\n`);
    await setFolderProtection(dir, notes, "n3", "locked", true);
    const after = await fields(dir);
    expect({ spelled, locks: naming(after, "locked") }).toEqual({ spelled, locks: ["locked: true"] });
    expect({ spelled, after }).toEqual({ spelled, after: ["tags: [plan]", "locked: true"] });
  }
});

// Codex review of pull request 303, blocker 2: a quoted lock counted for
// nothing and the Lock action left it, so AI editing stayed on.
for (const inPlace of [true, false]) {
  test(`a quoted lock locks, and the lock actions replace it (${inPlace ? "in place" : "Rotli vault"})`, async () => {
    const dir = await vault(
      inPlace,
      '---\nid: n4\n"locked": true\ncreated_by: agent\nai_edit: true\n---\n# Plan\n',
    );
    await setFolderProtection(dir, notes, "n4", "locked", true);
    expect(naming(await fields(dir), "locked")).toEqual(["locked: true"]);
    await setFolderProtection(dir, notes, "n4", "locked", false);
    expect(naming(await fields(dir), "locked")).toEqual([]);
  });

  // Codex review of pull request 303, item 4
  test(`setters keep block text and remove whole spans (${inPlace ? "in place" : "Rotli vault"})`, async () => {
    const text = "---\nid: n5\ncreated_by: agent\nexample: |\n  ai_edit: false\n---\n# Plan\n";
    const dir = await vault(inPlace, text);
    await expect(setFolderProtection(dir, notes, "n5", "ai_edit", true)).rejects.toThrow(
      "Edit the note's metadata by hand",
    );
    expect(await dir.readText(PATH)).toBe(text);
    const spanned = await vault(inPlace, "---\nid: n6\n? ai_edit\n: false\ntags: [plan]\n---\n# Plan\n");
    await setFolderProtection(spanned, notes, "n6", "ai_edit", true);
    const after = await fields(spanned);
    expect(naming(after, "ai_edit")).toEqual(["ai_edit: true"]);
    expect(after.filter((line) => line.startsWith(":"))).toEqual([]);
    expect(after).toContain("tags: [plan]");
  });
}

// Codex review of pull request 303, second round: a setting's write never
// changes how another setting reads (here, a lock indented under ai_edit).
for (const inPlace of [true, false]) {
  test(`a write never changes a setting it doesn't own (${inPlace ? "in place" : "Rotli vault"})`, async () => {
    const text = "---\nid: n7\nai_edit: false\n  locked: true\n---\n# Plan\n";
    const dir = await vault(inPlace, text);
    await expect(setFolderProtection(dir, notes, "n7", "ai_edit", true)).rejects.toThrow(
      "Edit the note's metadata by hand",
    );
    expect(await dir.readText(PATH)).toBe(text);
  });
}

// Codex re-check of pull request 303 (lead 1): pinning removed a denial
// indented under `pinned:`, and (lead 2) a raw metadata save could delete a
// typed denial; neither may leave the note more permissive.
for (const inPlace of [true, false]) {
  const where = inPlace ? "in place" : "Rotli vault";
  test(`pinning never loosens AI editing (${where})`, async () => {
    const text = "---\nid: n8\ncreated_by: agent\npinned: false\n  ai_edit: false\n---\n# Plan\n";
    const dir = await vault(inPlace, text);
    await setFolderPinned(dir, PATH, true).catch(() => undefined);
    expect(bodyEdit(await fields(dir))).toBe("revoked");
  });

  test(`a raw metadata save never loosens a permission, but may tighten one (${where})`, async () => {
    const text = '---\nid: n9\ncreated_by: agent\n"ai_edit": false\n---\n# Plan\n';
    const dir = await vault(inPlace, text);
    const { revision } = await readFolderRawMetadata(dir, PATH);
    await expect(
      writeFolderRawMetadata(dir, PATH, "id: n9\ncreated_by: agent\n", revision),
    ).rejects.toThrow();
    expect(await dir.readText(PATH)).toBe(text);
    const open = await vault(inPlace, "---\nid: n10\ncreated_by: agent\n---\n# Plan\n");
    const opened = await readFolderRawMetadata(open, PATH);
    await writeFolderRawMetadata(
      open,
      PATH,
      "id: n10\ncreated_by: agent\n  ai_edit: false\n",
      opened.revision,
    );
    expect(bodyEdit(await fields(open))).toBe("revoked");
  });
}
