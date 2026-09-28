import { beforeEach, expect, test } from "bun:test";

import { isPrivateBrowserTabRetained } from "../lib/privateBrowser";
import { useMediaDock } from "../state/mediaDock";
import { usePanesStore } from "../state/panes";
import { leaves } from "../state/paneTree";
import { bringBackTab, closeTuckedTab, tuckTab } from "./mediaDock";

function browserTab(): string | undefined {
  return leaves(usePanesStore.getState().root)
    .flatMap((leaf) => leaf.tabs)
    .find((tab) => tab.surfaceKind === "browser")?.id;
}

beforeEach(() => {
  useMediaDock.setState({ tabId: null });
  usePanesStore.getState().openNote("n-keep", { newTab: true });
  usePanesStore.getState().openBrowser("https://example.com/video");
});

test("a tucked tab leaves its pane but keeps its page, and comes back as the same tab", () => {
  const id = browserTab()!;
  expect(tuckTab(id)).toBe(true);
  expect(browserTab()).toBeUndefined();
  expect(useMediaDock.getState().tabId).toBe(id);
  expect(isPrivateBrowserTabRetained(id)).toBe(true);

  bringBackTab();
  expect(browserTab()).toBe(id); // the same id: its surface adopts the living page
  expect(useMediaDock.getState().tabId).toBeNull();
  expect(isPrivateBrowserTabRetained(id)).toBe(true); // until the surface adopts it
});

test("one tab at a time, and closing a tucked tab lets its page go", () => {
  const id = browserTab()!;
  tuckTab(id);
  usePanesStore.getState().openBrowser("https://example.com/other");
  expect(tuckTab(browserTab()!)).toBe(false);
  closeTuckedTab();
  expect(useMediaDock.getState().tabId).toBeNull();
  expect(isPrivateBrowserTabRetained(id)).toBe(false);
});
