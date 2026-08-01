import { describe, expect, test } from "bun:test";

import {
  DOCUMENT_CANVAS_COLORS,
  documentUniverTheme,
  rotliUniverTheme,
  univerNeutralForTheme,
} from "./univerTheme";

describe("Univer app-theme mapping", () => {
  test("paper and charcoal use the monochrome family", () => {
    expect(univerNeutralForTheme("paper")).toBe("mono");
    expect(univerNeutralForTheme("charcoal")).toBe("mono");
  });

  test("the branded light/dark pair stays warm", () => {
    expect(univerNeutralForTheme("dark")).toBe("warm");
  });

  test("charcoal removes clay from Univer primary chrome", () => {
    const charcoal = rotliUniverTheme(univerNeutralForTheme("charcoal"));
    const warm = rotliUniverTheme(univerNeutralForTheme("dark"));
    expect(charcoal.primary[500]).toBe(charcoal.gray[500]);
    expect(charcoal.primary[500]).not.toBe(warm.primary[500]);
  });

  test("documents always use literal white paper", () => {
    const theme = documentUniverTheme();
    expect(theme.white).toBe("#FFFFFF");
    expect(theme.black).toBe("#000000");
    expect(DOCUMENT_CANVAS_COLORS.paper).toBe("#FFFFFF");
    expect(DOCUMENT_CANVAS_COLORS.ink).toBe("#000000");
  });
});
