import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_APPEARANCE_LOOK, applyAppearanceLookBroadcast, useAppearanceLook } from "./appearanceLook";
import { appExtrasSnapshot, hydrateAppExtras } from "./appExtras";
import { APP_SETTINGS_KEYS } from "./appSettingsKeys";
import { useUiStore } from "./ui";

afterEach(() => {
  useAppearanceLook.setState(DEFAULT_APPEARANCE_LOOK);
  useUiStore.setState({ theme: "light", themeFamily: "warm" });
});

describe("the theme button cycle and the image outline", () => {
  test("default: light and dark within the family, images unoutlined", () => {
    expect(DEFAULT_APPEARANCE_LOOK).toEqual({
      themeCycle: "family",
      themeCyclePicks: [],
      outlineImages: false,
    });
    expect(useAppearanceLook.getInitialState()).toMatchObject(DEFAULT_APPEARANCE_LOOK);
  });

  test("kept in the app settings file and read back", () => {
    useAppearanceLook.getState().setLook({
      themeCycle: "picks",
      themeCyclePicks: ["ocean-light", "iris-dark"],
      outlineImages: true,
    });
    const saved = JSON.stringify({ v: 1, ...appExtrasSnapshot() });
    useAppearanceLook.setState(DEFAULT_APPEARANCE_LOOK);
    hydrateAppExtras(saved);
    expect(useAppearanceLook.getState()).toMatchObject({
      themeCycle: "picks",
      themeCyclePicks: ["ocean-light", "iris-dark"],
      outlineImages: true,
    });
    for (const key of ["themeCycle", "themeCyclePicks", "outlineImages"]) {
      expect(APP_SETTINGS_KEYS.has(key)).toBe(true);
    }
  });

  test("unknown or damaged values fail to the defaults", () => {
    hydrateAppExtras(JSON.stringify({ themeCycle: "spiral", themeCyclePicks: "all", outlineImages: "yes" }));
    expect(useAppearanceLook.getState()).toMatchObject(DEFAULT_APPEARANCE_LOOK);
    hydrateAppExtras("not json");
    expect(useAppearanceLook.getState()).toMatchObject(DEFAULT_APPEARANCE_LOOK);
  });

  test("a floating window follows main's broadcast, and ignores a broken one", () => {
    applyAppearanceLookBroadcast(JSON.stringify({ outlineImages: true, themeCycle: "all" }));
    expect(useAppearanceLook.getState()).toMatchObject({ outlineImages: true, themeCycle: "all" });
    applyAppearanceLookBroadcast("{");
    expect(useAppearanceLook.getState()).toMatchObject({ outlineImages: true, themeCycle: "all" });
  });

  test("the sun's click follows the saved cycle", () => {
    const { cycleTheme } = useUiStore.getState();
    cycleTheme();
    expect(useUiStore.getState()).toMatchObject({ theme: "dark", themeFamily: "warm" });
    cycleTheme();
    expect(useUiStore.getState()).toMatchObject({ theme: "light", themeFamily: "warm" });
    useAppearanceLook.getState().setLook({ themeCycle: "all" });
    cycleTheme();
    cycleTheme();
    expect(useUiStore.getState()).toMatchObject({ theme: "light", themeFamily: "mono" });
    useAppearanceLook
      .getState()
      .setLook({ themeCycle: "picks", themeCyclePicks: ["warm-dark", "grove-light"] });
    cycleTheme();
    expect(useUiStore.getState()).toMatchObject({ theme: "light", themeFamily: "grove" });
    cycleTheme();
    expect(useUiStore.getState()).toMatchObject({ theme: "dark", themeFamily: "warm" });
  });
});
