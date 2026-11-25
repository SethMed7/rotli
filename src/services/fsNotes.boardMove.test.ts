// A board's id IS its vault path, so moving one (Trash, Archive, a folder)
// mints a new id. The owner, 2026-11-24: "Couldn't delete this note — note not
// found: storage/excalidraw/Auth staff roles - now vs Dhaval.excalidraw" — the
// board HAD moved to Trash; the adapter then re-read it under its old path, so
// the move reported failure and the tab and sidebar row were left behind.
import { afterEach, expect, test } from "bun:test";

import { FsNotesService } from "./fsNotes";

const host = window as unknown as { __TAURI_INTERNALS__?: unknown };
afterEach(() => {
  delete host.__TAURI_INTERNALS__;
});

const OLD = "storage/excalidraw/Plan.excalidraw";
const NEW = "trash/storage/excalidraw/Plan.excalidraw";

/** Rust's side: the move succeeds and answers the board's NEW path; the old
 * path no longer names anything. */
function nativeBoardMove(calls: string[], kind: "board" | "file" = "board", oldId = OLD, newId = NEW) {
  host.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: { id?: string }) => {
      calls.push(`${cmd}:${args.id ?? ""}`);
      if (cmd === "corpus_move")
        return {
          id: newId,
          title: "Plan",
          snippet: "",
          folderId: "Trash",
          diskFolderId: "trash/storage/excalidraw",
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          kind,
        };
      void oldId;
      throw new Error(`note not found: ${args.id ?? ""}`);
    },
    transformCallback: () => 0,
  };
}

test("trashing a board resolves with the board's new path instead of failing after the move", async () => {
  const calls: string[] = [];
  nativeBoardMove(calls);
  const moved = await new FsNotesService().trashNote(OLD);
  expect(moved.id).toBe(NEW);
  expect(moved.kind).toBe("board");
  expect(moved.folderId).toBe("Trash");
  // never reads a board back through the Markdown note lane
  expect(calls).toEqual([`corpus_move:${OLD}`]);
});

test("a moved note is read back under the id the move answered", async () => {
  const calls: string[] = [];
  host.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: { id?: string }) => {
      calls.push(`${cmd}:${args.id ?? ""}`);
      if (cmd === "corpus_move")
        return {
          id: "work:01NOTE",
          title: "T",
          snippet: "",
          folderId: "work:Archive",
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          kind: "note",
        };
      if (cmd === "corpus_read" && args.id === "work:01NOTE") return { body: "# T\n", revision: "r1" };
      throw new Error(`note not found: ${args.id ?? ""}`);
    },
    transformCallback: () => 0,
  };
  const moved = await new FsNotesService().archiveNote("work:01NOTE");
  expect(moved.body).toBe("# T\n");
  expect(moved.revision).toBe("r1");
  expect(calls).toEqual(["corpus_move:work:01NOTE", "corpus_read:work:01NOTE"]);
});

test("archiving a surfaced file takes the same path lane as a board", async () => {
  const calls: string[] = [];
  const oldFile = "storage/docs/brief.pdf";
  const newFile = "archive/storage/docs/brief.pdf";
  nativeBoardMove(calls, "file", oldFile, newFile);
  const moved = await new FsNotesService().archiveNote(oldFile);
  expect(moved.id).toBe(newFile);
  expect(moved.kind).toBe("file");
  expect(calls).toEqual([`corpus_move:${oldFile}`]);
});
