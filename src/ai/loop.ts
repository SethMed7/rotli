// The agentic client — the heart of the feature.
//
// Drives a small on-device model through a JSON tool-use loop over the user's memex
// (its knowledge base) and, when the chat's globe is on, the web. Yields status as it
// works through its tool steps, then STREAMS the final answer token-by-token (`delta`
// events) when the host supports it, closing with the authoritative `final`. Streaming
// is opt-out (RunInput.stream === false) and only ever surfaces the confirmed final
// answer — a tool step's JSON scaffolding never reaches the user. Persistence is the
// caller's job — only the final answer is written to the chat file.

import { artifactClarification } from "./artifactIntent";
import { budgetFor } from "./budget";
import { containsPrivateDataOverlap, looksSecret } from "./guard";
import { extractJsonObject, parseAction } from "./parse";
import { adapterFor, trimHistory } from "./prompt";
import { localSourceRoute } from "./sourceRouting";
import { type FinalExtractor, makeFinalExtractor } from "./stream";
import { pruneScratch, runTool, statusFor } from "./tools";
import type { AgentEvent, CompleteReq, Host, RunInput, ScratchStep, ToolName } from "./types";
import {
  normalizeWebCitations,
  renumberResearchEvidence,
  researchEvidenceRecords,
  webGroundingIssue,
} from "./webEvidence";

const NOTE_TOOLS: ToolName[] = [
  "search_memory",
  "read_memory",
  "search_notes",
  "read_note",
  "create_note",
  "update_note",
  "open_note",
  "read_file",
];
const DOCUMENT_TOOLS: ToolName[] = ["create_document"];
const ARTIFACT_TOOLS: ToolName[] = ["create_artifact"];
const NOTE_SEARCH_TOOLS: ToolName[] = ["search_memory", "search_notes"];
const WEB_PRIMITIVE_TOOLS: ToolName[] = ["web_search", "web_fetch"];
const WEB_RESEARCH_TOOLS: ToolName[] = ["research_web"];
// Kept literal because check:security statically proves every off-device
// ToolName is classified here; the strategy-specific arrays above control
// which subset a model sees.
const WEB_TOOLS: ToolName[] = ["web_search", "web_fetch", "research_web"];
const IMAGE_TOOLS: ToolName[] = ["generate_image"];
// local mermaid→Excalidraw conversion — a creation tool, never egress
const BOARD_TOOLS: ToolName[] = ["draw_board"];
// every tool whose ARGS leave the device — the secret guard covers them all
// (an image prompt ships to a remote engine exactly like a web query)
const EGRESS_TOOLS: ToolName[] = [...WEB_TOOLS, ...IMAGE_TOOLS];

/** One generation, streamed through the final-answer extractor when the host
 * supports it. Yields `delta` events for the confirmed final answer as it
 * arrives; returns the full raw reply plus the extractor (null when buffered) so
 * the caller can trust the extractor's classification. `proseIsFinal` marks the
 * force-final generation (bare Markdown expected). Falls back to a single
 * buffered `complete` when streaming is off or unavailable. */
async function* generate(
  host: Host,
  req: CompleteReq,
  useStream: boolean,
  proseIsFinal: boolean,
): AsyncGenerator<AgentEvent, { raw: string; extractor: FinalExtractor | null }, void> {
  if (!useStream || !host.stream) {
    return { raw: await host.complete(req), extractor: null };
  }
  const extractor = makeFinalExtractor(proseIsFinal);
  const stream = host.stream(req);
  let step = await stream.next();
  while (!step.done) {
    const delta = extractor.push(step.value);
    if (delta) yield { type: "delta", text: delta };
    step = await stream.next();
  }
  return { raw: step.value, extractor };
}

