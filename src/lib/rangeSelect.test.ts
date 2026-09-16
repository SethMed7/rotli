import { expect, test } from "bun:test";

import { rangeBetween } from "./rangeSelect";

const order = ["a", "b", "c", "d", "e"];
const id = (s: string) => s;

test("a range is inclusive and direction-free", () => {
  expect(rangeBetween(order, id, "b", "d")).toEqual(["b", "c", "d"]);
  expect(rangeBetween(order, id, "d", "b")).toEqual(["b", "c", "d"]);
  expect(rangeBetween(order, id, "c", "c")).toEqual(["c"]);
});

test("a missing anchor or target yields null so the caller re-anchors", () => {
  expect(rangeBetween(order, id, "zz", "d")).toBeNull();
  expect(rangeBetween(order, id, "a", "zz")).toBeNull();
  expect(rangeBetween([], id, "a", "b")).toBeNull();
});

test("objects range by their id, in the order handed in", () => {
  const items = [{ id: "n1" }, { id: "n2" }, { id: "n3" }];
  expect(rangeBetween(items, (n) => n.id, "n3", "n2")).toEqual([{ id: "n2" }, { id: "n3" }]);
});
