// The pinned sites' lifecycle against a stand-in for the native pages
// (lib/pinnedSiteShell.ts): removing waits for the page to close and the
// store to go before the slot is free, a failure keeps the pin, an idle close
// never closes a page that was shown again, and an overlay puts the page away
// as it opens.
//
// `mock.module` is process-wide and outlives this file, so the mock spreads
// the real module and afterAll puts it back.

import { afterAll, beforeEach, expect, mock, test } from "bun:test";

import type { PinnedSite } from "../lib/pinnedSites";
import * as realShell from "../lib/pinnedSiteShell";
import { usePinnedSites } from "../state/pinnedSites";

const calls: string[] = [];
let failForget = false;
let releaseClose: (() => void) | null = null;

void mock.module("../lib/pinnedSiteShell", () => ({
  ...realShell,
  pinnedSiteOpen: async (slot: number, _url: string, store: string) => {
    calls.push(`open ${slot} ${store.slice(0, 2)}`);
  },
  pinnedSiteHide: async (slot: number) => {
    calls.push(`hide ${slot}`);
  },
  pinnedSiteClose: (slot: number) => {
    calls.push(`close ${slot}`);
    return new Promise<void>((resolve) => {
      releaseClose = () => {
        calls.push(`closed ${slot}`);
        resolve();
      };
    });
  },
  pinnedSiteForget: async (store: string) => {
    calls.push(`forget ${store.slice(0, 2)}`);
    if (failForget) throw new Error("WebKit kept the store");
  },
}));

afterAll(() => {
  void mock.module("../lib/pinnedSiteShell", () => realShell);
});

const { canAddPins, hidePin, hidePinsUnderOverlays, removePin, showPin } = await import("./pinnedSites");

const site = (slot: number, store: string): PinnedSite => ({
  id: `pin-${store.slice(0, 12)}`,
  slot,
  label: "X",
  url: "https://x.com/",
  store: store.repeat(16),
});
const bounds = { x: 0, y: 40, width: 400, height: 300 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls.length = 0;
  failForget = false;
  releaseClose = null;
  usePinnedSites.setState({ sites: [], open: null, supported: true });
});

test("removing waits for the page to close and the store to go before the slot is free", async () => {
  const old = site(0, "aa");
  usePinnedSites.setState({ sites: [old], open: old.id });
  await showPin(old, bounds);
  const removing = removePin(old.id);
  await tick();
  // the page is still closing: the pin, and its slot, are still taken
  expect(usePinnedSites.getState().sites).toHaveLength(1);
  expect(usePinnedSites.getState().open).toBeNull();
  releaseClose?.();
  await removing;
  expect(calls).toEqual(["open 0 aa", "close 0", "closed 0", "forget aa"]);
  expect(usePinnedSites.getState().sites).toEqual([]);
});

test("a failed sign-out keeps the pin so removing can be tried again", async () => {
  const pin = site(1, "bb");
  usePinnedSites.setState({ sites: [pin] });
  failForget = true;
  const removing = removePin(pin.id);
  await tick();
  releaseClose?.();
  expect(removing).rejects.toThrow("WebKit kept the store");
  await removing.catch(() => {});
  expect(usePinnedSites.getState().sites).toEqual([pin]);
});

test("an idle close never closes a page that was shown again", async () => {
  const pin = site(2, "cc");
  await showPin(pin, bounds);
  hidePin(pin, 5);
  await showPin(pin, bounds); // back before the idle close fires
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toEqual(["open 2 cc", "hide 2", "open 2 cc"]);

  // left hidden, it closes
  hidePin(pin, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls.slice(-2)).toEqual(["hide 2", "close 2"]);
  releaseClose?.();
});

test("a reopen waits for a close in flight, so it never shows a closing page", async () => {
  const pin = site(0, "dd");
  await showPin(pin, bounds);
  hidePin(pin, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls.at(-1)).toBe("close 0");
  const reopening = showPin(pin, bounds);
  await tick();
  expect(calls.at(-1)).toBe("close 0");
  releaseClose?.();
  await reopening;
  expect(calls.slice(-2)).toEqual(["closed 0", "open 0 dd"]);
});

test("an overlay opening puts the open pin away at once", async () => {
  const pin = site(0, "ee");
  usePinnedSites.setState({ sites: [pin], open: pin.id });
  await showPin(pin, bounds);
  let notify = () => {};
  let paletteOpen = false;
  const stop = hidePinsUnderOverlays([
    {
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      isOpen: () => paletteOpen,
    },
  ]);
  notify(); // an unrelated store change
  expect(usePinnedSites.getState().open).toBe(pin.id);
  paletteOpen = true;
  notify();
  expect(usePinnedSites.getState().open).toBeNull();
  expect(calls.at(-1)).toBe("hide 0");
  stop();
});

test("pins can be added only once this Mac has said it keeps a store per site", () => {
  expect(canAddPins(true)).toBe(true);
  expect(canAddPins(null)).toBe(false);
  expect(canAddPins(false)).toBe(false);
});
