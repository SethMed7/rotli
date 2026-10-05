import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { imageGenMarkdown, readyImageEngines } from "./imageGenPopover";
import { opensFlow, pickerFence, slashInsertion, templateInsertion } from "./slashActions";
import {
  adaptSlashInsertion,
  filterSlashItems,
  slashLineTarget,
  slashSpanAtCaret,
  SLASH_ITEMS,
} from "./slashMenu";
import { embedCreateName, filterPickerNotes, pickerHint, slashPickerCanCreate } from "./slashPicker";

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
      "Center",
      "Align right",
      "Bullet",
      "Numbered",
      "Checklist",
      "Table",
      "Divider",
      "Code block",
      "Inline code",
      "Math",
      "Mermaid",
      "Bar chart",
      "Line chart",
      "Area chart",
      "Pie chart",
      "Attach image",
      "Generate image",
      "Talk to the Librarian",
      "Hand to AI",
      "Template",
      "Link note",
      "Link chat",
      "Board",
      "Sheet",
      "Document",
      "Today",
      "Yesterday",
      "Tomorrow",
      "Continue a project list",
    ]);
    for (const item of SLASH_ITEMS) {
      // picker, image, and Librarian commands open a flow first — no scaffold
      if (opensFlow(item.op)) {
        continue;
      }
      const insertion = slashInsertion(item.op);
      expect(insertion).not.toBeNull();
      expect(insertion?.caret).toBeGreaterThanOrEqual(0);
      expect(insertion?.caret).toBeLessThanOrEqual(insertion?.insert.length ?? 0);
    }
  });

  test("a date command writes the date, or a placeholder when the note is a template", () => {
    const now = new Date(2026, 8, 29, 9, 0);
    expect(slashInsertion({ kind: "date", word: "today" }, { now })?.insert).toBe("September 29, 2026");
    expect(slashInsertion({ kind: "date", word: "tomorrow" }, { now })?.insert).toBe("September 30, 2026");
    expect(slashInsertion({ kind: "date", word: "yesterday" }, { now, template: true })?.insert).toBe(
      "{{yesterday}}",
    );
    expect(filterSlashItems("today").map((item) => item.label)).toContain("Today");
  });

  test("a template's date placeholders become the day it's used", () => {
    const now = new Date(2026, 8, 29, 9, 0);
    expect(templateInsertion("# Daily\n\n## {{today}}\n\n- [ ] ", true, now)).toBe(
      "# Daily\n\n## September 29, 2026\n\n- [ ]",
    );
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
    expect(slashPickerCanCreate("embedSheet", false)).toBe(false);
    expect(slashPickerCanCreate("embedDocument", true, false)).toBe(false);
    // a template is an ordinary note: creatable in every build that can write
    expect(slashPickerCanCreate("insertTemplate", false)).toBe(true);
    expect(slashPickerCanCreate("insertTemplate", true, false)).toBe(false);
    expect(slashPickerCanCreate("linkChat", true)).toBe(false);
    // Link note makes the note you typed — web and native alike, never read-only
    expect(slashPickerCanCreate("linkNote", false)).toBe(true);
    expect(slashPickerCanCreate("linkNote", true, false)).toBe(false);
    // Continue a project list makes its next note itself, never from the picker
    expect(slashPickerCanCreate("continueList", true)).toBe(false);
  });

  test("document discovery uses the editable DOCX vocabulary", () => {
    expect(filterSlashItems("word").map((item) => item.label)).toEqual(["Document"]);
    expect(filterSlashItems("docx").map((item) => item.label)).toEqual(["Document"]);
    expect(filterSlashItems("rtf")).toEqual([]);
    expect(filterSlashItems("librarian", { sheets: false, librarian: false })).toEqual([]);
    expect(filterSlashItems("librarian", { sheets: false }).map((item) => item.label)).toEqual([
      "Talk to the Librarian",
    ]);
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

  // owner review of PR 164: /Link note listed the open note, so it could link a
  // note to itself — the same rule the [[ picker already keeps
  test("Link note never offers the note being written in", () => {
    const notes = [
      { ...file("01HOST"), kind: "note" as const, title: "Trip plan" },
      { ...file("01OTHER"), kind: "note" as const, title: "Trip budget" },
    ];
    expect(filterPickerNotes(notes, "linkNote", "trip", "01HOST").map((n) => n.id)).toEqual(["01OTHER"]);
    expect(filterPickerNotes(notes, "linkNote", "", "01HOST").map((n) => n.id)).toEqual(["01OTHER"]);
    expect(filterPickerNotes(notes, "linkNote", "trip").map((n) => n.id)).toEqual(["01HOST", "01OTHER"]);
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
    // a date and a project-list link read as words in the sentence too
    const due = "- [ ] Ship it /tom";
    expect(slashSpanAtCaret(due, due.length, { kind: "date", word: "tomorrow" })?.lead).toBe("");
    const project = { kind: "picker", mode: "continueList" } as const;
    expect(slashSpanAtCaret("Today /cont", 11, project)?.lead).toBe("");
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

  test("it offers to create one — a note made like any other, then moved into its folder", () => {
    expect(slashPickerCanCreate("insertTemplate", true, true)).toBe(true);
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

  test("a picker row's hint is a readable place, never a native note's opaque id", () => {
    const note = (id: string) => ({
      id,
      title: "T",
      snippet: "",
      folderId: "",
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
    });
    expect(pickerHint(note("01K6B3ZQ8R2X4Y7N9P5T1V3W6M"))).toBe("");
    expect(pickerHint(note("wiki/_inbox/packing-list.md"))).toBe("packing-list.md");
  });

  test("a board made from /board is named from the picker's field first; other kinds name themselves", () => {
    expect(embedCreateName("embedBoard", "  Q4 roadmap ")).toBe("Q4 roadmap");
    expect(embedCreateName("embedBoard", "   ")).toBeNull();
    expect(embedCreateName("embedSheet", "anything")).toBeUndefined();
    expect(embedCreateName("embedDocument", "")).toBeUndefined();
  });
});
