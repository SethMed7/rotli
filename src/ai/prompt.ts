// The prompt scaffold — the "client" that makes a small local model succeed over
// the memex. It frames the memex AS the model's knowledge base, lists the tools in
// a single-JSON-object protocol the model can actually follow, renders the running
// scratchpad, and (the Gemma default) asks for JSON coercion. Per-model adapters can
// branch off `Adapter` later (e.g. a model with native tool-calls).

import type { ChatTurn, ScratchStep } from "./types";

export interface PromptCtx {
  web: boolean;
  knowledge: string;
  history: ChatTurn[];
  userText: string;
  scratch: ScratchStep[];
  maxSteps: number;
}

export interface Adapter {
  wantsFormatJson: boolean;
  renderPrompt(ctx: PromptCtx): string;
  renderForceFinal(ctx: Pick<PromptCtx, "history" | "userText" | "scratch">): string;
}

function renderConversation(history: ChatTurn[], userText: string): string {
  const lines = history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`);
  lines.push(`User: ${userText}`);
  return lines.join("\n");
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

    return `You are rotli, a warm, concise assistant running entirely on the user's Mac.

The user's memex — their personal notes folder — is YOUR KNOWLEDGE BASE. It is organized into
areas (People, Projects, Research, …) with titles and summaries so you can find things. Treat it as
the source of truth about the user and their work, and search it before answering from memory.

TOOLS — to use one, reply with a SINGLE JSON object:
- {"thought":"…","tool":"search_notes","args":{"query":"…"}}  → find notes (returns id, title, folder, snippet)
- {"thought":"…","tool":"read_note","args":{"id":"…"}}        → read one note's full text by id
${webTools}
When you can answer, reply: {"thought":"…","final":"your answer to the user"}

RULES:
- Output ONE JSON object and nothing else. No text outside the JSON. No code fences.
- ${webRule}
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
    return `You are rotli. Give your FINAL answer to the user now, in plain prose — no JSON, no tools.
Base it only on the conversation and your findings below. If they're not enough, answer what you can
and say plainly what you couldn't verify.

CONVERSATION:
${renderConversation(ctx.history, ctx.userText)}

YOUR FINDINGS:
${renderScratch(ctx.scratch)}

Your answer:`;
  },
};
