import { expect, test } from "bun:test";

import { onQuitFlush, runQuitFlushers } from "../lib/quitFlush";
import type { CanvasFileIo } from "../services/canvasFiles";
import { createCanvasSaver } from "./canvasSaver";
import {
  CANVAS_LOAD_REFUSAL,
  CANVAS_MAX_BYTES,
  closeCanvasSaver,
  loadCanvasFile,
  settleUnsavedCanvas,
} from "./composition";
import { CANVAS_REFUSAL } from "./model";

const stat = (len: number) => ({ len, revision: "r1", writable: true });

const utf8 = (text: string) => new TextEncoder().encode(text);

const io = (overrides: Partial<CanvasFileIo>, reads: number[] = []): CanvasFileIo => ({
  stat: async () => stat(20),
  read: async (_id, len) => {
    reads.push(len);
    return utf8('{"nodes":[],"edges":[]}');
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
  expect(await refused(io({ read: async () => utf8("[1,") }))).toBe(CANVAS_REFUSAL.notJson);
});

test("a canvas that isn't UTF-8 is refused, never opened lossily and saved back mangled", async () => {
  const refused = async (bytes: Uint8Array) => {
    const { state, revision } = await loadCanvasFile("wiki/Plan.canvas", io({ read: async () => bytes }));
    expect(revision).toBeNull();
    return state.status === "error" ? state.error : null;
  };
  // a Latin-1 "é" (0xE9) inside a card's text: lossy decoding would turn it
  // into U+FFFD and the next save would write that over the original byte
  const latin1 = Uint8Array.from([
    ...utf8('{"nodes":[{"id":"a","type":"text","text":"caf'),
    0xe9,
    ...utf8('"}]}'),
  ]);
  expect(await refused(latin1)).toBe(CANVAS_LOAD_REFUSAL.notText);
  // a byte-order mark stays refused too: decoding past it would drop it on save
  expect(await refused(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('{"nodes":[],"edges":[]}')]))).toBe(
    CANVAS_REFUSAL.notJson,
  );
  // real UTF-8 beyond ASCII opens as written
  const { state } = await loadCanvasFile(
    "wiki/Plan.canvas",
    io({
      read: async () =>
        utf8(
          '{"nodes":[{"id":"a","type":"text","text":"café ✓","x":0,"y":0,"width":1,"height":1}],"edges":[]}',
        ),
    }),
  );
  expect(state.status === "ready" && state.doc.nodes[0]).toMatchObject({ text: "café ✓" });
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
  await closeCanvasSaver("wiki/Kept.canvas", saver, unregister);
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
  await closeCanvasSaver("wiki/Saved.canvas", saver, () => {
    registered = false;
  });
  expect([calls, registered]).toEqual([1, false]);
});

test("reopening a canvas whose close-save failed lands that save first, so quit never runs two", async () => {
  let writes = 0;
  let failing = true;
  const saver = createCanvasSaver({
    revision: "r1",
    delayMs: 500,
    schedule: () => null,
    cancel: () => {},
    write: async () => {
      writes += 1;
      if (failing) throw new Error("disk full");
      return "r2";
    },
    onSaved: () => {},
    onError: () => {},
  });
  const unregister = onQuitFlush(() => saver.flush());
  saver.queue({ nodes: [], edges: [] });
  await closeCanvasSaver("wiki/Reopened.canvas", saver, unregister);
  // still failing: the canvas won't open over the edit it hasn't kept
  await expect(settleUnsavedCanvas("wiki/Reopened.canvas")).rejects.toThrow("disk full");
  failing = false;
  await settleUnsavedCanvas("wiki/Reopened.canvas");
  const landed = writes;
  // the old saver is gone from quit; nothing is left to run twice
  await runQuitFlushers();
  await settleUnsavedCanvas("wiki/Reopened.canvas");
  expect(writes).toBe(landed);
});
