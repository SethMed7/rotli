import { expect, test } from "bun:test";

import type { CanvasFileIo } from "../services/canvasFiles";
import { CANVAS_LOAD_REFUSAL, CANVAS_MAX_BYTES, loadCanvasFile } from "./composition";
import { CANVAS_REFUSAL } from "./model";

const stat = (len: number) => ({ len, revision: "r1", writable: true });

const io = (overrides: Partial<CanvasFileIo>, reads: number[] = []): CanvasFileIo => ({
  stat: async () => stat(20),
  read: async (_id, len) => {
    reads.push(len);
    return '{"nodes":[],"edges":[]}';
  },
  write: async () => "r2",
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

test("it fails closed: no fake blank canvas with nowhere to keep it, no half a file, no gone file", async () => {
  const refused = async (port: CanvasFileIo | null) => {
    const { state, revision } = await loadCanvasFile("wiki/Plan.canvas", port);
    expect(revision).toBeNull();
    return state.status === "error" ? state.error : null;
  };
  expect(await refused(null)).toBe(CANVAS_LOAD_REFUSAL.notHere);
  const reads: number[] = [];
  expect(await refused(io({ stat: async () => null }, reads))).toBe(CANVAS_LOAD_REFUSAL.gone);
  expect(await refused(io({ stat: async () => stat(CANVAS_MAX_BYTES + 1) }, reads))).toBe(
    CANVAS_LOAD_REFUSAL.tooLarge,
  );
  // neither refusal read a byte
  expect(reads).toEqual([]);
  // a parse failure surfaces the parser's own reason
  expect(await refused(io({ read: async () => "[1," }))).toBe(CANVAS_REFUSAL.notJson);
});
