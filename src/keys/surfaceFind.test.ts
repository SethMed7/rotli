import { describe, expect, test } from "bun:test";

import { registerSurfaceFind, runSurfaceFind } from "./surfaceFind";

describe("surface find registration", () => {
  test("reports no handler until a surface mounts", () => {
    expect(runSurfaceFind()).toBe(false);
  });

  test("runs the mounted surface's handler and reports it handled the intent", () => {
    let ran = 0;
    const unregister = registerSurfaceFind(() => {
      ran += 1;
    });
    expect(runSurfaceFind()).toBe(true);
    expect(ran).toBe(1);
    unregister();
  });

  test("unmounting clears the handler", () => {
    const unregister = registerSurfaceFind(() => {});
    unregister();
    expect(runSurfaceFind()).toBe(false);
  });

  // React can mount the next surface before the previous one's cleanup runs.
  // A cleanup that cleared unconditionally would silently disarm the live
  // surface, and ⌘F would do nothing on a screen that visibly owns a find field.
  test("a late unmount does not clear a newer surface's handler", () => {
    let served = "";
    const stale = registerSurfaceFind(() => {
      served = "old";
    });
    registerSurfaceFind(() => {
      served = "new";
    });

    stale();

    expect(runSurfaceFind()).toBe(true);
    expect(served).toBe("new");
  });
});
