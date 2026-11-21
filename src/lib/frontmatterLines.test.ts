// The permission line rules, one behavior at a time. Cross-language agreement
// is parity.json `permissionLineCases` and scripts/permission-differential.ts.
import { describe, expect, test } from "bun:test";

import {
  flagLine,
  lockedOn,
  namesPermissionKey,
  ownedKey,
  secureOn,
  segments,
  withoutFlag,
} from "./frontmatterLines";

const grantsTrue = (value: string) => value === "true";
const locks = (...fields: string[]) => lockedOn(fields);
const says = (fields: string[]) => ownedKey(fields, "ai_edit", grantsTrue).says;

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
      "&a locked: true",
      "!!str &a locked: true",
      "- &a !!str locked: true",
      "{locked: true}",
      "{? locked: true}",
      "<<: {&a locked: true}",
      "meta: {mood: calm, !!str locked: true}",
      '"\\u006cocked": true',
      '"\\x6cocked": true',
    ])
      expect({ line, on: locks(line) }).toEqual({ line, on: true });
  });

  test("false, no and off say off, in any case, quoted or not, with a comment or not", () => {
    for (const value of [
      "false",
      "False",
      "FALSE",
      "no",
      "No",
      "off",
      "OFF",
      "'false'",
      '"no"',
      "false # was on",
      "off\t# c",
    ])
      expect({ value, on: secureOn([`secure: ${value}`]) }).toEqual({ value, on: false });
    expect(secureOn(["{secure: no}"])).toBe(false);
  });

  test("every other value turns it on", () => {
    for (const value of [
      "",
      "true",
      "yes",
      "~",
      "null",
      "0",
      "\u00a0false",
      "'false",
      "falsey",
      "false#c",
      "&a false",
      "[false]",
    ])
      expect({ value, on: secureOn([`secure: ${value}`]) }).toEqual({ value, on: true });
  });

  test("a line that doesn't name the key says nothing", () => {
    for (const line of [
      "# locked: true",
      "status: unlocked",
      "LOCKED: true",
      "notes: locked",
      "",
      '"locked: true',
      "&a",
    ])
      expect({ line, on: locks(line) }).toEqual({ line, on: false });
  });

  test("an escape that names no character names no key", () => {
    expect(locks('"locke\\ud800": true')).toBe(false);
    expect(locks('"\\u006": true')).toBe(false);
  });

  test("flagLine names the line that holds it on", () => {
    expect(flagLine(["title: x", "secure: false", "'secure': 1"], "secure")).toBe(2);
    expect(flagLine(["secure: false"], "secure")).toBe(-1);
  });
});

describe("block-scalar text is text", () => {
  test("a key inside |, > and their chomping or indent forms names nothing", () => {
    for (const header of [
      "description: |",
      "description: >",
      "description: |-",
      "description: >+2",
      "description: |",
    ])
      expect({ header, on: locks(header, "  How to lock:", "  locked: true", "", "  then save.") }).toEqual({
        header,
        on: false,
      });
    expect(says(["created_by: agent", "notes: |", "  ai_edit: false"])).toBe("unset");
  });

  test("the block ends at a line no deeper than its header", () => {
    expect(locks("description: |", "  prose", "locked: true")).toBe(true);
    expect(locks("- note: |", "  - locked: true")).toBe(false);
    expect(locks("  meta: |", "  locked: true")).toBe(true);
  });

  test("a value that only looks like an indicator opens no block", () => {
    for (const header of ["title: a|", "title: x |", "key:|", 'title: "|"', "notes: | # a comment"])
      expect({ header, on: locks(header, "  locked: true") }).toEqual({ header, on: true });
  });
});

