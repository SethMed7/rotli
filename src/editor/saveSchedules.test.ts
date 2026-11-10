// The seventh review's three save findings, as plain schedules replayed in the
// save-state explorer's world (saveExplorer.fixtures.ts): each checks I1 to I5
// after every move and at the end, and the trace says what the person saw.
import { expect, test } from "bun:test";

import type { Scenario } from "./saveExplorer.fixtures";
import { replay } from "./saveExplorerSearch.fixtures";

const one = (moves: Scenario["moves"]): Scenario => ({ name: "one note", notes: [{ name: "A" }], moves });

test("1: a write past its bound, then undo: quit is refused until that write settles, and the restored words land last", async () => {
  const run = await replay(one(["type", "undo", "quit", "release", "advance"]), [
    "type A",
    "quit", // the write of v1 goes out and is held
    "advance", // 8 s: the note says it is taking longer than expected
    "undo A", // back to the saved words; nothing new starts beside v1
    "advance",
    "advance", // 12 s: the note's flush gives up, naming the note
    "release flusher", // another window finishes: quit is refused
    "release write", // v1 lands; only now does the restored text go out
    "release write",
    "quit",
    "release flusher",
  ]);
  expect(run.failure).toBeNull();
  expect(run.trace.join("\n")).toContain("“A” is still waiting on the disk");
});

test("2: a deleted note's words stay in its editor; quit names it until they are discarded", async () => {
  const run = await replay(
    {
      name: "deleted",
      notes: [{ name: "A", secure: true }],
      moves: ["type", "purge", "discard", "quit", "release", "advance"],
      caps: { type: 2 },
    },
    [
      "type A",
      "purge A",
      "quit",
      "release write",
      "release flusher",
      "type A",
      "quit",
      "release flusher",
      "discard A",
      "quit",
    ],
  );
  expect(run.failure).toBeNull();
  expect(run.trace.join("\n")).toContain(
    "“A” was deleted while it had unsaved words: copy them, or discard them",
  );
});

test("3: a read that never settles doesn't hold the note's queue: it is left behind at the bound", async () => {
  const run = await replay(
    {
      name: "conflict",
      notes: [{ name: "A" }],
      moves: ["type", "outside", "quit", "release", "never", "advance"],
    },
    ["type A", "outside A", "release notice", "quit", "release write", "never read", "advance"],
  );
  expect(run.failure).toBeNull();
});

// The eighth review's save findings, as the explorer found them on 1880e044.

test("F1: typing while another window is still flushing refuses the quit, never acknowledges it unsaved", async () => {
  const run = await replay(one(["type", "quit", "release", "advance"]), [
    "quit",
    "type A", // the editors are read-only now; a keystroke that slips in must refuse the quit
    "release flusher",
  ]);
  expect(run.failure).toBeNull();
  expect(run.trace.join("\n")).toContain("(quit refused: “A”");
});

test("F2: a query's answer older than a save that landed is dropped, not shown as saved", async () => {
  const run = await replay(
    { ...one(["type", "refetch", "quit", "release", "advance"]), caps: { type: 2, refetch: 2 } },
    ["type A", "refetch A", "quit", "release write", "release answer"],
  );
  expect(run.failure).toBeNull();
});

test("F6: a conflict copy counts only because the notice names it", async () => {
  const run = await replay(
    {
      name: "conflict",
      notes: [{ name: "A", secure: true, locked: true }],
      moves: ["type", "outside", "quit", "release", "advance"],
    },
    ["type A", "outside A", "quit", "release notice", "release write"],
  );
  expect(run.failure).toBeNull();
});
