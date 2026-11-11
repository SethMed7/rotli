import { expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import { memoPerDoc } from "./docMemo";

test("a scan runs once per document and again for an edited one", () => {
  let runs = 0;
  const lines = memoPerDoc((doc) => {
    runs += 1;
    return doc.toJSON();
  });
  const doc = Text.of(["a", "b"]);
  expect(lines(doc)).toBe(lines(doc));
  expect(runs).toBe(1);
  expect(lines(doc.replace(0, 1, Text.of(["z"])))).toEqual(["z", "b"]);
  expect(runs).toBe(2);
});
