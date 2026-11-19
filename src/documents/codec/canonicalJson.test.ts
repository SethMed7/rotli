import { expect, test } from "bun:test";

import { canonicalJson } from "./canonicalJson";

test("key order doesn't matter, at any depth; values and array order do", () => {
  expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
});
