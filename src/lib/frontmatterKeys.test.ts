// Twin of the Rust tests in src-tauri/src/frontmatter_keys.rs: the organizer's
// unquoted frontmatter keeps its permissions, a denial only YAML sees holds
// whatever else the frontmatter holds, and frontmatter the reader refuses
// denies. Synthetic frontmatter only.
import { describe, expect, test } from "bun:test";

import { bodyEdit } from "./aiEditPolicy";
import { localAiAllowedOverride } from "./frontmatterKeys";

// What the organizer writes: values unquoted (`summary: <one line>`,
// `links: [[A]], [[B]]`), neither of which a YAML parser reads.
const FILED = ["summary: Plan: phase two", "links: [[Alpha]], [[Beta]]"];

describe("frontmatter read as YAML", () => {
  test("a filed note with an unquoted colon keeps its permissions", () => {
    expect(bodyEdit(["created_by: librarian", ...FILED])).toBe("allowed");
    expect(bodyEdit(["created_by: agent", "ai_edit: true", ...FILED])).toBe("allowed");
    // not "revoked": a consented insert still lands on the person's note
    expect(bodyEdit(FILED)).toBe("person-written");
    expect(localAiAllowedOverride(["secure: true", "local_ai_allowed: true", ...FILED])).toBe(true);
    expect(localAiAllowedOverride(["secure: true", ...FILED])).toBeNull();
    for (const extra of ["tags: [a]\ntags: [b]", "summary: pasted\u0085text", "x: [unclosed"]) {
      expect({ extra, verdict: bodyEdit(["created_by: agent", ...extra.split("\n")]) }).toEqual({
        extra,
        verdict: "allowed",
      });
    }
  });

  // Codex review of pull request 303, item 3
  test("a denial only YAML sees holds beside an alias or a bad value", () => {
    const flow = '{s: 1, "local\\u005fai_allowed": false, note: x}';
    for (const extra of ["a: &k one", "b: *k", "summary: a: b"]) {
      expect({
        extra,
        says: localAiAllowedOverride(["secure: true", "local_ai_allowed: true", flow, extra]),
      }).toEqual({
        extra,
        says: false,
      });
    }
    expect(
      localAiAllowedOverride([
        "local_ai_allowed: true",
        'flow: {"local\\u005fai_allowed": false}',
        "a: &k one",
        "b: *k",
      ]),
    ).toBe(true);
    expect(localAiAllowedOverride(["local_ai_allowed: true", "a: &k local_ai_allowed", "*k : false"])).toBe(
      false,
    );
    expect(bodyEdit(["created_by: agent", "ai_edit: true", "ai_edit: true"])).toBe("revoked");
    expect(bodyEdit(["created_by: agent", "summary: a: b", "!!str ai_edit: false"])).toBe("revoked");
    expect(bodyEdit(["created_by: agent", "summary: a: b", '"ai\\u005fedit": false'])).toBe("revoked");
    expect(bodyEdit(["{created_by: agent, ai_edit: false}"])).toBe("revoked");
    expect(bodyEdit(["created_by: agent", "\tnested: tab"])).toBe("allowed");
    expect(localAiAllowedOverride(["local_ai_allowed: ﻿true", "summary: a: b"])).toBe(false);
  });

  // Codex review of pull request 303, item 5
  test("unrelated keys never change the verdict", () => {
    expect(bodyEdit(["created_by: agent", "1.0: a", "1.00: b", "summary: The ai_edit setting"])).toBe(
      "allowed",
    );
    expect(bodyEdit(["created_by: agent", "1: a", "1: b"])).toBe("allowed");
  });

  test("hostile frontmatter is never built into a tree", () => {
    const laughs = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    const names = "abcdefghijk";
    for (let at = 1; at < names.length; at++)
      laughs.push(
        `${names[at]}: &${names[at]} [${Array(9)
          .fill(`*${names[at - 1]}`)
          .join(", ")}]`,
      );
    const deep = `x: ${"[".repeat(30_000)}${"]".repeat(30_000)}`;
    const wide = `summary: ${"x".repeat(70_000)}`;
    const longKey = `"${"\\u0061".repeat(20_000)}": false`;
    for (const [hostile, verdict] of [
      [laughs, "allowed"],
      [[deep], "allowed"],
      [[wide], "allowed"],
      [[longKey], "locked"],
    ] as const) {
      const started = performance.now();
      expect(bodyEdit([...hostile, "created_by: agent"])).toBe(verdict);
      expect(performance.now() - started).toBeLessThan(2000);
    }
    // a grant holds at 64 levels of YAML nesting; at 65 it is refused
    const nested = (lists: number) => [
      "local_ai_allowed: true",
      `x: {y: ${"[".repeat(lists)}${"]".repeat(lists)}}`,
    ];
    expect(localAiAllowedOverride(nested(62))).toBe(true);
    expect(localAiAllowedOverride(nested(63))).toBe(true);
    expect(localAiAllowedOverride([...nested(63), 'z: "local\\u005fai_allowed"'])).toBe(false);
  });
});

