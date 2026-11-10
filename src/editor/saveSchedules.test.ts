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
    "advance", // 12 s: quit is refused, naming the note
    "release write", // v1 lands; only now does the restored text go out
    "release write",
    "quit",
  ]);
  expect(run.failure).toBeNull();
  expect(run.trace.join("\n")).toContain("(quit refused: “A” is still waiting on the disk");
});

test("2: keep a deleted note's words, type while the note is made: the newest words go to that one note", async () => {
  const run = await replay(
    {
      name: "deleted",
      notes: [{ name: "A", secure: true }],
      moves: ["type", "purge", "keep", "quit", "release", "advance"],
      caps: { type: 2 },
    },
    ["type A", "purge A", "quit", "release write", "keep A", "type A", "release create", "quit"],
  );
  expect(run.failure).toBeNull();
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
