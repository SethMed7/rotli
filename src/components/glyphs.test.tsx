import { describe, expect, test } from "bun:test";

import { isValidElement } from "react";

import { DocumentGlyph, WordGlyph, glyphForNote } from "./glyphs";

function glyphType(title: string): unknown {
  const glyph = glyphForNote({ kind: "file", title });
  expect(isValidElement(glyph)).toBe(true);
  return isValidElement(glyph) ? glyph.type : null;
}

describe("conventional file glyph identity", () => {
  test("Word formats use the recognizable Word mark", () => {
    expect(glyphType("report.docx")).toBe(WordGlyph);
    expect(glyphType("template.dotm")).toBe(WordGlyph);
    expect(glyphType("legacy.doc")).toBe(WordGlyph);
  });

  test("non-Word document formats keep the honest generic document mark", () => {
    expect(glyphType("report.odt")).toBe(DocumentGlyph);
    expect(glyphType("notes.rtf")).toBe(DocumentGlyph);
  });
});
