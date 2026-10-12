import { afterAll, expect, mock, test } from "bun:test";
const live = { ...(await import("../../lib/featurePolicy")) };
await mock.module("../../lib/featurePolicy", () => ({
  ...live,
  PLATFORM: "web",
  LAUNCH_FEATURES: live.launchFeatures(false, "web"),
}));
const { TOUR_STEPS } = await import("./guidedTourModel");
afterAll(async () => {
  await mock.module("../../lib/featurePolicy", () => live);
});
test("the web tour names no withheld app shortcut and names document creation the web now offers", () => {
  expect(TOUR_STEPS.some((step) => /[⌘⌃]/.test(step.body))).toBe(false);
  expect(TOUR_STEPS.find((step) => step.id === "new")?.body).toContain("documents and boards");
  expect(TOUR_STEPS.find((step) => step.id === "search")?.body).toContain("from here");
});
