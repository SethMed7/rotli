// Popover placement law: downward by default; flip up ONLY when below can't
// fit the menu and above genuinely has more room (short Quick Note windows).

import { describe, expect, test } from "bun:test";

import { SLASH_FLIP_THRESHOLD, slashPlacement } from "./slashMenu";

describe("slashPlacement", () => {
  test("plenty of room below → down", () => {
    expect(slashPlacement(50, 600)).toBe("down");
  });

  test("cramped below with more room above → up", () => {
    expect(slashPlacement(400, 80)).toBe("up");
  });

  test("cramped on BOTH sides stays down (below still wins ties)", () => {
    expect(slashPlacement(60, 80)).toBe("down");
  });

  test("exactly at the threshold below stays down", () => {
    expect(slashPlacement(1000, SLASH_FLIP_THRESHOLD)).toBe("down");
  });

  test("custom needed height is respected", () => {
    expect(slashPlacement(400, 250, 200)).toBe("down");
    expect(slashPlacement(400, 150, 200)).toBe("up");
  });
});
