import { describe, expect, test } from "bun:test";

import { activeItemSinkLane } from "./itemLifecycle";

describe("active item lifecycle routing", () => {
  test("boards use their note-native move lane instead of conventional file capabilities", () => {
    expect(activeItemSinkLane("note")).toBe("note");
    expect(activeItemSinkLane("board")).toBe("note");
    expect(activeItemSinkLane("file")).toBe("file");
  });
});