export async function* runAgent(host: Host, input: RunInput): AsyncGenerator<AgentEvent, void, void> {
  const clarification = artifactClarification(input.userText, {
    documentTool: input.documentTool === true && host.createDocument !== undefined,
  });
  if (clarification) {
    if (clarification.kind === "question") {
      yield { type: "question", prompt: clarification.prompt, options: clarification.options };
    } else {
      yield { type: "final", text: clarification.text };
    }
    return;
  }
  const budget = budgetFor(input.model); // the client's rules, sized to THIS model
  const adapter = adapterFor(input.model); // gemma (local default) or frontier
  const maxSteps = input.maxSteps ?? budget.maxSteps;
  // stream the final answer token-by-token when the picked host can (on-device
  // models). The hybrid layer opts out (input.stream === false) so an inner
  // leg's tokens don't surface as the turn's answer.
  const useStream = input.stream !== false;
  const enabledWebTools = adapter.webStrategy === "research" ? WEB_RESEARCH_TOOLS : WEB_PRIMITIVE_TOOLS;
  const sourceRoute =
    input.web && adapter.webStrategy === "research"
      ? localSourceRoute(input.userText, input.noteId !== undefined)
      : "ambiguous";
  const allowed: ReadonlySet<ToolName> = new Set<ToolName>([
    ...NOTE_TOOLS,
    ...(input.documentTool ? DOCUMENT_TOOLS : []),
    ...(input.artifactTool ? ARTIFACT_TOOLS : []),
    ...(input.web ? enabledWebTools : []),
    ...(input.imageTool ? IMAGE_TOOLS : []),
    ...(input.boardTool ? BOARD_TOOLS : []),
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
  if (input.noteId) {
    yield { type: "status", text: "reading the attached note…" };
    let result: string;
    try {
      // This goes through Host.readNote, which independently enforces local vs
      // remote access and secure-note permission before returning any bytes.
      result = await host.readNote(input.noteId);
    } catch (e) {
      result = `error: ${errMsg(e, "couldn't read the attached note")}`;
    }
    scratch.push({
      action: `read_note ${JSON.stringify({ id: input.noteId })}`,
      result,
    });
  }
  let consecutiveBad = 0;
  let researchAttempted = false;
  let nextWebSourceNumber = 1;
  const webEvidence = new Map<string, string>();

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
      ...(input.documentTool ? { documentTool: true } : {}),
      ...(input.artifactTool ? { artifactTool: true } : {}),
      ...(input.boardTool ? { boardTool: true } : {}),
      ...(input.userName ? { userName: input.userName } : {}),
    });

    const imgs = step === 1 ? input.images : undefined;
    const message =
      imgs && imgs.length > 0
        ? { role: "user" as const, content: prompt, images: imgs }
        : { role: "user" as const, content: prompt };

    let raw: string;
    let extractor: FinalExtractor | null;
    try {
      const gen = generate(
        host,
        { messages: [message], formatJson: adapter.wantsFormatJson },
        useStream && !researchAttempted,
        false,
      );
      const out = yield* gen;
      raw = out.raw;
      extractor = out.extractor;
    } catch (e) {
      yield { type: "final", text: `⚠ ${errMsg(e, "couldn't reach the model")}` };
      return;
    }

    // the extractor already streamed this answer's tokens — trust its
    // classification so the terminating `final` matches exactly what the user
    // watched appear (and a truncated JSON that won't re-parse still lands as
    // the answer we showed, not a wasted step).
    if (extractor && extractor.mode === "final") {
      yield { type: "final", text: extractor.finalText };
      return;
    }

    const parsed = parseAction(raw, allowed);

    if (parsed.kind === "question") {
      yield { type: "question", prompt: parsed.prompt, options: parsed.options };
      return;
    }

    if (parsed.kind === "final") {
      const finalText = normalizeWebCitations(parsed.text);
      const groundingIssue = webGroundingIssue(finalText, webEvidence);
      if (groundingIssue) {
        consecutiveBad += 1;
        scratch.push({
          action: "final answer citation check",
          ...(parsed.thought ? { thought: parsed.thought } : {}),
          result: `error: ${groundingIssue} Revise the final answer using only the supplied evidence. Do not call research_web again; the evidence is already available.`,
          remainingSteps: Math.max(0, maxSteps - step),
        });
        if (consecutiveBad >= 2) break;
        continue;
      }
      yield { type: "final", text: finalText };
      return;
    }

    if (parsed.kind !== "call") {
      consecutiveBad += 1;
      // an INVALID reply (e.g. naming a tool that's off for this chat) gets its
      // PRECISE reason back so the model fixes the right thing; only a truly
      // UNPARSEABLE reply gets the JSON-shape nudge (Seth, 2026-06-30 — audit).
      const baseResult =
        parsed.kind === "invalid"
          ? `error: ${parsed.reason}. Reply with ONE JSON object: {"tool":…,"args":…}, {"question":"…","options":["…","…"]}, or {"final":"…"}.`
          : 'error: your reply was not one valid JSON object. Reply with exactly one: {"tool":…,"args":…}, {"question":"…","options":["…","…"]}, or {"final":"…"}.';
      const routeHint =
        sourceRoute === "external" && !researchAttempted
          ? ' This is a public/external fact question: call research_web next, not a note tool. Keep JSON strings valid; omit quotation marks inside "thought" rather than leaving them unescaped.'
          : "";
      const result = `${baseResult}${routeHint}`;
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

    // A weak local model can ignore prompt-level provenance routing and treat
    // a bare public entity as one of the user's projects. Do not execute that
    // mistaken note search: return a local correction and let the model choose
    // research_web itself. This never auto-egresses; personal and ambiguous
    // questions remain fully model-routed.
    if (sourceRoute === "external" && !researchAttempted && NOTE_SEARCH_TOOLS.includes(parsed.tool)) {
      scratch.push({
        action: sig,
        ...(parsed.thought ? { thought: parsed.thought } : {}),
        result:
          "routing correction: this asks for public/external facts, so note search was not run. Call research_web next and answer only from its evidence.",
        remainingSteps: Math.max(0, maxSteps - step),
      });
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
    if (
      EGRESS_TOOLS.includes(parsed.tool) &&
      containsPrivateDataOverlap(JSON.stringify(parsed.args), privateScratch(knowledge, scratch))
    ) {
      consecutiveBad += 1;
      scratch.push({
        action: sig,
        result:
          "blocked: that off-device action repeats private text retrieved from your vault. Rephrase without private prose or perform the network action yourself.",
      });
      if (consecutiveBad >= 2) break;
      continue;
    }
    consecutiveBad = 0; // a genuinely NEW, allowed call — the model is working

    yield { type: "tool", tool: parsed.tool, args: parsed.args };
    yield { type: "status", text: statusFor(parsed.tool, parsed.args) };

    let result: string;
    try {
      result = await runTool(host, parsed.tool, parsed.args, budget);
    } catch (e) {
      result = `error: ${errMsg(e, "tool failed")}`;
    }
    if (parsed.tool === "research_web") {
      researchAttempted = true;
      const numbered = renumberResearchEvidence(result, nextWebSourceNumber);
      result = numbered.observation;
      nextWebSourceNumber = numbered.nextNumber;
      for (const source of researchEvidenceRecords(result)) webEvidence.set(source.sourceId, source.text);
    }
    scratch.push({
      action: sig,
      ...(parsed.thought ? { thought: parsed.thought } : {}),
      result,
      remainingSteps: Math.max(0, maxSteps - step),
    });
  }

  // step budget spent (or two strikes) → force a final answer from what we have.
  yield { type: "status", text: "wrapping up…" };
  const forced = yield* forceFinal(
    host,
    input,
    pruneScratch(scratch, budget.maxScratchChars),
    useStream && !researchAttempted,
    webEvidence,
  );
  yield { type: "final", text: forced };
}

/** The force-final generation, streamed. The prompt asks for bare Markdown, so
 * prose streams verbatim; a model that still wraps it in `{"final":…}` is
 * extracted the same way. Yields `delta` events; returns the answer text. */
async function* forceFinal(
  host: Host,
  input: RunInput,
  scratch: ScratchStep[],
  useStream: boolean,
  webEvidence: ReadonlyMap<string, string>,
): AsyncGenerator<AgentEvent, string, void> {
  const prompt = adapterFor(input.model).renderForceFinal({
    history: input.history,
    userText: input.userText,
    scratch,
    ...(input.userName ? { userName: input.userName } : {}),
  });
  try {
    const out = yield* generate(host, { messages: [{ role: "user", content: prompt }] }, useStream, true);
    if (out.extractor && out.extractor.mode === "final") {
      return groundForcedFinal(out.extractor.finalText, webEvidence);
    }
    const raw = out.raw;
    const obj = extractJsonObject(raw);
    if (obj !== null) {
      try {
        const d = JSON.parse(obj) as { final?: unknown };
        if (typeof d.final === "string") return groundForcedFinal(d.final, webEvidence);
      } catch {
        // fall through to raw prose
      }
    }
    return groundForcedFinal(raw, webEvidence);
  } catch (e) {
    return `⚠ ${errMsg(e, "couldn't reach the model")}`;
  }
}

function groundForcedFinal(answer: string, webEvidence: ReadonlyMap<string, string>): string {
  const text = normalizeWebCitations(answer.trim());
  if (!text) return "I couldn't find enough to answer that confidently.";
  return webGroundingIssue(text, webEvidence)
    ? "I couldn't verify a fully grounded answer from the available web evidence."
    : text;
}

/** The set of locally-retrieved PRIVATE text the overlap guard protects: the
 * knowledge map plus every scratch RESULT that came from the memex — but NOT the
 * results of prior WEB tools. A web_search / web_fetch result is already PUBLIC,
 * off-device content, so echoing it into a follow-up web call (the natural
 * research flow: search → fetch a URL from the results) is not a privacy leak.
 * Counting it as private falsely blocked exactly that flow — the model
 * researched the web, then couldn't open the page its own search returned
 * (live eval 2026-08-03). The secret-pattern guard (looksSecret) still covers
 * every arg regardless, and note/memory reads stay private here. */
function privateScratch(knowledge: string, scratch: ScratchStep[]): string[] {
  const fromWeb = (action: string): boolean => WEB_TOOLS.some((tool) => action.startsWith(tool));
  return [knowledge, ...scratch.filter((s) => !fromWeb(s.action)).map((s) => s.result)];
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : fallback;
}
