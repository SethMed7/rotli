import { expect, test } from "bun:test";

import type { FileStat } from "../lib/tauri";
import { CANVAS_LOAD_REFUSAL, CANVAS_MAX_BYTES, type CanvasFileIo, loadCanvasFile } from "./composition";
import { CANVAS_REFUSAL } from "./model";

const stat = (len: number): FileStat =>
  ({ len, revision: "r1", writable: true, lifecycleMutable: false, lifecycleReason: null }) as FileStat;

const io = (overrides: Partial<CanvasFileIo>, reads: number[] = []): CanvasFileIo => ({
  native: () => true,
  stat: async () => stat(20),
  text: async (_id, maxBytes) => {
    reads.push(maxBytes ?? -1);
    return '{"nodes":[],"edges":[]}';
  },
  ...overrides,
});

test("a canvas loads whole: the read asks for every byte the file has", async () => {
  const reads: number[] = [];
  const loaded = await loadCanvasFile("wiki/Plan.canvas", io({}, reads));
  expect(loaded.state).toEqual({
    status: "ready",
    doc: { nodes: [], edges: [] },
    writable: true,
    saveError: null,
  });
  expect(loaded.revision).toBe("r1");
  expect(reads).toEqual([20]);
});

test("it fails closed: no fake blank canvas off the Mac app, no half a file, no gone file", async () => {
  const refused = async (overrides: Partial<CanvasFileIo>) => {
    const reads: number[] = [];
    const { state, revision } = await loadCanvasFile("wiki/Plan.canvas", io(overrides, reads));
    expect(revision).toBeNull();
    return { error: state.status === "error" ? state.error : null, reads };
  };
  expect(await refused({ native: () => false })).toEqual({
    error: CANVAS_LOAD_REFUSAL.notHere,
    reads: [],
  });
  expect(await refused({ stat: async () => null })).toEqual({
    error: CANVAS_LOAD_REFUSAL.gone,
    reads: [],
  });
  expect(await refused({ stat: async () => stat(CANVAS_MAX_BYTES + 1) })).toEqual({
    error: CANVAS_LOAD_REFUSAL.tooLarge,
    reads: [],
  });
  // a parse failure surfaces the parser's own reason
  expect((await refused({ text: async () => "[1," })).error).toBe(CANVAS_REFUSAL.notJson);
});
