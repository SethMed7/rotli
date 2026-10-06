import { describe, expect, test } from "bun:test";

import { isValidElement } from "react";

import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { DocumentGlyph, FileGlyph, WordGlyph } from "./glyphs";
import { CanvasGlyph, glyphForNote } from "./noteGlyph";

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

test("a canvas wears the canvas mark only where the build opens canvases", () => {
  const listed = glyphForNote({ kind: "file", id: "wiki/Q3 plan.canvas", title: "Q3 plan" });
  const tabbed = glyphForNote({ kind: "file", title: "Q3 plan.canvas" });
  // bun test compiles as the stable channel, where a .canvas is an ordinary file
  const expected = LAUNCH_FEATURES.jsonCanvas ? CanvasGlyph : FileGlyph;
  expect(isValidElement(listed) && listed.type).toBe(expected);
  expect(isValidElement(tabbed) && tabbed.type).toBe(expected);
});
