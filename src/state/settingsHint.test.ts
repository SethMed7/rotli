import { beforeEach, expect, test } from "bun:test";

import { armSettingsHint, dismissSettingsHint, useSettingsHint } from "./settingsHint";
import { useTourStore } from "./tour";
import { useUiStore } from "./ui";

beforeEach(() => {
  useSettingsHint.setState({ armed: false, open: false });
  useTourStore.setState({ step: null });
});

test("after setup, the note shows when the tour closes, finished or skipped", () => {
  armSettingsHint();
  useTourStore.getState().setStep(0);
  useTourStore.getState().setStep(3);
  expect(useSettingsHint.getState().open).toBe(false);
  useTourStore.getState().setStep(null);
  expect(useSettingsHint.getState()).toEqual({ armed: false, open: true });
  dismissSettingsHint();
  expect(useSettingsHint.getState().open).toBe(false);
});

test("a tour taken later, from Settings or the palette, never shows it", () => {
  useTourStore.getState().setStep(0);
  useTourStore.getState().setStep(null);
  expect(useSettingsHint.getState().open).toBe(false);
  // shown once, it doesn't come back
  armSettingsHint();
  useTourStore.getState().setStep(0);
  useTourStore.getState().setStep(null);
  dismissSettingsHint();
  useTourStore.getState().setStep(0);
  useTourStore.getState().setStep(null);
  expect(useSettingsHint.getState().open).toBe(false);
});

test("opening Settings, or another tour, puts the note away", () => {
  useSettingsHint.setState({ open: true });
  useUiStore.getState().setSettingsOpen(true);
  expect(useSettingsHint.getState().open).toBe(false);
  useUiStore.getState().setSettingsOpen(false);
  useSettingsHint.setState({ open: true });
  useTourStore.getState().setStep(0);
  expect(useSettingsHint.getState().open).toBe(false);
});
