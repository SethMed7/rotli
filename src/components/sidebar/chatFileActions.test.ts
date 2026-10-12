import { expect, test } from "bun:test";

import { chatFinderMenuItems } from "./chatFileActions";

test("the chat Finder action is offered only by desktop builds", () => {
  const onClick = () => {};
  expect(chatFinderMenuItems("web", true, onClick)).toEqual([]);
  expect(chatFinderMenuItems("desktop", false, onClick)).toEqual([
    { kind: "action", label: "Show in Finder", disabled: true, onClick },
  ]);
  expect(chatFinderMenuItems("desktop", true, onClick)[0]?.disabled).toBe(false);
});
