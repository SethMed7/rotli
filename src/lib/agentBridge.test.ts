import { afterEach, expect, test } from "bun:test";

import { agentBridgeReady, agentBridgeReply, onAgentRequest } from "./agentBridge";

// What @tauri-apps/api's invoke calls on the Mac app (the IPC mock's own seam),
// so the adapter's payload is checked without a webview.
const host = window as unknown as { __TAURI_INTERNALS__?: unknown };
afterEach(() => {
  delete host.__TAURI_INTERNALS__;
});

test("off the Mac app there is no bridge to listen on", () => {
  const stop = onAgentRequest(() => {
    throw new Error("never called");
  });
  expect(typeof stop).toBe("function");
  stop();
});

test("an answer goes back by its request id, a result or an error, never both", async () => {
  const calls: { cmd: string; args: unknown }[] = [];
  host.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: unknown) => {
      calls.push({ cmd, args });
    },
    transformCallback: () => 0,
  };
  await agentBridgeReply(7, { ok: true, result: { blocks: "[1] paragraph: Hi" } });
  await agentBridgeReply(8, { ok: false, error: "blocked" });
  await agentBridgeReady();
  expect(calls).toEqual([
    {
      cmd: "agent_bridge_reply",
      args: { requestId: 7, ok: true, result: { blocks: "[1] paragraph: Hi" }, error: null },
    },
    { cmd: "agent_bridge_reply", args: { requestId: 8, ok: false, result: null, error: "blocked" } },
    { cmd: "agent_bridge_ready", args: {} },
  ]);
});
