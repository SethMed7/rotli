import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { imageGenMarkdown, readyImageEngines } from "./imageGenPopover";
import { pickerFence, slashInsertion } from "./slashActions";
import { adaptSlashInsertion, filterSlashItems, slashLineTarget, SLASH_ITEMS } from "./slashMenu";
import { filterPickerNotes, slashPickerCanCreate } from "./slashPicker";

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
      "Generate image",
      "Link note",
      "Board",
      "Sheet",
      "Document",
    ]);
    for (const item of SLASH_ITEMS) {
      // picker + imageGen open a popover first — no immediate scaffold
      if (item.op.kind === "picker" || item.op.kind === "imageGen") continue;
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

  test("list-item commands retain their marker and indent multiline scaffolds", () => {
    const target = slashLineTarget("12. /math");
    expect(target).toEqual({ from: 4, continuation: "    " });
    expect(adaptSlashInsertion("```math\n\n```", 8, target.continuation)).toEqual({
      insert: "```math\n\n    ```",
      caret: 8,
    });
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

// /image-gen (Seth, 2026-08-04): "it will only offer models you are actively
// logged into that can do image gen such as gemini and gpt".
describe("/image-gen", () => {
  test("the command is discoverable by the names Seth types", () => {
    for (const query of ["image-gen", "imagegen", "image", "generate", "picture", "ai"]) {
      expect(filterSlashItems(query).map((item) => item.label)).toContain("Generate image");
    }
  });

  test("it opens a popover rather than inserting a scaffold", () => {
    const item = SLASH_ITEMS.find((i) => i.label === "Generate image");
    expect(item?.op).toEqual({ kind: "imageGen" });
    expect(slashInsertion({ kind: "imageGen" })).toBeNull();
  });

  test("only ENABLED lanes that are installed AND authenticated are offered", () => {
    const ready = { installed: true, version: "1", authenticated: true };
    const noAuth = { installed: true, version: "1", authenticated: false };
    const missing = { installed: false, version: null, authenticated: false };

    // both signed in → both offered, codex (GPT) first
    expect(
      readyImageEngines({ codex: true, agy: true }, { codex: ready, agy: ready }).map((e) => e.id),
    ).toEqual(["codex", "agy"]);
    // installed but signed OUT, or not installed → never offered
    expect(readyImageEngines({ codex: true, agy: true }, { codex: noAuth, agy: missing })).toEqual([]);
    // lane disabled in Settings → not offered even when the CLI is ready
    expect(
      readyImageEngines({ codex: false, agy: true }, { codex: ready, agy: ready }).map((e) => e.id),
    ).toEqual(["agy"]);
    // a probe that hasn't resolved yet is not a green light
    expect(readyImageEngines({ codex: true }, {})).toEqual([]);
  });

  test("the inserted markdown uses the storage: shorthand and a safe alt", () => {
    expect(imageGenMarkdown("a quokka on a surfboard", "storage/images/img-01k.png")).toBe(
      "![a quokka on a surfboard](storage:images/img-01k.png)\n",
    );
    // brackets/parens in the prompt would break the markdown link — stripped;
    // newlines flatten; long prompts clip
    expect(imageGenMarkdown("a [weird] (prompt)\nwith lines", "storage/images/x.png")).toBe(
      "![a weird prompt with lines](storage:images/x.png)\n",
    );
    const long = imageGenMarkdown("x".repeat(200), "storage/images/x.png");
    expect(long.slice(2, long.indexOf("]"))).toHaveLength(80);
  });
});
