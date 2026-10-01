// The hidden stream page (Claude FM, a station) and the person's own pause,
// end to end through the service with a stand-in page (2026-10-01 review of
// #146: the stream half had only pure tests).

import { beforeEach, expect, test } from "bun:test";

import { CLAUDE_FM, DEFAULT_AMBIENT, STREAM_HOLD_MS } from "../lib/ambient";
import type { TabMediaState } from "../lib/tauri";
import { setInAppMedia, useAmbient, useTabMedia } from "../state/ambient";
import { applyAmbient, fmPage, pollTabMedia, stopAllSound } from "./ambient";

let page: TabMediaState = "none";
const asked: string[] = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const playing = () => useAmbient.getState().prefs.playing;
const setPlaying = (value: boolean) => useAmbient.getState().setPrefs({ playing: value });

beforeEach(() => {
  fmPage.create = () => Promise.resolve();
  fmPage.close = () => Promise.resolve();
  fmPage.media = (action) => {
    asked.push(action);
    return Promise.resolve();
  };
  fmPage.state = () => Promise.resolve(page);
  useTabMedia.setState({ media: {}, recent: null, inApp: false });
  stopAllSound(); // a fresh page for each test
  page = "none";
  asked.length = 0;
  useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT, enabled: true, track: CLAUDE_FM.id, playing: true } });
});

test("AirPods pause the stream: it sticks, and a store change meanwhile doesn't undo it", async () => {
  applyAmbient();
  expect(asked).toEqual(["play"]);
  page = "playing";
  await pollTabMedia();
  page = "paused"; // the Mac paused the page, not Rotli
  await pollTabMedia();
  asked.length = 0;
  applyAmbient(); // any store change re-applies the rules
  expect(asked).not.toContain("play");
  await wait(STREAM_HOLD_MS + 100);
  await pollTabMedia();
  expect(playing()).toBe(false);
});

test("Pause, then Play a while later: it plays (no flip back to Pause)", async () => {
  applyAmbient();
  page = "playing";
  await pollTabMedia();
  setPlaying(false);
  applyAmbient();
  expect(asked.at(-1)).toBe("pause");
  page = "paused";
  await pollTabMedia();
  setPlaying(true);
  applyAmbient();
  expect(asked.at(-1)).toBe("play");
  // the page takes a moment to resume: that's latency, not a pause
  await pollTabMedia();
  await wait(STREAM_HOLD_MS + 100);
  await pollTabMedia();
  expect(playing()).toBe(true);
});

test("Rotli's own audio takes over, then hands ambient back", async () => {
  applyAmbient();
  page = "playing";
  await pollTabMedia();
  setInAppMedia(true);
  applyAmbient();
  expect(asked.at(-1)).toBe("pause");
  page = "paused";
  await pollTabMedia();
  await wait(STREAM_HOLD_MS + 100);
  await pollTabMedia();
  expect(playing()).toBe(true); // Rotli's pause, not the person's
  setInAppMedia(false);
  applyAmbient();
  expect(asked.at(-1)).toBe("play");
});
