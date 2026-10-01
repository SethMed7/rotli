// The agent bridge's webview adapter (src-tauri/src/agent_bridge.rs): an
// agent's Word document request reaches the main window, already admitted by
// Rust (the open vault, the write rules, the document itself), and the
// window's answer goes back the same way. Off the Mac app there is no bridge.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { isTauri } from "./tauri";

export interface AgentRequest {
  requestId: number;
  tool: string;
  args: Record<string, unknown>;
  agent: string;
}

export type AgentAnswer = { ok: true; result: unknown } | { ok: false; error: string };

/** Listen for agent requests; `onListening` runs once the listener is live. */
export function onAgentRequest(cb: (request: AgentRequest) => void, onListening?: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<AgentRequest>("rotli:agent-request", (event) => cb(event.payload));
  void unlisten.then(() => onListening?.());
  return () => void unlisten.then((fn) => fn());
}

/** Tell Rust the main window now answers agents (until then it refuses at once). */
export const agentBridgeReady = (): Promise<void> => invoke<void>("agent_bridge_ready");

export function agentBridgeReply(requestId: number, answer: AgentAnswer): Promise<void> {
  return invoke<void>("agent_bridge_reply", {
    requestId,
    ok: answer.ok,
    result: answer.ok ? answer.result : null,
    error: answer.ok ? null : answer.error,
  });
}
