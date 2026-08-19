import { afterEach, describe, expect, test } from "bun:test";

import { registerDefaultActions } from "./actions";
import { setSetupHandle } from "./handles";
import { currentChord, dispatch } from "./registry";

registerDefaultActions();

afterEach(() => setSetupHandle(null));

describe("setup navigation commands", () => {
  test("Command-R refreshes the current vault instead of reloading the app shell", () => {
    expect(currentChord("vault.refresh")).toBe("Meta+R");
    expect(currentChord("app.refreshDevelopment")).toBeNull();
  });

  test("the remappable Back command routes to the mounted setup step", () => {
    let backs = 0;
    setSetupHandle({ continue: () => {}, back: () => backs++ });

    dispatch("nav.back");

    expect(backs).toBe(1);
    expect(currentChord("nav.back")).toBe("Meta+BracketLeft");
  });

  test("Continue still routes through the same setup bridge", () => {
    let continues = 0;
    setSetupHandle({ continue: () => continues++ });

    dispatch("setup.continue");

    expect(continues).toBe(1);
  });
});
