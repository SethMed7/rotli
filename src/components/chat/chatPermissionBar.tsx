// The chat asking the person before it acts (the owner, 2026-10-15): may it
// edit a note they wrote (like a code editor asking before it writes), and
// what to do with a message held back from a connected model. Both sit under
// the thread, beside the clarification bar.

import { useCallback, useEffect, useRef, useState } from "react";

import type { EditAnswer, EditRequest } from "../../ai/editGate";
import { BLOCK_NOTICES, blockedNoticeKind, type RemoteBlockKind } from "../../ai/remoteBlock";

/** The words on the chat's ask-first buttons (tests read these, not copies). */
export const PERMISSION_LABELS = {
  once: "Allow once",
  always: "Always for this note",
  backOn: "Turn AI editing back on",
  no: "No, make a new note",
  sendAnyway: "Send anyway",
  retry: "Try again",
  edit: "Edit message",
} as const;

/** One pending "may I edit this note?" at a time; `ask` resolves when the
 * person answers, and anything still waiting answers "no" when the turn ends. */
export function useEditPermission() {
  const [pending, setPending] = useState<EditRequest | null>(null);
  const resolveRef = useRef<((answer: EditAnswer) => void) | null>(null);
  const answer = useCallback((value: EditAnswer) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setPending(null);
  }, []);
  const ask = useCallback(
    (request: EditRequest) =>
      new Promise<EditAnswer>((resolve) => {
        resolveRef.current?.("no"); // a second ask supersedes the first
        resolveRef.current = resolve;
        setPending(request);
      }),
    [],
  );
  useEffect(() => () => resolveRef.current?.("no"), []);
  return { pending, ask, answer };
}

export function ChatEditPermission({
  request,
  allowOnce,
  onAnswer,
}: {
  request: EditRequest;
  /** "Allow once" needs Rust's consented write (the Mac app). */
  allowOnce: boolean;
  onAnswer: (answer: EditAnswer) => void;
}) {
  return (
    <div className="chat-question-wrap">
      <section className="chat-question chat-permission" aria-label="Allow this edit?">
        <p>
          <strong>Edit “{request.title}”?</strong>{" "}
          {request.revoked
            ? "You turned AI editing off for this note."
            : "You wrote this note, so the chat asks before it changes it."}
        </p>
        <div>
          {allowOnce && !request.revoked && (
            <button type="button" className="primary" onClick={() => onAnswer("once")}>
              {PERMISSION_LABELS.once}
            </button>
          )}
          <button type="button" onClick={() => onAnswer("always")}>
            {request.revoked ? PERMISSION_LABELS.backOn : PERMISSION_LABELS.always}
          </button>
          <button type="button" onClick={() => onAnswer("no")}>
            {PERMISSION_LABELS.no}
          </button>
        </div>
      </section>
    </div>
  );
}

export type BlockedAction = "send-anyway" | "edit" | "retry";

/** The actions under a held-back message. Only text the person typed may be
 * sent anyway; secure-note text never goes to a connected model. */
export function ChatBlockedBar({
  kind,
  onAction,
}: {
  kind: RemoteBlockKind;
  onAction: (action: BlockedAction) => void;
}) {
  return (
    <div className="chat-question-wrap">
      <section className="chat-question chat-blocked" role="alert" aria-label="Message not sent">
        <p>{BLOCK_NOTICES[kind]}</p>
        <div>
          {kind === "pattern" && (
            <button type="button" className="danger" onClick={() => onAction("send-anyway")}>
              {PERMISSION_LABELS.sendAnyway}
            </button>
          )}
          {kind === "warming" && (
            <button type="button" className="primary" onClick={() => onAction("retry")}>
              {PERMISSION_LABELS.retry}
            </button>
          )}
          <button type="button" onClick={() => onAction("edit")}>
            {PERMISSION_LABELS.edit}
          </button>
        </div>
      </section>
    </div>
  );
}

/** A held-back message at the end of the thread: the person's turn and Rotli's
 * notice right after it. Null for anything else, a model reply included. */
export function lastBlocked(
  messages: readonly { speaker: string; text: string }[],
): { kind: RemoteBlockKind; text: string } | null {
  const notice = messages.at(-1);
  const ask = messages.at(-2);
  if (!notice || !ask || notice.speaker === "you" || ask.speaker !== "you") return null;
  const kind = blockedNoticeKind(notice.text);
  return kind ? { kind, text: ask.text } : null;
}

/** "Send anyway" consents to what the person typed, nothing else: their own
 * messages in this thread plus the one being sent (ai/remoteBlock.ts). */
export function typedConsent(
  thread: readonly { speaker: string; text: string }[],
  sending: string[],
): string[] {
  return [...thread.filter((m) => m.speaker === "you").map((m) => m.text), ...sending];
}
