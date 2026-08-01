// Duplicate's body transform (Greptile, PR #1): the " copy" suffix must land
// on the TITLE line, never on a frontmatter fence or a thematic break.

import { describe, expect, test } from "bun:test";

import { copyBody } from "./useNoteMenu";

describe("copyBody", () => {
  test("suffixes the first non-blank line", () => {
    expect(copyBody("# Plan\n\nbody")).toBe("# Plan copy\n\nbody");
    expect(copyBody("\n\nplain text")).toBe("\n\nplain text copy");
  });

  test("skips a leading frontmatter fence block untouched", () => {
    const body = "---\ntags: [a]\n---\n\n# Plan\n\nbody";
    expect(copyBody(body)).toBe("---\ntags: [a]\n---\n\n# Plan copy\n\nbody");
  });

  test("an unclosed leading fence stays as it is (no corruption)", () => {
    expect(copyBody("---\nnot closed")).toBe("---\nnot closed copy");
  });

  test("never renames a thematic break", () => {
    expect(copyBody("---\n---\n\n---\n\n# Real title")).toBe("---\n---\n\n---\n\n# Real title copy");
  });

  test("an empty or all-blank body passes through", () => {
    expect(copyBody("")).toBe("");
    expect(copyBody("\n\n")).toBe("\n\n");
  });
});
