import { describe, expect, test } from "bun:test";

import JSZip from "jszip";

import { createDocxBase64 } from "../create";
import type { EditableDocument } from "../model";
import { decodeDocx } from "./docx";

function hasRunText(document: EditableDocument, text: string): boolean {
  return document.content.some(
    (block) => block.kind === "paragraph" && block.paragraph.runs.some((run) => run.text === text),
  );
}

describe("DOCX security text decoding", () => {
  test("reads text from a prefixed Strict document for the AI edit view", async () => {
    const base64 = await createDocxBase64({
      title: "Private title",
      blocks: [{ kind: "paragraph", text: "Readable body" }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    zip.file(
      "word/document.xml",
      xml
        .replaceAll(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "http://purl.oclc.org/ooxml/wordprocessingml/main",
        )
        .replace("xmlns:w=", "xmlns:x=")
        .replaceAll("w:", "x:"),
    );
    const decoded = await decodeDocx(await zip.generateAsync({ type: "base64" }), "strict.docx");
    expect(hasRunText(decoded.document, "Readable body")).toBe(true);
  });

  test("decodes CDATA text without exposing its XML wrapper to the AI view", async () => {
    const base64 = await createDocxBase64({
      title: "Test document",
      blocks: [{ kind: "paragraph", text: "Placeholder" }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    zip.file("word/document.xml", xml.replace("Placeholder", "<![CDATA[Private words]]>"));
    const decoded = await decodeDocx(await zip.generateAsync({ type: "base64" }), "cdata.docx");
    expect(hasRunText(decoded.document, "Private words")).toBe(true);
  });

  test("reads text from a default-namespace Strict document", async () => {
    const base64 = await createDocxBase64({
      title: "Test document",
      blocks: [{ kind: "paragraph", text: "Private words" }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    zip.file(
      "word/document.xml",
      xml
        .replaceAll(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "http://purl.oclc.org/ooxml/wordprocessingml/main",
        )
        .replace(/xmlns:w=/g, "xmlns=")
        .replace(/<(\/?)w:/g, "<$1"),
    );
    const decoded = await decodeDocx(await zip.generateAsync({ type: "base64" }), "default-strict.docx");
    expect(hasRunText(decoded.document, "Private words")).toBe(true);
  });
});
