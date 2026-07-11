// Quick Note — the floating, Raycast-style note window (Seth, 2026-06-15; the
// ⌘P picker, 2026-06-19). A third webview (?window=quick), summoned by ⌥Q,
// hidden on blur. It reuses the EXACT main editor + format bar over ONE open
// note. The note you're in is decoupled from your pinned favorites: ⌘P (or the
// header) opens a picker over ALL notes — click one to open it, star one to pin
// it to quick access. ⌘]/⌘[ cycle the pinned favorites. The set + the open note
// live in the ui store (state/quick.ts), synced to the main window which
// persists them. Renders standalone in a plain browser for review.

import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { EditorSurface } from "../editor/editorSurface";
import { useTransientPopover } from "../lib/popover";
import { setQuickHandle } from "../lib/quickHandle";
import { corpusFrontmatter, corpusSetSecure, onQuickShow, startWindowDrag } from "../lib/tauri";
import { isChatsPath, isVault, isWikiPath } from "../services/destinations";
import { invalidateNotes, useSearchableNotes } from "../services/hooks";
import { inboxFolderId, notesService } from "../services/notes";
import { createRoutedNote } from "../services/createNote";
import { usePanesStore } from "../state/panes";
import { pruneQuick, setQuickActive, togglePinQuick } from "../state/quick";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { IconButton } from "./iconButton";
import { PlusGlyph, SearchGlyph, ShieldGlyph, glyphForNote } from "./glyphs";

/** activeEditor() resolves through the panes store's focusedPaneId; the quick
 * webview has no pane tree, so we pin it to this id and register the editor
 * under it — that keeps ⌘B / headings / lists working here. */
const QUICK_PANE_ID = "quick";

/** Manual drag (never data-tauri-drag-region) so double-click can't zoom. */
function onDragRegionMouseDown(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void startWindowDrag();
}

/** Forgiving subsequence match — instant, no scoring (mirrors the palette). */
function fuzzy(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i >= q.length) return true;
  }
  return q.length === 0;
}

function StarGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77 6.79 19.5l.99-5.79-4.21-4.1 5.82-.85z" />
    </svg>
  );
}

/** The picker (⌘P): search ALL notes; click a row to OPEN it, click the star to
 * pin/unpin it to quick access. Favorites float to the top. */
