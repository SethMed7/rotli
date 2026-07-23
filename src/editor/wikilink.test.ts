import { describe, expect, test } from "bun:test";
import type { NoteSummary } from "../types";
import {
  buildTitleCounts,
  buildWikilinkIndex,
  editorLinkOpensOnClick,
  resolveWikilink,
  wikilinkLabel,
} from "./wikilink";
import { filterSlashItems, slashQueryAtCaret } from "./slashMenu";

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
    expect(filterSlashItems("xlsx").some((i) => i.label === "Sheet")).toBe(true);
    expect(filterSlashItems("docx").some((i) => i.label === "Document")).toBe(true);
  });

  test("supports multi-word labels and keeps unmatched text editable", () => {
    expect(filterSlashItems("code block").map((i) => i.label)).toEqual(["Code block"]);
    expect(filterSlashItems("not a command")).toEqual([]);
  });

  test("a slash query must own the line and trail the caret", () => {
    expect(slashQueryAtCaret("/code block", 11)).toBe("code block");
    expect(slashQueryAtCaret("/code block", 5)).toBeNull();
    expect(slashQueryAtCaret("prefix /code", 12)).toBeNull();
    expect(slashQueryAtCaret("//code", 6)).toBeNull();
  });
});
