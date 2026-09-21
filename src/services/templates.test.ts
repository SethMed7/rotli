import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import {
  TEMPLATE_PRESETS,
  isPresetTemplate,
  isTemplateFolder,
  isTemplateNote,
  presetTemplateBody,
  presetTemplateNotes,
  templatesFolderBeside,
} from "./templates";

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

describe("built-in presets", () => {
  test("are Rotli's own rows — never a vault template, each with a titled body", () => {
    const rows = presetTemplateNotes();
    expect(rows.map((row) => row.title)).toEqual(TEMPLATE_PRESETS.map((preset) => preset.title));
    for (const row of rows) {
      expect(isPresetTemplate(row.id)).toBe(true);
      // a picker row, not a note: the Templates-folder rule never counts it
      expect(presetTemplateBody(row.id)?.startsWith(`# ${row.title}\n`)).toBe(true);
    }
    expect(isPresetTemplate("01JABC")).toBe(false);
    expect(presetTemplateBody("preset:nope")).toBeNull();
  });

  test("a new template goes where the vault keeps them, read off where new notes land", () => {
    expect(templatesFolderBeside("wiki/_inbox")).toBe("wiki/Templates");
    expect(templatesFolderBeside("wiki")).toBe("wiki/Templates");
    expect(templatesFolderBeside("Inbox")).toBe("Templates");
    expect(templatesFolderBeside("")).toBe("Templates");
  });
});
