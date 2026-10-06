import { expect, test } from "bun:test";

import { onQuitFlush, runQuitFlushers } from "../lib/quitFlush";
import type { CanvasFileIo } from "../services/canvasFiles";
import { createCanvasSaver } from "./canvasSaver";
import { CANVAS_LOAD_REFUSAL, CANVAS_MAX_BYTES, closeCanvasSaver, loadCanvasFile } from "./composition";
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
  // a file that went away between the look and the read is gone, never empty
  expect(await refused(io({ read: async () => null }))).toBe(CANVAS_LOAD_REFUSAL.gone);
  // a parse failure surfaces the parser's own reason
  expect(await refused(io({ read: async () => "[1," }))).toBe(CANVAS_REFUSAL.notJson);
});

test("closing a canvas whose save fails keeps the edit for quit, which retries it", async () => {
  let disk = "";
  let failing = true;
  const saver = createCanvasSaver({
    revision: "r1",
    delayMs: 500,
    schedule: () => null,
    cancel: () => {},
    write: async (text) => {
      if (failing) throw new Error("disk full");
      disk = text;
      return "r2";
    },
    onSaved: () => {},
    onError: () => {},
  });
  const unregister = onQuitFlush(() => saver.flush());
  saver.queue({ nodes: [], edges: [] });
  await closeCanvasSaver(saver, unregister);
  // the tab is gone, but quit still holds the edit and refuses to lose it
  await expect(runQuitFlushers()).rejects.toThrow("disk full");
  failing = false;
  await runQuitFlushers();
  expect(JSON.parse(disk)).toEqual({ nodes: [], edges: [] });
  unregister();
});

test("closing a canvas that saved lets go of quit", async () => {
  let calls = 0;
  const saver = createCanvasSaver({
    revision: "r1",
    delayMs: 500,
    schedule: () => null,
    cancel: () => {},
    write: async () => {
      calls += 1;
      return `r${calls + 1}`;
    },
    onSaved: () => {},
    onError: () => {},
  });
  let registered = true;
  saver.queue({ nodes: [], edges: [] });
  await closeCanvasSaver(saver, () => {
    registered = false;
  });
  expect([calls, registered]).toEqual([1, false]);
});
