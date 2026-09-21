// The Main store against a fake `.rotli/main.json` that something else (the
// CLI, the Librarian) can write behind the app's back. The reproduction this
// file exists for: one revision conflict used to leave `dirty` set, which
// locked hydrateMain out and failed EVERY later Main edit until a restart.
//
// `mock.module` is process-wide and outlives this file, so the mock spreads
// the REAL module and afterAll puts the real one back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as realTauri from "../lib/tauri";
import { type MainNode, parseMainManifest, serializeMainManifest } from "../services/mainTree";

let disk = { contents: "", revision: "r0" };
let writes = 0;

function externalWrite(tree: MainNode[]): void {
  disk = { contents: serializeMainManifest({ version: 1, tree }), revision: `${disk.revision}x` };
}

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  hasDurableCorpus: () => true,
  corpusMainRead: async () => disk,
  corpusMainWrite: async (contents: string, expectedRevision: string) => {
    if (expectedRevision !== disk.revision) {
      throw new Error(
        `revision conflict: expected ${expectedRevision}, found ${disk.revision}; the file changed after it was opened`,
      );
    }
    writes += 1;
    disk = { contents, revision: `${disk.revision}+` };
    return disk.revision;
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});

const { MAIN_RELOADED_NOTICE, hydrateMain, useMainStore } = await import("./main");

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const diskTree = () => parseMainManifest(disk.contents).tree;

const base: MainNode[] = [{ note: "a" }, { folder: "Work", children: [{ note: "b" }] }];

beforeEach(async () => {
  disk = { contents: serializeMainManifest({ version: 1, tree: base }), revision: "r1" };
  writes = 0;
  useMainStore.setState({ dirty: false, error: null, saveState: "idle" });
  await hydrateMain();
});

describe("Main survives a write from outside the app", () => {
  test("a note the CLI filed is kept under a local drag, with no message", async () => {
    externalWrite([...base, { note: "cli" }]);
    const dragged: MainNode[] = [{ folder: "Work", children: [{ note: "b" }, { note: "a" }] }];
    useMainStore.getState().setTree(dragged);
    await settle();

    const merged = [...dragged, { note: "cli" }];
    expect(useMainStore.getState()).toMatchObject({ saveState: "saved", error: null, dirty: false });
    expect(useMainStore.getState().manifest.tree).toEqual(merged);
    expect(diskTree()).toEqual(merged);
  });

  test("two rearrangements show the disk version in plain words — and the NEXT edit saves", async () => {
    externalWrite([{ folder: "Work", children: [{ note: "b" }] }, { note: "a" }]);
    useMainStore.getState().setTree([{ folder: "Work", children: [{ note: "b" }, { note: "a" }] }]);
    await settle();

    const state = useMainStore.getState();
    expect(state.error).toBe(MAIN_RELOADED_NOTICE);
    expect(state.error).not.toContain("revision");
    expect(state.dirty).toBe(false);
    expect(state.manifest.tree).toEqual(diskTree());
    expect(writes).toBe(0);

    // the wedge: before the fix this edit (and every one after it) failed too
    const next: MainNode[] = [
      { note: "a" },
      { folder: "Work", children: [{ note: "b" }] },
      { folder: "New", children: [] },
    ];
    useMainStore.getState().setTree(next);
    await settle();
    expect(useMainStore.getState()).toMatchObject({ saveState: "saved", error: null, dirty: false });
    expect(diskTree()).toEqual(next);
  });

  test("an external reload is never locked out after a conflict", async () => {
    externalWrite([{ folder: "Work", children: [{ note: "b" }] }, { note: "a" }]);
    useMainStore.getState().setTree([{ folder: "Work", children: [{ note: "b" }, { note: "a" }] }]);
    await settle();

    externalWrite([{ note: "only" }]);
    await hydrateMain();
    expect(useMainStore.getState().manifest.tree).toEqual([{ note: "only" }]);
    expect(useMainStore.getState().error).toBeNull();
  });

  test("a real save failure still says what failed", async () => {
    const real = disk;
    disk = { ...real, revision: "" };
    await hydrateMain();
    useMainStore.getState().setTree([{ note: "a" }]);
    await settle();
    expect(useMainStore.getState().error).toContain(
      "Couldn’t save Main — The vault projection has no revision",
    );
    disk = real;
  });
});
