// Focused-list j/k navigation for the compact-tree Sidebar (the maintainer, 2026-06-13).
//
// SAFETY MODEL — this is a FOCUS-SCOPED keymap, NOT a global one. Every handler
// here is LOCAL to a sidebar row element (it rides each row's own onKeyDown), so
// the editor textarea and non-vim users never see these keys: only a focused
// sidebar row reacts. The global key registry (src/keys/registry.ts) keeps its
// single window-level dispatcher untouched — we just stopPropagation() on the
// keys we handle so the bare-key rule there never double-fires (e.g. a lone "k"
// must move the cursor up, not reach the dispatcher). MODIFIED chords (⌘K and
// friends) are explicitly let through by an early return, so the palette and the
// rest of the keymap still work while a row is focused.
//
// ROVING TABINDEX — exactly one row carries tabIndex=0 (the activeId), the rest
// -1, so Tab enters the list at one stop and arrow/j/k move the active row,
// .focus()-ing the new element (refs tracked in a Map keyed by row id). The
// keyboard highlight is :focus-visible (the base.css 2px clay ring), so we never
// invent a selection state — .sel stays reserved for the open note (Sidebar
// keeps them separate). When the visible rows shrink (filter typed, a note
// trashed), activeId is clamped to a still-present row so the list never points
// at a vanished element.

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

/** One navigable row in the flat, in-render-order list the Sidebar feeds us.
 * kind lets a caller branch (a note opens vs a folder/dest toggles). */
export interface RovingRow {
  id: string;
  kind: "note" | "folder" | "smart";
}

/** The per-row props the Sidebar spreads onto each row element. role="option"
 * pairs with the container's role="listbox"; aria-selected mirrors the roving
 * active row (the keyboard cursor), distinct from the visually-open note's
 * .sel. */
export interface RovingRowProps {
  tabIndex: number;
  role: "option";
  "aria-selected": boolean;
  ref: (el: HTMLElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

export interface UseRovingListOpts {
  /** l / Enter on a row: open it (note → open; folder/dest → toggle+select). */
  onOpen: (row: RovingRow, newTab: boolean) => void;
  /** h / Esc: collapse this row if it can. Return true when something was
   * collapsed (we consume the key); return false at the root (nothing to
   * collapse) so Esc bubbles to the global app.hide. */
  onCollapseOrOut: (row: RovingRow) => boolean;
  /** "/" — jump to the filter input. */
  onFocusFilter: () => void;
  /** "m" — open the row's context menu anchored to its element. */
  onOpenMenu: (row: RovingRow, anchor: HTMLElement) => void;
}

export interface UseRovingList {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  rowProps: (row: RovingRow) => RovingRowProps;
  /** Focus the active row's element (or the first row if the active one is
   * gone) — the filter input's Esc uses this to return the cursor to the list
   * without the caller needing the internal ref map. */
  focusActive: () => void;
}

export function useRovingList(rows: RovingRow[], opts: UseRovingListOpts): UseRovingList {
  // the keyboard cursor: which row owns tabIndex=0 and gets .focus() on a move.
  const [activeId, setActiveId] = useState<string | null>(rows[0]?.id ?? null);
  // live element refs, keyed by row id — the Map is how a move .focus()es the
  // freshly-active row without a re-render round-trip.
  const refs = useRef<Map<string, HTMLElement>>(new Map());
  // opts can change identity each render (inline closures from the Sidebar);
  // park them in a ref so the row handlers stay referentially stable.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // latest activeId + rows for focusActive (a stable callback that must read
  // current values without re-subscribing).
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Clamp when the visible rows shrink/shift (filter typed, note trashed, a
  // dest collapsed): if the active row vanished, fall back to the first row so
  // the list never points at a gone element. Also seed the first active row
  // once rows first arrive.
  useEffect(() => {
    setActiveId((current) => {
      if (current && rows.some((r) => r.id === current)) return current;
      return rows[0]?.id ?? null;
    });
  }, [rows]);

  /** Move the cursor by ±1 within the current order and focus the new row. */
  const move = useCallback(
    (delta: 1 | -1, fromId: string) => {
      const index = rows.findIndex((r) => r.id === fromId);
      if (index === -1) return;
      const next = rows[index + delta];
      if (!next) return; // clamp at the ends — no wrap
      setActiveId(next.id);
      refs.current.get(next.id)?.focus();
    },
    [rows],
  );

  const rowProps = useCallback(
    (row: RovingRow): RovingRowProps => ({
      // exactly one tabIndex=0 (the active row) — one Tab stop for the list
      tabIndex: row.id === activeId ? 0 : -1,
      role: "option",
      "aria-selected": row.id === activeId,
      ref: (el: HTMLElement | null) => {
        if (el) refs.current.set(row.id, el);
        else refs.current.delete(row.id);
      },
      // clicking/focusing a row makes it the cursor too — mouse and keyboard
      // share one active row
      onFocus: () => setActiveId(row.id),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        // let real chords (⌘K, ⌃…, ⌥…) fall through to the global dispatcher —
        // we only own bare keys here
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const o = optsRef.current;
        // every key we OWN beats the global bare-key rule: preventDefault +
        // stopPropagation so the registry's window listener never sees it
        const consume = () => {
          event.preventDefault();
          event.stopPropagation();
        };
        switch (event.key) {
          case "j":
          case "ArrowDown":
            consume();
            move(1, row.id);
            return;
          case "k":
          case "ArrowUp":
            consume();
            move(-1, row.id);
            return;
          case "l":
          case "Enter":
            consume();
            o.onOpen(row, false);
            return;
          case "/":
            consume();
            o.onFocusFilter();
            return;
          case "m":
            consume();
            o.onOpenMenu(row, event.currentTarget);
            return;
          case "h":
          case "Escape":
            // collapse if there's anything to collapse; if so, consume. At the
            // root (nothing nested under the cursor) DO NOT stop — let Escape
            // bubble to the registry's app.hide so the quokka rule still hides
            // the window. (h at the root simply does nothing.)
            if (o.onCollapseOrOut(row)) {
              consume();
            }
            return;
          default:
            return; // every other key types/bubbles untouched
        }
      },
    }),
    [activeId, move],
  );

  const focusActive = useCallback(() => {
    const id = activeIdRef.current;
    const fallback = rowsRef.current[0]?.id;
    const target = id && refs.current.has(id) ? id : fallback;
    if (target) refs.current.get(target)?.focus();
  }, []);

  return { activeId, setActiveId, rowProps, focusActive };
}
