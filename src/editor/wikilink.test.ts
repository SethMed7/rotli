import { describe, expect, test } from "bun:test";
import type { NoteSummary } from "../types";
import {
  buildTitleCounts,
  buildWikilinkIndex,
  resolveWikilink,
  wikilinkLabel,
} from "./wikilink";
import { filterSlashItems } from "./SlashMenu";

const note = (id: string, title: string): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: "Inbox",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
});

describe("wikilink", () => {
  test("wikilinkLabel uses title when unique", () => {
    const notes = [note("a", "Alpha"), note("b", "Beta")];
    expect(wikilinkLabel(notes[0]!, buildTitleCounts(notes))).toBe("Alpha");
  });

  test("wikilinkLabel uses id when titles collide", () => {
    const notes = [note("path/a", "Same"), note("path/b", "Same")];
    expect(wikilinkLabel(notes[0]!, buildTitleCounts(notes))).toBe("path/a");
  });

  test("resolveWikilink by id", () => {
    const index = buildWikilinkIndex([note("path/x", "X")]);
    expect(resolveWikilink("path/x", index)).toBe("path/x");
  });

  test("resolveWikilink by unique title", () => {
    const index = buildWikilinkIndex([note("path/x", "My Note")]);
    expect(resolveWikilink("My Note", index)).toBe("path/x");
  });

  test("resolveWikilink returns null for ambiguous title", () => {
    const index = buildWikilinkIndex([note("a", "Dup"), note("b", "Dup")]);
    expect(resolveWikilink("Dup", index)).toBeNull();
  });
});

describe("filterSlashItems", () => {
  test("matches keywords (wiki, excalidraw, xlsx)", () => {
    expect(filterSlashItems("wiki").some((i) => i.label === "Link note")).toBe(true);
    expect(filterSlashItems("excalidraw").some((i) => i.label === "Board")).toBe(true);
    expect(filterSlashItems("xlsx").some((i) => i.label === "Sheet")).toBe(true);
  });
});
