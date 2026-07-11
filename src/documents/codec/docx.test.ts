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
    decoded.document.paragraphs[0] = {
      runs: [{ text: "Edited in Rotli", style: { bold: true, fontFamily: "Aptos", fontSize: 18 } }],
      namedStyle: "title",
    };
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const savedZip = await JSZip.loadAsync(encoded, { base64: true });
    const savedDocument = await savedZip.file("word/document.xml")?.async("string");
    const savedStyles = await savedZip.file("word/styles.xml")?.async("string");

    expect(savedDocument).toContain("Edited in Rotli");
    expect(savedDocument).toContain('w:ascii="Aptos"');
    expect(savedDocument).toContain("<w:b/>");
    expect(savedDocument).toContain("<w:tbl>");
    expect(savedDocument).toContain("Preserved");
    expect(savedStyles).toBe(originalStyles);

    const reopened = await decodeDocx(encoded, "storage/rotli/plan.docx");
    expect(reopened.document.paragraphs[0]?.runs[0]).toEqual({
      text: "Edited in Rotli",
      style: { bold: true, fontFamily: "Aptos", fontSize: 18 },
    });
  });

  test("keeps tables visible in the package and reports the current editing boundary", async () => {
    const base64 = await createDocxBase64({ title: "Table", table: [["A", "B"]] });
    const decoded = await decodeDocx(base64, "storage/rotli/table.docx");
    expect(decoded.warnings).toEqual(["1 table is preserved but not editable yet"]);
    expect(decoded.document.paragraphs.map((paragraph) => paragraph.runs[0]?.text)).toEqual([
      "Table",
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
    decoded.document.paragraphs[0] = { runs: [{ text: "Changed title" }], namedStyle: "title" };
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const saved = await JSZip.loadAsync(encoded, { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");

    expect(savedXml).toContain("Changed title");
    expect(savedXml).toContain(advanced);
  });
});
