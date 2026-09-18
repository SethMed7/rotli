import { expect, test } from "bun:test";

import { toggledSet } from "./toggledSet";

test("flips an id in and out without touching the original", () => {
  const start = new Set(["a"]);
  expect([...toggledSet(start, "b")]).toEqual(["a", "b"]);
  expect([...toggledSet(start, "a")]).toEqual([]);
  expect([...start]).toEqual(["a"]);
});
