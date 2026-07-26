// System-browser fold locks: real folder paths (never synthetic groupings),
// root items lead, internal segment names humanize, and search removes
// match-less folders entirely.

import { describe, expect, test } from "bun:test";
import type { NoteSummary } from "../types";
import { filterSystemItems, folderSegmentLabel, groupSystemItems } from "./systemBrowser";

const note = (over: Partial<NoteSummary>): NoteSummary => ({
  id: "n1",
  title: "A note",
  snippet: "words",
  folderId: "wiki/Projects",
  createdAt: 1,
  updatedAt: 10,
  pinned: false,
  ...over,
});

describe("groupSystemItems", () => {
  test("groups by real folder path, root items first, folders alphabetical", () => {
    const groups = groupSystemItems(
      [
        note({ id: "a", folderId: "wiki/Research" }),
        note({ id: "b", folderId: "wiki" }),
        note({ id: "c", folderId: "wiki/Projects/rotli" }),
      ],
      "wiki",
      "",
    );
    expect(groups.map((g) => g.label)).toEqual(["", "Projects › rotli", "Research"]);
    expect(groups[0]?.items.map((n) => n.id)).toEqual(["b"]);
  });

  test("the physical folder wins over a projected one (diskFolderId)", () => {
    const groups = groupSystemItems(
      [note({ folderId: "Shelf/Work", diskFolderId: "wiki/Projects" } as Partial<NoteSummary>)],
      "wiki",
      "",
    );
    expect(groups.map((g) => g.label)).toEqual(["Projects"]);
  });

  test("internal segments humanize; search hides match-less folders", () => {
    expect(folderSegmentLabel("_secure")).toBe("Secure notes");
    expect(folderSegmentLabel("_inbox")).toBe("Captures");
    const groups = groupSystemItems(
      [
        note({ id: "s", title: "Gateway ENV", folderId: "wiki/_secure" }),
        note({ id: "p", title: "Trip plan", folderId: "wiki/Projects" }),
      ],
      "wiki",
      "gateway",
    );
    expect(groups.map((g) => g.label)).toEqual(["Secure notes"]);
    expect(groups[0]?.items.map((n) => n.id)).toEqual(["s"]);
  });

  test("items inside a group float pinned first, then recency", () => {
    const groups = groupSystemItems(
      [
        note({ id: "old", updatedAt: 1 }),
        note({ id: "pinned", updatedAt: 2, pinned: true }),
        note({ id: "new", updatedAt: 9 }),
      ],
      "wiki",
      "",
    );
    expect(groups[0]?.items.map((n) => n.id)).toEqual(["pinned", "new", "old"]);
  });
});

describe("filterSystemItems (List mode)", () => {
  test("empty query keeps everything sorted; a query narrows by title/snippet", () => {
    const items = [note({ id: "a", title: "Alpha" }), note({ id: "b", snippet: "beta words" })];
    expect(filterSystemItems(items, "").length).toBe(2);
    expect(filterSystemItems(items, "beta").map((n) => n.id)).toEqual(["b"]);
    expect(filterSystemItems(items, "zzz")).toEqual([]);
  });
});
