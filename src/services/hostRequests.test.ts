import { afterEach, expect, spyOn, test } from "bun:test";

import type { AppHost } from "../host/registry";
import type { HeldForPage } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import {
  type PageTransport,
  attachPageRequests,
  deliverHeld,
  openSettingsFromHost,
  openSettingsOn,
  settingsPaneOpens,
} from "./hostRequests";

// A synthetic host: one pane always on, one behind a capability that's off.
const glyph = () => null;
const Pane = () => null;
const host = (notes = true): AppHost => ({
  notes,
  settingsPanes: [
    { id: "synthetic", label: "Synthetic", glyph, Pane },
    { id: "gated", label: "Gated", glyph, Pane, visible: () => false },
  ],
});

afterEach(() => useUiStore.setState({ settingsOpen: false, settingsPaneRequest: null }));

test("a request opens a pane the nav shows, Rotli's or the host's, and nothing else", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(settingsPaneOpens("appearance", host(), "desktop", false)).toBe(true);
    expect(settingsPaneOpens("synthetic", host(), "desktop", false)).toBe(true);
    expect(settingsPaneOpens("about", null, "desktop", false)).toBe(true);
    expect(settingsPaneOpens("gated", host(), "desktop", false)).toBe(false);
    // a notes pane in a host without notes, and a desktop pane on the web
    expect(settingsPaneOpens("brain", host(false), "desktop", false)).toBe(false);
    expect(settingsPaneOpens("hotkeys", null, "web", false)).toBe(false);
    expect(settingsPaneOpens("nowhere", host(), "desktop", false)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    // under the dev server an id no pane has warns, and still opens nothing
    expect(settingsPaneOpens("nowhere", host(), "desktop", true)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"nowhere"');
    // a hidden pane is a known one: no warning
    expect(settingsPaneOpens("gated", host(), "desktop", true)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

test("an opening request lands on the pane through the app's own route, then shows the window", async () => {
  const log: string[] = [];
  const steps = {
    opens: (id: string) => id !== "gated" && id !== "nowhere",
    open: (id: string) => log.push(`open ${id}`),
    show: async () => void log.push("show"),
  };
  expect(openSettingsFromHost("synthetic", steps)).toBe(true);
  expect(log).toEqual(["open synthetic", "show"]);
  // a hidden or unknown pane: no Settings, no window
  expect(openSettingsFromHost("gated", steps)).toBe(false);
  expect(openSettingsFromHost("nowhere", steps)).toBe(false);
  expect(log).toEqual(["open synthetic", "show"]);
});

test("the app's own route: the store's pane request, with Settings open", () => {
  openSettingsOn("appearance");
  expect(useUiStore.getState().settingsPaneRequest).toBe("appearance");
  expect(useUiStore.getState().settingsOpen).toBe(true);
});

test("what was held is delivered in the order it came", () => {
  const log: string[] = [];
  deliverHeld(
    { notices: ["first refusal", "second refusal"], settings: ["general", "synthetic"] },
    { notice: (m) => log.push(`notice ${m}`), settings: (id) => log.push(`settings ${id}`) },
  );
  expect(log).toEqual([
    "notice first refusal",
    "notice second refusal",
    "settings general",
    "settings synthetic",
  ]);
});

/** A transport whose listeners register when the test says so. */
function fakeTransport(held: HeldForPage, answer: (reply: () => void) => void = (reply) => reply()) {
  const log: string[] = [];
  const handlers = new Map<string, (event: { payload: string }) => void>();
  const pending: (() => void)[] = [];
  let readies = 0;
  const transport: PageTransport = {
    listenHere: (event, handler) =>
      new Promise((resolve) => {
        pending.push(() => {
          handlers.set(event, handler);
          log.push(`listen ${event}`);
          resolve(() => {
            handlers.delete(event);
            log.push(`unlisten ${event}`);
          });
        });
      }),
    ready: () => {
      readies += 1;
      log.push("ready");
      const reply = readies === 1 ? held : { notices: [], settings: [] };
      return new Promise((resolve) => answer(() => resolve(reply)));
    },
  };
  const settle = async () => {
    for (const register of pending.splice(0)) register();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const send = (event: string, payload: string) => handlers.get(event)?.({ payload });
  return { log, transport, settle, send, readies: () => readies };
}

test("the page listens before it takes what was held, then hears each later one", async () => {
  const fake = fakeTransport({ notices: ["cold refusal"], settings: ["synthetic"] });
  const got: string[] = [];
  const stop = attachPageRequests(
    { notice: (m) => got.push(`notice ${m}`), settings: (id) => got.push(`settings ${id}`) },
    fake.transport,
  );
  // nothing is taken while the listeners are still being registered
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(fake.readies()).toBe(0);
  await fake.settle();
  expect(fake.log).toEqual(["listen rotli:open-notice", "listen rotli:open-settings", "ready"]);
  expect(got).toEqual(["notice cold refusal", "settings synthetic"]);
  fake.send("rotli:open-notice", "warm refusal");
  fake.send("rotli:open-settings", "appearance");
  expect(got).toEqual([
    "notice cold refusal",
    "settings synthetic",
    "notice warm refusal",
    "settings appearance",
  ]);
  stop();
  await fake.settle();
  expect(fake.log.slice(-2)).toEqual(["unlisten rotli:open-notice", "unlisten rotli:open-settings"]);
});

test("a mount torn down before it listens leaves the held items for the next one", async () => {
  // React's development double mount: the first attach stops at once
  const fake = fakeTransport({ notices: ["cold refusal"], settings: [] });
  const got: string[] = [];
  const handlers = { notice: (m: string) => got.push(m), settings: () => {} };
  attachPageRequests(handlers, fake.transport)();
  attachPageRequests(handlers, fake.transport);
  await fake.settle();
  expect(fake.readies()).toBe(1);
  expect(got).toEqual(["cold refusal"]);
});

test("a mount torn down while Rust answers still delivers what it took", async () => {
  let reply = () => {};
  const fake = fakeTransport({ notices: ["cold refusal"], settings: [] }, (send) => (reply = send));
  const got: string[] = [];
  const stop = attachPageRequests({ notice: (m) => got.push(m), settings: () => {} }, fake.transport);
  await fake.settle();
  expect(fake.readies()).toBe(1);
  stop();
  reply();
  await fake.settle();
  // Rust released it on that call, so dropping it here would lose it for good
  expect(got).toEqual(["cold refusal"]);
});