function NotePicker({
  notes,
  pinned,
  activeId,
  onOpen,
  onTogglePin,
  onClose,
}: {
  notes: NoteSummary[];
  pinned: Set<string>;
  activeId: string | null;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  // Esc (quick.dismiss) + outside-click close the picker before the window
  useTransientPopover([panelRef], true, onClose);

  const results = useMemo(() => {
    const q = query.trim();
    const matched = notes.filter((n) => fuzzy(q, n.title) || fuzzy(q, n.snippet));
    // pinned favorites first, then the rest — both filtered by the query
    const fav = matched.filter((n) => pinned.has(n.id));
    const rest = matched.filter((n) => !pinned.has(n.id));
    return [...fav, ...rest].slice(0, 60);
  }, [notes, query, pinned]);
  const sel = Math.min(index, Math.max(0, results.length - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const note = results[sel];
      if (note) onOpen(note.id);
    }
    // Esc falls through to quick.dismiss (the transient stack)
  };

  return (
    <div className="qsearch" ref={panelRef} role="dialog" aria-label="Switch or pin a note">
      <div className="qsearch-in">
        <SearchGlyph size={15} />
        <input
          autoFocus
          type="text"
          value={query}
          placeholder="Open any note · ★ pins it to quick access"
          aria-label="Switch to a note"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="qsearch-list">
        {results.map((n, i) => {
          const isPinned = pinned.has(n.id);
          return (
            <div key={n.id} className={i === sel ? "qsrow sel" : "qsrow"} onMouseEnter={() => setIndex(i)}>
              <button type="button" className="qsopen" onClick={() => onOpen(n.id)}>
                {glyphForNote(n, { size: 14 })}
                <span className="qslabel">{n.title || "Untitled"}</span>
                {n.id === activeId && <span className="qstag">open</span>}
              </button>
              <button
                type="button"
                className={isPinned ? "qspin on" : "qspin"}
                aria-label={isPinned ? "Unpin from quick access" : "Pin to quick access"}
                aria-pressed={isPinned}
                onClick={() => onTogglePin(n.id)}
              >
                <StarGlyph filled={isPinned} />
              </button>
            </div>
          );
        })}
        {results.length === 0 && <div className="qsempty">No notes match.</div>}
      </div>
    </div>
  );
}

export function QuickNote() {
  const ids = useUiStore((s) => s.quickNoteIds);
  const activeId = useUiStore((s) => s.quickActiveId);
  // the SEARCHABLE universe (staged + Brain + Vault + added roots) minus
  // boards — this picker feeds the MARKDOWN editor, so a .excalidraw scene or
  // an image/pdf must never be pickable (corpus_read on one fails or renders
  // garbage). useNotes() alone missed staged notes (the search audit's P0).
  const universe = useSearchableNotes();
  const notes = useMemo(
    () => universe.notes.filter((n) => n.kind !== "board"),
    [universe.notes],
  );
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // a failed new-note create, surfaced in the window (#6 — never silent)
  const [err, setErr] = useState<string | null>(null);
  // bumped each summon — keys the editor so it REMOUNTS on every show, re-running
  // autoFocus so re-opens always land a typing caret (#7)
  const [showNonce, setShowNonce] = useState(0);
  const [secure, setSecure] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  // in-flight guard so a burst of summons can't spawn duplicate blank notes (QN-1)
  const creatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setSecure(false);
    if (!activeId) return;
    void corpusFrontmatter(activeId).then((fm) => {
      if (!cancelled) setSecure(fm?.secure ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const toggleSecure = () => {
    if (!activeId || securityBusy) return;
    const next = !secure;
    setSecurityBusy(true);
    void corpusSetSecure(activeId, next)
      .then(() => {
        setSecure(next);
        return invalidateNotes();
      })
      .catch((e: unknown) => setErr((e as Error)?.message ?? "couldn't update note security"))
      .finally(() => setSecurityBusy(false));
  };

  // point activeEditor() at the one editor this webview mounts
  useEffect(() => {
    usePanesStore.setState({ focusedPaneId: QUICK_PANE_ID });
  }, []);

  // self-heal: prune pinned ids whose notes are truly GONE (archive/trash is an
  // id-preserving move, not a delete — confirm via getNote before dropping). The
  // OPEN note is kept by pruneQuick whenever it still exists, pinned or not.
  useEffect(() => {
    // ready = EVERY listing succeeded — pruning against a half-loaded universe
    // would read "still loading" as "gone" (the pruneQuick data-loss lesson)
    if (!universe.ready) return;
    const visible = new Set(notes.map((n) => n.id));
    // ids absent from the visible list MIGHT be gone — but archive/trash is an
    // id-preserving move, so confirm via getNote before dropping. The OPEN note
    // is checked the same way even when every pinned favorite is still visible
    // (it can be archived/trashed on its own — the half-fix missed this path).
    const toConfirm = ids.filter((id) => !visible.has(id));
    if (activeId && !visible.has(activeId) && !toConfirm.includes(activeId)) {
      toConfirm.push(activeId);
    }
    if (toConfirm.length === 0) {
      pruneQuick(visible);
      return;
    }
    let cancelled = false;
    void Promise.all(toConfirm.map((id) => notesService.getNote(id).then((n) => (n ? id : null))))
      .then((found) => {
        if (cancelled) return;
        const alive = new Set(visible);
        for (const id of found) if (id) alive.add(id);
        pruneQuick(alive);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [universe.ready, notes, ids, activeId]);

  const newNote = () => {
    // Quick notes default to the LOCAL Inbox. The external Vault is read-mostly —
    // rotli never creates a note inside it (never into a memex's chats/) — and the
    // local memex's curated wiki/** + chats/ REFUSE creation at the write gate, so
    // a stored quickFolder pointing at any of those (a stale Settings pick)
    // redirects to the local Inbox instead of leaving ⌥Q dead (#6, audit 2026-07).
    const stored = useUiStore.getState().quickFolder;
    const folder =
      isVault(stored) || isWikiPath(stored) || isChatsPath(stored) ? inboxFolderId : stored;
    creatingRef.current = true;
    void createRoutedNote({
      selectedFolderId: folder,
      isSmart: folder === inboxFolderId,
      localFallback: inboxFolderId,
      secure: true,
    })
      .then(async (noteId) => {
        await invalidateNotes();
        setErr(null);
        setQuickActive(noteId); // open it (not pinned — pin deliberately via ★)
        setPickerOpen(false);
      })
      // a refused create (read-only band, a gone folder, …) must SAY so — the
      // global hotkey silently doing nothing reads as "rotli is broken" (#6)
      .catch((e: unknown) => setErr((e as Error)?.message ?? "couldn't create the note"))
      .finally(() => {
        creatingRef.current = false;
      });
  };
  const openPicker = () => setPickerOpen(true);

  // route the quick.new / quick.search(picker) chords to this live component
  useEffect(() => {
    setQuickHandle({ newNote, openSearch: openPicker });
    return () => setQuickHandle(null);
  });

  // re-summoned: close the picker, remount the editor (refocus), and if NO note
  // is open drop straight into a fresh one so there's always a typing area (#7).
  // subscribe once — the handler reads everything imperatively (getState, stable
  // refs/setters), so a per-render re-subscribe would only churn the async
  // listen/unlisten pair with no benefit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable handler, subscribe once
  useEffect(
    () =>
      onQuickShow(() => {
        setPickerOpen(false);
        setErr(null); // a fresh summon starts clean; a re-failure re-surfaces
        setShowNonce((n) => n + 1);
        if (!creatingRef.current && !useUiStore.getState().quickActiveId) newNote();
      }),
    [],
  );

  const activeTitle = (activeId && byId.get(activeId)?.title) || "Untitled";

  return (
    <div className="quick-window">
      <header className="quick-head">
        <div className="quick-inset" onMouseDown={onDragRegionMouseDown} />
        {activeId ? (
          // the title button is content-width and centered, with draggable
          // spacers on either side — so the header stays easy to grab and move
          // the window, instead of being one big click target (Seth, 2026-06-24)
          <>
            <div className="quick-drag" onMouseDown={onDragRegionMouseDown} aria-hidden="true" />
            <button
              type="button"
              className="quick-pick"
              aria-haspopup="dialog"
              title="Switch or pin a note — ⌘P"
              onClick={openPicker}
            >
              <span className="quick-pick-name">{activeTitle}</span>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="quick-drag" onMouseDown={onDragRegionMouseDown} aria-hidden="true" />
          </>
        ) : (
          <span className="quick-title" onMouseDown={onDragRegionMouseDown}>
            Quick note
          </span>
        )}
        <div className="quick-actions">
          {activeId && (
            <IconButton
              label={secure ? "Secure note — click to remove protection" : "Mark as secure"}
              pressed={secure}
              disabled={securityBusy}
              onClick={toggleSecure}
            >
              <ShieldGlyph size={15} />
            </IconButton>
          )}
          <IconButton label="Switch or pin a note — ⌘P" onClick={openPicker}>
            <SearchGlyph size={15} />
          </IconButton>
          <IconButton label="New quick note — ⌘N" onClick={newNote}>
            <PlusGlyph size={15} />
          </IconButton>
        </div>
      </header>

      {err && <p className="quick-err">⚠ {err}</p>}

      {activeId ? (
        // key forces a clean remount per note AND per show (the nonce) — fresh
        // caret/scroll on switch, autoFocus re-lands the caret on every re-open
        <EditorSurface key={`${activeId}:${showNonce}`} noteId={activeId} paneId={QUICK_PANE_ID} autoFocus />
      ) : (
        <div className="quick-empty">
          <p className="qe-title">No note open</p>
          <p className="qe-sub">Start a fresh note, or open any of your notes with ⌘P.</p>
          <div className="qe-actions">
            <button type="button" className="btn" onClick={newNote}>
              <PlusGlyph size={14} /> New note
            </button>
            <button type="button" className="qe-ghost" onClick={openPicker}>
              Open a note…
            </button>
          </div>
        </div>
      )}

      {pickerOpen && (
        <NotePicker
          notes={notes}
          pinned={new Set(ids)}
          activeId={activeId}
          onOpen={(id) => {
            setQuickActive(id);
            setPickerOpen(false);
          }}
          onTogglePin={togglePinQuick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
