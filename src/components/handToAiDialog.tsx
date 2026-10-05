// Hand to AI (Round Three, 2026-09-26): the note's handoff prompt in an
// editable box with Copy, for pasting into Claude Code or another agent.
// Basic is built from the note alone (services/handToAi.ts), with the files it
// links to as real paths; Refined (2026-10-02) asks the Librarian's model to
// turn that into a fuller prompt, and falls back to Basic when it can't. A
// secure note, a note linking a secure file, or one that looks like it holds a
// secret says why nothing was built instead.

import { useEffect, useRef, useState } from "react";

import { modelIsOnDevice } from "../ai/guard";
import { refineModelFor } from "../ai/handToAiRefine";
import { tauriHostFor, useLibrarianModels } from "../editor/librarianSession";
import { type HandToAi, handToAiFor, refineHandToAiFor } from "../services/handToAi";
import { type HandToAiMode, useHandToAiMode } from "../state/handToAiMode";
import { useUiStore } from "../state/ui";
import { WebDialogFrame } from "./webDialogFrame";

type View = { kind: "loading" } | { kind: "error"; message: string } | HandToAi;
type Refusal = Exclude<HandToAi["kind"], "ready">;
type Refine =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; model: string; onDevice: boolean }
  | { kind: "fallback"; reason: string };

const REFUSAL: Record<Refusal, string> = {
  secure: "This note is secure, so Rotli won’t build a prompt from it: secure notes never go to a remote AI.",
  secureAttachment:
    "This note links to a file in a secure place, or by a link Rotli can’t read safely, so Rotli won’t build a prompt from it: secure files never go to a remote AI.",
  secret:
    "This note looks like it holds a secret, such as a key, a card number, or an ID number. Remove it, or make the note secure, before handing it off.",
  empty: "This note is empty, so there’s nothing to hand off yet.",
};

const NO_MODEL = "Refined needs the Librarian’s model, and none is available here.";

const MODES: { id: HandToAiMode; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "refined", label: "Refined" },
];

export function HandToAiDialog() {
  const noteId = useUiStore((s) => s.handToAiNoteId);
  // keyed by note: another note opens a fresh card, never a stale prompt
  return noteId ? <HandToAiCard key={noteId} noteId={noteId} /> : null;
}

