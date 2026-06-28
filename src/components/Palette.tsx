// ⌘K — the command palette, r3 frame F (approved): 640px, horizontally
// centered, anchored 96px from the top (never vertically centered — the input
// must not move as results grow), behind it the window dims + blurs (the ONLY
// overlay that dims). Empty query = Recent (in-memory MRU) + Suggested
// actions; typing filters Open tabs · Notes · Actions. Every registry action
// is listable with its current chord as an inline kbd hint. ⏎ opens replacing
// the focused pane's active tab; ⌘⏎ opens in a new tab. Esc closes through
// the transient stack (the registry's app.hide), not an ad-hoc listener.

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBindingsStore, resolveChord } from "../keys/bindings";
import { formatChord } from "../keys/chords";
import { type KeyAction, allActions, dispatch, getAction } from "../keys/registry";
import { useTransientPopover } from "../lib/popover";
import { useFolders, useNotes } from "../services/hooks";
import { useMruStore } from "../state/mru";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { Icon } from "./Icon";
import {
  FileGlyph,
  FocusGlyph,
  KeyboardGlyph,
  PlusGlyph,
  SearchGlyph,
  SplitGlyph,
  SunGlyph,
} from "./glyphs";

/** Simple subsequence match — instant, forgiving, no scoring (no metric gates). */
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

function actionIcon(id: string): ReactNode {
  if (id === "notes.new" || id === "tabs.new") return <PlusGlyph size={15} />;
  if (id.startsWith("panes.split")) return <SplitGlyph size={15} />;
  if (id === "view.focus") return <FocusGlyph size={15} />;
  if (id === "app.settings") return <Icon name="rotli-settings" size={15} />;
  if (id === "theme.cycle") return <SunGlyph size={15} />;
  if (id.startsWith("capture.")) return <Icon name="rotli-capture" size={15} />;
  return <KeyboardGlyph size={15} />;
}

interface Row {
  key: string;
  label: string;
  icon: ReactNode;
  hint: ReactNode;
  run: (newTab: boolean) => void;
}

interface Group {
  name: string;
  rows: Row[];
}

