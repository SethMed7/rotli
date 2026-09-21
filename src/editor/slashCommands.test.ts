import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { imageGenMarkdown, readyImageEngines } from "./imageGenPopover";
import { pickerFence, slashInsertion, templateInsertion } from "./slashActions";
import {
  adaptSlashInsertion,
  filterSlashItems,
  slashLineTarget,
  slashSpanAtCaret,
  SLASH_ITEMS,
} from "./slashMenu";
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
      "Attach image",
      "Generate image",
      "Template",
      "Link note",
      "Link chat",
      "Board",
      "Sheet",
      "Document",
    ]);
    for (const item of SLASH_ITEMS) {
      // picker + image commands open a native/popover flow first — no scaffold
      if (item.op.kind === "picker" || item.op.kind === "attachImage" || item.op.kind === "imageGen") {
        continue;
      }
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

    expect(slashLineTarget("- [ ][ ] /table")).toEqual({ from: 9, continuation: "         " });
    expect(slashLineTarget("- ( ) /table")).toEqual({ from: 6, continuation: "      " });
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

describe("/attatch", () => {
  test("the requested spelling opens the native image attachment command", () => {
    expect(filterSlashItems("attatch").map((item) => item.label)).toEqual(["Attach image"]);
    expect(SLASH_ITEMS.find((item) => item.label === "Attach image")?.op).toEqual({
      kind: "attachImage",
    });
    expect(slashInsertion({ kind: "attachImage" })).toBeNull();
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

// /image-gen (the maintainer, 2026-08-04): "it will only offer models you are actively
// logged into that can do image gen such as gemini and gpt".
describe("/image-gen", () => {
  test("the command is discoverable by the names the maintainer types", () => {
    for (const query of ["image-gen", "imagegen", "image", "generate", "picture", "ai"]) {
      expect(filterSlashItems(query).map((item) => item.label)).toContain("Generate image");
    }
  });

  test("it opens a popover rather than inserting a scaffold", () => {
    const item = SLASH_ITEMS.find((i) => i.label === "Generate image");
    expect(item?.op).toEqual({ kind: "imageGen" });
    expect(slashInsertion({ kind: "imageGen" })).toBeNull();
  });

  test("subscription-authenticated image engines are never offered", () => {
    expect(readyImageEngines()).toEqual([]);
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

describe("slash commands inside a result row's reason", () => {
  const nine = " ".repeat(9);

  test("the trailing slash token of a reason is the command; its block lands beneath the row", () => {
    const line = "- [ ][x] Hello — fail hello /table";
    const span = slashSpanAtCaret(line, line.length);
    expect(span).toEqual({
      from: line.indexOf(" /table"),
      to: line.length,
      lead: `\n${nine}`,
      continuation: nine,
      query: "table",
    });
  });

  test("a reason that was only the slash drops its dangling separator", () => {
    const line = "- [x][ ] Hello — /attach";
    const span = slashSpanAtCaret(line, line.length);
    expect(span?.from).toBe(line.indexOf(" — "));
    expect(span?.query).toBe("attach");
    expect(span?.lead).toBe(`\n${nine}`);
  });

  test("ordinary lines and empty list items keep the in-place contract", () => {
    expect(slashSpanAtCaret("/math", 5)).toEqual({
      from: 0,
      to: 5,
      lead: "",
      continuation: "",
      query: "math",
    });
    expect(slashSpanAtCaret("- [ ][ ] /table", 15)).toMatchObject({ from: 9, lead: "", query: "table" });
  });

  test("a slash mid-word, mid-line, or on an unanswered row's label is not a command", () => {
    expect(slashSpanAtCaret("- [ ][x] Hello — and/or", 23)).toBeNull();
    expect(slashSpanAtCaret("- [ ][x] Hello — fail /table", 20)).toBeNull();
    expect(slashSpanAtCaret("- [ ][x] Hello /table", 21)).toBeNull();
  });

  test("after text, a trailing /query is a command — in a paragraph and in any list item", () => {
    const item = "- [ ] Ask Gabriel /li";
    expect(slashSpanAtCaret(item, item.length)).toEqual({
      from: 18, // the slash itself: the space before it stays, the token goes
      to: item.length,
      lead: "\n      ",
      continuation: "      ",
      query: "li",
    });
    expect(slashSpanAtCaret("some words /link", 16)).toMatchObject({
      from: 11,
      query: "link",
      continuation: "",
    });
    expect(slashSpanAtCaret("- item /table", 13)).toMatchObject({ from: 7, query: "table" });
    expect(slashSpanAtCaret("1. step /code", 13)).toMatchObject({ from: 8, query: "code" });
  });

  test("an INLINE command stays in the sentence; a block lands on a continuation line beneath", () => {
    const item = "- [ ] Ask Gabriel /li";
    const link = { kind: "picker", mode: "linkNote" } as const;
    const chat = { kind: "picker", mode: "linkChat" } as const;
    expect(slashSpanAtCaret(item, item.length, link)?.lead).toBe("");
    expect(slashSpanAtCaret(item, item.length, chat)?.lead).toBe("");
    expect(slashSpanAtCaret(item, item.length, { kind: "code" })?.lead).toBe("");
    expect(slashSpanAtCaret(item, item.length, { kind: "table" })?.lead).toBe("\n      ");
    // a command that owns the whole item was always in place, whatever it is
    expect(slashSpanAtCaret("- [ ] /table", 12, { kind: "table" })?.lead).toBe("");
  });

  test("prose keeps its slashes: no space before, nothing typed yet, or nothing that matches", () => {
    expect(slashSpanAtCaret("yes and/or no", 13)).toBeNull();
    expect(slashSpanAtCaret("see https://rotli.co", 20)).toBeNull();
    expect(slashSpanAtCaret("either / or", 8)).toBeNull(); // a bare slash after text
    expect(slashSpanAtCaret("run it from /usr", 16)).toBeNull(); // no command is called "usr"
    expect(slashSpanAtCaret("from /usr/bin", 13)).toBeNull();
    expect(slashSpanAtCaret("- [ ] done /li later", 14)).toBeNull(); // caret not at the end
  });
});

describe("/template", () => {
  const note = (id: string, over: Partial<NoteSummary> = {}): NoteSummary => ({
    ...file(id),
    kind: "note",
    folderId: "wiki/Templates",
    ...over,
  });

  test("the picker offers only the notes in the Templates folder", () => {
    const pool = [
      note("01MEET", { title: "Meeting notes" }),
      note("01SHELF", { title: "Weekly review", folderId: "Board", diskFolderId: "wiki/Templates" }),
      note("01SECRET", { title: "Secret layout", secure: true }),
      note("01ELSE", { title: "Meeting with Ana", folderId: "wiki/Projects" }),
      file("Storage/Meeting.docx"),
    ];
    expect(filterPickerNotes(pool, "insertTemplate", "").map((n) => n.id)).toEqual(["01MEET", "01SHELF"]);
    expect(filterPickerNotes(pool, "insertTemplate", "meet").map((n) => n.id)).toEqual(["01MEET"]);
  });

  test("it never offers to create: a template is made like any note, in its folder", () => {
    expect(slashPickerCanCreate("insertTemplate", true, true)).toBe(false);
  });

  test("into an EMPTY note the template comes whole — its heading names the new note", () => {
    expect(templateInsertion("# Meeting notes\n\n## Attendees\n\n- \n", true)).toBe(
      "# Meeting notes\n\n## Attendees\n\n-",
    );
  });

  test("into a note with content the template's own title is left out, so the note is never renamed", () => {
    expect(templateInsertion("# Meeting notes\n\n## Attendees\n\n- \n", false)).toBe("## Attendees\n\n-");
    // only a LEADING H1 is the template's name; a later one is content
    expect(templateInsertion("intro\n\n# Part one\n", false)).toBe("intro\n\n# Part one");
    expect(templateInsertion("## Agenda\n- item\n", false)).toBe("## Agenda\n- item");
  });

  test("stray frontmatter never rides into the host note, and an empty template inserts nothing", () => {
    expect(templateInsertion("---\ntitle: x\nsecure: false\n---\n\n## Agenda\n", false)).toBe("## Agenda");
    expect(templateInsertion("# Only a title\n", false)).toBe("");
    expect(templateInsertion("\n\n", true)).toBe("");
  });
});