// Review of pull request 303 at 828f994d: the readers agree on tabs, a stray
// line, `...`, carriage returns, quoted or YAML-only locks, and merge keys.
describe("what the differential harness found", () => {
  test("a tab after the colon never grants (item 1)", () => {
    expect(bodyEdit(["ai_edit:\ttrue"])).toBe("revoked");
    expect(bodyEdit(["created_by:\tagent"])).toBe("person-written");
    expect(localAiAllowedOverride(["secure: true", "local_ai_allowed:\ttrue"])).toBe(false);
    expect(bodyEdit(["date created:\t2024-01-01"])).toBe("person-written");
    expect(bodyEdit(["created_by: agent", "date created:\t2024-01-01"])).toBe("allowed");
    expect(bodyEdit(["created_by:  agent"])).toBe("person-written");
  });

  test("one malformed ordinary line changes no permission (item 3)", () => {
    for (const odd of ["date created: Meeting: x", "c", "- item", "\t- a", "{a: 1,", "%YAML 1.2", "  y: z"]) {
      expect({ odd, edit: bodyEdit(["created_by: agent", odd]) }).toEqual({ odd, edit: "allowed" });
      expect({ odd, edit: bodyEdit([odd]) }).toEqual({ odd, edit: "person-written" });
      expect({ odd, local: localAiAllowedOverride(["secure: true", odd]) }).toEqual({ odd, local: null });
    }
    expect(bodyEdit(["created_by: agent", '"a\\qb": c'])).toBe("allowed");
    expect(bodyEdit(["created_by: agent", "c", '{"ai\\u005fedit": false'])).toBe("locked");
  });

  test("a document end, carriage returns, and a lone tab line read alike (item 6)", () => {
    expect(localAiAllowedOverride(["...", "secure: true", "local_ai_allowed: true"])).toBe(true);
    expect(localAiAllowedOverride(["...", "local_ai_allowed: true", "x: *nope"])).toBe(false);
    expect(bodyEdit(["ai_edit: true\r\r\r"])).toBe("allowed");
    expect(bodyEdit(["\tnested: tab"])).toBe("person-written");
  });

  test("a lock or secure flag counts however YAML spells it, and merge keys deny (item 8)", () => {
    for (const lock of ['locked: "true"', "locked: True", "{locked: true}", "!!str locked: true"])
      expect({ lock, edit: bodyEdit([lock, "created_by: agent"]) }).toEqual({ lock, edit: "locked" });
    expect(bodyEdit(["created_by: agent", "<<: {ai_edit: false}"])).toBe("revoked");
    expect(bodyEdit(["created_by: agent", "base: &x {ai_edit: false}", "<<: *x"])).toBe("locked");
  });

  test("leading list markers are bounded before parsing (item 7)", () => {
    const started = performance.now();
    expect(bodyEdit(["created_by: agent", "x:", `  ${"- ".repeat(30_000)}a`])).toBe("allowed");
    expect(performance.now() - started).toBeLessThan(200);
  });
});
