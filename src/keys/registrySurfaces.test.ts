// Which webview an action fires in. The Chat window opts main's tab and pane
// chords in one by one (alsoOnSurface) — never `shared`, which would also fire
// them in the Quick Note and Capture windows.

import { afterEach, describe, expect, test } from "bun:test";

import { alsoOnSurface, attachDispatcher, claimingAction, registerAction } from "./registry";

let detach: (() => void) | null = null;
afterEach(() => {
  detach?.();
  // the attached surface is module state: leave it on "main" for other files
  attachDispatcher("main")();
  detach = null;
});

function on(surface: "main" | "chat" | "quick") {
  detach?.();
  detach = attachDispatcher(surface);
}

describe("action surfaces", () => {
  test("a main action fires only in main until it is opted into another window", () => {
    registerAction({ id: "t.close", title: "Close tab", defaultChord: "Meta+F13", run: () => {} });
    on("chat");
    expect(claimingAction("Meta+F13")).toBeNull();
    alsoOnSurface("t.close", "chat");
    expect(claimingAction("Meta+F13")?.id).toBe("t.close");
    on("main");
    expect(claimingAction("Meta+F13")?.id).toBe("t.close");
  });

  test("opting into the Chat window does not leak into Quick or Capture", () => {
    registerAction({ id: "t.split", title: "Split", defaultChord: "Meta+F14", run: () => {} });
    alsoOnSurface("t.split", "chat");
    on("quick");
    expect(claimingAction("Meta+F14")).toBeNull();
  });

  test("an action that belongs to the Chat window alone never fires in main", () => {
    registerAction({
      id: "t.dismiss",
      title: "Dismiss",
      defaultChord: "Meta+F15",
      surface: "chat",
      run: () => {},
    });
    on("main");
    expect(claimingAction("Meta+F15")).toBeNull();
    on("chat");
    expect(claimingAction("Meta+F15")?.id).toBe("t.dismiss");
  });

  test("opting in an unknown id is a quiet no-op", () => {
    expect(() => alsoOnSurface("t.nope", "chat")).not.toThrow();
  });
});
