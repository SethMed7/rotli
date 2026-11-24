import { describe, expect, test } from "bun:test";

import { BREVE_PDF_PRESETS, contrastRatio, validateBrevePdfPalette } from "./brevePdfThemes";

describe("Breve PDF design system", () => {
  test("every shipped preset meets its text and UI contrast contract", () => {
    for (const palette of Object.values(BREVE_PDF_PRESETS)) {
      expect(validateBrevePdfPalette(palette)).toBe("");
      expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.accent, palette.background)).toBeGreaterThanOrEqual(3);
    }
  });

  test("rejects custom palettes that make body text unreadable", () => {
    expect(
      validateBrevePdfPalette({
        ...BREVE_PDF_PRESETS.paper,
        text: "#eeeeee",
      }),
    ).toContain("Text needs more contrast");
  });
});

test("a PDF color that isn't hex is refused instead of measuring as black", () => {
  const palette = { ...BREVE_PDF_PRESETS.paper, text: "oklch(20% 0 0)" };
  expect(validateBrevePdfPalette(palette)).toBe("Every PDF color must be a #rrggbb color.");
});
