import { expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { lonelyWikilink, noteAtPath, notePath } from "./notePaths";

const note = (id: string, title: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: "wiki/Projects",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  ...extra,
});

test("a note's card path round-trips back to the same note", () => {
  const byPath = note("wiki/Books.md", "Books", { folderId: "wiki" });
  const byId = note("01J9ULID", "Q3 plan", { aliases: ["q3-plan", "Q3 plan"] });
  const untitledStem = note("01J9OTHER", "Garden", { diskFolderId: "wiki/Home", folderId: "Main" });
  const notes = [byPath, byId, untitledStem];
  expect(notePath(byPath)).toBe("wiki/Books.md");
  expect(notePath(byId)).toBe("wiki/Projects/q3-plan.md");
  expect(notePath(untitledStem)).toBe("wiki/Home/Garden.md");
  for (const each of notes) expect(noteAtPath(notes, notePath(each))).toBe(each);
  expect(noteAtPath(notes, "wiki/Projects/gone.md")).toBeNull();
});

test("only a link standing alone in a card becomes a note card", () => {
  expect(lonelyWikilink("  [[Books]]\n")).toBe("Books");
  expect(lonelyWikilink("see [[Books]]")).toBeNull();
  expect(lonelyWikilink("[[a]] [[b]]")).toBeNull();
});
