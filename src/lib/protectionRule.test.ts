// Every case in scripts/fixtures/protection-rule.json, the rule Rust's
// note_protection.rs runs too: both sides must call the same rewrite loosening.
import { describe, expect, test } from "bun:test";

import fixture from "../../scripts/fixtures/protection-rule.json";
import { isNotePath, keepProtection, loosened, protection, requireNotLooser } from "./protectionRule";

describe("note protection only tightens", () => {
  for (const c of fixture.cases)
    test(c.name, () => {
      expect(loosened(c.old, c.new)).toEqual(c.loosened);
      if (c.loosened.length) expect(() => requireNotLooser(c.old, c.new)).toThrow(/refused/);
      else expect(() => requireNotLooser(c.old, c.new)).not.toThrow();
    });

  for (const c of fixture.notePaths)
    test(`note path: ${c.path}`, () => expect(isNotePath(c.path)).toBe(c.note));

  test("keepProtection puts dropped flags back, with or without a block", () => {
    const sealed = "---\nsecureContext: true\nsecure: true\nlocked: true\n---\nkept words\n";
    for (const next of ["---\ntitle: t\n---\n\nnext\n", "next\n", "---\nlocked: no\n---\nnext\n"]) {
      const kept = keepProtection(sealed, next);
      expect(protection(kept)).toMatchObject({ locked: true, secure: true, secureContext: true });
      expect(kept).toContain("next\n");
      expect(loosened(sealed, kept)).toEqual([]);
    }
    expect(keepProtection("plain\n", "---\ntitle: t\n---\n")).toBe("---\ntitle: t\n---\n");
  });
});

test("a lock doesn't hide a revoked grant: a rewrite dropping both gets both back", () => {
  const old = "---\nlocked: true\ncreated_by: chat\nai_edit: false\n---\n\nturn\n";
  const kept = keepProtection(old, "---\ncreated_by: chat\n---\n\nturn\n");
  expect(loosened(old, kept)).toEqual([]);
  expect(kept).toContain("ai_edit: false");
});
