import { beforeEach, expect, test } from "bun:test";

import { isPrivateBrowserTabRetained } from "../lib/privateBrowser";
import { useMediaDock } from "../state/mediaDock";
import { usePanesStore } from "../state/panes";
import { leaves } from "../state/paneTree";
import { bringBackTab, closeOrphanedTuck, closeTuckedTab, tuckTab } from "./mediaDock";

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

test("a tab tucked before a reload is closed on the next start; one the player still holds is kept", () => {
  const stored = new Map<string, string>();
  const fake = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
  const real = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { value: fake, configurable: true });
  try {
    const id = browserTab()!;
    tuckTab(id);
    expect(stored.get("rotli.tuckedTab")).toBe(id);
    closeOrphanedTuck(); // a hot reload: the player still holds it
    expect(stored.get("rotli.tuckedTab")).toBe(id);
    useMediaDock.setState({ tabId: null }); // a full reload: the player forgot it
    closeOrphanedTuck();
    expect(stored.has("rotli.tuckedTab")).toBe(false);
  } finally {
    if (real) Object.defineProperty(globalThis, "sessionStorage", real);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});
