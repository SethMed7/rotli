import { describe, expect, test } from "bun:test";

import { BREVE_PDF_TOKEN_ROLES, validateBrevePdfPalette } from "./brevePdfThemes";
import { livePdfPalette, toHex6 } from "./pdfPalette";

const WARM_LIGHT: Record<string, string> = {
  "--ground": " #f8f2e9 ",
  "--surface": "#FFFFFF",
  "--text": "#3a3028",
  "--text-muted": "#6e6155",
  "--accent-text": "#8f4e37",
  "--border": "#e7dbc9",
};

describe("livePdfPalette", () => {
  test("maps the six theme roles to a complete lower-case hex palette", () => {
    const palette = livePdfPalette((token) => WARM_LIGHT[token] ?? "", null);
    expect(palette).toEqual({
      background: "#f8f2e9",
      surface: "#ffffff",
      text: "#3a3028",
      muted: "#6e6155",
      accent: "#8f4e37",
      rule: "#e7dbc9",
    });
    expect(validateBrevePdfPalette(palette!)).toBe("");
  });

  test("links ride the accent TEXT role, not the fill accent", () => {
    expect(BREVE_PDF_TOKEN_ROLES.accent).toBe("--accent-text");
  });

  test("any unresolvable role yields null — never a partial palette", () => {
    const palette = livePdfPalette(
      (token) => (token === "--accent-text" ? "oklch(47% 0.14 210)" : (WARM_LIGHT[token] ?? "")),
      null, // no canvas available → oklch cannot be resolved here
    );
    expect(palette).toBeNull();
    expect(livePdfPalette(() => "", null)).toBeNull();
  });
});

describe("toHex6", () => {
  test("passes six-digit hex through and expands short hex", () => {
    expect(toHex6("#ABCDEF", null)).toBe("#abcdef");
    expect(toHex6("#fa0", null)).toBe("#ffaa00");
  });

  test("parses rgb() without a canvas", () => {
    expect(toHex6("rgb(24, 39, 47)", null)).toBe("#18272f");
    expect(toHex6("rgba(255 0 0 / 0.5)", null)).toBe("#ff0000");
  });

  test("resolves other colour syntaxes through the canvas round-trip", () => {
    const px = new Uint8ClampedArray([15, 111, 174, 255]);
    let last = "";
    const fake = {
      set fillStyle(value: string) {
        last = value;
      },
      get fillStyle() {
        return last;
      },
      clearRect() {},
      fillRect() {},
      getImageData: () => ({ data: px }),
    } as unknown as CanvasRenderingContext2D;
    expect(toHex6("oklch(53% 0.145 210)", fake)).toBe("#0f6fae");
    expect(last).toBe("oklch(53% 0.145 210)");
    const transparent = {
      set fillStyle(_value: string) {},
      clearRect() {},
      fillRect() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } as unknown as CanvasRenderingContext2D;
    expect(toHex6("not-a-colour", transparent)).toBeNull();
  });
});
