// Ask AI (`/ai`, 2026-10-05): one request to the Librarian's model whose reply
// is a passage for the note at the cursor. The instructions are a versioned
// asset (prompts/inlineAi.md); this file renders the exact request and checks
// the reply. Pure apart from the injected host; it never chooses a model and
// never writes — the editor shows the reply, and only the person's Insert
// writes it, through corpus_insert_ai.

import { looksSecret } from "./guard";
import inlinePrompt from "./prompts/inlineAi.md?raw";
import { modelFailure, stripThinking } from "./replyText";
import type { CompleteReq, Host } from "./types";

const HEADER = /^version:\s*(\d+)\s*\n/;

/** The asset's `version:` line. Bump it whenever the instructions change. */
export const INLINE_AI_VERSION = Number(HEADER.exec(inlinePrompt)?.[1] ?? Number.NaN);
const SYSTEM = inlinePrompt.replace(HEADER, "").trim();

/** How much of the note around the cursor the model reads. */
export const INLINE_CONTEXT = { before: 6000, after: 1500 } as const;
/** A passage longer than this is not an insertion; it is a rewrite. */
export const MAX_INSERT_CHARS = 12_000;

export const CURSOR_MARK = "⟦here⟧";

/** The exact request: the asset as the system message, the note around the
 * cursor fenced as data, then the person's ask. */
export function renderInlineRequest(ask: string, before: string, after: string): CompleteReq {
  const note = `${before.slice(-INLINE_CONTEXT.before)}${CURSOR_MARK}${after.slice(0, INLINE_CONTEXT.after)}`;
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `<<<\n${note}\n>>>\n\n${ask.trim()}` },
    ],
  };
}

export const REPLY_EMPTY = "The model's answer was empty.";
export const REPLY_TOO_LONG = "The model's answer ran too long to insert.";

export type InlineVerdict = { ok: true; text: string } | { ok: false; reason: string };

/** The passage as it will be inserted, or why it won't be. A reply that is one
 * fenced block (a chart) stays a fenced block — that is the passage. */
export function cleanInlineReply(raw: string): InlineVerdict {
  const text = stripThinking(raw);
  if (text === "") return { ok: false, reason: "The model's answer was empty." };
  if (text.length > MAX_INSERT_CHARS)
    return { ok: false, reason: "The model's answer ran too long to insert." };
  return { ok: true, text };
}

/** One request. The secret gate runs on the exact text that would be sent,
 * whatever model is chosen (the egress ledger in Rust still backstops it). */
export async function askInline(
  host: Pick<Host, "complete">,
  ask: string,
  before: string,
  after: string,
): Promise<InlineVerdict> {
  if (ask.trim() === "") return { ok: false, reason: "Write what you want first." };
  const request = renderInlineRequest(ask, before, after);
  if (request.messages.some((message) => looksSecret(message.content))) {
    return {
      ok: false,
      reason: "The note or the request looks like it holds a secret, so nothing was sent.",
    };
  }
  try {
    return cleanInlineReply(await host.complete(request));
  } catch (error) {
    return { ok: false, reason: modelFailure(error) };
  }
}
