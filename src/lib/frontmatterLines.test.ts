// The permission line rules, one behavior at a time. Cross-language agreement
// is parity.json `permissionLineCases` and scripts/permission-differential.ts.
import { describe, expect, test } from "bun:test";

import { lineFlag, lineMentions, lockedOn, ownedKey, secureOn, segments } from "./frontmatterLines";

const grantsTrue = (value: string) => value === "true";

describe("rule 1: locked and secure in any spelling", () => {
  test("every line spelling names the key", () => {
    for (const line of [
      "locked: true",
      "  locked: true",
      "- locked: true",
      "-\tlocked: true",
      "? locked",
      '"locked": true',
      "'locked': true",
      "!!str locked: true",
      "{locked: true}",
      "meta: {mood: calm, locked: true}",
      '"\\u006cocked": true',
      '"\\x6cocked": true',
    ])
      expect({ line, on: lineFlag(line, "locked") }).toEqual({ line, on: true });
  });

  test("only an exact false turns it off", () => {
    for (const value of [
      "",
      "True",
      "yes",
      "no",
      "off",
      '"true"',
      "'false'",
      "false # c",
      "\u00a0false",
      "~",
    ])
      expect({ value, on: lineFlag(`secure: ${value}`, "secure") }).toEqual({ value, on: true });
    expect(lineFlag("secure: false", "secure")).toBe(false);
    expect(lineFlag("secure:\tfalse  ", "secure")).toBe(false);
    expect(lineFlag("{secure: false}", "secure")).toBe(false);
  });

  test("a line that doesn't name the key says nothing", () => {
    for (const line of [
      "# locked: true",
      "status: unlocked",
      "LOCKED: true",
      "notes: locked",
      "",
      '"locked: true',
    ])
      expect({ line, on: lineFlag(line, "locked") }).toEqual({ line, on: null });
  });

  test("an escape that names no character names no key", () => {
    expect(lineFlag('"locke\\ud800": true', "locked")).toBe(null);
    expect(lineFlag('"\\u006": true', "locked")).toBe(null);
  });
});

describe("rule 2: the same spellings deny a key only Rust writes", () => {
  test("a value that isn't a grant denies in any spelling", () => {
    for (const line of [
      '"ai_edit": false',
      "{ai_edit: no}",
      "!!str ai_edit: false",
      '"\\u0061i_edit": 0',
      "? ai_edit",
    ])
      expect({ line, says: ownedKey([line], "ai_edit", grantsTrue).says }).toEqual({ line, says: "deny" });
  });

  test("only Rotli's own spelling grants", () => {
    expect(ownedKey(["ai_edit: true"], "ai_edit", grantsTrue)).toEqual({ says: "grant", value: "true" });
    for (const line of ['"ai_edit": true', "  ai_edit: true", "{ai_edit: true}", "ai_edit : true"])
      expect({ line, says: ownedKey([line], "ai_edit", grantsTrue).says }).toEqual({ line, says: "unset" });
  });
});

describe("rule 3: a grant continued onto a plain line", () => {
  test("a deeper plain line turns the grant into text, which denies", () => {
    for (const next of ["  until friday", "  - later", "  ? maybe", "\tmore"])
      expect({ next, says: ownedKey(["ai_edit: true", next], "ai_edit", grantsTrue).says }).toEqual({
        next,
        says: "deny",
      });
  });

  test("a comment, a nested key, or a line at the margin leaves the grant", () => {
    for (const next of ["  # note", "  x: y", "  x:", "? x", ": y", "other: 1", "", "- item"])
      expect({ next, says: ownedKey(["ai_edit: true", next], "ai_edit", grantsTrue).says }).toEqual({
        next,
        says: "grant",
      });
    expect(ownedKey(["ai_edit: true", "", "  later"], "ai_edit", grantsTrue).says).toBe("deny");
  });
});

describe("rule 4: odd line breaks", () => {
  test("a lone CR, U+0085, U+2028 and U+2029 split a line; trailing CRs don't", () => {
    for (const brk of ["\r", "\u0085", "\u2028", "\u2029"])
      expect(segments(`x: 1${brk}secure: true`)).toEqual({ parts: ["x: 1", "secure: true"], whole: false });
    expect(segments("ai_edit: true\r\r")).toEqual({ parts: ["ai_edit: true"], whole: true });
  });

  test("a broken line is also read whole, so a break can't open what the whole line holds", () => {
    expect(lineFlag("secure: false\rx: y", "secure")).toBe(true);
    expect(lineFlag("locked\u2028: true", "locked")).toBe(true);
    expect(lineMentions("x: 1\rsecure: false", "secure").mentions.map((m) => m.value)).toEqual(["false"]);
  });

  test("a broken line never grants and denies the key it names", () => {
    expect(ownedKey(["x: 1\rai_edit: true"], "ai_edit", grantsTrue).says).toBe("deny");
    expect(ownedKey(["ai_edit: true\u0085"], "ai_edit", grantsTrue).says).toBe("deny");
  });
});

test("note-level readers: any line turns the flag on", () => {
  expect(lockedOn(["title: x", "meta: {locked: yes}"])).toBe(true);
  expect(secureOn(["secure: false", "  secure: false"])).toBe(false);
  expect(secureOn(["secure: false", "'secure': 1"])).toBe(true);
});
