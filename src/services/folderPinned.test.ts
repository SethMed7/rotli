import { afterEach, beforeEach, expect, test } from "bun:test";

import { corpusSetPinned } from "../lib/tauri";
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

test("pinning an in-place note preserves CRLF, nested metadata, and a locked body", async () => {
  const text = "---\r\nlocked: true\r\ncustom:\r\n  pinned: keep\r\n---\r\n# Garden\r\n\r\nWords.\r\n";
  const path = "Garden.md";
  await dir.writeText(path, text);
  await corpusSetPinned(path, true);
  expect(await dir.readText(path)).toBe(text.replace("  pinned: keep", "  pinned: keep\r\npinned: true"));
  expect((await new FolderNotesService(dir).getNote(path))?.pinned).toBe(true);
  await corpusSetPinned(path, false);
  expect(await dir.readText(path)).toBe(text);
});

test("pinning an unfenced note adds only the pin and unpinning restores its exact bytes", async () => {
  const text = "# Garden\n\nWords.\n";
  await dir.writeText("Garden.md", text);
  await corpusSetPinned("Garden.md", true);
  expect(await dir.readText("Garden.md")).toBe(`---\npinned: true\n---\n${text}`);
  await corpusSetPinned("Garden.md", false);
  expect(await dir.readText("Garden.md")).toBe(text);
});

test("repeating the same pin state does not rewrite a note", async () => {
  await dir.writeText("Garden.md", "---\npinned: true\n---\n# Garden\n");
  const before = await dir.stat("Garden.md");
  await corpusSetPinned("Garden.md", true);
  expect(await dir.stat("Garden.md")).toEqual(before);
});

test("a newer external edit wins when a pin write races it", async () => {
  await dir.writeText("Garden.md", "# Garden\n");
  const write = dir.writeText.bind(dir);
  dir.writeText = async (path, text, revision) => {
    if (path === "Garden.md" && revision !== undefined) await write(path, "# External edit\n");
    await write(path, text, revision);
  };
  await expect(corpusSetPinned("Garden.md", true)).rejects.toThrow(/revision conflict/);
  expect(await dir.readText("Garden.md")).toBe("# External edit\n");
});

test("pin write failures reach the caller without changing the note", async () => {
  await dir.writeText("Garden.md", "# Garden\n");
  dir.writeText = async () => {
    throw new Error("disk refused");
  };
  await expect(corpusSetPinned("Garden.md", true)).rejects.toThrow("disk refused");
  expect(await dir.readText("Garden.md")).toBe("# Garden\n");
});

test("pinning refuses non-Markdown files and unknown notes", async () => {
  await dir.writeText("map.excalidraw", "board bytes");
  await expect(corpusSetPinned("map.excalidraw", true)).rejects.toThrow("not a Markdown note");
  await expect(corpusSetPinned("missing", true)).rejects.toThrow();
  expect(await dir.readText("map.excalidraw")).toBe("board bytes");
});
