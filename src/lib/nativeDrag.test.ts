// The native drag relay only exists inside Tauri; elsewhere subscribing is a
// no-op that still hands back an unsubscribe, so the hook's cleanup never
// branches on the runtime.
import { expect, test } from "bun:test";

import { onNativeDrag } from "./nativeDrag";

test("subscribing outside Tauri returns a callable unsubscribe and never fires", () => {
  let fired = 0;
  const off = onNativeDrag(() => fired++);
  expect(typeof off).toBe("function");
  expect(() => off()).not.toThrow();
  expect(fired).toBe(0);
});