function HandToAiCard({ noteId }: { noteId: string }) {
  const close = useUiStore((s) => s.setHandToAiNoteId);
  const librarianOn = useUiStore((s) => s.brainEnabled);
  const { groups, preferred } = useLibrarianModels();
  const model = refineModelFor(groups, preferred, librarianOn);
  const [view, setView] = useState<View>({ kind: "loading" });
  const remember = useHandToAiMode((s) => s.setMode);
  // this card's mode starts as the one chosen last; a fallback to Basic shows
  // Basic here without changing what is remembered
  const [mode, setMode] = useState<HandToAiMode>(() => useHandToAiMode.getState().mode);
  const [drafts, setDrafts] = useState<Record<HandToAiMode, string>>({ basic: "", refined: "" });
  const [refine, setRefine] = useState<Refine>({ kind: "idle" });
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const live = useRef(true);
  // which refine is current: choosing Basic mid-refine (or closing) moves it on,
  // and an answer for an older run is dropped. The model call itself can't be
  // stopped (Host.complete takes no signal), so it is ignored, not aborted.
  const run = useRef(0);
  const asking = useRef(false);
  // the Basic text as it stands, so a fallback never overwrites the person's edits
  const basicNow = useRef("");

  useEffect(() => {
    live.current = true;
    handToAiFor(noteId)
      .then((result) => {
        if (!live.current) return;
        setView(result);
        if (result.kind === "ready") {
          basicNow.current = result.prompt;
          setDrafts({ basic: result.prompt, refined: "" });
        }
        queueMicrotask(() => (result.kind === "ready" ? promptRef.current : closeRef.current)?.focus());
      })
      .catch((error) => {
        if (live.current)
          setView({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live.current = false;
      run.current += 1;
    };
  }, [noteId]);

  const ready = view.kind === "ready";
  const wantsRefine = ready && mode === "refined" && refine.kind === "idle" && model !== null;

  // Refined runs once per card, when it is the chosen mode and a model exists;
  // choosing Basic and back reuses the answer instead of asking again
  useEffect(() => {
    if (!wantsRefine || !model || asking.current) return;
    asking.current = true;
    const token = ++run.current;
    const asked = basicNow.current;
    const current = () => live.current && run.current === token;
    setRefine({ kind: "working" });
    refineHandToAiFor(noteId, tauriHostFor(model))
      .finally(() => {
        if (run.current === token) asking.current = false;
      })
      .then((result) => {
        // a refusal from the re-read is never stale: it stands even after a cancel
        if (result.kind !== "refined" && result.kind !== "fallback") {
          if (live.current) setView(result);
          return;
        }
        if (!current()) return;
        if (result.kind === "refined") {
          setDrafts((now) => ({ ...now, refined: result.prompt }));
          setRefine({ kind: "done", model: model.label, onDevice: modelIsOnDevice(model) });
        } else if (result.kind === "fallback") {
          // the note read again, unless Basic was edited since the ask
          if (basicNow.current === asked) {
            basicNow.current = result.prompt;
            setDrafts((now) => ({ ...now, basic: result.prompt }));
          }
          setRefine({ kind: "fallback", reason: result.reason });
          setMode("basic");
        }
      })
      .catch((error) => {
        if (!current()) return;
        setRefine({ kind: "fallback", reason: error instanceof Error ? error.message : String(error) });
        setMode("basic");
      });
  }, [wantsRefine, model, noteId]);

  const dismiss = () => close(null);
  const working = mode === "refined" && refine.kind === "working";
  const showing: HandToAiMode = mode === "refined" && refine.kind === "done" ? "refined" : "basic";
  const draft = drafts[showing];

  const choose = (next: HandToAiMode) => {
    remember(next);
    setMode(next);
    setCopy("idle");
    // a failed refine may be asked again by choosing Refined again
    if (next === "refined" && refine.kind === "fallback") setRefine({ kind: "idle" });
    // choosing Basic mid-refine drops that answer; Refined again asks afresh
    if (next === "basic" && refine.kind === "working") {
      run.current += 1;
      asking.current = false;
      setRefine({ kind: "idle" });
    }
  };

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
              disabled={working || !draft.trim()}
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
      {view.kind !== "loading" && view.kind !== "error" && view.kind !== "ready" && (
        <p className="hand-to-ai-note">{REFUSAL[view.kind]}</p>
      )}
      {view.kind === "ready" && (
        <>
          <div className="hand-to-ai-head">
            <div className="hand-to-ai-mode" role="group" aria-label="Prompt style">
              {MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={mode === option.id ? "sel" : ""}
                  aria-pressed={mode === option.id}
                  disabled={option.id === "refined" && model === null}
                  title={option.id === "refined" && model === null ? NO_MODEL : undefined}
                  onClick={() => choose(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="hand-to-ai-note">{caption(view.title, mode, refine, model !== null)}</p>
          </div>
          {refine.kind === "fallback" && mode === "basic" && (
            <p className="hand-to-ai-note" role="status">
              Couldn’t refine it this time, so this is the Basic prompt. {refine.reason}
            </p>
          )}
          {working ? (
            <p className="hand-to-ai-note hand-to-ai-working" aria-live="polite">
              The Librarian is shaping the note into a prompt…
            </p>
          ) : (
            <textarea
              ref={promptRef}
              className="hand-to-ai-prompt"
              aria-label="Prompt"
              spellCheck={false}
              value={draft}
              onChange={(event) => {
                const text = event.target.value;
                if (showing === "basic") basicNow.current = text;
                setDrafts((now) => ({ ...now, [showing]: text }));
                setCopy("idle");
              }}
            />
          )}
        </>
      )}
    </WebDialogFrame>
  );
}

/** One sentence under the toggle: what this prompt is, and who refined it. */
function caption(title: string, mode: HandToAiMode, refine: Refine, hasModel: boolean): string {
  if (mode === "refined" && !hasModel) return `${NO_MODEL} This is the Basic prompt.`;
  if (mode === "refined" && refine.kind === "done") {
    const where = refine.onDevice ? " on this Mac" : "";
    return `“${title}” rewritten as a prompt by ${refine.model}${where}. Edit it here, then copy it.`;
  }
  return `A prompt built from “${title}” for Claude Code or another agent. Edit it here, then copy it.`;
}
