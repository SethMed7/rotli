import { expect, test } from "bun:test";

import { appExtrasSnapshot, hydrateAppExtras, subscribeAppExtras } from "./appExtras";
import { usePinnedSites } from "./pinnedSites";
import { useSidebarLook } from "./sidebarLook";

test("the extras survive a save and a load, and a damaged file loads the defaults", () => {
  useSidebarLook.getState().setLook({ scenery: "both", icons: "color" });
  const saved = JSON.stringify(appExtrasSnapshot());
  useSidebarLook.getState().setLook({ scenery: "off", icons: "neutral" });
  hydrateAppExtras(saved);
  expect(useSidebarLook.getState().look).toEqual({ scenery: "both", icons: "color" });
  expect(JSON.parse(JSON.stringify(appExtrasSnapshot()))).toEqual(JSON.parse(saved));

  hydrateAppExtras("{ not json");
  expect(useSidebarLook.getState().look).toEqual({ scenery: "top", icons: "neutral" });
});

test("a change saves; opening a pin's panel doesn't", () => {
  let saves = 0;
  const stop = subscribeAppExtras(() => saves++);
  useSidebarLook.getState().setLook({ icons: "color" });
  expect(saves).toBe(1);
  usePinnedSites.getState().setOpen("pin-x");
  expect(saves).toBe(1);
  stop();
});
