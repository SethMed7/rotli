import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { blankDocumentTemplate, createDocxBase64 } from "./create";
import { decodeDocx } from "./codec/docx";
import { GENERATED_DOCX_THEME } from "./theme";
import { documentFileName } from "./workflow";

describe("local DOCX creation", () => {
  test("creates an OOXML document that the local editor codec can read", async () => {
    const base64 = await createDocxBase64({
      title: "Rotli document",
      subtitle: "Local and portable",
      blocks: [{ kind: "heading", level: 2, text: "Workflow" }, { kind: "paragraph", text: "Embedded in a note." }],
      table: [["Action", "Result"], ["Zoom in", "Stay in the note"]],
    });
    const result = await decodeDocx(base64, "storage/rotli/example.docx");
    expect(result.document.content
      .filter((content) => content.kind === "paragraph")
      .map((content) => content.kind === "paragraph" ? content.paragraph.runs.map((run) => run.text).join("") : ""))
      .toEqual(["Rotli document", "Local and portable", "Workflow", "Embedded in a note."]);
    expect(result.document.content.some((content) => content.kind === "table")).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("new documents start as a genuinely blank editable page", () => {
    const template = blankDocumentTemplate();
    expect(template).toEqual({ title: "" });
  });

  test("generated typography and page geometry come from one theme", async () => {
    const base64 = await createDocxBase64({ title: "Styled" });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const styles = await zip.file("word/styles.xml")?.async("string");
    const document = await zip.file("word/document.xml")?.async("string");
    expect(styles).toContain(`w:ascii="${GENERATED_DOCX_THEME.bodyFont}"`);
    expect(styles).toContain(`w:ascii="${GENERATED_DOCX_THEME.headingFont}"`);
    expect(document).toContain(`w:w="${GENERATED_DOCX_THEME.pageWidthTwips}"`);
    expect(document).toContain(`w:top="${GENERATED_DOCX_THEME.marginTwips}"`);
  });

  test("the managed filename follows the central creation extension", () => {
    expect(documentFileName("docx", 42)).toBe("untitled-42.docx");
  });
});
