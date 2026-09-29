// Empty Trash (2026-09-27, the test-suite audit): the only hard-delete flow.
// The Mac app purges each item through Rust; Rotli Web deletes through its
// notes service; a partial failure reports honest progress. `mock.module` is
// process-wide, so every mock spreads a SNAPSHOT and afterAll restores it.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as liveVault from "../lib/browserVault";
import * as liveTauri from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { DEST } from "./destinations";
import { notesService } from "./notes";

const realVault = { ...liveVault };
const realTauri = { ...liveTauri };

let web = false;
let purged: string[] = [];
let refuse = new Set<string>();

void mock.module("../lib/browserVault", () => ({ ...realVault, isWebVault: () => web }));
void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusPurge: async (id: string) => {
    if (refuse.has(id)) throw new Error("not in Trash");
    purged.push(id);
    await notesService.deleteNote(id);
  },
}));

afterAll(() => {
  void mock.module("../lib/browserVault", () => realVault);
  void mock.module("../lib/tauri", () => realTauri);
});

const { emptyTrash } = await import("./systemTrash");

async function trashed(titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const note = await notesService.createNote(DEST.inbox, `# ${title}\n\nOld.`);
    await notesService.trashNote(note.id);
    ids.push(note.id);
  }
  return ids;
}

beforeEach(async () => {
  web = false;
  purged = [];
  refuse = new Set();
  useUiStore.getState().setRowActionError(null);
  for (const leftover of await notesService.listNotes(DEST.trash)) await notesService.deleteNote(leftover.id);
});

describe("Empty Trash", () => {
  test("the Mac app purges every item through Rust and reports a partial failure honestly", async () => {
    const [a, b, c] = await trashed(["Receipt", "Draft", "Scrap"]);
    refuse = new Set([b!]);
    expect(await emptyTrash()).toEqual({ purged: 2, failed: 1 });
    expect(purged.sort()).toEqual([a!, c!].sort());
    expect(useUiStore.getState().rowActionError).toMatch(
      /^Emptied 2 of 3 — 1 couldn’t be deleted \(not in Trash\)\./,
    );
    expect((await notesService.listNotes(DEST.trash)).map((note) => note.id)).toEqual([b!]);
  });

  test("Rotli Web deletes through its notes service and never calls the Rust purge", async () => {
    web = true;
    await trashed(["Old plan", "Spare copy"]);
    expect(await emptyTrash()).toEqual({ purged: 2, failed: 0 });
    expect(purged).toEqual([]);
    expect(await notesService.listNotes(DEST.trash)).toEqual([]);
    expect(useUiStore.getState().rowActionError).toBeNull();
  });

  test("an empty Trash is a quiet no-op", async () => {
    expect(await emptyTrash()).toEqual({ purged: 0, failed: 0 });
    expect(useUiStore.getState().rowActionError).toBeNull();
  });
});
