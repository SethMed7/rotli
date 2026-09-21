import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { isTemplateFolder, isTemplateNote } from "./templates";

const note = (over: Partial<NoteSummary>): NoteSummary => ({
  id: "01T",
  title: "Meeting notes",
  snippet: "",
  folderId: "wiki/Templates",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  ...over,
});

describe("the Templates folder", () => {
  test("is wiki/Templates in a memex vault and Templates in a plain folder, subfolders included", () => {
    for (const folder of ["wiki/Templates", "Templates", "wiki/Templates/Work", "Templates/Work/Weekly"]) {
      expect(isTemplateFolder(folder)).toBe(true);
    }
    for (const folder of ["wiki/TemplatesOld", "wiki/Projects/Templates", "wiki/_templates", "Storage", ""]) {
      expect(isTemplateFolder(folder)).toBe(false);
    }
  });

  test("the physical folder decides — a shelf projection cannot hide a template", () => {
    expect(isTemplateNote(note({ folderId: "Board", diskFolderId: "wiki/Templates" }))).toBe(true);
    expect(isTemplateNote(note({ folderId: "wiki/Templates", diskFolderId: "wiki/Projects" }))).toBe(false);
  });

  test("boards, files, and secure notes are never offered", () => {
    expect(isTemplateNote(note({ kind: "board" }))).toBe(false);
    expect(isTemplateNote(note({ kind: "file" }))).toBe(false);
    expect(isTemplateNote(note({ secure: true }))).toBe(false);
    expect(isTemplateNote(note({}))).toBe(true);
  });
});
