import { expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import { pickWikiEmbedFile, scanWikiEmbeds } from "./fileEmbeds";

test("whole-line ![[file]] embeds of a sheet, document, or board are found", () => {
  const doc = Text.of([
    "# Budget",
    "![[budget.xlsx]]",
    "Text with ![[inline.xlsx]] stays text",
    "![[plan.docx|400]]",
    "![[map.excalidraw]]",
    "![[rose.png]]",
    "![[Some note]]",
    "```",
    "![[in-a-fence.csv]]",
    "```",
  ]);
  const fence = { from: doc.line(8).from, to: doc.line(10).to };
  expect(scanWikiEmbeds(doc, [fence]).map((e) => [e.kind, e.target])).toEqual([
    ["sheet", "budget.xlsx"],
    ["document", "plan.docx"],
    ["board", "map.excalidraw"],
  ]);
});

test("an embed names a file by path, by path from the note, or by its unique name", () => {
  const rels = ["Finance/budget.xlsx", "storage/rotli/plan.docx", "a/dup.csv", "b/dup.csv"];
  expect(pickWikiEmbedFile("Finance/budget.xlsx", "Notes", rels)).toBe("Finance/budget.xlsx");
  expect(pickWikiEmbedFile("../Finance/budget.xlsx", "Notes", rels)).toBe("Finance/budget.xlsx");
  expect(pickWikiEmbedFile("plan.docx", "Notes", rels)).toBe("storage/rotli/plan.docx");
  expect(pickWikiEmbedFile("Budget.XLSX", "", rels)).toBe("Finance/budget.xlsx");
  expect(pickWikiEmbedFile("dup.csv", "", rels)).toBeNull();
  expect(pickWikiEmbedFile("gone.xlsx", "", rels)).toBeNull();
});
