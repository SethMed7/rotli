import { expect, test } from "bun:test";

import { allActions, dispatch, getAction, registerAction } from "./registry";

test("web action registration excludes native actions from search and dispatch", () => {
  let ran = false;
  registerAction(
    {
      id: "test.native",
      title: "Native action",
      defaultChord: null,
      platforms: ["desktop"],
      run: () => {
        ran = true;
      },
    },
    "web",
  );
  expect(getAction("test.native")).toBeUndefined();
  expect(allActions().some((a) => a.id === "test.native")).toBe(false);
  dispatch("test.native");
  expect(ran).toBe(false);
  registerAction(
    {
      id: "test.native",
      title: "Native action",
      defaultChord: null,
      platforms: ["desktop"],
      run: () => {
        ran = true;
      },
    },
    "desktop",
  );
  expect(getAction("test.native")).toBeDefined();
  dispatch("test.native");
  expect(ran).toBe(true);
});
