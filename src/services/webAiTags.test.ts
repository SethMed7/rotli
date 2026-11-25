import { afterEach, beforeEach, expect, test } from "bun:test";

import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";
import { createWebAiCorpus } from "./webAiCorpus";
import { configureWebVaultIo } from "./webVaultIo";

// Rotli Web's AI tag lane (2026-11-24): the twin of Rust's
// corpus_change_tags_ai, over a connected folder.
let dir: MemoryVaultDir;
let notes: FolderNotesService;

beforeEach(() => {
  dir = new MemoryVaultDir();
  notes = new FolderNotesService(dir);
  configureWebVaultIo(dir, notes);
});
afterEach(() => configureWebVaultIo(null, null));

const corpus = () => createWebAiCorpus(() => notes);
const revisionOf = async (path: string) => (await notes.getNote(path))!.revision;

test("an AI tags a note an AI made, on the revision it read", async () => {
  await dir.writeText("Made.md", "---\ncreated_by: chat\ntags: [a]\n---\n# Made\n\nwords\n");
  const out = await corpus().changeTags(
    "Made.md",
    { add: ["b"], remove: ["a"] },
    await revisionOf("Made.md"),
  );
  expect(out.tags).toEqual(["b"]);
  expect(await dir.readText("Made.md")).toBe("---\ncreated_by: chat\ntags: [b]\n---\n# Made\n\nwords\n");
  await expect(corpus().changeTags("Made.md", { add: ["c"] }, "stale")).rejects.toThrow("changed since");
});

test("a person's note, a locked one, and a secure one are refused and untouched", async () => {
  const cases: [string, string, string][] = [
    ["Mine.md", "---\ntags: [a]\n---\n# Mine\n\nwords\n", "person"],
    ["Locked.md", "---\ncreated_by: chat\nlocked: true\n---\n# Locked\n\nwords\n", "locked"],
    ["Vault.md", "---\ncreated_by: chat\nsecure: true\n---\n# Vault\n\nwords\n", "secure"],
  ];
  for (const [path, text] of cases) await dir.writeText(path, text);
  for (const [path, text, why] of cases) {
    const revision = (await notes.getNote(path))?.revision ?? "none";
    await expect(corpus().changeTags(path, { add: ["x"] }, revision)).rejects.toThrow();
    expect({ why, text: await dir.readText(path) }).toEqual({ why, text });
  }
});

test("a secret-shaped tag is refused for the web's remote models", async () => {
  const text = "---\ncreated_by: chat\n---\n# Made\n\nwords\n";
  await dir.writeText("Made.md", text);
  await expect(
    corpus().changeTags(
      "Made.md",
      { add: ["sk-ant-api03-EXAMPLE0EXAMPLE0EXAM"] },
      await revisionOf("Made.md"),
    ),
  ).rejects.toThrow("secret");
  expect(await dir.readText("Made.md")).toBe(text);
});
