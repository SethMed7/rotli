import { expect, test } from "bun:test";

import { appExtrasSnapshot, hydrateAppExtras, subscribeAppExtras } from "./appExtras";
import { useGraphStore } from "./graph";
import { usePinnedSites } from "./pinnedSites";
import { useSidebarLook } from "./sidebarLook";

test("the extras survive a save and a load, and a damaged file loads the defaults", () => {
  useSidebarLook.getState().setLook({ icons: "color" });
  const saved = JSON.stringify(appExtrasSnapshot());
  useSidebarLook.getState().setLook({ icons: "neutral" });
  hydrateAppExtras(saved);
  expect(useSidebarLook.getState().look).toEqual({ icons: "color" });
  expect(JSON.parse(JSON.stringify(appExtrasSnapshot()))).toEqual(JSON.parse(saved));

  hydrateAppExtras("{ not json");
  expect(useSidebarLook.getState().look).toEqual({ icons: "neutral" });
});

test("a file saved before the scenery was removed loads, and the next save drops it", () => {
  hydrateAppExtras(JSON.stringify({ sidebarLook: { scenery: "both", icons: "color" } }));
  expect(useSidebarLook.getState().look).toEqual({ icons: "color" });
  expect(appExtrasSnapshot().sidebarLook).toEqual({ icons: "color" });
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
