import { expect, test } from "bun:test";

import { COPYING_LINES, importCopy } from "./vaultImportDialog";

test("the choice names the folder, what it is, and how many notes", () => {
  const copy = importCopy({ kind: "choose", label: "Garden", source: "Obsidian vault", notes: 1204 });
  expect(copy.title).toBe("Open “Garden”");
  expect(copy.lines[0]).toBe("It’s an Obsidian vault with 1,204 notes. How should Rotli open it?");
});

test("progress counts files and size, and says the original is only read", () => {
  const copy = importCopy({
    kind: "copying",
    label: "Garden",
    files: 12,
    totalFiles: 40,
    bytes: 2_500_000,
    totalBytes: 9_000_000,
  });
  expect(copy.lines).toEqual(["12 files of 40 · 2.5 MB of 9.0 MB", COPYING_LINES.onlyRead]);
  expect(
    importCopy({ kind: "copying", label: "G", files: 0, totalFiles: 0, bytes: 0, totalBytes: 0 }).lines[0],
  ).toBe(COPYING_LINES.ready);
});

test("done says where the copy is and names linked items that weren't copied", () => {
  const copy = importCopy({
    kind: "done",
    label: "Garden",
    report: { destination: "/Users/sam/Garden (Rotli)", files: 1, skipped: ["Linked.md"] },
  });
  expect(copy.lines).toEqual([
    "Copied 1 file to /Users/sam/Garden (Rotli). Your original wasn’t changed.",
    "1 linked item wasn’t copied: Linked.md",
  ]);
});

test("a failure says what went wrong", () => {
  expect(importCopy({ kind: "failed", label: "Garden", message: "Copy into an empty folder." })).toEqual({
    title: "Couldn’t copy “Garden”",
    lines: ["Copy into an empty folder."],
  });
});
