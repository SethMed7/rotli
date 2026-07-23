import { describe, expect, test } from "bun:test";
import type { NoteSummary } from "../types";
import { filterPickerNotes, slashPickerCanCreate } from "./slashPicker";
import { filterSlashItems, SLASH_ITEMS } from "./slashMenu";
import { pickerFence, slashInsertion } from "./slashActions";

const file = (id: string): NoteSummary => ({
  id,
  title: id.split("/").pop() ?? id,
  snippet: "",
  folderId: "Storage",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  kind: "file",
});

describe("slash command catalog", () => {
  test("every command has one stable label and an executable operation", () => {
    const labels = SLASH_ITEMS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Quote",
      "Bullet",
      "Numbered",
      "Checklist",
      "Table",
      "Divider",
      "Code block",
      "Inline code",
      "Math",
      "Mermaid",
      "Link note",
      "Board",
      "Sheet",
      "Document",
    ]);
    for (const item of SLASH_ITEMS) {
      if (item.op.kind === "picker") continue;
      const insertion = slashInsertion(item.op);
      expect(insertion).not.toBeNull();
      expect(insertion?.caret).toBeGreaterThanOrEqual(0);
      expect(insertion?.caret).toBeLessThanOrEqual(insertion?.insert.length ?? 0);
    }
  });

  test("immediate commands produce the intended markdown scaffolds", () => {
    const byLabel = (label: string) => SLASH_ITEMS.find((item) => item.label === label)!.op;
    expect(slashInsertion(byLabel("Heading 2"))?.insert).toBe("## ");
    expect(slashInsertion(byLabel("Quote"))?.insert).toBe("> ");
    expect(slashInsertion(byLabel("Bullet"))?.insert).toBe("- ");
    expect(slashInsertion(byLabel("Numbered"))?.insert).toBe("1. ");
    expect(slashInsertion(byLabel("Checklist"))?.insert).toBe("- [ ] ");
    expect(slashInsertion(byLabel("Divider"))?.insert).toBe("---\n\n");
    expect(slashInsertion(byLabel("Inline code"))).toEqual({ insert: "``", caret: 1 });
    expect(slashInsertion(byLabel("Math"))?.insert).toBe("```math\n\n```");
    expect(slashInsertion(byLabel("Mermaid"))).toEqual({
      insert: "```mermaid\nflowchart LR\n  Start[Start] --> Next[Next step]\n```",
      caret: 32,
    });
    expect(slashInsertion(byLabel("Table"))?.insert.split("\n")).toHaveLength(4);
  });

  test("targeted embeds use explicit typed fences", () => {
    expect(pickerFence("embedBoard", "storage/excalidraw/plan.excalidraw")).toBe(
      "```board\nstorage/excalidraw/plan.excalidraw\n```\n\n",
    );
    expect(pickerFence("embedSheet", "storage/forecast.xlsx")).toBe(
      "```sheet\nstorage/forecast.xlsx\n```\n\n",
    );
    expect(pickerFence("embedDocument", "storage/brief.docx")).toBe(
      "```document\nstorage/brief.docx\n```\n\n",
    );
  });

  test("native board, sheet, and document pickers offer creation when writable", () => {
    expect(slashPickerCanCreate("embedBoard", true)).toBe(true);
    expect(slashPickerCanCreate("embedSheet", true)).toBe(true);
    expect(slashPickerCanCreate("embedDocument", true)).toBe(true);
    expect(slashPickerCanCreate("linkNote", true)).toBe(false);
    expect(slashPickerCanCreate("embedSheet", false)).toBe(false);
    expect(slashPickerCanCreate("embedDocument", true, false)).toBe(false);
  });

  test("document discovery uses the editable DOCX vocabulary", () => {
    expect(filterSlashItems("word").map((item) => item.label)).toEqual(["Document"]);
    expect(filterSlashItems("docx").map((item) => item.label)).toEqual(["Document"]);
    expect(filterSlashItems("rtf")).toEqual([]);
  });
});

describe("slash target filtering", () => {
  const files = [
    file("storage/budget.xlsx"),
    file("storage/data.csv"),
    file("storage/brief.docx"),
    file("storage/template.dotx"),
    file("storage/macros.docm"),
    file("storage/legacy.doc"),
    file("storage/notes.rtf"),
    file("storage/report.pdf"),
  ];

  test("sheet picker offers only editable embedded sheet formats", () => {
    expect(filterPickerNotes(files, "embedSheet", "").map((note) => note.id)).toEqual([
      "storage/budget.xlsx",
      "storage/data.csv",
    ]);
  });

  test("document picker offers only formats the embedded editor can edit", () => {
    expect(filterPickerNotes(files, "embedDocument", "").map((note) => note.id)).toEqual([
      "storage/brief.docx",
      "storage/template.dotx",
      "storage/macros.docm",
    ]);
  });

  test("document picker search keeps fuzzy title/path matching inside the editable set", () => {
    expect(filterPickerNotes(files, "embedDocument", "macro").map((note) => note.id)).toEqual([
      "storage/macros.docm",
    ]);
    expect(filterPickerNotes(files, "embedDocument", "legacy")).toEqual([]);
  });
});
