// Shared clean-up for a one-shot model reply before Rotli reads it: a local
// reasoning model's <think> block is never part of the answer.

/** Why a one-shot request failed, in the words a person reads. */
export function modelFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message ? `The model couldn't answer: ${message}` : "The model couldn't answer.";
}

/** The reply without its thinking blocks, trimmed. */
export function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
