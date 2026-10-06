// Shared clean-up for a one-shot model reply before Rotli reads it: a local
// reasoning model's <think> block is never part of the answer.

/** A versioned prompt asset: its `version:` line (bump it whenever the
 * instructions change) and the instructions after it. */
export function promptAsset(raw: string): { version: number; system: string } {
  const header = /^version:\s*(\d+)\s*\n/;
  return { version: Number(header.exec(raw)?.[1] ?? Number.NaN), system: raw.replace(header, "").trim() };
}

/** Why a one-shot request failed, in the words a person reads. */
export function modelFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message ? `The model couldn't answer: ${message}` : "The model couldn't answer.";
}

/** The reply without its thinking blocks, trimmed. */
export function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
