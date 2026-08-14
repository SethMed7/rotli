import { describe, expect, test } from "bun:test";

import { BooleanNumber, WrapTextType } from "@univerjs/presets";

import { documentImageDrawing } from "./imageDrawing";

describe("DOCX Univer image adapter", () => {
  test("supplies the complete inline drawing contract expected by the renderer", () => {
    const drawing = documentImageDrawing("document", {
      id: "diagram",
      name: "Architecture diagram",
      mimeType: "image/png",
      base64: "AA==",
      widthPx: 480,
      heightPx: 270,
    });

    expect(drawing.behindDoc).toBe(BooleanNumber.FALSE);
    expect(drawing.wrapText).toBe(WrapTextType.BOTH_SIDES);
    expect(drawing.distT).toBe(0);
    expect(drawing.distB).toBe(0);
    expect(drawing.distL).toBe(0);
    expect(drawing.distR).toBe(0);
  });
});
