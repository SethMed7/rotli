import { expect, test } from "bun:test";

import { applyDocumentEdits, linkedText, MAX_EDIT_ACTIONS, parseEditAction } from "./aiEdit";
import type { EditableDocument } from "./model";

const doc: EditableDocument = {
  id: "storage/rotli/plan.docx",
  title: "Plan",
  content: [
    { kind: "paragraph", paragraph: { namedStyle: "heading1", runs: [{ text: "Launch" }] } },
    {
      kind: "paragraph",
      paragraph: { runs: [{ text: "Ship", style: { bold: true } }], alignment: "center" },
    },
    {
      kind: "table",
      table: {
        id: "t",
        rows: [
          {
            cells: [
              { paragraphs: [{ runs: [{ text: "Owner" }] }] },
              { paragraphs: [{ runs: [{ text: "?" }] }] },
            ],
          },
        ],
      },
    },
  ],
};

const texts = (document: EditableDocument | string) =>
  typeof document === "string"
    ? document
    : document.content.map((content) =>
        content.kind === "paragraph"
          ? `${content.paragraph.namedStyle ?? content.paragraph.list ?? "p"}:${content.paragraph.runs.map((r) => r.text).join("")}`
          : content.kind,
      );

test("block numbers mean the document as read, through inserts and deletes", () => {
  const edited = applyDocumentEdits(doc, [
    { op: "insert_after", block: 1, kind: "bullet", text: "First" },
    { op: "insert_after", block: 1, kind: "bullet", text: "Second" },
    { op: "delete", block: 2 },
    { op: "insert_after", block: 0, kind: "title", text: "Plan" },
    { op: "set_kind", block: 1, kind: "heading2" },
  ]);
  expect(texts(edited)).toEqual(["title:Plan", "heading2:Launch", "bullet:First", "bullet:Second", "table"]);
});

test("replacing keeps the paragraph's kind, first run style, and alignment", () => {
  const edited = applyDocumentEdits(doc, [{ op: "replace", block: 2, text: "Ship calmly" }]);
  if (typeof edited === "string") throw new Error(edited);
  const paragraph = edited.content[1];
  expect(paragraph).toEqual({
    kind: "paragraph",
    paragraph: { runs: [{ text: "Ship calmly", style: { bold: true } }], alignment: "center" },
  });
});

test("a table cell by row and column; nothing else in the table changes", () => {
  const edited = applyDocumentEdits(doc, [{ op: "set_cell", block: 3, row: 1, column: 2, text: "Mina" }]);
  if (typeof edited === "string") throw new Error(edited);
  const table = edited.content[2];
  expect(
    table?.kind === "table" && table.table.rows[0]?.cells.map((c) => c.paragraphs[0]?.runs[0]?.text),
  ).toEqual(["Owner", "Mina"]);
  expect(table?.kind === "table" && table.table.id).toBe("t");
});

test("what can't apply says why, and changes nothing", () => {
  expect(applyDocumentEdits(doc, [{ op: "replace", block: 9, text: "x" }])).toBe("there is no block 9");
  expect(applyDocumentEdits(doc, [{ op: "replace", block: 3, text: "x" }])).toMatch(/is a table/);
  expect(applyDocumentEdits(doc, [{ op: "set_cell", block: 1, row: 1, column: 1, text: "x" }])).toMatch(
    /isn't a table/,
  );
  expect(applyDocumentEdits(doc, [{ op: "set_cell", block: 3, row: 2, column: 1, text: "x" }])).toMatch(
    /no cell r2c1/,
  );
  expect(
    applyDocumentEdits(doc, [
      { op: "delete", block: 1 },
      { op: "replace", block: 1, text: "x" },
    ]),
  ).toBe("there is no block 1");
  expect(applyDocumentEdits(doc, [])).toBe("no actions to apply");
  expect(
    applyDocumentEdits(
      doc,
      Array.from({ length: MAX_EDIT_ACTIONS + 1 }, () => ({ op: "delete" as const, block: 1 })),
    ),
  ).toMatch(/at most/);
});

test("a model's arguments become actions, or a reason", () => {
  expect(parseEditAction({ op: "replace", block: 2, text: "x" })).toEqual({
    op: "replace",
    block: 2,
    text: "x",
  });
  expect(parseEditAction({ op: "insert_after", block: 0, text: "x" })).toEqual({
    op: "insert_after",
    block: 0,
    kind: "paragraph",
    text: "x",
  });
  expect(parseEditAction({ op: "explode", block: 1 })).toMatch(/op is one of/);
  expect(parseEditAction({ op: "replace", block: "2", text: "x" })).toMatch(/block number/);
  expect(parseEditAction({ op: "set_kind", block: 2, kind: "heading9" })).toMatch(/set_kind needs/);
  expect(parseEditAction({ op: "replace", block: 1, text: "x".repeat(9000) })).toMatch(/under/);
});

test("links read as [label](url) and an edit may keep or add them", () => {
  const linked: EditableDocument = {
    ...doc,
    content: [
      {
        kind: "paragraph",
        paragraph: { runs: [{ text: "See " }, { text: "Rotli", link: "https://rotli.co" }] },
      },
    ],
  };
  const edited = applyDocumentEdits(linked, [
    { op: "set_kind", block: 1, kind: "heading2" },
    {
      op: "insert_after",
      block: 1,
      kind: "bullet",
      text: "Write [us](mailto:hi@rotli.co) or [run](javascript:x)",
    },
  ]);
  if (typeof edited === "string") throw new Error(edited);
  const [heading, bullet] = edited.content;
  expect(heading?.kind === "paragraph" && linkedText(heading.paragraph)).toBe(
    "See [Rotli](https://rotli.co)",
  );
  expect(bullet?.kind === "paragraph" && bullet.paragraph.runs).toEqual([
    { text: "Write " },
    { text: "us", link: "mailto:hi@rotli.co" },
    { text: " or " },
    { text: "run" },
  ]);
});
