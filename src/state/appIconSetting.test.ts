import { expect, test } from "bun:test";

import { parseSettings } from "./persist";

test("the Dock app icon keeps every shipped variant and falls back to the default", () => {
  for (const id of ["default", "warm", "paper", "charcoal", "clay", "black"] as const) {
    expect(parseSettings(JSON.stringify({ appIcon: id })).appIcon).toBe(id);
  }
  expect(parseSettings('{"appIcon":"neon"}').appIcon).toBe("default");
});
