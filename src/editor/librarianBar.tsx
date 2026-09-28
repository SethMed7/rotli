// Talk to the Librarian (`/librarian`, 2026-09-28; plan:
// docs/design/librarian-bar.md). The bar that takes the format bar's place:
// pick a model, highlight a passage (or not), say what you want. The model
// proposes; nothing changes until Apply, and every applied change shows in
// Librarian Activity with Undo. The note's words are never edited.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { makeTauriHost } from "../ai/host";
import { librarianModelFor } from "../ai/librarianLane";
import { mergedModels } from "../ai/models";
import {
  anchorFromSelection,
  describeLibrarianAction,
  type LibrarianAction,
  parseAnchors,
  resolveAnchor,
} from "../lib/librarianActions";
import { chatModels, corpusFrontmatter, isTauri } from "../lib/tauri";
import { useConnectedLanes } from "../services/connectedModels";
import { useFolders } from "../services/hooks";
import {
  applyLibrarian,
  currentTags,
  LIBRARIAN_REFUSALS,
  librarianRefusal,
  proposeLibrarian,
} from "../services/librarianBar";
import { closeLibrarianBar } from "../state/librarianBar";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { editorFor } from "./commands";

type Phase =
  | { kind: "checking" }
  | { kind: "refused"; message: string }
  | { kind: "ready" }
  | { kind: "thinking" }
  | { kind: "proposals"; actions: LibrarianAction[]; picked: boolean[] }
  | { kind: "applying" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const CHIP_MAX = 48;

function titleOf(doc: string): string {
  const first = doc.split("\n").find((line) => line.trim()) ?? "";
  return first.replace(/^#+\s+/, "").trim() || "Untitled";
}

/** The Library's areas: the top-level folders under wiki/, minus its lanes. */
function libraryAreas(folderIds: readonly string[]): string[] {
  return folderIds
    .map((id) => /^wiki\/([^/]+)$/.exec(id)?.[1])
    .filter((name): name is string => !!name && !name.startsWith("_"));
}

/** The models the person has connected, and the Librarian's own choice. */
function useLibrarianModels() {
  const aiProviders = useUiStore((s) => s.aiProviders);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const providerDefaults = useUiStore((s) => s.providerDefaults);
  const organizerModel = useUiStore((s) => s.organizerModel);
  const organizerModelId = useUiStore((s) => s.organizerModelId);
  const local = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  const lanes = useConnectedLanes(aiProviders, isTauri());
  const groups = mergedModels(local.data ?? [], aiProviders, [], blockedModels, lanes.ready, lanes.lanes);
  const models = [...groups.local, ...groups.connected];
  const preferred =
    organizerModel === "local"
      ? (groups.local.find((m) => m.localDefault) ?? groups.local[0])?.id
      : librarianModelFor(organizerModel, organizerModelId, providerDefaults, lanes.lanes);
  return { models, preferred };
}

export function LibrarianBar({ noteId, paneId }: { noteId: string; paneId: string }) {
  const librarianOn = useUiStore((s) => s.brainEnabled);
  const folders = useFolders();
  const { models, preferred } = useLibrarianModels();
  const [picked, setPicked] = useState<string | null>(null);
  const modelId = picked ?? preferred ?? models[0]?.id ?? "";
  const model = models.find((m) => m.id === modelId);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [request, setRequest] = useState("");
  const [selection, setSelection] = useState("");
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

  // the live highlight: the editor keeps its selection while focus is here
  useEffect(() => {
    const read = () => {
      const current = editorFor(paneId)?.getSelection?.();
      setSelection(current && current.to > current.from ? current.doc.slice(current.from, current.to) : "");
    };
    read();
    const events = ["selectionchange", "mouseup", "keyup"] as const;
    for (const name of events) document.addEventListener(name, read);
    return () => {
      for (const name of events) document.removeEventListener(name, read);
    };
  }, [paneId]);

  const anchors = useQuery({
    queryKey: ["librarian-anchors", noteId],
    queryFn: async () => {
      const fm = await corpusFrontmatter(noteId);
      const line = fm?.fields.find((field) => field.startsWith("anchors:")) ?? "";
      return parseAnchors(line.slice("anchors:".length).trim());
    },
    enabled: phase.kind !== "checking" && phase.kind !== "refused",
  });

  // back to the note, its selection as it was
  const close = () => {
    closeLibrarianBar();
    const editor = editorFor(paneId);
    const current = editor?.getSelection?.();
    if (current) editor?.selectRange?.(current.from, current.to);
  };

  const ask = async () => {
    const current = editorFor(paneId)?.getSelection?.();
    if (!current || !model || !request.trim()) return;
    // the selection is snapshotted now: a later click can't change the question
    const highlight = anchorFromSelection(current.doc, current.from, current.to);
    setPhase({ kind: "thinking" });
    try {
      const proposal = await proposeLibrarian(
        {
          title: titleOf(current.doc),
          request: request.trim(),
          highlight,
          doc: current.doc,
          areas: libraryAreas((folders.data ?? []).map((folder) => folder.id)),
          tags: await currentTags(noteId),
        },
        makeTauriHost(model, { isSecureContext: () => false }),
      );
      if (proposal.kind === "secret") setPhase({ kind: "refused", message: LIBRARIAN_REFUSALS.secret });
      else if (proposal.actions.length === 0)
        setPhase({
          kind: "done",
          message: "The Librarian has nothing to change for that. Try asking another way.",
        });
      else
        setPhase({ kind: "proposals", actions: proposal.actions, picked: proposal.actions.map(() => true) });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const apply = async (actions: LibrarianAction[]) => {
    const current = editorFor(paneId)?.getSelection?.();
    setPhase({ kind: "applying" });
    try {
      const count = await applyLibrarian(actions, {
        id: noteId,
        title: titleOf(current?.doc ?? ""),
        model: model?.id ?? "",
      });
      await anchors.refetch();
      setRequest("");
      setPhase({
        kind: "done",
        message:
          count === 0
            ? "Nothing needed changing."
            : `${count === 1 ? "1 change" : `${count} changes`} made. Undo any of them in Librarian Activity.`,
      });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const jump = (index: number) => {
    const anchor = anchors.data?.[index];
    const editor = editorFor(paneId);
    const doc = editor?.getSelection?.()?.doc;
    if (!anchor || !editor || doc === undefined) return;
    const where = resolveAnchor(doc, anchor);
    if (where.kind === "found") editor.selectRange?.(where.from, where.to);
    else
      setPhase({
        kind: "done",
        message:
          where.kind === "moved"
            ? "That passage’s words now appear more than once, so the Librarian won’t guess which."
            : "That passage isn’t in the note anymore.",
      });
  };

  const busy = phase.kind === "thinking" || phase.kind === "applying";
  const chip = selection.length > CHIP_MAX ? `${selection.slice(0, CHIP_MAX - 1)}…` : selection;

  return (
    <div
      className="libbar"
      role="region"
      aria-label="Librarian"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className="libbar-head">
        <strong>Librarian</strong>
        {phase.kind !== "refused" && phase.kind !== "checking" && (
          <select
            className="libbar-model"
            aria-label="Model"
            value={modelId}
            disabled={busy || models.length === 0}
            onChange={(event) => setPicked(event.currentTarget.value)}
          >
            {models.length === 0 && <option value="">No models connected</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <span className="libbar-chip" title={selection || undefined}>
          {chip ? `“${chip}”` : "Highlight a passage to mark it"}
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

      {(phase.kind === "ready" ||
        phase.kind === "thinking" ||
        phase.kind === "done" ||
        phase.kind === "error") && (
        <form
          className="libbar-ask"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <input
            ref={input}
            className="libbar-input"
            aria-label="Ask the Librarian"
            placeholder="Tag this, mark this passage, file it with People…"
            value={request}
            disabled={busy}
            onChange={(event) => setRequest(event.currentTarget.value)}
          />
          <button type="submit" className="rename-btn primary" disabled={busy || !request.trim() || !model}>
            {phase.kind === "thinking" ? "Thinking…" : "Ask"}
          </button>
        </form>
      )}

      {phase.kind === "proposals" && (
        <div className="libbar-proposals">
          <ul>
            {phase.actions.map((action, index) => (
              <li key={describeLibrarianAction(action)}>
                <label>
                  <input
                    type="checkbox"
                    checked={phase.picked[index] ?? false}
                    onChange={() =>
                      setPhase({
                        ...phase,
                        picked: phase.picked.map((on, at) => (at === index ? !on : on)),
                      })
                    }
                  />
                  {describeLibrarianAction(action)}
                </label>
              </li>
            ))}
          </ul>
          <div className="libbar-row">
            <button type="button" className="rename-btn" onClick={() => setPhase({ kind: "ready" })}>
              Not now
            </button>
            <button
              type="button"
              className="rename-btn primary"
              disabled={!phase.picked.some(Boolean)}
              onClick={() => void apply(phase.actions.filter((_, index) => phase.picked[index]))}
            >
              Apply
            </button>
          </div>
        </div>
      )}
      {phase.kind === "applying" && <p className="libbar-note">Applying…</p>}
      {(phase.kind === "done" || phase.kind === "error") && (
        <p className={phase.kind === "error" ? "libbar-note err" : "libbar-note"} role="status">
          {phase.message}
          {phase.kind === "done" && (
            <button
              type="button"
              className="libbar-link"
              onClick={() => usePanesStore.getState().openActivity()}
            >
              Librarian Activity
            </button>
          )}
        </p>
      )}

      {(anchors.data?.length ?? 0) > 0 && (
        <details className="libbar-marks">
          <summary>Marked passages ({anchors.data!.length})</summary>
          <ul>
            {anchors.data!.map((anchor, index) => (
              <li key={`${anchor.prefix}${anchor.exact}`}>
                <button type="button" className="libbar-link" onClick={() => jump(index)}>
                  {anchor.label ? `${anchor.label}: ` : ""}“
                  {anchor.exact.length > CHIP_MAX ? `${anchor.exact.slice(0, CHIP_MAX - 1)}…` : anchor.exact}”
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
