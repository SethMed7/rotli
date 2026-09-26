// Hand to AI (Round Three, 2026-09-26): the note's handoff prompt in an
// editable box with Copy, for pasting into Claude Code or another agent.
// Built from the note alone (services/handToAi.ts); a secure note, or one that
// looks like it holds a secret, says why nothing was built instead.

import { useEffect, useRef, useState } from "react";

import { type HandToAi, handToAiFor } from "../services/handToAi";
import { useUiStore } from "../state/ui";
import { WebDialogFrame } from "./webDialogFrame";

type View = { kind: "loading" } | { kind: "error"; message: string } | HandToAi;

const REFUSAL: Record<Exclude<HandToAi["kind"], "ready">, string> = {
  secure: "This note is secure, so Rotli won’t build a prompt from it: secure notes never go to a remote AI.",
  secret:
    "This note looks like it holds a secret, such as a key, a card number, or an ID number. Remove it, or make the note secure, before handing it off.",
  empty: "This note is empty, so there’s nothing to hand off yet.",
};

export function HandToAiDialog() {
  const noteId = useUiStore((s) => s.handToAiNoteId);
  // keyed by note: another note opens a fresh card, never a stale prompt
  return noteId ? <HandToAiCard key={noteId} noteId={noteId} /> : null;
}

function HandToAiCard({ noteId }: { noteId: string }) {
  const close = useUiStore((s) => s.setHandToAiNoteId);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let live = true;
    handToAiFor(noteId)
      .then((result) => {
        if (!live) return;
        setView(result);
        if (result.kind === "ready") setDraft(result.prompt);
        queueMicrotask(() => (result.kind === "ready" ? promptRef.current : closeRef.current)?.focus());
      })
      .catch((error) => {
        if (live) setView({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
    };
  }, [noteId]);

  const dismiss = () => close(null);
  const ready = view.kind === "ready";

  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(draft);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <WebDialogFrame
      id="hand-to-ai"
      title="Hand to AI"
      busy={view.kind === "loading"}
      className="hand-to-ai-card"
      onClose={dismiss}
      actions={
        <>
          <span className="hand-to-ai-status" role="status">
            {copy === "copied" ? "Copied. Paste it into your agent." : ""}
          </span>
          {copy === "failed" && (
            <span role="alert" className="rename-error">
              Couldn’t copy. Select the prompt and press ⌘C instead.
            </span>
          )}
          <button ref={closeRef} type="button" className="rename-btn" onClick={dismiss}>
            {ready ? "Cancel" : "Close"}
          </button>
          {ready && (
            <button
              type="button"
              className="rename-btn primary"
              disabled={!draft.trim()}
              onClick={() => void copyPrompt()}
            >
              Copy prompt
            </button>
          )}
        </>
      }
    >
      {view.kind === "loading" && <p className="hand-to-ai-note">Reading the note…</p>}
      {view.kind === "error" && (
        <p role="alert" className="rename-error">
          Couldn’t build a prompt — {view.message}
        </p>
      )}
      {(view.kind === "secure" || view.kind === "secret" || view.kind === "empty") && (
        <p className="hand-to-ai-note">{REFUSAL[view.kind]}</p>
      )}
      {view.kind === "ready" && (
        <>
          <p className="hand-to-ai-note">
            A prompt built from “{view.title}” for Claude Code or another agent. Edit it here, then copy it.
          </p>
          <textarea
            ref={promptRef}
            className="hand-to-ai-prompt"
            aria-label="Prompt"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setCopy("idle");
            }}
          />
        </>
      )}
    </WebDialogFrame>
  );
}
