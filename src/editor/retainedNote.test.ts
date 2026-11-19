// A note whose file vanished (deleted outside) keeps showing its retained
// words (ninth review of pull request 267: the editor rendered nothing).
import { expect, test } from "bun:test";

import { adoptReadNote, evictDocument, retainedNote } from "./model";

test("a note whose file vanished still shows its retained words, while its buffer is here", () => {
  const note = {
    id: "vanished",
    title: "Plan",
    snippet: "",
    folderId: "Inbox",
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    body: "# Plan",
    revision: "r1",
    readAt: 1,
  };
  adoptReadNote(note);
  expect(retainedNote("vanished")?.title).toBe("Plan");
  evictDocument("vanished");
  expect(retainedNote("vanished")).toBeUndefined();
});
