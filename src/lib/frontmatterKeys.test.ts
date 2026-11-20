// Twin of the Rust tests in src-tauri/src/frontmatter_keys.rs: frontmatter a
// strict YAML parser won't decode says nothing about a key by itself, and a
// line about the key itself still denies. Synthetic frontmatter only.
import { describe, expect, test } from "bun:test";

import { bodyEdit } from "./aiEditPolicy";
import { localAiAllowedOverride } from "./frontmatterKeys";

// What the organizer writes: values unquoted (`summary: <one line>`,
// `links: [[A]], [[B]]`), neither of which a YAML parser reads.
const FILED = ["summary: Plan: phase two", "links: [[Alpha]], [[Beta]]"];

describe("frontmatter a YAML parser can't decode", () => {
  test("a filed note with an unquoted colon keeps its permissions", () => {
    expect(bodyEdit(["created_by: librarian", ...FILED])).toBe("allowed");
    expect(bodyEdit(["created_by: agent", "ai_edit: true", ...FILED])).toBe("allowed");
    // not "revoked": a consented insert still lands on the person's note
    expect(bodyEdit(FILED)).toBe("person-written");
    expect(localAiAllowedOverride(["secure: true", "local_ai_allowed: true", ...FILED])).toBe(true);
    expect(localAiAllowedOverride(["secure: true", ...FILED])).toBeNull();
    for (const extra of [
      "tags: [a]\ntags: [b]",
      "summary: pasted\u0085text",
      "x: [unclosed",
      "\tnested: tab",
    ]) {
      expect({ extra, verdict: bodyEdit(["created_by: agent", ...extra.split("\n")]) }).toEqual({
        extra,
        verdict: "allowed",
      });
    }
  });

  test("undecodable frontmatter still denies where a line is about the key", () => {
    expect(bodyEdit(["created_by: agent", "ai_edit: true", "ai_edit: true"])).toBe("revoked");
    expect(bodyEdit(["created_by: agent", "summary: a: b", "!!str ai_edit: false"])).toBe("revoked");
    expect(bodyEdit(["created_by: agent", "summary: a: b", '"ai\\u005fedit": false'])).toBe("revoked");
    expect(localAiAllowedOverride(["local_ai_allowed: true", "summary: about local_ai_allowed: x"])).toBe(
      false,
    );
    expect(localAiAllowedOverride(["local_ai_allowed: \ufefftrue", "summary: a: b"])).toBe(false);
    expect(bodyEdit(["{created_by: agent, ai_edit: false}"])).toBe("revoked");
  });
});

// Twin of `hostile_frontmatter_is_never_built_into_a_tree`: nested aliases,
// nesting past 64 levels, or more than 64 KiB are never decoded; the line
// rules still decide, and a denial only a parser would see still denies.
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
  for (const hostile of [laughs, [deep], [wide]]) {
    const started = performance.now();
    expect(bodyEdit([...hostile, "created_by: agent"])).toBe("allowed");
    expect(bodyEdit([...hostile, "created_by: agent", "{ai_edit: false}"])).toBe("revoked");
    expect(performance.now() - started).toBeLessThan(2000);
  }
  // an escaped key in a flow map is a denial only a decoder sees: it holds
  // at 64 levels of nesting, and at 65 the frontmatter isn't decoded
  const flow = (lists: number) =>
    `{"local\\u005fai_allowed": false, x: ${"[".repeat(lists)}${"]".repeat(lists)}}`;
  expect(localAiAllowedOverride([flow(63)])).toBe(false);
  expect(localAiAllowedOverride([flow(64)])).toBeNull();
});
