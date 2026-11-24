import { describe, expect, test } from "bun:test";

import { PROJECTS_SHOWN, shownProjectIds } from "./sidebarChatProjects";

const ids = ["a", "b", "c", "d", "e", "f", "g"];

describe("the Projects list stays short", () => {
  test("a few projects all show; more fold behind Show more", () => {
    expect(shownProjectIds(ids.slice(0, 3), false, null)).toEqual(["a", "b", "c"]);
    expect(shownProjectIds(ids, false, null)).toEqual(ids.slice(0, PROJECTS_SHOWN));
    expect(shownProjectIds(ids, true, null)).toEqual(ids);
  });

  test("the open project's row stays visible even when it is folded away", () => {
    expect(shownProjectIds(ids, false, "g")).toEqual([...ids.slice(0, PROJECTS_SHOWN), "g"]);
    expect(shownProjectIds(ids, false, "b")).toEqual(ids.slice(0, PROJECTS_SHOWN));
    expect(shownProjectIds(ids, false, "gone")).toEqual(ids.slice(0, PROJECTS_SHOWN));
  });
});
