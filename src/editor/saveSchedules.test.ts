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
    "release flush", // another window finished: quit is refused
    "release write", // v1 lands; only now does the restored text go out
    "release write",
    "quit",
    "release flush",
    "release question",
    "release question",
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
      "release flush",
      "type A",
      "quit",
      "release flush",
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

test("F1: typing while another window is still flushing is caught by the question after every flush", async () => {
  const run = await replay(one(["type", "quit", "release", "advance"]), [
    "quit", // main flushes at once (nothing unsaved); another window is still flushing
    "type A", // nothing is read-only: the person types
    "release flush", // another window finished: every window is asked the immediate question
    "release question", // main answers at once: “A” has a save waiting
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

// The ninth review's findings.

test("2 (reads): a publish that cancelled a read reads again: a newer version on disk isn't left unread", async () => {
  const run = await replay(
    {
      ...one(["type", "refetch", "quiet", "quit", "release", "land", "advance"]),
      caps: { type: 2, refetch: 2 },
    },
    [
      "type A",
      "quit", // Rotli writes “v1”; its answer is delayed
      "land write", // it reached the disk
      "outside A unnoticed", // another app writes, inside the watcher's quiet time
      "refetch A", // a query reads that and waits to deliver
      "release write", // Rotli's answer arrives: publishing cancels that query, and reads again
    ],
  );
  expect(run.failure).toBeNull();
});

test("3: an older answer that is dropped forgives nothing: the person's words are still owed", async () => {
  const run = await replay(one(["type", "refetch", "quit", "release", "advance"]), [
    "type A",
    "refetch A", // reads “base”
    "quit",
    "release write", // “v1” lands
    "release flush",
    "release answer", // the old answer arrives, and is dropped
  ]);
  expect(run.failure).toBeNull();
  expect(run.owed.A).toBe(true);
});

test("4: a deleted note whose file comes back saves again, and quit no longer names it", async () => {
  const run = await replay(
    {
      name: "deleted",
      notes: [{ name: "A" }],
      moves: ["type", "purge", "restore", "quit", "release", "advance"],
    },
    ["type A", "purge A", "quit", "release write", "release flush", "restore A", "release notice", "quit"],
  );
  expect(run.failure).toBeNull();
  expect(run.trace.join("\n")).toContain("(quit refused: 1 save operation failed: “A” was deleted");
});
