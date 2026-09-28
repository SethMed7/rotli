import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_AMBIENT } from "../lib/ambient";
import { setTabMedia, useAmbient, useTabMedia } from "../state/ambient";
import { activeTabOf, usePanesStore } from "../state/panes";
import { leaves } from "../state/paneTree";
import { openMediaTab, pollTabMedia, stepAmbient, stopAmbient, toggleAmbient } from "./ambient";

beforeEach(() => {
  useTabMedia.setState({ media: {}, recent: null, inApp: false });
  useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT, enabled: true } });
});

describe("the player's buttons", () => {
  test("over a playing tab, the ambient toggle makes ambient the one that plays", () => {
    setTabMedia("t1", "playing");
    toggleAmbient();
    expect(useAmbient.getState().prefs.playing).toBe(true);
  });

  test("with nothing in a tab, the toggle plays and pauses ambient; stop stops it", () => {
    toggleAmbient();
    expect(useAmbient.getState().prefs.playing).toBe(true);
    toggleAmbient();
    expect(useAmbient.getState().prefs.playing).toBe(false);
    toggleAmbient();
    stopAmbient();
    expect(useAmbient.getState().prefs.playing).toBe(false);
  });

  test("skip moves through the tracks", () => {
    stepAmbient(1);
    expect(useAmbient.getState().prefs.track).toBe("graphite");
    stepAmbient(-1);
    stepAmbient(-1);
    expect(useAmbient.getState().prefs.track).toBe("lamplight");
  });

  test("open the tab: its pane shows it", () => {
    usePanesStore.getState().openBrowser("https://example.com");
    const leaf = leaves(usePanesStore.getState().root).find((l) =>
      l.tabs.some((t) => t.surfaceKind === "browser"),
    )!;
    const browser = leaf.tabs.find((t) => t.surfaceKind === "browser")!;
    usePanesStore.getState().openNote("n-other", { newTab: true });
    expect(activeTabOf(findLeafById(leaf.id))?.id).not.toBe(browser.id);
    openMediaTab(browser.id);
    expect(activeTabOf(findLeafById(leaf.id))?.id).toBe(browser.id);
  });

  test("a tab that's gone is forgotten on the next poll (off the Mac app, every page is silent)", async () => {
    setTabMedia("gone", "playing");
    await pollTabMedia();
    expect(useTabMedia.getState()).toMatchObject({ media: {}, recent: null });
  });
});

function findLeafById(id: string) {
  return leaves(usePanesStore.getState().root).find((leaf) => leaf.id === id)!;
}
