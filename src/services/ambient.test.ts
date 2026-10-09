import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_AMBIENT } from "../lib/ambient";
import { setInAppMedia, setTabMedia, useAmbient, useTabMedia } from "../state/ambient";
import { activeTabOf, usePanesStore } from "../state/panes";
import { leaves } from "../state/paneTree";
import {
  applyAmbient,
  chooseAmbient,
  openMediaTab,
  pollTabMedia,
  stepAmbient,
  stopAllSound,
  stopAmbient,
  tabMediaAction,
  toggleAmbient,
} from "./ambient";

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

  test("a tab's button shows its result at once, before the page answers", () => {
    setTabMedia("t1", "playing");
    tabMediaAction("t1", "pause");
    expect(useTabMedia.getState().media.t1).toBe("paused");
    tabMediaAction("t1", "play");
    expect(useTabMedia.getState().media.t1).toBe("playing");
  });

  test("the menu picks a track or Claude FM, and starts it", () => {
    chooseAmbient("claude-fm");
    expect(useAmbient.getState().prefs).toMatchObject({ track: "claude-fm", playing: true });
    chooseAmbient("dusk");
    expect(useAmbient.getState().prefs.track).toBe("dusk");
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

describe("sound that can't hide", () => {
  test("Stop all sound stops ambient and pauses every open tab at once", () => {
    useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT, enabled: true, playing: true } });
    usePanesStore.getState().openBrowser("https://example.com/music");
    const tab = leaves(usePanesStore.getState().root)
      .flatMap((leaf) => leaf.tabs)
      .find((t) => t.surfaceKind === "browser")!;
    setTabMedia(tab.id, "playing");
    stopAllSound();
    expect(useAmbient.getState().prefs.playing).toBe(false);
    expect(useTabMedia.getState().media[tab.id]).toBe("paused");
  });
});

// The owner, 2026-10-01: "play and pause isn't being respected … if I pause
// with airpods it should pause". The Mac pauses or plays the ambient element
// itself (AirPods, a media key); that becomes the person's choice, while
// Rotli's own pauses (a tab taking over) never touch it.
describe("a pause or play from outside Rotli", () => {
  class FakeAudio {
    paused = true;
    volume = 0;
    loop = false;
    preload = "";
    src = "";
    currentTime = 0;
    onpause: (() => void) | null = null;
    onplay: (() => void) | null = null;
    load() {}
    play() {
      this.paused = false;
      this.onplay?.();
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.onpause?.();
    }
  }
  const shared = globalThis as { Audio?: unknown; __rotliAmbientAudio?: FakeAudio };
  const element = () => shared.__rotliAmbientAudio!;

  test("AirPods pausing the track pauses ambient; playing it again plays", async () => {
    shared.Audio = FakeAudio;
    useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT, enabled: true, playing: true } });
    applyAmbient();
    expect(element().paused).toBe(false);
    // the Mac pauses the element, not Rotli
    element().pause();
    expect(useAmbient.getState().prefs.playing).toBe(false);
    void element().play();
    expect(useAmbient.getState().prefs.playing).toBe(true);
  });

  test("Rotli's own pause (something else playing) leaves the choice alone", async () => {
    shared.Audio = FakeAudio;
    useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT, enabled: true, playing: true } });
    applyAmbient();
    expect(element().paused).toBe(false);
    setInAppMedia(true);
    applyAmbient();
    await new Promise((resolve) => setTimeout(resolve, 600)); // the fade-out, then the pause
    expect(element().paused).toBe(true);
    expect(useAmbient.getState().prefs.playing).toBe(true);
    setInAppMedia(false);
  });
});
