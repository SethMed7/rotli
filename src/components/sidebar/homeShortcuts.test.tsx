import { describe, expect, test } from "bun:test";

import { ALL_NOTES, TASKS } from "../../state/ui";
import { shownShortcuts } from "./homeShortcuts";

describe("the Home rows the keyboard walks", () => {
  test("all three when nothing is hidden, in the order they show", () => {
    expect(shownShortcuts({}, "row:captures").map((row) => row.id)).toEqual([
      ALL_NOTES,
      "row:captures",
      TASKS,
    ]);
  });

  test("a hidden row is skipped, so the cursor never lands on it", () => {
    expect(shownShortcuts({ captures: true }, "row:captures").map((row) => row.id)).toEqual([
      ALL_NOTES,
      TASKS,
    ]);
    // the overview card was never a keyboard row
    expect(shownShortcuts({ overview: true, allNotes: true, tasks: true }, "row:captures")).toEqual([
      { id: "row:captures", kind: "smart" },
    ]);
  });
});