describe("rule 2: the same spellings deny a key only Rust writes", () => {
  test("a value that isn't a grant denies in any spelling", () => {
    for (const line of [
      '"ai_edit": false',
      "{ai_edit: no}",
      "!!str ai_edit: false",
      "&a ai_edit: false",
      '"\\u0061i_edit": 0',
      "? ai_edit",
    ])
      expect({ line, says: says([line]) }).toEqual({ line, says: "deny" });
  });

  test("only Rotli's own spelling grants", () => {
    expect(ownedKey(["ai_edit: true"], "ai_edit", grantsTrue)).toEqual({ says: "grant", value: "true" });
    for (const line of [
      '"ai_edit": true',
      "  ai_edit: true",
      "{ai_edit: true}",
      "ai_edit : true",
      "&a ai_edit: true",
    ])
      expect({ line, says: says([line]) }).toEqual({ line, says: "unset" });
  });
});

describe("rule 3: a grant continued onto a plain line", () => {
  test("a deeper plain line turns the grant into text, which denies", () => {
    for (const next of ["  until friday", "  - later", "  ? maybe", "\tmore"])
      expect({ next, says: says(["ai_edit: true", next]) }).toEqual({ next, says: "deny" });
  });

  test("a comment, a nested key, or a line at the margin leaves the grant", () => {
    for (const next of ["  # note", "  x: y", "  x:", "? x", ": y", "other: 1", "", "- item"])
      expect({ next, says: says(["ai_edit: true", next]) }).toEqual({ next, says: "grant" });
    expect(says(["ai_edit: true", "", "  later"])).toBe("deny");
  });
});

describe("rule 4: odd line breaks", () => {
  test("a lone CR, U+0085, U+2028 and U+2029 split a line; trailing CRs don't", () => {
    for (const brk of ["\r", "\u0085", "\u2028", "\u2029"])
      expect(segments(`x: 1${brk}secure: true`)).toEqual({ parts: ["x: 1", "secure: true"], whole: false });
    expect(segments("ai_edit: true\r\r")).toEqual({ parts: ["ai_edit: true"], whole: true });
  });

  test("a broken line is also read whole, so a break can't open what the whole line holds", () => {
    expect(secureOn(["secure: false\rx: y"])).toBe(true);
    expect(locks("locked\u2028: true")).toBe(true);
    expect(secureOn(["x: 1\rsecure: false"])).toBe(false);
  });

  test("a broken line never grants and denies the key it names", () => {
    expect(says(["x: 1\rai_edit: true"])).toBe("deny");
    expect(says(["ai_edit: true\u0085"])).toBe("deny");
  });
});

describe("typed facts and off-switches", () => {
  test("a typed fact's line that names a permission key stays foreign", () => {
    for (const line of [
      "pinned: {secure: true}",
      "id: {locked: true}",
      "updated: {local_ai_allowed: false}",
      "pinned: false\rsecure: true",
    ])
      expect({ line, foreign: namesPermissionKey(line) }).toEqual({ line, foreign: true });
    for (const line of ["id: 01J", "pinned: true", "created: 2024-01-01", "origin: Inbox", "updated: {a: 1}"])
      expect({ line, foreign: namesPermissionKey(line) }).toEqual({ line, foreign: false });
  });

  test("an off-switch removes only top-level single-line spellings", () => {
    expect(
      withoutFlag(["title: x", "locked: true", '"locked": yes', "locked : on", "'locked': 1"], "locked"),
    ).toEqual(["title: x"]);
    const kept = [
      "? locked",
      ": true",
      "resources:",
      "  - locked: true",
      "    src: a.png",
      "- locked: true",
      "!!str locked: true",
      "&a locked: true",
      "x: 1\rlocked: true",
      "notes: |",
      "  locked: true",
    ];
    expect(withoutFlag(kept, "locked")).toEqual(kept);
    for (const value of ["|", ">-", "[true,", "{a: 1,", '"tr'])
      expect({ value, kept: withoutFlag([`locked: ${value}`, "x: 1"], "locked").length }).toEqual({
        value,
        kept: 2,
      });
    expect(withoutFlag(["locked:", "  - true"], "locked")).toEqual(["locked:", "  - true"]);
  });
});
