import { expect, test } from "bun:test";

import { appExtrasSnapshot, hydrateAppExtras, subscribeAppExtras } from "./appExtras";
import { useGraphStore } from "./graph";
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

test("the Graph's Librarian switch is remembered, on unless switched off; the scope never saves", () => {
  hydrateAppExtras("{}");
  expect(useGraphStore.getState().librarianLinks).toBe(true);
  hydrateAppExtras(JSON.stringify({ graphLibrarianLinks: false }));
  expect(useGraphStore.getState().librarianLinks).toBe(false);
  expect(appExtrasSnapshot().graphLibrarianLinks).toBe(false);

  let saves = 0;
  const stop = subscribeAppExtras(() => saves++);
  useGraphStore.getState().setScope({ kind: "around", noteId: "n", depth: 1 });
  expect(saves).toBe(0);
  useGraphStore.getState().setLibrarianLinks(true);
  expect(saves).toBe(1);
  stop();
});
