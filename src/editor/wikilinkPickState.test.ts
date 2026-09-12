import { expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { wikilinkChoices, wikilinkPickAt } from "./wikilinkPickState";

const note = (
  id: string,
  title: string,
  updatedAt: number,
  extra: Partial<NoteSummary> = {},
): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: "Inbox",
  createdAt: updatedAt,
  updatedAt,
  pinned: false,
  kind: "note",
  ...extra,
});

test("an open [[ before the caret is a pick span; closed links and code are not", () => {
  expect(wikilinkPickAt("see [[Pri", 9)).toEqual({ open: 4, to: 9, query: "Pri" });
  expect(wikilinkPickAt("[[", 2)).toEqual({ open: 0, to: 2, query: "" });
  expect(wikilinkPickAt("see [[Pricing]] and", 19)).toBeNull();
  expect(wikilinkPickAt("see [[Pri]]", 9)).toBeNull();
  expect(wikilinkPickAt("`[[Pri", 6)).toBeNull();
  expect(wikilinkPickAt("plain text", 5)).toBeNull();
});

test("choices rank title prefixes, then aliases, then substrings, newest first, notes only", () => {
  const notes = [
    note("a", "Pricing decision", 10),
    note("b", "Old pricing", 5),
    note("c", "Prism", 20),
    note("d", "Budget", 30, { aliases: ["Pricing plan"] }),
    note("e", "Pricing.xlsx", 40, { kind: "file" }),
    note("f", "Board", 50, { kind: "board" }),
  ];
  expect(wikilinkChoices(notes, "pri").map((n) => n.id)).toEqual(["c", "a", "d", "b"]);
  expect(wikilinkChoices(notes, "").map((n) => n.id)).toEqual(["d", "c", "a", "b"]);
  expect(wikilinkChoices(notes, "zzz")).toEqual([]);
  expect(wikilinkChoices(notes, "", 2)).toHaveLength(2);
});
