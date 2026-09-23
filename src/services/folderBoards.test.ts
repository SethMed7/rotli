import { describe, expect, test } from "bun:test";

import { DEST } from "./destinations";
import { EMPTY_BOARD_FILE, FolderBoardStore, boardHome, boardNameStem, boardTitle } from "./folderBoards";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";

async function memexVault(): Promise<MemoryVaultDir> {
  const dir = new MemoryVaultDir();
  for (const path of ["wiki/_inbox", "wiki/ideas", "storage", "archive", "trash"]) await dir.mkdir(path);
  return dir;
}

const SCENE =
  '{"type":"excalidraw","version":2,"source":"rotli","elements":[{"id":"a"}],"appState":{},"files":{}}';

describe("board naming and placement policy (the Rust twin)", () => {
  test("a typed name becomes a stem: trimmed, extension dropped, separators flattened", () => {
    expect(boardNameStem("  Roadmap  ")).toBe("Roadmap");
    expect(boardNameStem("Map.excalidraw")).toBe("Map");
    expect(boardNameStem("Project/Map")).toBe("Project-Map");
    expect(boardNameStem("a\\b")).toBe("a-b");
    expect(() => boardNameStem("   ")).toThrow("a board needs a name");
    expect(() => boardNameStem(".excalidraw")).toThrow("a board needs a name");
  });

  test("a memex keeps a board in a writable surface and sends everything else to the board lane", () => {
    expect(boardHome("wiki/ideas", true)).toBe("wiki/ideas");
    expect(boardHome("chats", true)).toBe("chats");
    expect(boardHome("storage/excalidraw/sketches", true)).toBe("storage/excalidraw/sketches");
    expect(boardHome(DEST.inbox, true)).toBe("storage/excalidraw");
    expect(boardHome(DEST.storage, true)).toBe("storage/excalidraw");
    expect(boardHome(DEST.board, true)).toBe("storage/excalidraw");
    expect(boardHome("storage", true)).toBe("storage/excalidraw");
    expect(boardHome("default:storage/excalidraw", true)).toBe("storage/excalidraw");
    expect(boardHome("identity", true)).toBe("storage/excalidraw");
  });

  test("a plain vault puts a board in the folder, and its reserved rows at the root", () => {
    expect(boardHome("Projects/2026", false)).toBe("Projects/2026");
    expect(boardHome(DEST.inbox, false)).toBe("");
    expect(boardHome(DEST.storage, false)).toBe("");
  });

  test("the title is the file stem", () => {
    expect(boardTitle("storage/excalidraw/My map.excalidraw")).toBe("My map");
    expect(boardTitle("a.b.excalidraw")).toBe("a.b");
  });

  test("the empty scene is the exact bytes the Mac app writes", () => {
    expect(EMPTY_BOARD_FILE).toBe(
      '{"type":"excalidraw","version":2,"source":"rotli","elements":[],"appState":{},"files":{}}',
    );
  });
});

describe("creating boards in a vault folder", () => {
  test("a memex board is born in the board lane with an empty scene, collision-safe as -2, -3", async () => {
    const dir = await memexVault();
    const boards = new FolderBoardStore(dir);
    expect(await boards.create(DEST.inbox, "Roadmap")).toEqual({
      id: "storage/excalidraw/Roadmap.excalidraw",
    });
    expect(await dir.readText("storage/excalidraw/Roadmap.excalidraw")).toBe(EMPTY_BOARD_FILE);
    expect((await boards.create(DEST.inbox, "Roadmap")).id).toBe("storage/excalidraw/Roadmap-2.excalidraw");
    expect((await boards.create(DEST.inbox, "Roadmap")).id).toBe("storage/excalidraw/Roadmap-3.excalidraw");
    // the first file was never touched
    expect(await dir.readText("storage/excalidraw/Roadmap.excalidraw")).toBe(EMPTY_BOARD_FILE);
  });

  test("a board created in a wiki folder stays there, with the body it was given", async () => {
    const dir = await memexVault();
    const { id } = await new FolderBoardStore(dir).create("wiki/ideas", "Flow", SCENE);
    expect(id).toBe("wiki/ideas/Flow.excalidraw");
    expect(await dir.readText(id)).toBe(SCENE);
  });

  test("a plain vault's board lands at the root; a nameless or invalid board writes nothing", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "# A\n");
    const boards = new FolderBoardStore(dir);
    expect((await boards.create(DEST.inbox, "Sketch")).id).toBe("Sketch.excalidraw");
    await expect(boards.create(DEST.inbox, "  ")).rejects.toThrow("a board needs a name");
    await expect(boards.create(DEST.inbox, "Bad", '{"type":"other","elements":[]}')).rejects.toThrow(
      "Board type must be excalidraw",
    );
    expect((await dir.list("")).map((entry) => entry.name)).toEqual(["Sketch.excalidraw", "a.md"]);
  });
});

