import { expect, test } from "bun:test";

import { startTour, useTourStore } from "./tour";
import { useUiStore } from "./ui";

test("starting the tour closes Settings and opens step one; closing sets null", () => {
  useUiStore.setState({ settingsOpen: true });
  startTour();
  expect(useUiStore.getState().settingsOpen).toBe(false);
  expect(useTourStore.getState().step).toBe(0);
  useTourStore.getState().setStep(null);
  expect(useTourStore.getState().step).toBeNull();
});
