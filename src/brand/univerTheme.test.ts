import { describe, expect, test } from "bun:test";
import { rotliUniverTheme, univerNeutralForTheme } from "./univerTheme";

describe("Univer app-theme mapping", () => {
  test("paper and charcoal use the monochrome family", () => {
    expect(univerNeutralForTheme("paper")).toBe("mono");
    expect(univerNeutralForTheme("charcoal")).toBe("mono");
  });

  test("warm and glass themes keep their established families", () => {
    expect(univerNeutralForTheme("dark")).toBe("warm");
    expect(univerNeutralForTheme("glass-dark")).toBe("cool");
  });

  test("charcoal removes clay from Univer primary chrome", () => {
    const charcoal = rotliUniverTheme(univerNeutralForTheme("charcoal"));
    const warm = rotliUniverTheme(univerNeutralForTheme("dark"));
    expect(charcoal.primary[500]).toBe(charcoal.gray[500]);
    expect(charcoal.primary[500]).not.toBe(warm.primary[500]);
  });
});
