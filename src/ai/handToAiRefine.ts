// Hand to AI, Refined (2026-10-02): the Librarian's model turns the Basic
// handoff (lib/handToAi.ts) into a real prompt — task, context, constraints,
// attachments, acceptance criteria. The instructions are a versioned asset
// (prompts/handToAiRefine.md); this file renders the exact request, checks the
// reply, and says no when the reply can't be trusted, so the caller falls back
// to Basic. Pure apart from the injected host; never chooses a model.

import { looksSecret } from "./guard";
import refinePrompt from "./prompts/handToAiRefine.md?raw";
import type { CompleteReq, Host } from "./types";

const HEADER = /^version:\s*(\d+)\s*\n/;

/** The asset's `version:` line. Bump it whenever the instructions change. */
export const HAND_TO_AI_REFINE_VERSION = Number(HEADER.exec(refinePrompt)?.[1] ?? Number.NaN);
const SYSTEM = refinePrompt.replace(HEADER, "").trim();

/** A reply can't be shorter than a task line, and a runaway reply is not a prompt. */
const MIN_CHARS = 40;
const growthCap = (basic: string) => basic.length * 4 + 4000;

/** The exact request the model receives: the asset as the system message, the
 * Basic handoff fenced as data. */
export function renderRefineRequest(basic: string): CompleteReq {
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `<<<\n${basic.trim()}\n>>>` },
    ],
  };
}

export type RefineVerdict = { ok: true; prompt: string } | { ok: false; reason: string };

/** Only a reply that keeps every attachment path, character for character,
 * becomes the prompt. A thinking block or one fence around the whole reply is
 * unwrapped; anything else is taken as written. */
export function parseRefinedReply(raw: string, basic: string, paths: readonly string[]): RefineVerdict {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = /^(```|~~~)[\w-]*\n([\s\S]*?)\n\1$/.exec(text);
  if (fenced?.[2]) text = fenced[2].trim();
  if (text.length < MIN_CHARS) return { ok: false, reason: "The model's answer was empty." };
  if (text.length > growthCap(basic)) return { ok: false, reason: "The model's answer ran too long." };
  if (paths.some((path) => !text.includes(path))) {
    return { ok: false, reason: "The model's answer dropped a file path." };
  }
  return { ok: true, prompt: `${text}\n` };
}

/** The model Refined asks: the Librarian's own choice (`preferred`, already
 * resolved from its settings), but a connected lane only while the Librarian
 * is on; otherwise, or when that lane isn't connected, this Mac's model. */
export function refineModelFor<M extends { id: string }>(
  groups: { local: readonly M[]; connected: readonly M[] },
  preferred: string | undefined,
  librarianOn: boolean,
): M | null {
  const local = groups.local.find((model) => model.id === preferred);
  const connected = librarianOn ? groups.connected.find((model) => model.id === preferred) : undefined;
  return local ?? connected ?? groups.local[0] ?? null;
}

/** One request. The secret gate runs on the exact text that would be sent,
 * whatever model is chosen (the egress ledger in Rust still backstops it). */
export async function refineHandoff(
  host: Pick<Host, "complete">,
  basic: string,
  paths: readonly string[],
): Promise<RefineVerdict> {
  const request = renderRefineRequest(basic);
  if (request.messages.some((message) => looksSecret(message.content))) {
    return { ok: false, reason: "The prompt looks like it holds a secret, so it wasn't sent." };
  }
  try {
    return parseRefinedReply(await host.complete(request), basic, paths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message ? `The model couldn't answer: ${message}` : "The model couldn't answer.",
    };
  }
}
