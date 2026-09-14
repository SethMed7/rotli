import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { filterSlashItems, slashQueryAtCaret } from "./slashMenu";
import {
  buildTitleCounts,
  buildWikilinkIndex,
  editorLinkOpensOnClick,
  resolveWikilink,
  wikilinkLabel,
} from "./wikilink";

const note = (id: string, title: string): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: "Inbox",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
});

const aliasedNote = (id: string, title: string, aliases: string[]): NoteSummary => ({
  ...note(id, title),
  aliases,
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

  test("resolveWikilink by filename or rename alias without case sensitivity", () => {
    const index = buildWikilinkIndex([
      aliasedNote("path/x", "The 3-stage infrastructure plan", [
        "the-3-stage-infrastructure-plan",
        "northstar-stage-plan",
      ]),
    ]);
    expect(resolveWikilink("northstar-stage-plan", index)).toBe("path/x");
    expect(resolveWikilink("NORTHSTAR-STAGE-PLAN", index)).toBe("path/x");
  });

  test("resolveWikilink refuses an ambiguous alias", () => {
    const index = buildWikilinkIndex([
      aliasedNote("a", "First", ["shared-name"]),
      aliasedNote("b", "Second", ["shared-name"]),
    ]);
    expect(resolveWikilink("shared-name", index)).toBeNull();
  });

  test("resolveWikilink returns null for ambiguous title", () => {
    const index = buildWikilinkIndex([note("a", "Dup"), note("b", "Dup")]);
    expect(resolveWikilink("Dup", index)).toBeNull();
  });

  test("resolveWikilink strips display alias, heading fragment, and .md", () => {
    const index = buildWikilinkIndex([note("path/x", "My Note")]);
    expect(resolveWikilink("My Note|shown text", index)).toBe("path/x");
    expect(resolveWikilink("My Note#Section", index)).toBe("path/x");
    expect(resolveWikilink("My Note.md", index)).toBe("path/x");
  });

  test("resolveWikilink falls back to the last segment of a path-style target", () => {
    const index = buildWikilinkIndex([note("wiki/projects/x.md", "My Note")]);
    expect(resolveWikilink("projects/My Note", index)).toBe("wiki/projects/x.md");
  });

  test("a normal click opens a note link while web links keep the command-click guard", () => {
    expect(editorLinkOpensOnClick("note", 0, false)).toBe(true);
    expect(editorLinkOpensOnClick("web", 0, false)).toBe(false);
    expect(editorLinkOpensOnClick("web", 0, true)).toBe(true);
    expect(editorLinkOpensOnClick("note", 2, true)).toBe(false);
  });
});

describe("filterSlashItems", () => {
  test("matches keywords (wiki, excalidraw, xlsx, docx)", () => {
    expect(filterSlashItems("wiki").some((i) => i.label === "Link note")).toBe(true);
    expect(filterSlashItems("excalidraw").some((i) => i.label === "Board")).toBe(true);
    expect(filterSlashItems("xlsx", { sheets: true }).some((i) => i.label === "Sheet")).toBe(true);
    // a build without sheets offers no spreadsheet embed at all
    expect(filterSlashItems("sheet", { sheets: false }).some((i) => i.label === "Sheet")).toBe(false);
    expect(filterSlashItems("", { sheets: false }).length).toBe(
      filterSlashItems("", { sheets: true }).length - 1,
    );
    expect(filterSlashItems("docx").some((i) => i.label === "Document")).toBe(true);
  });

  test("supports multi-word labels and keeps unmatched text editable", () => {
    expect(filterSlashItems("code block").map((i) => i.label)).toEqual(["Code block"]);
    expect(filterSlashItems("not a command")).toEqual([]);
  });

  test("a slash query must own the line and trail the caret", () => {
    expect(slashQueryAtCaret("/code block", 11)).toBe("code block");
    expect(slashQueryAtCaret("1. /", 4)).toBe("");
    expect(slashQueryAtCaret("  - /code", 9)).toBe("code");
    expect(slashQueryAtCaret("- [ ][ ] /table", 15)).toBe("table");
    expect(slashQueryAtCaret("/code block", 5)).toBeNull();
    expect(slashQueryAtCaret("prefix /code", 12)).toBeNull();
    expect(slashQueryAtCaret("//code", 6)).toBeNull();
  });
});
