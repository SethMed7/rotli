import { expect, test } from "bun:test";

import { joinCaptureBodies } from "./captureMerge";
import { routeDecision } from "./createNote";
import { DEST } from "./destinations";

test("capture bodies join oldest-first with one blank line and empties dropped", () => {
  expect(joinCaptureBodies(["  first  ", "", null, "second\n", undefined, "third"])).toBe(
    "first\n\nsecond\n\nthird",
  );
  expect(joinCaptureBodies([])).toBe("");
});

test("a merged capture routes like a smart-row creation: memex staging when writable, else Inbox", () => {
  // the Captures view is a reserved root, never a direct write target
  expect(routeDecision(DEST.board, true, true, DEST.inbox)).toEqual({ kind: "memex" });
  expect(routeDecision(DEST.board, true, false, DEST.inbox)).toEqual({ kind: "local", folder: DEST.inbox });
});
