import { expect, test } from "bun:test";

import { welcomeAvailability } from "./welcomeSettings";

test("a read-only native vault blocks seeding; the browser twin never does and says its seed is in memory", () => {
  expect(welcomeAvailability(true, false)).toEqual({
    unavailable: true,
    note: "Open a writable vault to add the notes.",
  });
  expect(welcomeAvailability(false, false)).toEqual({ unavailable: false, note: null });
  expect(welcomeAvailability(true, true)).toMatchObject({ unavailable: false });
  expect(welcomeAvailability(true, true).note).toContain("reset on reload");
});
