// Why a message didn't reach a connected model, in the chat's own words
// (src-tauri/src/remote_block.rs owns the decision; it tags each refusal
// `rotli-blocked:<kind>`). The owner, 2026-10-15: say why, keep the message,
// and let the person decide. Only text they typed may be sent anyway; text
// from a secure note never goes to a connected model (AGENTS.md).

export type RemoteBlockKind = "warming" | "pattern" | "secure";

const TAG = /rotli-blocked:(warming|pattern|secure)\b/;

/** The kind of a tagged refusal from Rust, or null for any other error. */
export function remoteBlockOf(error: string): RemoteBlockKind | null {
  const kind = TAG.exec(error)?.[1];
  return kind === "warming" || kind === "pattern" || kind === "secure" ? kind : null;
}

/** What the chat says, persisted as the "⚠" reply (blockedNoticeKind reads it
 * back from a saved transcript, so the wording is the key; change both). */
export const BLOCK_NOTICES: Record<RemoteBlockKind, string> = {
  pattern:
    "Held back: this message has text shaped like a password, key, or card number, so it wasn’t sent to the connected model. If it’s yours to share, send it anyway.",
  secure:
    "Not sent: this conversation includes text from a secure note, and secure notes never go to a connected model. Use an on-device model, or start a new chat without that text.",
  warming: "Not sent: Rotli was still checking your secure notes after starting. Try again in a moment.",
};

/** The notice a tagged refusal becomes (without the "⚠ " prefix), or the
 * error as it was. */
export function remoteBlockText(error: string): string {
  const kind = remoteBlockOf(error);
  return kind ? BLOCK_NOTICES[kind] : error;
}

/** Which notice a saved "⚠" reply is, so its actions show again on reload. */
export function blockedNoticeKind(text: string): RemoteBlockKind | null {
  const body = text.replace(/^⚠\s*/, "");
  const found = (Object.keys(BLOCK_NOTICES) as RemoteBlockKind[]).find(
    (kind) => BLOCK_NOTICES[kind] === body,
  );
  return found ?? null;
}

export const WARMING_STATUS = "getting ready — checking your secure notes…";

/** Run `attempt`; while Rust says it is still warming up, wait and try again
 * (the startup walk usually finishes within seconds) instead of refusing. */
export async function retryWhileWarming<T>(
  attempt: () => Promise<T>,
  onWait: () => void = () => undefined,
  { tries = 30, delayMs = 2000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  for (let left = tries; ; left--) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (left <= 1 || remoteBlockOf(message) !== "warming") throw error;
      onWait();
      await sleep(delayMs);
    }
  }
}
