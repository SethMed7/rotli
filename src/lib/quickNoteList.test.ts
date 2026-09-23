import { expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { pickableNotes, quickNoteTitle } from "./quickNoteList";

// The picker and header never show a blank note as "Untitled" (the maintainer,
// 2026-09-23): the blank note you are typing into is the open "New note", and
// an abandoned one is discarded rather than listed.

const note = (over: Partial<NoteSummary>): NoteSummary => ({
  id: "n1",
  title: "Groceries",
  snippet: "",
  folderId: "Inbox",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  ...over,
});

test("the picker leaves out blank notes and keeps everything written", () => {
  const listed = pickableNotes([
    note({ id: "blank", title: "Untitled", bodyEmpty: true }),
    note({ id: "written", title: "Groceries", bodyEmpty: false }),
    note({ id: "older-fixture", title: "Plan" }),
  ]);
  expect(listed.map((n) => n.id)).toEqual(["written", "older-fixture"]);
});

test("the header calls a blank or not-yet-listed note a new note", () => {
  expect(quickNoteTitle(note({ title: "Untitled", bodyEmpty: true }))).toBe("New note");
  expect(quickNoteTitle(undefined)).toBe("New note");
  expect(quickNoteTitle(note({ title: "Groceries", bodyEmpty: false }))).toBe("Groceries");
});
