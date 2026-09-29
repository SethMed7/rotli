// Native adapter for Claude's agent protocol (src-tauri/src/claude_session.rs).
// One Channel carries the model's tool calls up from Rust; each answer goes back
// through `claude_session_tool_result`. Rust owns every gate — which tools may
// run, the secret scan on arguments, and the rescan of every result.

import { Channel, invoke } from "@tauri-apps/api/core";

/** One Rotli tool as Claude sees it (an MCP tool on the in-process server). */
export interface NativeToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface NativeToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface NativeSessionReq {
  model: string;
  systemPrompt: string;
  userText: string;
  tools: NativeToolSpec[];
  maxTurns: number;
  reasoningEffort?: string;
}

/** Run one turn; `onToolCall` executes a call and resolves with its result
 * text. Resolves with the final answer, rejects with the error to show. */
export type NativeSession = (
  req: NativeSessionReq,
  onToolCall: (call: NativeToolCall) => Promise<string>,
) => Promise<string>;

/** The desktop session for one chat turn. `requestId` is the id the composer's
 * stop already cancels (`cli_cancel` kills the session's process). */
export function claudeSession(requestId: string): NativeSession {
  return (req, onToolCall) => {
    const channel = new Channel<string>();
    channel.onmessage = (raw) => {
      const call = parseToolCall(raw);
      if (!call) return;
      void onToolCall(call)
        .catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`)
        .then((result) => invoke("claude_session_tool_result", { requestId, callId: call.callId, result }))
        .catch(() => undefined); // the turn already ended; nothing is waiting
    };
    return invoke<string>("claude_session_run", {
      requestId,
      model: req.model,
      systemPrompt: req.systemPrompt,
      userText: req.userText,
      tools: req.tools,
      maxTurns: req.maxTurns,
      reasoningEffort: req.reasoningEffort,
      onEvent: channel,
    });
  };
}

export function parseToolCall(raw: string): NativeToolCall | null {
  try {
    const ev = JSON.parse(raw) as { type?: unknown; callId?: unknown; name?: unknown; args?: unknown };
    if (ev.type !== "tool_call" || typeof ev.callId !== "string" || typeof ev.name !== "string") return null;
    const args = ev.args && typeof ev.args === "object" ? (ev.args as Record<string, unknown>) : {};
    return { callId: ev.callId, name: ev.name, args };
  } catch {
    return null;
  }
}
