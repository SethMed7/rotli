// The agentic client — the heart of the feature.
//
// Drives a small on-device model through a JSON tool-use loop over the user's memex
// (its knowledge base) and, when the chat's globe is on, the web. Yields status as it
// goes (no token streaming, so per-step status IS the feedback). Persistence is the
// caller's job — only the final answer is written to the chat file.

import { budgetFor } from "./budget";
import { looksSecret } from "./guard";
import { extractJsonObject, parseAction } from "./parse";
import { adapterFor, trimHistory } from "./prompt";
import { pruneScratch, runTool, statusFor } from "./tools";
import type { AgentEvent, Host, RunInput, ScratchStep, ToolName } from "./types";

const NOTE_TOOLS: ToolName[] = ["search_notes", "read_note", "read_file"];
const WEB_TOOLS: ToolName[] = ["web_search", "web_fetch"];
const IMAGE_TOOLS: ToolName[] = ["generate_image"];
// every tool whose ARGS leave the device — the secret guard covers them all
// (an image prompt ships to a remote engine exactly like a web query)
const EGRESS_TOOLS: ToolName[] = [...WEB_TOOLS, ...IMAGE_TOOLS];

export async function* runAgent(
  host: Host,
  input: RunInput,
): AsyncGenerator<AgentEvent, void, void> {
  const budget = budgetFor(input.model); // the client's rules, sized to THIS model
  const adapter = adapterFor(input.model); // gemma (local default) or frontier
  const maxSteps = input.maxSteps ?? budget.maxSteps;
  const allowed: ReadonlySet<ToolName> = new Set<ToolName>([
    ...NOTE_TOOLS,
    ...(input.web ? WEB_TOOLS : []),
    ...(input.imageTool ? IMAGE_TOOLS : []),
  ]);

  let knowledge = "";
  try {
    knowledge = await host.knowledgeMap(budget.maxIndexChars);
  } catch (e) {
    console.warn("knowledgeMap failed — the model runs without a knowledge index", e);
    knowledge = "";
  }

  // history is capped to the model's budget (#65) — newest turns win, so a
  // long-running chat degrades to "recent context" instead of a blown window
  const history = trimHistory(input.history, budget.maxHistoryChars);

  const scratch: ScratchStep[] = [];
  let consecutiveBad = 0;

  for (let step = 1; step <= maxSteps; step++) {
    yield { type: "status", text: step === 1 ? "thinking…" : `thinking… (step ${step})` };

    const prompt = adapter.renderPrompt({
      web: input.web,
      knowledge,
      history,
      userText: input.userText,
      scratch: pruneScratch(scratch, budget.maxScratchChars),
      maxSteps,
      ...(input.imageTool ? { imageTool: true } : {}),
    });

    const imgs = step === 1 ? input.images : undefined;
    const message =
      imgs && imgs.length > 0
        ? { role: "user" as const, content: prompt, images: imgs }
        : { role: "user" as const, content: prompt };

    let raw: string;
    try {
      raw = await host.complete({ messages: [message], formatJson: adapter.wantsFormatJson });
    } catch (e) {
      yield { type: "final", text: `⚠ ${errMsg(e, "couldn't reach the model")}` };
      return;
    }

    const parsed = parseAction(raw, allowed);

    if (parsed.kind === "final") {
      yield { type: "final", text: parsed.text };
      return;
    }

    if (parsed.kind !== "call") {
      consecutiveBad += 1;
      // an INVALID reply (e.g. naming a tool that's off for this chat) gets its
      // PRECISE reason back so the model fixes the right thing; only a truly
      // UNPARSEABLE reply gets the JSON-shape nudge (Seth, 2026-06-30 — audit).
      const result =
        parsed.kind === "invalid"
          ? `error: ${parsed.reason}. Reply with ONE JSON object: {"tool":…,"args":…} or {"final":"…"}.`
          : 'error: your reply was not one valid JSON object. Reply with exactly one: {"tool":…,"args":…} or {"final":"…"}.';
      scratch.push({ action: raw.slice(0, 160), result });
      if (consecutiveBad >= 2) break; // confused model → stop burning steps, force a final
      continue;
    }
    // futile-but-parseable calls STRIKE too (#93, audit 2026-07): a model
    // re-issuing the same call (or retrying a blocked one) is exactly as stuck
    // as an unparseable reply — before this, those steps never counted and the
    // loop burned its whole budget before forcing a final.
    const sig = `${parsed.tool} ${JSON.stringify(parsed.args)}`;
    if (scratch.some((s) => s.action === sig)) {
      consecutiveBad += 1;
      scratch.push({
        action: sig,
        result: "(already requested above — use that result, or give your final answer)",
      });
      if (consecutiveBad >= 2) break; // looping → force a final
      continue;
    }

    // egress guard (mirror of the Rust backstop): no secret ever rides a tool
    // whose args leave the device. Keyed off EGRESS_TOOLS so a future one
    // can't be added past the guard (audit).
    if (EGRESS_TOOLS.includes(parsed.tool) && looksSecret(JSON.stringify(parsed.args))) {
      consecutiveBad += 1;
      scratch.push({
        action: sig,
        result: "blocked: that input looks like it contains a secret — it wasn't sent off-device.",
      });
      if (consecutiveBad >= 2) break; // insisting on the blocked call → force a final
      continue;
    }
    consecutiveBad = 0; // a genuinely NEW, allowed call — the model is working

    yield { type: "tool", tool: parsed.tool, args: parsed.args };
    yield { type: "status", text: statusFor(parsed.tool) };

    let result: string;
    try {
      result = await runTool(host, parsed.tool, parsed.args, budget);
    } catch (e) {
      result = `error: ${errMsg(e, "tool failed")}`;
    }
    scratch.push({ action: sig, result });
  }

  // step budget spent (or two strikes) → force a final answer from what we have.
  yield { type: "status", text: "wrapping up…" };
  yield {
    type: "final",
    text: await forceFinal(host, input, pruneScratch(scratch, budget.maxScratchChars)),
  };
}

async function forceFinal(host: Host, input: RunInput, scratch: ScratchStep[]): Promise<string> {
  const prompt = adapterFor(input.model).renderForceFinal({
    history: input.history,
    userText: input.userText,
    scratch,
  });
  try {
    const raw = await host.complete({ messages: [{ role: "user", content: prompt }] });
    const obj = extractJsonObject(raw);
    if (obj !== null) {
      try {
        const d = JSON.parse(obj) as { final?: unknown };
        if (typeof d.final === "string") return d.final;
      } catch {
        // fall through to raw prose
      }
    }
    return raw.trim() || "I couldn't find enough to answer that confidently.";
  } catch (e) {
    return `⚠ ${errMsg(e, "couldn't reach the model")}`;
  }
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : fallback;
}
