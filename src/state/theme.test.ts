import { describe, expect, test } from "bun:test";

import { isDarkDataTheme, resolveTheme, resolveThemeSetting } from "./theme";

describe("theme resolution", () => {
  test("maps every family to its complete light/dark pair", () => {
    expect(resolveTheme("warm", "light")).toBe("light");
    expect(resolveTheme("warm", "dark")).toBe("dark");
    expect(resolveTheme("mono", "light")).toBe("paper");
    expect(resolveTheme("mono", "dark")).toBe("charcoal");
    expect(resolveTheme("ocean", "light")).toBe("ocean-light");
    expect(resolveTheme("ocean", "dark")).toBe("ocean-dark");
    expect(resolveTheme("grove", "light")).toBe("grove-light");
    expect(resolveTheme("grove", "dark")).toBe("grove-dark");
    expect(resolveTheme("iris", "light")).toBe("iris-light");
    expect(resolveTheme("iris", "dark")).toBe("iris-dark");
    expect(resolveTheme("blossom", "light")).toBe("blossom-light");
    expect(resolveTheme("blossom", "dark")).toBe("blossom-dark");
    expect(resolveTheme("midnight", "light")).toBe("midnight-light");
    expect(resolveTheme("midnight", "dark")).toBe("midnight-dark");
  });

  test("classifies every dark environment for embedded editors", () => {
    expect(isDarkDataTheme("dark")).toBe(true);
    expect(isDarkDataTheme("charcoal")).toBe(true);
    expect(isDarkDataTheme("ocean-dark")).toBe(true);
    expect(isDarkDataTheme("grove-dark")).toBe(true);
    expect(isDarkDataTheme("iris-dark")).toBe(true);
    expect(isDarkDataTheme("blossom-dark")).toBe(true);
    expect(isDarkDataTheme("blossom-light")).toBe(false);
    expect(isDarkDataTheme("midnight-dark")).toBe(true);
    expect(isDarkDataTheme("midnight-light")).toBe(false);
  });

  test("system follows the OS within the selected family", () => {
    expect(resolveThemeSetting("system", "ocean", false)).toBe("ocean-light");
    expect(resolveThemeSetting("system", "ocean", true)).toBe("ocean-dark");
    expect(resolveThemeSetting("system", "mono", false)).toBe("paper");
    expect(resolveThemeSetting("system", "mono", true)).toBe("charcoal");
  });
});
