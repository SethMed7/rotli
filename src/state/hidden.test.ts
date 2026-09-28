import { beforeEach, describe, expect, test } from "bun:test";

import { appExtrasSnapshot, hydrateAppExtras } from "./appExtras";
import { showEverything, useHidden } from "./hidden";

beforeEach(() => showEverything());

describe("what the person hid", () => {
  test("switching an item off hides it; on shows it again; Show everything clears all", () => {
    const { setShown } = useHidden.getState();
    setShown("overview", false);
    setShown("tabPlus", false);
    expect(useHidden.getState().hidden).toEqual({ overview: true, tabPlus: true });
    setShown("overview", true);
    expect(useHidden.getState().hidden).toEqual({ tabPlus: true });
    showEverything();
    expect(useHidden.getState().hidden).toEqual({});
  });

  test("kept in the app settings file beside ambient audio, and read back", () => {
    useHidden.getState().setShown("browserButton", false);
    const saved = JSON.stringify({ v: 1, ...appExtrasSnapshot() });
    showEverything();
    hydrateAppExtras(saved);
    expect(useHidden.getState().hidden).toEqual({ browserButton: true });
    hydrateAppExtras("{}");
    expect(useHidden.getState().hidden).toEqual({});
  });
});
