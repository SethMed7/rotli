// The Board (the maintainer, 2026-06-19): quick captures collected as cards, NOT dumped
// into your note list. ⌥C drops a card here (a real .md in Board/, hidden from
// All Notes until merged). Click cards to multi-select, then MERGE the selected
// ones into a single joint note (in Inbox) — the originals are archived
// (recoverable, never hard-deleted), per the never-delete lifecycle. Double-click
// a card to open it on its own. A view in the content area now (the sidebar
// stays); the registry's app.hide (Esc) closes it back to the panes via the
// contentView model (setContentView("panes")).

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { relativeLabel } from "../lib/dateLabels";
import { createDragGhost } from "../lib/dragGhost";
import { createPointerDragSession } from "../lib/pointerDrag";
import { createMergedCaptureNote, joinCaptureBodies } from "../services/captureMerge";
import { DEST } from "../services/destinations";
import { invalidateNotes, useNotes } from "../services/hooks";
import { mainNoteIds } from "../services/mainTree";
import { archiveNoteWithImages, trashNoteWithImages } from "../services/noteLifecycle";
import { notesService } from "../services/notes";
import { useMainStore } from "../state/main";
import { useFocusedNoteId, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { pendingRevealKey } from "./captureReveal";
import { Character } from "./character";
import { ArchiveGlyph, CheckGlyph, TrashGlyph, glyphForNote } from "./glyphs";
import { useNoteMenu } from "./useNoteMenu";

/** Per-item accounting for a batched archive: say exactly how many failed (and
 * why, first reason) through the app's row-action banner — the loop used to be
 * serial with silent rejection. */
function reportLifecycleFailures(
  results: PromiseSettledResult<unknown>[],
  total: number,
  noun: string,
  verb: string,
): void {
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === 0) return;
  const reason = failed[0]!.reason;
  useUiStore
    .getState()
    .setRowActionError(
      `${failed.length} of ${total} ${noun}s couldn’t be ${verb} — ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    );
}

export function BoardSurface() {
  const stagedData = useNotes(DEST.board).data;
  // a CURATED note is a full note, not a passing capture (the maintainer, 2026-07-01: "my
  // main note should not be in Captures") — anything placed in Main or starred
  // for Quick access leaves the board, even while it still lives in intake
  // staging (_inbox, or _secure for secure-at-birth captures). Sidebar's
  // Captures count applies the same rule; a Quick Note is filed into Main at
  // birth, so it never appears here.
  const mainTree = useMainStore((s) => s.manifest.tree);
  const quickIds = useUiStore((s) => s.quickNoteIds);
  const focusedNoteId = useFocusedNoteId();
  const revealNonce = useUiStore((s) => s.revealNonce);
  const captures = useMemo(() => {
    const staged = stagedData ?? [];
    const curated = mainNoteIds(mainTree);
    return staged.filter((n) => !curated.has(n.id) && !quickIds.includes(n.id));
  }, [stagedData, mainTree, quickIds]);
  const setContentView = useUiStore((s) => s.setContentView);
  const openNote = usePanesStore((s) => s.openNote);
  const openSummary = usePanesStore((s) => s.openSummary);
  // right-click = the app's one row menu (#56's other half: the graduating
  // gestures — star, Add to Main, File to the Brain — live ON the cards, not
  // only back in the sidebar). Same hook every note row wires.
  const openMenu = useNoteMenu();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // "Show in Brain" on a Captures note: select + scroll the card into view.
  // Fires once per (focus, nonce) — captures stays in the deps only so a
  // reveal that lands before the list loads still runs; the handled-key guard
  // keeps later list churn from clobbering a multi-select (audit 2026-07-30).
  const handledRevealRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusedNoteId) return;
    const key = pendingRevealKey(
      handledRevealRef.current,
      focusedNoteId,
      revealNonce,
      captures.map((c) => c.id),
    );
    if (!key) return;
    handledRevealRef.current = key;
    setSelected(new Set([focusedNoteId]));
    if (!revealNonce) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-cap-id="${CSS.escape(focusedNoteId)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusedNoteId, revealNonce, captures]);

  // only ids still on the board count as selected (a refetch drops archived ones)
  const chosen = captures.filter((c) => selected.has(c.id));

  const captureOrder = useUiStore((s) => s.captureOrder);
  const setCaptureOrder = useUiStore((s) => s.setCaptureOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const didDragRef = useRef(false);
  const trashTargetRef = useRef(false);

  // captures in the user's manual order; new ids (not yet ordered) keep their
  // newest-first spot from listNotes.
  const ordered = useMemo(() => {
    const pos = new Map(captureOrder.map((id, i) => [id, i] as const));
    // pinned captures FLOAT above the manual order (the maintainer, 2026-07-09) — the
    // saved order itself is untouched, same rule as Main
    return [...captures].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity),
    );
  }, [captures, captureOrder]);

  // pointer-drag reorder (HTML5 DnD is dead in the WKWebView shell). A move past
  // the threshold is a DRAG (reorder); no move falls through to the click (select).
  // The card's title rides the cursor as a floating ghost (the shared
  // lib/dragGhost, same as tab drags); Esc / pointercancel abandons the drag.
  const startCardDrag = (e: ReactPointerEvent, id: string, label: string) => {
    // button guard BEFORE the ref reset — a right-click must not clear the
    // last drag's click suppression (the session guards again internally)
    if (e.button !== 0) return;
    let drop: { id: string; after: boolean } | null = null;
    didDragRef.current = false;
    createPointerDragSession(e, {
      ghost: (x, y) => createDragGhost(label, x, y),
      // didDragRef stays armed past onEnd so the trailing click is eaten
      onStart: () => {
        didDragRef.current = true;
        setDragId(id);
      },
      onMove: (x, y) => {
        const trash = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
          '[data-system-trash-drop="1"]',
        ) as HTMLElement | null;
        document
          .querySelector('[data-system-trash-drop="1"]')
          ?.classList.toggle("capture-trash-target", !!trash);
        trashTargetRef.current = !!trash;
        if (trash) {
          drop = null;
          setDropAt(null);
          return;
        }
        const hit = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
          "[data-cap-id]",
        ) as HTMLElement | null;
        const tid = hit?.dataset.capId;
        if (!hit || !tid || tid === id) {
          drop = null;
          setDropAt(null);
          return;
        }
        const rect = hit.getBoundingClientRect();
        drop = { id: tid, after: x > rect.left + rect.width / 2 };
        setDropAt(drop);
      },
      onDrop: () => {
        if (trashTargetRef.current) {
          const ids = selected.has(id) ? [...selected] : [id];
          void trashCaptureIds(ids);
          return;
        }
        const d = drop;
        if (!d) return;
        const ids = ordered.map((c) => c.id).filter((x) => x !== id);
        let idx = ids.indexOf(d.id);
        if (idx >= 0) {
          if (d.after) idx += 1;
          ids.splice(idx, 0, id);
          setCaptureOrder(ids);
        }
      },
      onEnd: () => {
        document.querySelector('[data-system-trash-drop="1"]')?.classList.remove("capture-trash-target");
        trashTargetRef.current = false;
        setDragId(null);
        setDropAt(null);
      },
    });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // open a card by kind — a stray board in the Board root opens its canvas, not
  // a dead note tab. open* returns the content area to the panes on its own.
  const openOne = (c: { id: string; kind?: "note" | "board" | "file" }) => openSummary(c);

  const back = () => setContentView("panes");

  /** Merge the selected cards into ONE note (bodies joined oldest-first with a
   * blank line) created where a new note from here belongs, then archive the
   * originals — they're consumed, not lost. A refused create says so in the
   * sidebar's error lane instead of failing silently. */
  const merge = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      // board order is newest-first; read oldest-first so the joint note reads
      // in the order the thoughts arrived
      const ordered = [...chosen].reverse();
      const docs = await Promise.all(ordered.map((c) => notesService.getNote(c.id)));
      const noteId = await createMergedCaptureNote(joinCaptureBodies(docs.map((d) => d?.body)));
      // consume the originals together — independent archives, so one failure
      // must not strand the rest (audit 2026-07-30, #16 batch half)
      const results = await Promise.allSettled(ordered.map((c) => archiveNoteWithImages(c.id)));
      reportLifecycleFailures(results, ordered.length, "merged capture", "archived");
      await invalidateNotes();
      setSelected(new Set());
      openNote(noteId); // returns the content area to the panes
    } catch (error) {
      useUiStore
        .getState()
        .setRowActionError(
          `Couldn’t make a note from the selection — ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      setBusy(false);
    }
  };

  /** Archive the selected cards (recoverable; clears them off the board). */
  const archiveSelected = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(chosen.map((c) => archiveNoteWithImages(c.id)));
      reportLifecycleFailures(results, chosen.length, "capture", "archived");
      await invalidateNotes();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  /** Move captures to Rotli's recoverable Trash. Shared by the toolbar and the
   * sidebar drop target so drag-and-drop cannot acquire a separate delete path. */
  const trashCaptureIds = async (ids: readonly string[]) => {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => trashNoteWithImages(id)));
      reportLifecycleFailures(results, ids.length, "capture", "moved to Trash");
      await invalidateNotes();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="board">
      <header className="board-head">
        <button type="button" className="board-back" onClick={back}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Back to notes</span>
        </button>
        <h2 className="board-title">Captures</h2>
        <span className="board-count">{captures.length}</span>
      </header>

      {captures.length === 0 ? (
        <div className="list-empty">
          <Character name="listening" size={104} className="be-quokka" />
          <p className="be-title">Nothing captured yet</p>
          <p className="be-sub">
            Press your Quick capture shortcut (⌥C) from anywhere — each thought lands here as a card. Select a
            few and merge them into one note.
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          {/* curating a card GRADUATES it — say so, or the instant vanish reads
              as data loss (#56, audit 2026-07) */}
          <p className="board-foot-hint">
            A card added to Main or starred for Quick access graduates — it leaves this board and lives with
            your notes.
          </p>
          <div className="board-grid">
            {ordered.map((c) => {
              const sel = selected.has(c.id);
              const cls = ["board-card"];
              if (sel) cls.push("sel");
              if (dragId === c.id) cls.push("dragging");
              if (dropAt?.id === c.id) cls.push(dropAt.after ? "drop-after" : "drop-before");
              return (
                <button
                  type="button"
                  key={c.id}
                  data-cap-id={c.id}
                  className={cls.join(" ")}
                  aria-pressed={sel}
                  onPointerDown={(e) => startCardDrag(e, c.id, c.title || "Empty capture")}
                  onClick={() => {
                    if (didDragRef.current) {
                      didDragRef.current = false;
                      return;
                    }
                    toggle(c.id);
                  }}
                  onDoubleClick={() => openOne(c)}
                  onContextMenu={(e) => openMenu(e, c)}
                  title="Drag to reorder · click to select · double-click to open · right-click for actions"
                >
                  <span className="bc-check" aria-hidden="true">
                    {sel && <CheckGlyph size={11} />}
                  </span>
                  <span className="bc-body">
                    <span className="bc-title">
                      {glyphForNote(c, { size: 13, className: "bc-icon" })}
                      {c.title || "Empty capture"}
                    </span>
                    {c.snippet && <span className="bc-snippet">{c.snippet}</span>}
                  </span>
                  <span className="bc-date">{relativeLabel(c.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="board-bar" role="toolbar" aria-label="Selected captures">
          <span className="board-bar-count">{chosen.length} selected</span>
          <span className="board-bar-grow" />
          <button type="button" className="board-btn" disabled={busy} onClick={() => void archiveSelected()}>
            <ArchiveGlyph size={14} />
            Archive
          </button>
          <button
            type="button"
            className="board-btn"
            disabled={busy}
            onClick={() => void trashCaptureIds(chosen.map((capture) => capture.id))}
          >
            <TrashGlyph size={14} />
            Trash
          </button>
          <button type="button" className="board-btn primary" disabled={busy} onClick={() => void merge()}>
            {busy ? "Merging…" : chosen.length > 1 ? `Merge ${chosen.length} into a note` : "Make a note"}
          </button>
          <button
            type="button"
            className="board-btn ghost"
            disabled={busy}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
