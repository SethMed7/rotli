import { describe, expect, test } from "bun:test";

import { hotkeyPeekDelay } from "./useHeldModifier";

describe("hotkeyPeekDelay", () => {
  test("shows immediately in the normal workspace", () => {
    expect(hotkeyPeekDelay(false)).toBe(0);
  });

  test("keeps the hold threshold while modal UI owns attention", () => {
    expect(hotkeyPeekDelay(true)).toBe(500);
  });
});
