import { describe, expect, test } from "bun:test";

import { documentImageFromBase64 } from "./images";
import { GENERATED_DOCX_THEME } from "./theme";

function pngDimensions(width: number, height: number): string {
  const data = new Uint8Array(24);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return btoa(String.fromCharCode(...data));
}

describe("generated document images", () => {
  test("fit within the document editor's supported drawing frame", () => {
    const image = documentImageFromBase64("diagram", "Diagram", "image/png", pngDimensions(1_000, 500));

    expect(image.widthPx).toBe(GENERATED_DOCX_THEME.imageMaxWidthPx);
    expect(image.heightPx).toBe(250);
  });
});
