// The prompt scaffold — the "client" that makes a small local model succeed over
// the memex. It frames the memex AS the model's knowledge base, lists the tools in
// a single-JSON-object protocol the model can actually follow, renders the running
// scratchpad, and (the Gemma default) asks for JSON coercion. Two adapters:
// `gemmaAdapter` (the local default, JSON coercion + heavy hand-holding) and
// `frontierAdapter` (the connected lanes — same protocol, terser framing, no
// server-side coercion). `adapterFor` picks by the model's budget family.

import { type ModelMeta, contextWindowFor } from "./budget";
import type { ChatTurn, ScratchStep } from "./types";

export interface PromptCtx {
  web: boolean;
  knowledge: string;
  history: ChatTurn[];
  userText: string;
  scratch: ScratchStep[];
  maxSteps: number;
  /** Offer the generate_image tool (a connected engine is configured). */
  imageTool?: boolean;
  /** The user's name (Settings → General / onboarding) — omit when unset. */
  userName?: string;
}

export interface Adapter {
  wantsFormatJson: boolean;
  renderPrompt(ctx: PromptCtx): string;
  renderForceFinal(ctx: Pick<PromptCtx, "history" | "userText" | "scratch" | "userName">): string;
}

/** The persona line naming the user — "" when no name is set, so the prompt
 * shape is untouched for existing users. */
function namedLine(userName?: string): string {
  return userName ? `\nThe user's name is ${userName} — address them by name when it feels natural.` : "";
}

function renderConversation(history: ChatTurn[], userText: string): string {
  const lines = history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`);
  lines.push(`User: ${userText}`);
  return lines.join("\n");
}

/** Keep the NEWEST turns whose total text fits `maxChars` — a long chat must
 * not overflow a small model's context window (#65, audit 2026-07). The
 * latest turn always survives (even oversized: better a truncated-context
 * reply than none), and a trim leaves a one-line marker so the model knows
 * the conversation didn't start here. */
export function trimHistory(history: ChatTurn[], maxChars: number): ChatTurn[] {
  let total = 0;
  const kept: ChatTurn[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (!turn) continue;
    total += turn.text.length;
    if (kept.length > 0 && total > maxChars) {
      kept.unshift({ role: "assistant", text: "(earlier conversation trimmed)" });
      break;
    }
    kept.unshift(turn);
  }
  return kept;
}

function renderScratch(scratch: ScratchStep[]): string {
  if (scratch.length === 0) return "(nothing yet)";
  return scratch
    .map((s, i) => `STEP ${i + 1} ACTION: ${s.action}\nSTEP ${i + 1} RESULT: ${s.result}`)
    .join("\n\n");
}

// Default adapter, tuned for Gemma: no system role (everything in one user turn),
// and JSON coercion on the MLX generate shape.
export const gemmaAdapter: Adapter = {
  wantsFormatJson: true,

  renderPrompt(ctx) {
    const webTools = ctx.web
      ? `- {"thought":"…","tool":"web_search","args":{"query":"…"}}  → search the public web (DuckDuckGo)
- {"thought":"…","tool":"web_fetch","args":{"url":"…"}}     → read a web page's text`
      : "";
    const webRule = ctx.web
      ? "Prefer the user's notes; reach for the web only when the notes don't cover it."
      : "The web is OFF for this chat — answer from the notes and what you already know.";
    const imageTool = ctx.imageTool
      ? `\n- {"thought":"…","tool":"generate_image","args":{"prompt":"…"}}  → create an image (saved into this chat's assets) — describe the IMAGE, never a file path`
      : "";

    return `You are rotli, a warm, concise assistant running entirely on the user's Mac.${namedLine(ctx.userName)}

The user's memex — their personal notes folder — is YOUR KNOWLEDGE BASE. It is organized into
areas (People, Projects, Research, …) with titles and summaries so you can find things. Treat it as
the source of truth about the user and their work, and search it before answering from memory.

TOOLS — to use one, reply with a SINGLE JSON object:
- {"thought":"…","tool":"search_memory","args":{"query":"…"}} → search the master memory across notes and prior chats
- {"thought":"…","tool":"read_memory","args":{"id":"…"}}     → read a note or original chat returned by search_memory
- {"thought":"…","tool":"search_notes","args":{"query":"…"}}  → find notes (returns id, title, folder, snippet)
- {"thought":"…","tool":"read_note","args":{"id":"…"}}        → read one note's full text by id
- {"thought":"…","tool":"read_file","args":{"query":"report.csv"}} → read a file by name (text, or a spreadsheet as CSV)
${webTools}${imageTool}
When you can answer, reply: {"thought":"…","final":"your answer to the user"}

RULES:
- Output ONE JSON object and nothing else. No text outside the JSON. No code fences.
- ${webRule}
- For anything about the user's past, decisions, people, or prior conversations, search_memory before answering.
- Never put secrets, API keys, or tokens into web_search or web_fetch.
- Use at most ${ctx.maxSteps} steps. If unsure, give your best answer and note what you couldn't verify.

YOUR KNOWLEDGE BASE (index of the user's notes):
${ctx.knowledge || "(no notes indexed yet — use search_notes to look)"}

CONVERSATION:
${renderConversation(ctx.history, ctx.userText)}

YOUR WORK SO FAR:
${renderScratch(ctx.scratch)}

Respond with the next single JSON object now.`;
  },

  renderForceFinal(ctx) {
    return `You are rotli.${namedLine(ctx.userName)} Give your FINAL answer to the user now, in plain prose — no JSON, no tools.
Base it only on the conversation and your findings below. If they're not enough, answer what you can
and say plainly what you couldn't verify.

CONVERSATION:
${renderConversation(ctx.history, ctx.userText)}

YOUR FINDINGS:
${renderScratch(ctx.scratch)}

Your answer:`;
  },
};

