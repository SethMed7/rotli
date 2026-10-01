import { expect, test } from "bun:test";

import { usePinnedSites } from "./pinnedSites";

const site = { id: "pin-a", slot: 0, label: "X", url: "https://x.com/", store: "1".repeat(32) };

test("the open panel closes when its pin goes away", () => {
  usePinnedSites.setState({ sites: [site], open: "pin-a" });
  usePinnedSites.getState().setSites([site]);
  expect(usePinnedSites.getState().open).toBe("pin-a");
  usePinnedSites.getState().setSites([]);
  expect(usePinnedSites.getState().open).toBeNull();
});
