import { describe, expect, test } from "bun:test";
import { replaceTitleLine } from "./noteTitle";

describe("replaceTitleLine", () => {
  test("replaces an h1 heading, keeping the marker", () => {
    expect(replaceTitleLine("# Old title\n\nbody", "New title")).toBe("# New title\n\nbody");
  });

  test("uses the first H1 even when prose or lower headings precede it", () => {
    expect(replaceTitleLine("Preface\n### Deep\n# Canonical\ntext", "Renamed")).toBe(
      "Preface\n### Deep\n# Renamed\ntext",
    );
  });

  test("an H1-less legacy title deliberately adopts the H1 form", () => {
    expect(replaceTitleLine("Buy milk\nand eggs", "Groceries")).toBe("# Groceries\nand eggs");
  });

  test("skips leading blank lines to find the title line", () => {
    expect(replaceTitleLine("\n\n# Title\nx", "Fresh")).toBe("\n\n# Fresh\nx");
  });

  test("empty body becomes a single h1", () => {
    expect(replaceTitleLine("", "Hello")).toBe("# Hello\n");
  });

  test("blank title is a no-op", () => {
    expect(replaceTitleLine("# Keep me\nx", "   ")).toBe("# Keep me\nx");
  });

  test("trims the incoming title", () => {
    expect(replaceTitleLine("# a", "  spaced  ")).toBe("# spaced");
  });
});