export function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const palRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useTransientPopover([palRef], true, onClose);

  // surfaced non-note files (image/pdf/…) aren't quick-open targets — keep them
  // out of the palette; they live in their folder (e.g. Storage) in the sidebar.
  const notes = (useNotes().data ?? []).filter((n) => n.kind !== "file");
  const folders = useFolders().data ?? [];
  const mruIds = useMruStore((s) => s.ids);
  const overrides = useBindingsStore((s) => s.overrides);
  const root = usePanesStore((s) => s.root);
  const focusedPaneId = usePanesStore((s) => s.focusedPaneId);
  const openNote = usePanesStore((s) => s.openNote);
  const activateTab = usePanesStore((s) => s.activateTab);
  const selectedFolderId = useUiStore((s) => s.selectedFolderId);

  const groups = useMemo<Group[]>(() => {
    const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "";
    const noteById = new Map(notes.map((n) => [n.id, n]));
    const q = query.trim();

    const chordOf = (a: KeyAction) => resolveChord(overrides, a.id, a.defaultChord);
    const kbdHint = (a: KeyAction): ReactNode => {
      const chord = chordOf(a);
      return chord ? <kbd>{formatChord(chord)}</kbd> : null;
    };
    const noteRow = (n: NoteSummary): Row => ({
      key: `note:${n.id}`,
      label: n.title,
      icon: <FileGlyph size={15} />,
      hint: <span className="muted">{folderName(n.folderId)}</span>,
      run: (newTab) => {
        openNote(n.id, { newTab });
        onClose();
      },
    });
    const actionRow = (a: KeyAction, label?: string): Row => ({
      key: `action:${a.id}`,
      label: label ?? a.title,
      icon: actionIcon(a.id),
      hint: kbdHint(a),
      run: () => {
        onClose();
        // selecting "Search notes & actions" from inside the palette would
        // close-then-reopen it — closing IS the toggle here
        if (a.id !== "palette.toggle") dispatch(a.id);
      },
    });

    if (!q) {
      // Recent includes the open note (gate r3F: the focused note is row 1 —
      // an empty palette is a dead palette); recents living as tabs in the
      // focused pane carry their ⌘1…⌘8 jump hint (tab-jump education).
      const focusedTabs = findLeaf(root, focusedPaneId)?.tabs ?? [];
      const recentRow = (n: NoteSummary): Row => {
        const i = focusedTabs.findIndex((t) => t.surfaceKind === "note" && t.noteId === n.id);
        const tab = i >= 0 && i < 8 ? focusedTabs[i] : undefined;
        if (!tab) return noteRow(n);
        return {
          ...noteRow(n),
          hint: <kbd>{formatChord(`Meta+${i + 1}`)}</kbd>,
          run: (newTab) => {
            // ⌘⏎ keeps the footer's promise even on a row that is already a tab
            if (newTab) openNote(n.id, { newTab: true });
            else activateTab(focusedPaneId, tab.id);
            onClose();
          },
        };
      };
      const recents = mruIds
        .map((id) => noteById.get(id))
        .filter((n): n is NoteSummary => n !== undefined)
        .slice(0, 5);
      const newNoteIn =
        selectedFolderId === ALL_NOTES || selectedFolderId === RECENT
          ? "Inbox"
          : folderName(selectedFolderId);
      const suggested: Row[] = [];
      const suggest = (id: string, label?: string) => {
        const action = getAction(id);
        if (action) suggested.push(actionRow(action, label));
      };
      suggest("notes.new", `New note in “${newNoteIn}”`);
      suggest("panes.splitRight");
      suggest("view.focus");
      return [
        ...(recents.length > 0 ? [{ name: "Recent", rows: recents.map(recentRow) }] : []),
        { name: "Suggested", rows: suggested },
      ];
    }

    // typed: Open tabs · Notes · Actions (gate order)
    const tabRows: Row[] = [];
    for (const leaf of leaves(root)) {
      leaf.tabs.forEach((tab, i) => {
        if (tab.surfaceKind !== "note") return;
        const n = noteById.get(tab.noteId);
        if (!n || !fuzzy(q, n.title)) return;
        tabRows.push({
          key: `tab:${leaf.id}:${tab.id}`,
          label: n.title,
          icon: <FileGlyph size={15} />,
          hint:
            leaf.id === focusedPaneId && i < 8 ? (
              <kbd>{formatChord(`Meta+${i + 1}`)}</kbd>
            ) : (
              <span className="muted">Open tab</span>
            ),
          run: (newTab) => {
            if (newTab) openNote(n.id, { newTab: true });
            else activateTab(leaf.id, tab.id);
            onClose();
          },
        });
      });
    }
    const noteRows = notes
      .filter((n) => fuzzy(q, n.title) || fuzzy(q, n.snippet))
      .slice(0, 8)
      .map(noteRow);
    // capture-surface actions live in the other webview — their handle is
    // null here and dispatching them would silently no-op
    const actionRows = allActions()
      .filter((a) => a.surface === "main" && fuzzy(q, a.title))
      .slice(0, 10)
      .map((a) => actionRow(a));
    return [
      ...(tabRows.length > 0 ? [{ name: "Open tabs", rows: tabRows.slice(0, 6) }] : []),
      ...(noteRows.length > 0 ? [{ name: "Notes", rows: noteRows }] : []),
      ...(actionRows.length > 0 ? [{ name: "Actions", rows: actionRows }] : []),
    ];
  }, [
    query,
    notes,
    folders,
    mruIds,
    overrides,
    root,
    focusedPaneId,
    selectedFolderId,
    openNote,
    activateTab,
    onClose,
  ]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const selected = Math.min(index, Math.max(0, flat.length - 1));

  // keep the selected row in view as ↑↓ move
  useEffect(() => {
    listRef.current?.querySelector(".prow.sel")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // ↑↓/⏎ are the palette input's own semantics (like typing); command chords
  // (⌘K toggle, Esc via the transient stack) stay with the registry dispatcher.
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      flat[selected]?.run(event.metaKey);
    }
  };

  let flatIndex = -1;

  return (
    <div className="pal-scrim">
      <div className="palette" ref={palRef} role="dialog" aria-label="Search notes and actions">
        <div className="pal-in">
          <SearchGlyph size={16} />
          <input
            autoFocus
            type="text"
            value={query}
            placeholder="Search notes, actions…"
            aria-label="Search notes and actions"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onInputKeyDown}
          />
        </div>
        <div className="pal-list" ref={listRef}>
          {groups.map((group) => (
            <div key={group.name}>
              <div className="pal-sec">{group.name}</div>
              {group.rows.map((row) => {
                flatIndex += 1;
                const i = flatIndex;
                return (
                  <button
                    type="button"
                    key={row.key}
                    className={i === selected ? "prow sel" : "prow"}
                    onMouseEnter={() => setIndex(i)}
                    onClick={(e) => row.run(e.metaKey)}
                  >
                    {row.icon}
                    <span className="plabel">{row.label}</span>
                    <span className="hint">{row.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="pal-empty">Nothing matches — fewer letters?</div>}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>⏎</kbd> open
          </span>
          <span>
            <kbd>⌘⏎</kbd> open in new tab
          </span>
          <span className="end">
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
