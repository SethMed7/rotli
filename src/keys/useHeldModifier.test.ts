import { describe, expect, test } from "bun:test";

import { hotkeyPeekDelay, keyCancelsHold } from "./useHeldModifier";

describe("hotkeyPeekDelay", () => {
  test("shows immediately in the normal workspace", () => {
    expect(hotkeyPeekDelay(false)).toBe(0);
  });

  test("keeps the hold threshold while modal UI owns attention", () => {
    expect(hotkeyPeekDelay(true)).toBe(500);
  });
});

describe("keyCancelsHold", () => {
  const holding = (...down: string[]) => ({ getModifierState: (key: string) => down.includes(key) });

  test("a chord with ⌘ down cancels the hold until ⌘ is let go", () => {
    expect(keyCancelsHold("Meta", holding("Meta"))).toBe(true);
  });

  test("typing with ⌘ up cancels nothing, so the next hold still peeks", () => {
    expect(keyCancelsHold("Meta", holding())).toBe(false);
    expect(keyCancelsHold("Meta", holding("Shift"))).toBe(false);
  });
});
