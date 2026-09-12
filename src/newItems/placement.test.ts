import { expect, test } from "bun:test";

import { MAIN_ROOT, type MainNode } from "../services/mainTree";
import { newItemParent } from "./placement";

const tree: MainNode[] = [
  { note: "root-note" },
  { folder: "Welcome", children: [{ note: "lesson" }, { folder: "Deep", children: [{ note: "nested" }] }] },
];

test("a new item lands beside the open note, at the root when nothing is open", () => {
  expect(newItemParent(tree, null)).toBe(MAIN_ROOT);
  expect(newItemParent(tree, "root-note")).toBe(MAIN_ROOT);
  expect(newItemParent(tree, "lesson")).toBe("main:Welcome");
  expect(newItemParent(tree, "nested")).toBe("main:Welcome/Deep");
  expect(newItemParent(tree, "not-in-main")).toBe(MAIN_ROOT);
});
