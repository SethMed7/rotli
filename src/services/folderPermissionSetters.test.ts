// Codex review round 5 of pull request 295: now that a permission key denies in any
// spelling, the person's own setting must clear every spelling before it
// writes Rotli's line, or a typed denial outlives the person's "yes". Checked
// on the file as written, in a folder opened in place and in a Rotli vault.
import { describe, expect, test } from "bun:test";

import { bodyEdit } from "../lib/aiEditPolicy";
import { parseNoteDocument } from "../lib/frontmatter";
import { frontmatterField, localAiAllowedOverride } from "../lib/frontmatterKeys";
import { setFolderProtection } from "./folderMetadata";
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
