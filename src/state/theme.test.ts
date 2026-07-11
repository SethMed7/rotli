import { describe, expect, test } from "bun:test";
import { resolveTheme } from "./theme";

describe("theme resolution", () => {
  test("maps both solid families to their complete light/dark pairs", () => {
    expect(resolveTheme("warm", "light")).toBe("light");
    expect(resolveTheme("warm", "dark")).toBe("dark");
    expect(resolveTheme("mono", "light")).toBe("paper");
    expect(resolveTheme("mono", "dark")).toBe("charcoal");
  });
});