describe("reading and saving a board", () => {
  test("a save needs the revision it loaded, and returns the next one", async () => {
    const dir = await memexVault();
    const boards = new FolderBoardStore(dir);
    const { id } = await boards.create(DEST.inbox, "Plan");
    const loaded = await boards.read(id);
    expect(loaded.body).toBe(EMPTY_BOARD_FILE);
    const saved = await boards.write(id, SCENE, loaded.revision);
    expect(saved.revision).not.toBe(loaded.revision);
    expect(await dir.readText(id)).toBe(SCENE);
    // the old revision is stale now: a second editor can't overwrite
    await expect(boards.write(id, EMPTY_BOARD_FILE, loaded.revision)).rejects.toThrow("revision conflict");
    await expect(boards.write(id, EMPTY_BOARD_FILE, "")).rejects.toThrow("revision conflict");
    expect(await dir.readText(id)).toBe(SCENE);
    expect((await boards.write(id, EMPTY_BOARD_FILE, saved.revision)).revision).toBeTruthy();
  });

  test("an invalid scene, a missing board, and a path outside the vault are refused", async () => {
    const dir = await memexVault();
    const boards = new FolderBoardStore(dir);
    const { id } = await boards.create(DEST.inbox, "Plan");
    const { revision } = await boards.read(id);
    await expect(boards.write(id, "not json", revision)).rejects.toThrow("invalid JSON");
    expect(await dir.readText(id)).toBe(EMPTY_BOARD_FILE);
    await expect(boards.read("storage/excalidraw/nope.excalidraw")).rejects.toThrow("board not found");
    await expect(boards.read("wiki/a.md")).rejects.toThrow("not a board");
    await expect(boards.read("../outside.excalidraw")).rejects.toThrow("invalid board path");
  });

  test("rename keeps the folder and extension and never replaces a sibling", async () => {
    const dir = await memexVault();
    const boards = new FolderBoardStore(dir);
    const { id } = await boards.create(DEST.inbox, "Draft");
    await boards.create(DEST.inbox, "Final");
    expect(await boards.rename(id, "Final")).toEqual({ id: "storage/excalidraw/Final-2.excalidraw" });
    expect(await dir.exists(id)).toBe(false);
    expect(await boards.rename("storage/excalidraw/Final-2.excalidraw", "Final-2")).toEqual({
      id: "storage/excalidraw/Final-2.excalidraw",
    });
  });
});

describe("boards in the folder notes listing", () => {
  test("boards list as board rows (never read, never notes) and survive a fresh service", async () => {
    const dir = await memexVault();
    await dir.writeText("storage/photo.png", "not a board");
    const boards = new FolderBoardStore(dir);
    const { id } = await boards.create(DEST.inbox, "Roadmap");
    await boards.create("wiki/ideas", "Flow", SCENE);

    const all = await new FolderNotesService(dir).listAll();
    const rows = all.filter((note) => note.kind === "board").sort((a, b) => a.id.localeCompare(b.id));
    expect(rows.map((row) => [row.id, row.title, row.folderId])).toEqual([
      ["storage/excalidraw/Roadmap.excalidraw", "Roadmap", "storage/excalidraw"],
      ["wiki/ideas/Flow.excalidraw", "Flow", "wiki/ideas"],
    ]);
    expect(all.some((note) => note.id === "storage/photo.png")).toBe(false);
    // a board is not a note: no body to read, no note save
    const notes = new FolderNotesService(dir);
    expect(await notes.getNote(id)).toBeNull();
    await expect(notes.updateNote(id, "# hi", "1:1")).rejects.toThrow("not a note");
    // All notes shows the board like the Mac corpus does
    expect((await notes.listNotes()).some((note) => note.id === id)).toBe(true);
  });

  test("a board goes to Trash and back with its bytes intact", async () => {
    const dir = await memexVault();
    const { id } = await new FolderBoardStore(dir).create(DEST.inbox, "Roadmap", SCENE);
    const notes = new FolderNotesService(dir);
    await notes.listAll();
    const trashed = await notes.trashNote(id);
    expect(trashed).toMatchObject({ id: `trash/${id}`, kind: "board", folderId: DEST.trash });
    expect(await dir.readText(`trash/${id}`)).toBe(SCENE);
    const restored = await notes.restoreNote(trashed.id);
    expect(restored).toMatchObject({ id, kind: "board" });
    expect(await dir.readText(id)).toBe(SCENE);
  });

  test("a plain vault lists a root board in Inbox", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "# A\n");
    await new FolderBoardStore(dir).create(DEST.inbox, "Sketch");
    const rows = (await new FolderNotesService(dir).listAll()).filter((note) => note.kind === "board");
    expect(rows.map((row) => [row.id, row.folderId])).toEqual([["Sketch.excalidraw", DEST.inbox]]);
  });
});
