import { describe, expect, test } from "bun:test";

import JSZip from "jszip";

import { createDocxBase64 } from "../create";
import { decodeDocx, encodeDocx } from "./docx";

describe("DOCX editor codec", () => {
  test("round-trips edited paragraphs without rewriting opaque package parts", async () => {
    const base64 = await createDocxBase64({
      title: "Original title",
      subtitle: "Local document",
      blocks: [{ kind: "paragraph", text: "Editable body" }],
      table: [
        ["Owner", "Status"],
        ["Rotli", "Preserved"],
      ],
    });
    const originalZip = await JSZip.loadAsync(base64, { base64: true });
    const originalStyles = await originalZip.file("word/styles.xml")?.async("string");

    const decoded = await decodeDocx(base64, "storage/rotli/plan.docx");
    decoded.document.content[0] = {
      kind: "paragraph",
      paragraph: {
        runs: [{ text: "Edited in Rotli", style: { bold: true, fontFamily: "Aptos", fontSize: 18 } }],
        namedStyle: "title",
      },
    };
    const table = decoded.document.content.find((content) => content.kind === "table");
    if (!table || table.kind !== "table") throw new Error("expected editable table");
    table.table.rows[1]!.cells[1]!.paragraphs[0]!.runs = [{ text: "Edited table" }];
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const savedZip = await JSZip.loadAsync(encoded, { base64: true });
    const savedDocument = await savedZip.file("word/document.xml")?.async("string");
    const savedStyles = await savedZip.file("word/styles.xml")?.async("string");

    expect(savedDocument).toContain("Edited in Rotli");
    expect(savedDocument).toContain('w:ascii="Aptos"');
    expect(savedDocument).toContain("<w:b/>");
    expect(savedDocument).toContain("<w:tbl>");
    expect(savedDocument).toContain("Edited table");
    expect(savedStyles).toBe(originalStyles);

    const reopened = await decodeDocx(encoded, "storage/rotli/plan.docx");
    expect(reopened.document.content[0]?.kind).toBe("paragraph");
    const reopenedTitle = reopened.document.content[0];
    expect(reopenedTitle?.kind === "paragraph" ? reopenedTitle.paragraph.runs[0] : undefined).toEqual({
      text: "Edited in Rotli",
      style: { bold: true, fontFamily: "Aptos", fontSize: 18 },
    });
    const reopenedTable = reopened.document.content.find((content) => content.kind === "table");
    expect(
      reopenedTable?.kind === "table"
        ? reopenedTable.table.rows[1]?.cells[1]?.paragraphs[0]?.runs[0]?.text
        : undefined,
    ).toBe("Edited table");
  });

  test("decodes Word tables as native editable document content", async () => {
    const base64 = await createDocxBase64({ title: "Table", table: [["A", "B"]] });
    const decoded = await decodeDocx(base64, "storage/rotli/table.docx");
    expect(decoded.warnings).toEqual([]);
    expect(decoded.document.content).toEqual([
      { kind: "paragraph", paragraph: { runs: [{ text: "Table" }], namedStyle: "title" } },
      {
        kind: "table",
        table: {
          id: "table-1",
          rows: [
            {
              cells: [
                { paragraphs: [{ runs: [{ text: "A" }] }] },
                { paragraphs: [{ runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      },
    ]);
  });

  test("keeps an untouched advanced paragraph byte-for-byte when another paragraph changes", async () => {
    const base64 = await createDocxBase64({
      title: "Editable title",
      blocks: [{ kind: "paragraph", text: "Paragraph with drawing" }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    const advanced = '<w:r><w:drawing><wp:inline xmlns:wp="urn:test"/></w:drawing></w:r>';
    zip.file(
      "word/document.xml",
      xml.replace("Paragraph with drawing</w:t></w:r>", `Paragraph with drawing</w:t></w:r>${advanced}`),
    );
    const withDrawing = await zip.generateAsync({ type: "base64" });

    const decoded = await decodeDocx(withDrawing, "storage/rotli/drawing.docx");
    decoded.document.content[0] = {
      kind: "paragraph",
      paragraph: { runs: [{ text: "Changed title" }], namedStyle: "title" },
    };
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const saved = await JSZip.loadAsync(encoded, { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");

    expect(savedXml).toContain("Changed title");
    expect(savedXml).toContain(advanced);
  });

  test("preserves unsupported objects inside a table cell when its text changes", async () => {
    const base64 = await createDocxBase64({ title: "", table: [["Cell text"]] });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    const object = '<w:r><w:object><w:control xmlns:w="urn:test"/></w:object></w:r>';
    zip.file("word/document.xml", xml.replace("Cell text</w:t></w:r>", `Cell text</w:t></w:r>${object}`));
    const withObject = await zip.generateAsync({ type: "base64" });

    const decoded = await decodeDocx(withObject, "storage/rotli/object.docx");
    const table = decoded.document.content.find((content) => content.kind === "table");
    if (!table || table.kind !== "table") throw new Error("expected table");
    table.table.rows[0]!.cells[0]!.paragraphs[0]!.runs = [{ text: "Changed cell" }];
    const saved = await JSZip.loadAsync(await encodeDocx(decoded.source, decoded.document), { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");

    expect(savedXml).toContain("Changed cell");
    expect(savedXml).toContain(object);
  });

  test("keeps an original table template when a new table is inserted before it", async () => {
    const base64 = await createDocxBase64({ title: "", table: [["Original"]] });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    const object = '<w:r><w:object><w:control xmlns:w="urn:test"/></w:object></w:r>';
    zip.file("word/document.xml", xml.replace("Original</w:t></w:r>", `Original</w:t></w:r>${object}`));
    const decoded = await decodeDocx(
      await zip.generateAsync({ type: "base64" }),
      "storage/rotli/insert.docx",
    );
    decoded.document.content.unshift({
      kind: "table",
      table: {
        id: "new-table",
        rows: [{ cells: [{ paragraphs: [{ runs: [{ text: "New" }] }] }] }],
      },
    });

    const saved = await JSZip.loadAsync(await encodeDocx(decoded.source, decoded.document), { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");
    expect(savedXml?.indexOf("New")).toBeLessThan(savedXml?.indexOf("Original") ?? -1);
    expect(savedXml).toContain(object);
  });
});
