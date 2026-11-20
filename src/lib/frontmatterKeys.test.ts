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

  // Codex review of PR #303, item 3
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
    expect(bodyEdit(["created_by: agent", "\tnested: tab"])).toBe("revoked");
    expect(localAiAllowedOverride(["local_ai_allowed: ﻿true", "summary: a: b"])).toBe(false);
  });

  // Codex review of PR #303, item 5
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
      [[deep], "revoked"],
      [[wide], "revoked"],
      [[longKey], "revoked"],
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
    expect(localAiAllowedOverride(nested(63))).toBe(false);
  });
});
