// Board autosave must never lose the last strokes (the owner, 2026-11-24:
// errors "any time I mess with a board", including saves that didn't stick).
// A save of a big board can outlast the 500 ms debounce; the next save used to
// start alongside it with the OLD revision, Rust refused it ("revision
// conflict"), and the refused strokes were never written again.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";

import * as liveStore from "../services/boardStore";

const realStore = { ...liveStore };

let disk = { body: "v0", rev: "r0" };
let revs = 0;
let writeDelayMs = 0;
let inFlight = 0;
let maxInFlight = 0;

function outsideEdit(body: string): void {
  disk = { body, rev: `r${++revs}` };
}

void mock.module("../services/boardStore", () => ({
  ...realStore,
  boardsAvailable: () => true,
  boardStore: () => ({
    read: async () => ({ body: disk.body, revision: disk.rev }),
    write: async (_id: string, body: string, expected: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, writeDelayMs));
        if (expected !== disk.rev) {
          throw new Error(
            `revision conflict: expected ${expected}, found ${disk.rev}; the file changed after it was opened`,
          );
        }
        outsideEdit(body);
        return { revision: disk.rev };
      } finally {
        inFlight -= 1;
      }
    },
    create: async () => ({ id: "x" }),
    rename: async () => ({ id: "x" }),
    reveal: null,
  }),
}));

afterAll(() => {
  void mock.module("../services/boardStore", () => realStore);
});

const { createCorpusBoardSaver } = await import("./composition");
const { BOARD_SAVE_DEBOUNCE_MS } = await import("./session");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  disk = { body: "v0", rev: "r0" };
  revs = 0;
  inFlight = 0;
  maxInFlight = 0;
  writeDelayMs = BOARD_SAVE_DEBOUNCE_MS + 300;
});

test("strokes drawn while a slow save is in flight still reach the disk", async () => {
  const results: (string | null)[] = [];
  const saver = createCorpusBoardSaver("storage/excalidraw/x.excalidraw", (e) => results.push(e));
  saver.prime("v0", "r0");
  saver.schedule(() => "stroke-1");
  await wait(BOARD_SAVE_DEBOUNCE_MS + 100); // the first save is now writing
  saver.schedule(() => "stroke-1+2"); // keep drawing, then stop
  await wait(BOARD_SAVE_DEBOUNCE_MS + 100);
  await saver.flush(); // the tab closes
  expect(disk.body).toBe("stroke-1+2");
  expect(maxInFlight).toBe(1);
  expect(results.filter((r) => r !== null)).toEqual([]);
});

test("a metadata save during an autosave waits its turn instead of colliding", async () => {
  const results: (string | null)[] = [];
  const saver = createCorpusBoardSaver("storage/excalidraw/x.excalidraw", (e) => results.push(e));
  saver.prime("v0", "r0");
  saver.schedule(() => "stroke-1");
  await wait(BOARD_SAVE_DEBOUNCE_MS + 100);
  saver.saveNow("stroke-1+tags");
  await saver.flush();
  expect(disk.body).toBe("stroke-1+tags");
  expect(maxInFlight).toBe(1);
  expect(results.filter((r) => r !== null)).toEqual([]);
});

test("a real outside edit is still refused and reported, never overwritten", async () => {
  writeDelayMs = 0;
  const results: (string | null)[] = [];
  const saver = createCorpusBoardSaver("storage/excalidraw/x.excalidraw", (e) => results.push(e));
  saver.prime("v0", "r0");
  outsideEdit("agent-edit"); // another process rewrote the board
  saver.schedule(() => "mine");
  await saver.flush().catch(() => {});
  expect(disk.body).toBe("agent-edit");
  expect(results.at(-1)).toContain("revision conflict");
});
