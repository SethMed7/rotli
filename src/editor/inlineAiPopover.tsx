// Ask AI (`/ai`, 2026-10-05): a request box at the cursor, the model's answer
// shown read-only, and the person's choice — Insert or Discard. Nothing is
// written until Insert, and then only through corpus_insert_ai (the services
// controller runs every gate). The model is the Librarian's, chosen the way
// Hand to AI's Refined mode chooses it.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useRef, useState } from "react";

import { modelIsOnDevice } from "../ai/guard";
import { refineModelFor } from "../ai/handToAiRefine";
import { useTransientPopover } from "../lib/popover";
import { INLINE_AI_DEPS, askAtCursor, insertAtCursor } from "../services/inlineAi";
import { useUiStore } from "../state/ui";
import type { ImageGenState } from "./cmEditorState";
import { tauriHostFor, useLibrarianModels } from "./librarianSession";
import { adaptSlashInsertion } from "./slashMenu";

type Phase =
  | { kind: "ask"; error: string | null }
  | { kind: "asking" }
  | { kind: "answer"; text: string; error: string | null; inserting: boolean };

export function InlineAiPopover({
  state,
  noteId,
  view,
  onClose,
}: {
  state: ImageGenState;
  noteId: string;
  view: () => EditorView | null;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const request = useRef(0);
  const [ask, setAsk] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "ask", error: null });
  const librarianOn = useUiStore((s) => s.brainEnabled);
  const { groups, preferred } = useLibrarianModels();
  const model = refineModelFor(groups, preferred, librarianOn);
  const cancel = () => {
    request.current += 1; // a reply still on its way is dropped
    onClose();
  };
  // an answer on screen is something the person waited for: only Insert or
  // Discard ends it, never a stray click or Escape
  const answering = phase.kind === "answer";
  useTransientPopover([rootRef], !answering, cancel);

  const where = () => {
    const editor = view();
    if (!editor) return null;
    const docText = editor.state.doc.toString();
    return { editor, docText, at: Math.min(state.insertAt, docText.length) };
  };

  const submit = async () => {
    const target = where();
    if (!model || !target || ask.trim() === "") return;
    const id = ++request.current;
    setPhase({ kind: "asking" });
    const verdict = await askAtCursor(
      INLINE_AI_DEPS,
      tauriHostFor(model),
      model,
      noteId,
      ask,
      target.docText,
      target.at,
    );
    if (id !== request.current) return;
    setPhase(
      verdict.ok
        ? { kind: "answer", text: verdict.text, error: null, inserting: false }
        : { kind: "ask", error: verdict.reason },
    );
  };

  const insert = async () => {
    const target = where();
    if (!model || !target || phase.kind !== "answer") return;
    // the answer as it will sit in the note: indented to the list it lands in
    const text = adaptSlashInsertion(phase.text, phase.text.length, state.continuation).insert;
    setPhase({ ...phase, inserting: true, error: null });
    const done = await insertAtCursor(INLINE_AI_DEPS, model, noteId, text, target.docText, target.at);
    if (!done.ok) {
      setPhase({ ...phase, inserting: false, error: done.reason });
      return;
    }
    const after = Math.min(target.at + text.length, target.editor.state.doc.length);
    target.editor.dispatch({ selection: EditorSelection.cursor(after), scrollIntoView: true });
    target.editor.focus();
    onClose();
  };

  const lane = model ? (modelIsOnDevice(model) ? "on this Mac" : "connected") : "";

  return (
    <div
      ref={rootRef}
      className="rotli-imagegen rotli-inline-ai"
      role="dialog"
      aria-label="Ask AI"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (!answering) cancel();
      }}
    >
      {!model ? (
        <p className="rotli-inline-ai-empty">
          No model to ask yet. Set one up in Settings → Librarian, then try again.
        </p>
      ) : phase.kind === "answer" ? (
        <>
          <p className="rotli-inline-ai-label">Answer from {model.label} · read it, then choose</p>
          <pre className="rotli-inline-ai-answer" aria-label="The answer">
            {phase.text}
          </pre>
          {phase.error && (
            <p className="rotli-inline-ai-error" role="alert">
              {phase.error}
            </p>
          )}
          <div className="rotli-inline-ai-row">
            <button
              type="button"
              className="rotli-inline-ai-cancel"
              onClick={cancel}
              disabled={phase.inserting}
            >
              Discard
            </button>
            <button
              type="button"
              className="rotli-inline-ai-cancel"
              onClick={() => setPhase({ kind: "ask", error: null })}
              disabled={phase.inserting}
            >
              Try again
            </button>
            <button
              type="button"
              className="rotli-inline-ai-go"
              onClick={() => void insert()}
              disabled={phase.inserting}
              autoFocus
            >
              {phase.inserting ? "Inserting…" : "Insert"}
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            className="rotli-inline-ai-prompt"
            rows={2}
            autoFocus
            aria-label="What should AI write here?"
            placeholder="A bar chart of my hours, sources on this, a paragraph that…"
            value={ask}
            disabled={phase.kind === "asking"}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {phase.kind === "ask" && phase.error && (
            <p className="rotli-inline-ai-error" role="alert">
              {phase.error}
            </p>
          )}
          <div className="rotli-inline-ai-row">
            <span className="rotli-inline-ai-note">
              {model.label} · {lane}
            </span>
            <button type="button" className="rotli-inline-ai-cancel" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="rotli-inline-ai-go"
              onClick={() => void submit()}
              disabled={phase.kind === "asking" || ask.trim() === ""}
            >
              {phase.kind === "asking" ? "Asking…" : "Ask"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
