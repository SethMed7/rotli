import { expect, test } from "bun:test";

import { EMPTY_CANVAS_FILE } from "../jsonCanvas/model";
import { DEST } from "./destinations";
import { FolderCanvasStore, canvasHome, canvasTitle } from "./folderCanvases";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";

test("a new canvas lands beside notes, or where a new note would", () => {
  expect(canvasHome("wiki/projects", true)).toBe("wiki/projects");
  expect(canvasHome(DEST.inbox, true)).toBe("wiki/_inbox");
  expect(canvasHome("storage", true)).toBe("wiki/_inbox");
  expect(canvasHome("Plans", false)).toBe("Plans");
  expect(canvasHome(DEST.inbox, false)).toBe("");
  expect(canvasTitle("wiki/Q3 plan.canvas")).toBe("Q3 plan");
});

test("Rotli Web makes, reads, and saves a canvas in the folder, never over a newer version", async () => {
  const dir = new MemoryVaultDir();
  await dir.mkdir("Plans");
  const store = new FolderCanvasStore(dir);
  const id = await store.create("Plans", "  Q3/plan ");
  expect(id).toBe("Plans/Q3-plan.canvas");
  expect(await store.create("Plans", "Q3/plan")).toBe("Plans/Q3-plan-2.canvas");
  await expect(store.create("Plans", "  ")).rejects.toThrow("a canvas needs a name");

  const read = await store.read(id);
  expect(read?.text).toBe(EMPTY_CANVAS_FILE);
  const stat = await store.stat(id);
  expect(stat?.len).toBe(EMPTY_CANVAS_FILE.length);
  const next = await store.write(id, '{"nodes":[],"edges":[],"x":1}', stat!.revision);
  expect(await dir.readText(id)).toBe('{"nodes":[],"edges":[],"x":1}');
  // the revision the editor loaded is gone: the save refuses, the file stands
  await expect(store.write(id, "{}", stat!.revision)).rejects.toThrow("changed on disk");
  expect(next).not.toBe(stat!.revision);
  expect(await store.read("Plans/missing.canvas")).toBeNull();
  await expect(store.read("../escape.canvas")).rejects.toThrow("invalid canvas path");
  await expect(store.read("Plans/note.md")).rejects.toThrow("not a canvas");
});

test("a build without canvases leaves .canvas files out of the folder's lists", async () => {
  // bun test compiles as the stable channel, where canvases aren't offered
  const dir = new MemoryVaultDir();
  await dir.writeText("Plan.canvas", EMPTY_CANVAS_FILE);
  await dir.writeText("Note.md", "# Note\n");
  const listed = await new FolderNotesService(dir).listAll();
  expect(listed.map((note) => note.id)).toEqual(["Note.md"]);
});

test("two panes saving one canvas at once: only one lands, the other conflicts", async () => {
  const dir = new MemoryVaultDir();
  await dir.mkdir("Plans");
  const id = await new FolderCanvasStore(dir).create("Plans", "Race");
  const loaded = (await new FolderCanvasStore(dir).stat(id))!.revision;
  const saves = await Promise.allSettled([
    new FolderCanvasStore(dir).write(id, '{"nodes":[],"edges":[],"pane":"left"}', loaded),
    new FolderCanvasStore(dir).write(id, '{"nodes":[],"edges":[],"pane":"right-hand"}', loaded),
  ]);
  expect(saves.map((save) => save.status)).toEqual(["fulfilled", "rejected"]);
  expect(await dir.readText(id)).toBe('{"nodes":[],"edges":[],"pane":"left"}');
});
