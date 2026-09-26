// Hand to AI (Round Three, 2026-09-26): the note's handoff prompt in an
// editable box with Copy, for pasting into Claude Code or another agent.
// Built from the note alone (services/handToAi.ts); a secure note, or one that
// looks like it holds a secret, says why nothing was built instead.

import { useEffect, useRef, useState } from "react";

import { type HandToAi, handToAiFor } from "../services/handToAi";
import { useUiStore } from "../state/ui";

type View = { kind: "loading" } | { kind: "error"; message: string } | HandToAi;

const REFUSAL: Record<Exclude<HandToAi["kind"], "ready">, string> = {
  secure: "This note is secure, so Rotli won’t build a prompt from it: secure notes never go to a remote AI.",
  secret:
    "This note looks like it holds a secret, such as a key, a card number, or an ID number. Remove it, or make the note secure, before handing it off.",
  empty: "This note is empty, so there’s nothing to hand off yet.",
};

export function HandToAiDialog() {
  const noteId = useUiStore((s) => s.handToAiNoteId);
  const close = useUiStore((s) => s.setHandToAiNoteId);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [copy, setCopy] = useState<{ state: "idle" | "copied" | "failed"; error?: string }>({
    state: "idle",
  });
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!noteId) return;
    let live = true;
    setView({ kind: "loading" });
    setCopy({ state: "idle" });
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

  if (!noteId) return null;
  const dismiss = () => close(null);
  const ready = view.kind === "ready";

  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard) throw new Error("the clipboard is unavailable");
      await navigator.clipboard.writeText(draft);
      setCopy({ state: "copied" });
    } catch (error) {
      setCopy({ state: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="rename-overlay" onMouseDown={dismiss}>
      <div
        className="rename-card hand-to-ai-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hand-to-ai-title"
        aria-busy={view.kind === "loading"}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }}
      >
        <h2 id="hand-to-ai-title" className="rename-label">
          Hand to AI
        </h2>
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
                setCopy({ state: "idle" });
              }}
            />
          </>
        )}
        <div className="rename-actions">
          <span className="hand-to-ai-status" role="status">
            {copy.state === "copied" ? "Copied. Paste it into your agent." : ""}
          </span>
          {copy.state === "failed" && (
            <span role="alert" className="rename-error">
              Couldn’t copy — {copy.error}
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
        </div>
      </div>
    </div>
  );
}
