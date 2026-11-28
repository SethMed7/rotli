import { afterAll, expect, mock, test } from "bun:test";

// A host's starting theme family (docs/architecture/host-seams.md, "The
// look"): a fresh start, first run and Reset use it; standalone keeps Rotli's.
const registry = { ...(await import("../host/registry")) };
let family: "ocean" | null = null;
await mock.module("../host/registry", () => ({ ...registry, hostThemeFamily: () => family }));
const { DEFAULT_APPEARANCE, defaultAppearance } = await import("./appearanceDefaults");
const { startingAppearance } = await import("./onboarding");
const { parseSettings } = await import("./persist");
afterAll(async () => {
  await mock.module("../host/registry", () => registry);
});

test("standalone Rotli starts on its own family, exactly as before", () => {
  family = null;
  expect(defaultAppearance()).toEqual({ ...DEFAULT_APPEARANCE });
  expect(startingAppearance().themeFamily).toBe("warm");
});

test("a host's family replaces only the family, and is read at each use", () => {
  family = "ocean";
  expect(defaultAppearance()).toEqual({ ...DEFAULT_APPEARANCE, themeFamily: "ocean" });
  expect(startingAppearance()).toMatchObject({
    themeFamily: "ocean",
    theme: "light",
    quokkaAccessory: "none",
  });
  family = null;
  expect(defaultAppearance().themeFamily).toBe("warm");
});

test("settings with no family of their own start on the host's, and a saved family still wins", () => {
  // a host's first launch has its scratch vault bound already, so hydration
  // reads that vault's empty settings rather than taking the fresh-install path
  family = "ocean";
  expect(parseSettings("{}").themeFamily).toBe("ocean");
  expect(parseSettings('{"themeFamily":"grove"}').themeFamily).toBe("grove");
  expect(parseSettings('{"themeFamily":"neon"}').themeFamily).toBe("ocean");
  family = null;
  expect(parseSettings("{}").themeFamily).toBe("warm");
});
