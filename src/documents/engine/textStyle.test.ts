import { describe, expect, test } from "bun:test";

import { BaselineOffset } from "@univerjs/presets";

import { fromTextStyle, textStyle } from "./textStyle";

// A document fixture color (hex without the leading #), not a UI color.
const ORANGE = "F6B26B";

describe("DOCX Univer text-style mapping", () => {
  test("carries background shading and sub/superscript both directions", () => {
    const superscript = { background: `#${ORANGE}`, verticalAlign: "superscript" as const };
    expect(textStyle(superscript)).toEqual({ bg: { rgb: `#${ORANGE}` }, va: BaselineOffset.SUPERSCRIPT });
    expect(fromTextStyle(textStyle(superscript))).toEqual(superscript);
    expect(fromTextStyle(textStyle({ verticalAlign: "subscript" }))).toEqual({ verticalAlign: "subscript" });
  });

  test("a reset highlight and normal baseline carry no style", () => {
    expect(fromTextStyle({ bg: { rgb: null }, va: BaselineOffset.NORMAL })).toBeUndefined();
  });
});
