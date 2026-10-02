import { describe, expect, test } from "bun:test";

import type { NoteSummary, SearchHit } from "../types";
import {
  PICKER_STATUS,
  pickableNotes,
  pickerResults,
  pickerStatus,
  quickNoteTitle,
  titleMatchTier,
} from "./quickNoteList";

// The picker and header never show a blank note as "Untitled" (the maintainer,
// 2026-09-23): the blank note you are typing into is the open "New note", and
// ⌘N reuses it rather than making another.

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

// ⌘P searches note TEXT (#23): titles answer instantly, the full-text engine
// adds what only the body holds, and a title match never sits beneath it.

const hit = (id: string, rank = 2): SearchHit => ({
  id,
  title: id,
  snippet: "",
  folderId: "Inbox",
  kind: "note",
  rank,
  matchStart: 0,
  matchLen: 0,
  spans: [],
  updatedAt: 0,
});

const ids = (rows: NoteSummary[]) => rows.map((n) => n.id);

describe("titleMatchTier", () => {
  test("ranks prefix, word start, substring, all words, then subsequence", () => {
    expect(titleMatchTier("gro", "Groceries")).toBe(0);
    expect(titleMatchTier("fri", "Groceries for Friday")).toBe(1);
    expect(titleMatchTier("ceri", "Groceries")).toBe(2);
    expect(titleMatchTier("friday groceries", "Groceries for Friday")).toBe(3);
    expect(titleMatchTier("gcs", "Groceries")).toBe(4);
    expect(titleMatchTier("zz", "Groceries")).toBeNull();
    expect(titleMatchTier("  ", "Groceries")).toBeNull();
  });

  test("folds case and diacritics on both sides", () => {
    expect(titleMatchTier("cafe", "Café plans")).toBe(0);
    expect(titleMatchTier("RÉSUMÉ", "Resume draft")).toBe(0);
    expect(titleMatchTier("senor", "Notes for el Señor")).toBe(1);
  });
});

describe("pickerResults", () => {
  const notes = [
    note({ id: "recipes", title: "Recipes", snippet: "soup" }),
    note({ id: "trip", title: "Trip to Lisbon", snippet: "pack the passport" }),
    note({ id: "passport", title: "Passport renewal" }),
    note({ id: "blank", title: "Untitled", bodyEmpty: true }),
    note({ id: "named-blank", title: "Packing list", bodyEmpty: true }),
  ];

  test("an empty query lists written notes, pinned first", () => {
    const rows = pickerResults({ notes, query: "", pinned: new Set(["passport"]), hits: undefined });
    expect(ids(rows)).toEqual(["passport", "recipes", "trip"]);
  });

  test("a title match outranks a body-only hit even when the engine ranked it lower", () => {
    const rows = pickerResults({
      notes,
      query: "passport",
      pinned: new Set(),
      hits: [hit("trip", 2), hit("passport", 0)],
    });
    expect(ids(rows)).toEqual(["passport", "trip"]);
  });

  test("body-only hits arrive in the engine's order; unopenable ids are dropped", () => {
    const rows = pickerResults({
      notes,
      query: "soup lisbon",
      pinned: new Set(),
      hits: [hit("board-elsewhere"), hit("recipes", 3), hit("trip", 3), hit("trip", 3)],
    });
    expect(ids(rows)).toEqual(["recipes", "trip"]);
  });

  test("before the body search settles, only instant title matches show", () => {
    const rows = pickerResults({ notes, query: "pass", pinned: new Set(), hits: undefined });
    expect(ids(rows)).toEqual(["passport"]);
  });

  test("a blank note is findable by name, never by a stray subsequence", () => {
    expect(ids(pickerResults({ notes, query: "packing", pinned: new Set(), hits: undefined }))).toEqual([
      "named-blank",
    ]);
    expect(ids(pickerResults({ notes, query: "utd", pinned: new Set(), hits: undefined }))).toEqual([]);
  });

  test("pinned breaks ties inside a title tier, never across tiers", () => {
    const rows = pickerResults({
      notes: [
        note({ id: "a", title: "Plan A" }),
        note({ id: "b", title: "Plan B" }),
        note({ id: "c", title: "The plan" }),
      ],
      query: "plan",
      pinned: new Set(["b", "c"]),
      hits: undefined,
    });
    expect(ids(rows)).toEqual(["b", "a", "c"]);
  });
});

describe("pickerStatus", () => {
  test("never presents a partial list as the whole answer", () => {
    const base = { query: "pass", rows: 1, notesReady: true } as const;
    expect(pickerStatus({ ...base, notesReady: false, search: "settled" })).toBe(PICKER_STATUS.loading);
    expect(pickerStatus({ ...base, search: "pending" })).toBe(PICKER_STATUS.searching);
    expect(pickerStatus({ ...base, search: "failed" })).toBe(PICKER_STATUS.failed);
    expect(pickerStatus({ ...base, search: "settled" })).toBeNull();
    // "nothing matches" only once nothing is still on its way
    expect(pickerStatus({ ...base, rows: 0, search: "pending" })).toBe(PICKER_STATUS.searching);
    expect(pickerStatus({ ...base, rows: 0, search: "settled" })).toBe(PICKER_STATUS.noMatch);
    expect(pickerStatus({ ...base, query: "", rows: 0, search: "idle" })).toBe(PICKER_STATUS.noNotes);
  });
});
