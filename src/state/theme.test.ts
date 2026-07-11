import { describe, expect, test } from "bun:test";
import { resolveTheme } from "./theme";

describe("theme resolution", () => {
  test("maps both solid families to their complete light/dark pairs", () => {
    expect(resolveTheme("warm", false, "light")).toBe("light");
    expect(resolveTheme("warm", false, "dark")).toBe("dark");
    expect(resolveTheme("mono", false, "light")).toBe("paper");
    expect(resolveTheme("mono", false, "dark")).toBe("charcoal");
  });

  test("glass is a mode over either family", () => {
    expect(resolveTheme("warm", true, "light")).toBe("glass-light");
    expect(resolveTheme("mono", true, "dark")).toBe("glass-dark");
  });
});
