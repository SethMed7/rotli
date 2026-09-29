// Claude chat on Claude Code's native agent protocol — the transport T3 Code
// and the Agent SDK use (src-tauri/src/claude_session.rs), instead of the JSON
// action loop in loop.ts. The model calls Rotli's tools as real tool calls;
// each one comes back here, passes the SAME guards the JSON loop runs (allowed
// set, duplicate strike, step budget, egress secret + private-prose guard,
// secure taint), then runs through the same Host (runTool), whose native
// commands keep their own gates. Yields the loop's AgentEvent stream, so the
// chat surface treats both transports alike.

import type { NativeSession, NativeToolCall } from "../lib/claudeSession";
import { artifactClarification } from "./artifactIntent";
import { budgetFor } from "./budget";
import {
  allowedTools,
  DUPLICATE_CALL_RESULT,
  egressBlock,
  errMsg,
  loadKnowledge,
  READING_ATTACHED,
  readAttached,
  runToolSafely,
} from "./loop";
import { renderNativeSystem, renderNativeUser } from "./nativePrompt";
import { trimHistory } from "./prompt";
import { statusFor } from "./tools";
import { toolSpecsFor } from "./toolSchemas";
import type { AgentEvent, Host, RunInput, ScratchStep, ToolName } from "./types";

export interface NativeRunOpts {
  /** The picked Claude model id (the Rust allowlist re-checks it). */
  modelId: string;
  reasoningEffort?: string;
  /** Live secure-note taint (a secure read mid-run), as the Host sees it. */
  isSecureContext?: () => boolean;
}

const TAINTED =
  "error: this chat now carries secure-note content, so nothing more is sent to the remote model. Answer from what you already have.";

export async function* runNativeAgent(
  host: Host,
  session: NativeSession,
  input: RunInput,
  opts: NativeRunOpts,
): AsyncGenerator<AgentEvent, void, void> {
  const clarification = artifactClarification(input.userText, {
    documentTool: input.documentTool === true && host.createDocument !== undefined,
  });
  if (clarification) {
    yield clarification.kind === "question"
      ? { type: "question", prompt: clarification.prompt, options: clarification.options }
      : { type: "final", text: clarification.text };
    return;
  }
  if (opts.isSecureContext?.() === true) {
    yield {
      type: "final",
      text: "⚠ This chat carries secure-note content and cannot be sent to a remote model.",
    };
    return;
  }
  const budget = budgetFor(input.model);
  const maxSteps = input.maxSteps ?? budget.maxSteps;
  const allowed = allowedTools(input, "primitives");
  const knowledge = await loadKnowledge(host, budget.maxIndexChars);
  // what the model has seen from the vault: the private-prose guard reads it
  const scratch: ScratchStep[] = [];
  let attached: { id: string; text: string } | undefined;
  if (input.noteId) {
    yield { type: "status", text: READING_ATTACHED };
    const step = await readAttached(host, input.noteId);
    attached = { id: input.noteId, text: step.result };
    scratch.push(step);
  }

  const events: AgentEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (ev: AgentEvent) => {
    events.push(ev);
    wake?.();
  };
  let calls = 0;
  const onToolCall = async (call: NativeToolCall): Promise<string> => {
    const tool = call.name as ToolName;
    if (!allowed.has(tool)) return `error: ${call.name} isn't available in this chat.`;
    if (opts.isSecureContext?.() === true) return TAINTED;
    const sig = `${tool} ${JSON.stringify(call.args)}`;
    if (scratch.some((s) => s.action === sig)) return DUPLICATE_CALL_RESULT;
    if (calls >= maxSteps) return "error: this turn's tool budget is spent — answer now from what you have.";
    const blocked = egressBlock(tool, call.args, knowledge, scratch);
    if (blocked) {
      scratch.push({ action: sig, result: blocked });
      return blocked;
    }
    calls += 1;
    push({ type: "tool", tool, args: call.args });
    push({ type: "status", text: statusFor(tool, call.args) });
    const result = await runToolSafely(host, tool, call.args, budget);
    scratch.push({ action: sig, result });
    push({ type: "status", text: "thinking…" });
    return result;
  };

  yield { type: "status", text: "thinking…" };
  // settled from the session's callbacks — a holder, so the wait loop re-reads it
  const settled: { outcome: { text: string } | { error: string } | null } = { outcome: null };
  void session(
    {
      model: opts.modelId,
      systemPrompt: renderNativeSystem({
        web: input.web,
        knowledge,
        maxSteps,
        ...(input.documentTool ? { documentTool: true } : {}),
        ...(input.userName ? { userName: input.userName } : {}),
      }),
      userText: renderNativeUser(
        trimHistory(input.history, budget.maxHistoryChars),
        input.userText,
        attached,
      ),
      tools: toolSpecsFor(allowed),
      // one turn per tool call, one to answer, one spare for a blocked call
      maxTurns: maxSteps + 2,
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
    },
    onToolCall,
  ).then(
    (text) => {
      settled.outcome = { text };
      wake?.();
    },
    (e: unknown) => {
      settled.outcome = { error: errMsg(e, "couldn't reach the model") };
      wake?.();
    },
  );
  while (true) {
    const next = events.shift();
    if (next) {
      yield next;
      continue;
    }
    const done = settled.outcome;
    if (done) {
      yield {
        type: "final",
        text:
          "error" in done
            ? `⚠ ${done.error}`
            : done.text.trim() || "I couldn't find enough to answer that confidently.",
      };
      return;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = null;
  }
}