// The connected lanes (Claude · Codex · Antigravity · Gemini): the SAME
// single-JSON protocol (parse.ts stays untouched), but framed system-style and
// terser — a frontier model follows the instruction without coercion, and the
// CLI transports have no `format:"json"` anyway (extractJsonObject strips a
// stray fence as the safety net).
export const frontierAdapter: Adapter = {
  wantsFormatJson: false,

  renderPrompt(ctx) {
    const webTools = ctx.web
      ? `\n- {"thought":"…","tool":"web_search","args":{"query":"…"}} — search the public web
- {"thought":"…","tool":"web_fetch","args":{"url":"…"}} — read a web page's text`
      : "";
    const webRule = ctx.web
      ? "Prefer the notes; use the web only where they don't cover it."
      : "The web is OFF for this chat — answer from the notes and what you know.";
    const imageTool = ctx.imageTool
      ? `\n- {"thought":"…","tool":"generate_image","args":{"prompt":"…"}} — create an image (saved into this chat's assets); describe the IMAGE, never a file path`
      : "";

    return `You are rotli's reasoning engine. The user's memex — their personal notes folder, indexed below — is your knowledge base; search it before answering from memory.${namedLine(ctx.userName)}

Reply with EXACTLY ONE JSON object on a single line — no prose around it, no markdown fences.
Tools:
- {"thought":"…","tool":"search_memory","args":{"query":"…"}} — search the master memory across notes and prior chats
- {"thought":"…","tool":"read_memory","args":{"id":"…"}} — read the exact note or chat returned by search_memory
- {"thought":"…","tool":"search_notes","args":{"query":"…"}} — find notes (id, title, folder, snippet)
- {"thought":"…","tool":"read_note","args":{"id":"…"}} — read one note by id
- {"thought":"…","tool":"read_file","args":{"query":"report.csv"}} — read a file by name (sheets arrive as CSV)${webTools}${imageTool}
To answer the user: {"thought":"…","final":"your answer"}

Rules: ${webRule} For past decisions, people, or conversations, search_memory first. Never place secrets or tokens in tool args. You have ${ctx.maxSteps} steps — spend them only where they add facts.

KNOWLEDGE BASE INDEX:
${ctx.knowledge || "(no notes indexed yet — use search_notes)"}

CONVERSATION:
${renderConversation(ctx.history, ctx.userText)}

WORK SO FAR:
${renderScratch(ctx.scratch)}

The next single JSON object:`;
  },

  renderForceFinal(ctx) {
    return `Give your FINAL answer to the user now, in plain prose — no JSON, no tools.${namedLine(ctx.userName)} Base it on the conversation and findings below; say plainly what you couldn't verify.

CONVERSATION:
${renderConversation(ctx.history, ctx.userText)}

FINDINGS:
${renderScratch(ctx.scratch)}

Your answer:`;
  },
};

/** Pick the adapter by the model's budget family — the frontier tier (the
 * connected lanes) gets the terse system-style scaffold, everything local
 * keeps the tuned Gemma one. One signal (budget.ts), used consistently. */
export function adapterFor(model: ModelMeta): Adapter {
  return contextWindowFor(model) >= 180_000 ? frontierAdapter : gemmaAdapter;
}
