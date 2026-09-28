// Talk to the Librarian (`/librarian`, 2026-09-28; plan:
// docs/design/librarian-bar.md). The bar that takes the format bar's place:
// pick a model, highlight a passage (or not), say what you want. The first ask
// pops the conversation out into the pane's corner (librarianChat.tsx) and
// gives the format bar back; the model proposes, nothing changes until Apply,
// and every applied change shows in Librarian Activity with Undo. The note's
// words are never edited.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "../components/chat/chatModelPicker";
import { parseAnchors, resolveAnchor } from "../lib/librarianActions";
import { corpusFrontmatter, isTauri } from "../lib/tauri";
import { useFolders } from "../services/hooks";
import { librarianRefusal } from "../services/librarianBar";
import {
  closeLibrarianBar,
  startLibrarianChat,
  updateLibrarianChat,
  useLibrarianBar,
} from "../state/librarianBar";
import { useUiStore } from "../state/ui";
import { editorFor } from "./commands";
import {
  clip,
  librarianContext,
  libraryAreas,
  sendToLibrarian,
  useLibrarianModels,
  usePassage,
} from "./librarianSession";

type Phase = { kind: "checking" } | { kind: "refused"; message: string } | { kind: "ready" };

export function LibrarianBar({ noteId, paneId }: { noteId: string; paneId: string }) {
  const librarianOn = useUiStore((s) => s.brainEnabled);
  const folders = useFolders();
  const { groups, models, preferred } = useLibrarianModels();
  const [picked, setPicked] = useState<string | null>(null);
  const model = models.find((m) => m.id === (picked ?? preferred)) ?? models[0] ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [request, setRequest] = useState("");
  const [notice, setNotice] = useState("");
  const passage = usePassage(paneId);
  const input = useRef<HTMLInputElement | null>(null);

  // who may ask, before anything else
  useEffect(() => {
    let live = true;
    void librarianRefusal(noteId, { native: isTauri(), librarianOn }).then((message) => {
      if (!live) return;
      setPhase(message ? { kind: "refused", message } : { kind: "ready" });
      if (!message) input.current?.focus();
    });
    return () => {
      live = false;
    };
  }, [noteId, librarianOn]);

  const anchors = useQuery({
    queryKey: ["librarian-anchors", noteId],
    queryFn: async () => {
      const fm = await corpusFrontmatter(noteId);
      const line = fm?.fields.find((field) => field.startsWith("anchors:")) ?? "";
      return parseAnchors(line.slice("anchors:".length).trim());
    },
    enabled: phase.kind === "ready",
  });

  // back to the note, its selection as it was
  const close = () => {
    closeLibrarianBar();
    const editor = editorFor(paneId);
    const current = editor?.getSelection?.();
    if (current) editor?.selectRange?.(current.from, current.to);
  };

  // the first ask pops the conversation out; asking again here continues it
  const ask = () => {
    const text = request.trim();
    if (!text || !model) return;
    const existing = useLibrarianBar.getState().chat;
    const chatId =
      existing?.noteId === noteId && existing.paneId === paneId ? existing.id : crypto.randomUUID();
    if (chatId === existing?.id) {
      closeLibrarianBar();
      updateLibrarianChat(chatId, () => ({ minimized: false }));
    } else {
      startLibrarianChat({
        id: chatId,
        paneId,
        noteId,
        modelId: model.id,
        turns: [],
        status: "idle",
        error: null,
        minimized: false,
      });
    }
    const areas = libraryAreas((folders.data ?? []).map((folder) => folder.id));
    void sendToLibrarian(chatId, { text, highlight: passage.anchor() }, model, () =>
      librarianContext(noteId, paneId, areas),
    );
  };

  const jump = (index: number) => {
    const anchor = anchors.data?.[index];
    const editor = editorFor(paneId);
    const doc = editor?.getSelection?.()?.doc;
    if (!anchor || !editor || doc === undefined) return;
    const where = resolveAnchor(doc, anchor);
    if (where.kind === "found") editor.selectRange?.(where.from, where.to);
    else
      setNotice(
        where.kind === "moved"
          ? "That passage’s words now appear more than once, so the Librarian won’t guess which."
          : "That passage isn’t in the note anymore.",
      );
  };

  return (
    <div
      className="libbar"
      role="region"
      aria-label="Librarian"
      onKeyDown={(event) => {
        // the model picker is portaled: its own Escape (it closes the list) bubbles here too
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className="libbar-head">
        <strong>Librarian</strong>
        {phase.kind === "ready" &&
          (models.length > 0 ? (
            <ModelPicker groups={groups} picked={model} onPick={setPicked} />
          ) : (
            <span className="libbar-note">No models connected</span>
          ))}
        <span className="libbar-chip" title={passage.text || undefined}>
          {passage.text ? `“${clip(passage.text)}”` : "Highlight a passage to ask about it"}
        </span>
        <button type="button" className="libbar-close" aria-label="Close the Librarian" onClick={close}>
          ×
        </button>
      </div>

      {phase.kind === "checking" && <p className="libbar-note">Checking this note…</p>}
      {phase.kind === "refused" && (
        <p className="libbar-note" role="status">
          {phase.message}
        </p>
      )}

      {phase.kind === "ready" && (
        <form
          className="libbar-ask"
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <input
            ref={input}
            className="libbar-input"
            aria-label="Ask the Librarian"
            placeholder="Tag this note, mark a passage, file it with People…"
            value={request}
            onChange={(event) => setRequest(event.currentTarget.value)}
          />
          <button type="submit" className="rename-btn primary" disabled={!request.trim() || !model}>
            Ask
          </button>
        </form>
      )}
      {notice && (
        <p className="libbar-note" role="status">
          {notice}
        </p>
      )}

      {(anchors.data?.length ?? 0) > 0 && (
        <details className="libbar-marks">
          <summary>Marked passages ({anchors.data!.length})</summary>
          <ul>
            {anchors.data!.map((anchor, index) => (
              <li key={`${anchor.prefix}${anchor.exact}`}>
                <button type="button" className="libbar-link" onClick={() => jump(index)}>
                  {anchor.label ? `${anchor.label}: ` : ""}“{clip(anchor.exact)}”
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
