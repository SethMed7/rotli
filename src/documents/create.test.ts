import { describe, expect, test } from "bun:test";

import JSZip from "jszip";

import { decodeDocx } from "./codec/docx";
import { blankDocumentTemplate, createDocxBase64 } from "./create";
import { GENERATED_DOCX_THEME } from "./theme";
import { documentFileName } from "./workflow";

describe("local DOCX creation", () => {
  const RED_PIXEL_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=";

  test("creates an OOXML document that the local editor codec can read", async () => {
    const base64 = await createDocxBase64({
      title: "Rotli document",
      subtitle: "Local and portable",
      blocks: [
        { kind: "heading", level: 2, text: "Workflow" },
        { kind: "paragraph", text: "Embedded in a note." },
      ],
      table: [
        ["Action", "Result"],
        ["Zoom in", "Stay in the note"],
      ],
    });
    const result = await decodeDocx(base64, "storage/rotli/example.docx");
    expect(
      result.document.content
        .filter((content) => content.kind === "paragraph")
        .map((content) =>
          content.kind === "paragraph" ? content.paragraph.runs.map((run) => run.text).join("") : "",
        ),
    ).toEqual(["Rotli document", "Local and portable", "Workflow", "Embedded in a note."]);
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
    expect(GENERATED_DOCX_THEME.bodyFont).toBe("Arial");
    expect(GENERATED_DOCX_THEME.bodyColor).toBe("000000");
    expect(document).toContain(`w:w="${GENERATED_DOCX_THEME.pageWidthTwips}"`);
    expect(document).toContain(`w:top="${GENERATED_DOCX_THEME.marginTwips}"`);
  });

  test("embeds generated images as real OOXML media that the local editor can reopen", async () => {
    const base64 = await createDocxBase64({
      title: "Visual brief",
      images: [
        {
          id: "diagram",
          name: "Architecture diagram",
          mimeType: "image/png",
          base64: RED_PIXEL_PNG,
          widthPx: 480,
          heightPx: 270,
        },
      ],
      content: [{ kind: "paragraph", paragraph: { runs: [{ text: "Explanation" }] } }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    expect(await zip.file("word/media/rotli-image-1.png")?.async("base64")).toBe(RED_PIXEL_PNG);
    expect(await zip.file("word/document.xml")?.async("string")).toContain("<w:drawing>");

    const reopened = await decodeDocx(base64, "storage/rotli/visual.docx");
    expect(reopened.document.content.some((content) => content.kind === "image")).toBe(true);
    expect(reopened.warnings).toEqual([]);
  });

  test("places generated visuals after the introduction instead of leaving a blank lead page", async () => {
    const base64 = await createDocxBase64({
      title: "Visual brief",
      images: [
        {
          id: "diagram",
          name: "Architecture diagram",
          mimeType: "image/png",
          base64: RED_PIXEL_PNG,
          widthPx: 480,
          heightPx: 270,
        },
      ],
      content: [
        {
          kind: "paragraph",
          paragraph: { namedStyle: "heading1", runs: [{ text: "Overview" }] },
        },
        { kind: "paragraph", paragraph: { runs: [{ text: "Introductory context" }] } },
        {
          kind: "paragraph",
          paragraph: { namedStyle: "heading1", runs: [{ text: "Details" }] },
        },
      ],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const document = (await zip.file("word/document.xml")?.async("string")) ?? "";

    expect(document.indexOf("Overview")).toBeLessThan(document.indexOf("Introductory context"));
    expect(document.indexOf("Introductory context")).toBeLessThan(document.indexOf("<w:drawing>"));
    expect(document.indexOf("<w:drawing>")).toBeLessThan(document.indexOf("Details"));
  });

  test("the managed filename follows the central creation extension", () => {
    expect(documentFileName("docx", 42)).toBe("untitled-42.docx");
  });
});
