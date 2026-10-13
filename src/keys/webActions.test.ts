import { afterAll, expect, mock, test } from "bun:test";
const live = { ...(await import("../lib/featurePolicy")) };
await mock.module("../lib/featurePolicy", () => ({
  ...live,
  PLATFORM: "web",
  LAUNCH_FEATURES: live.launchFeatures(false, "web"),
}));
const { registerDefaultActions } = await import("./actions");
const { allActions, currentChord } = await import("./registry");
afterAll(async () => {
  await mock.module("../lib/featurePolicy", () => live);
});
registerDefaultActions();
test("the full web action list omits native-only window and vault actions", () => {
  const names = allActions()
    .filter((a) => a.surface === "main")
    .map((a) => a.title);
  for (const name of ["Quick capture", "Quick note", "Open or hide Rotli", "Refresh current vault"])
    expect(names).not.toContain(name);
  expect(names).toContain("Search notes & actions");
  expect(names.filter((name) => /[⌘⌃]/.test(name))).toEqual([]);
  expect(currentChord("tabs.jump1")).toBeNull();
});
