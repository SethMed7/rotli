import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { blankDocumentTemplate, createDocxBase64 } from "./create";
import { convertDocxPreview } from "./preview";
import { GENERATED_DOCX_THEME } from "./theme";
import { documentFileName } from "./workflow";

describe("local DOCX creation", () => {
  test("creates an OOXML document that the local preview can read", async () => {
    const base64 = await createDocxBase64({
      title: "Rotli document",
      subtitle: "Local and portable",
      blocks: [{ kind: "heading", level: 2, text: "Workflow" }, { kind: "paragraph", text: "Embedded in a note." }],
      table: [["Action", "Result"], ["Zoom in", "Stay in the note"]],
    });
    const result = await convertDocxPreview(base64);
    expect(result.srcDoc).toContain("Rotli document");
    expect(result.srcDoc).toContain("Local and portable");
    expect(result.srcDoc).toContain("Workflow");
    expect(result.srcDoc).toContain("Embedded in a note.");
    expect(result.srcDoc).toContain("<table>");
    expect(result.srcDoc).toContain("Stay in the note");
    expect(result.warnings).toEqual([]);
  });

  test("blank documents explain the two viewing modes", () => {
    const template = blankDocumentTemplate();
    expect(template.title).toBe("Untitled document");
    expect(template.blocks?.[0]?.text).toContain("Zoom in");
    expect(template.blocks?.[0]?.text).toContain("Open in tab");
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
