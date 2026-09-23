// Discovery orchestration: one ask per lane at a time, a refresh window, the
// built-in catalog standing in when a client (or an older Rotli Helper) can't
// list, and a failed refresh that never throws away the last answer.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as tauri from "../lib/tauri";
import { useConnectedModels } from "../state/connectedModels";

const live = { ...tauri };
let answer: () => Promise<unknown> = () => Promise.resolve([]);
let calls: { provider: string; refresh: boolean }[] = [];
void mock.module("../lib/tauri", () => ({
  ...live,
  cliModels: (provider: string, refresh = false) => {
    calls.push({ provider, refresh });
    return answer();
  },
}));
afterAll(() => {
  void mock.module("../lib/tauri", () => live);
});

const { DISCOVERY_FRESH_MS, discoverConnectedModels, discoverySettled, readyFrom, refreshShownLanes } =
  await import("./connectedModels");

const sonnet = {
  id: "sonnet",
  label: "Claude Sonnet 5",
  efforts: [],
  fastTier: false,
  vision: true,
  isDefault: true,
};

beforeEach(() => {
  useConnectedModels.setState({ lanes: {} });
  calls = [];
  answer = () => Promise.resolve([sonnet]);
});

describe("discoverConnectedModels", () => {
  test("a lane answers once, and concurrent askers share the one call", async () => {
    await Promise.all([discoverConnectedModels("claude"), discoverConnectedModels("claude")]);
    expect(calls).toEqual([{ provider: "claude", refresh: false }]);
    expect(useConnectedModels.getState().lanes.claude).toMatchObject({ status: "ready", models: [sonnet] });
    // inside the refresh window: no second ask; a forced refresh asks again
    await discoverConnectedModels("claude");
    expect(calls).toHaveLength(1);
    await discoverConnectedModels("claude", { refresh: true });
    expect(calls.at(-1)).toEqual({ provider: "claude", refresh: true });
    // past the window, an ordinary ask re-reads
    await discoverConnectedModels("claude", { now: Date.now() + DISCOVERY_FRESH_MS + 1 });
    expect(calls).toHaveLength(3);
  });

  test("an older helper's unknown command leaves the built-in catalog in charge", async () => {
    answer = () => Promise.reject(new Error("unknown command"));
    await discoverConnectedModels("codex");
    expect(useConnectedModels.getState().lanes.codex).toMatchObject({ status: "error", models: [] });
  });

  test("a failed refresh keeps the last answer", async () => {
    await discoverConnectedModels("claude");
    answer = () => Promise.reject(new Error("offline"));
    await discoverConnectedModels("claude", { refresh: true });
    expect(useConnectedModels.getState().lanes.claude).toMatchObject({ status: "ready", models: [sonnet] });
  });

  test("an opened list asks only the connected lanes it shows", async () => {
    refreshShownLanes(["claude", "claude", "mlx", "preset"]);
    await discoverConnectedModels("claude");
    expect(calls.map((c) => c.provider)).toEqual(["claude"]);
  });
});

describe("discoverySettled", () => {
  test("waits for every enabled and ready lane, and only those", () => {
    const enabled = { claude: true, codex: true, cursor: false };
    const ready = readyFrom({ claude: { installed: true, authenticated: true, version: null } });
    expect(ready).toEqual({ claude: true, codex: false, cursor: false, antigravity: false });
    expect(discoverySettled({}, enabled, ready)).toBe(false);
    expect(discoverySettled({ claude: { status: "loading", models: [], at: 0 } }, enabled, ready)).toBe(
      false,
    );
    expect(discoverySettled({ claude: { status: "error", models: [], at: 0 } }, enabled, ready)).toBe(true);
    expect(discoverySettled({}, { claude: false }, ready)).toBe(true);
  });
});
