// Turn a connected model's raw error into something a person can act on. The
// one case that needs it today is a provider safeguard block: Claude Code
// prints a long API error with a category tag like [reasoning_extraction].
// Rotli never retries a block itself — support.claude.com/en/articles/16049681
// says blocked requests are billed and re-trigger on the same content.

const SAFEGUARD = /safeguards flagged this message/i;
const CATEGORY = /\[([a-z][a-z_]*)\]/;
const BLOCKED = "Claude's safety filter blocked this reply";

export function modelErrorText(message: string): string {
  if (!SAFEGUARD.test(message)) return message;
  const category = CATEGORY.exec(message)?.[1];
  return `${BLOCKED}${category ? ` (${category})` : ""}. It sometimes flags ordinary requests. Edit your message and send it again, or switch model. Rotli doesn't retry on its own, because a blocked request still counts toward your plan.`;
}

/** Is this error (raw, or already worded by modelErrorText) a provider safety
 * block? Callers never retry one on their own. */
export function isSafeguardBlock(message: string): boolean {
  return SAFEGUARD.test(message) || message.includes(BLOCKED);
}
