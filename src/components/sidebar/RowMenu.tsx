// The sidebar row context menu (Seth, 2026-06-13): a small popover anchored to
// a focused note row, opened by "m" (useRovingList) or — later — a right-click.
// It mirrors the FormatBar's .fbmenu role=menu pattern: a vertical list of
// menuitems, Arrow/Enter to navigate+run, and useTransientPopover so Esc closes
// it via the ui store's transient stack (before app.hide) and an outside click
// dismisses it. On close, focus returns to the anchor row — the keyboard never
// gets stranded.
//
// Only NOTE rows get the full menu (Open in new tab + the lifecycle actions);
// the Sidebar simply doesn't open a menu for folder/smart rows, so this
// component always renders a note menu. A normal note offers Archive + Move to
// Trash; a hidden-root note (already in Archive/Trash) offers Restore instead —
// the same split the compact-row hover affordances use. The mutation hooks are
// passed in already-bound so this stays a pure-ish leaf.

import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { useTransientPopover } from "../../lib/popover";
import { usePanesStore } from "../../state/panes";
import {
  useArchiveNote,
  useRestoreNote,
  useTrashNote,
} from "../../services/hooks";
import { ArchiveGlyph, TrashGlyph } from "../glyphs";

/** Open-in-new-tab glyph: a small tab-with-plus mark (Seth, 2026-06-13). Local
 * to this menu — same 1.7-stroke / 24-viewBox grammar as the shared Glyph helper
 * so it reads as one family; lives here, not in glyphs.tsx, since the row menu
 * is the only place it appears and this phase touches sidebar files only. */
function NewTabGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h6l2 2h6a0 0 0 0 1 0 0" />
      <path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" />
      <path d="M16 11v6M13 14h6" />
    </svg>
  );
}

/** Restore glyph: a counter-clockwise arc arrow — "put it back" (matches the
 * Sidebar's local RestoreGlyph; kept local to the sidebar files). */
function RestoreGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9a8 8 0 1 1-1.5 5" />
      <path d="M4 4v5h5" />
    </svg>
  );
}

interface MenuItem {
  label: string;
  glyph: ReactNode;
  run: () => void;
}

export function RowMenu({
  noteId,
  hidden,
  anchor,
  onClose,
}: {
  noteId: string;
  /** True when the note lives in Archive/Trash (a hidden root) → show Restore
   * instead of Archive + Move to Trash. */
  hidden: boolean;
  /** The row element the menu hangs off — positioned just below it, and the
   * focus target when the menu closes. */
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement>(anchor);
  anchorRef.current = anchor;
  // Esc closes via the transient stack (before app.hide); outside-click too.
  useTransientPopover([menuRef, anchorRef], true, onClose);

  const openNote = usePanesStore((s) => s.openNote);
  const archiveNote = useArchiveNote();
  const trashNote = useTrashNote();
  const restoreNote = useRestoreNote();

  // run the action, then close — onClose hands focus back to the row, so the
  // keyboard cursor never strands (the Sidebar's onClose refocuses the anchor).
  const closeAndRun = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const items: MenuItem[] = [
    {
      label: "Open in new tab",
      glyph: <NewTabGlyph size={16} />,
      run: () => openNote(noteId, { newTab: true }),
    },
    ...(hidden
      ? [
          {
            label: "Restore",
            glyph: <RestoreGlyph size={16} />,
            run: () => restoreNote.mutate(noteId),
          },
        ]
      : [
          {
            label: "Archive",
            glyph: <ArchiveGlyph size={16} />,
            run: () => archiveNote.mutate(noteId),
          },
          {
            label: "Move to Trash",
            glyph: <TrashGlyph size={16} />,
            run: () => trashNote.mutate(noteId),
          },
        ]),
  ];

  // anchor the popover just under its row, clamped into the sidebar. Positioned
  // on mount from the anchor's box (the menu is fixed-positioned so it escapes
  // the sidebar's overflow-y:auto clip).
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = anchorRef.current.getBoundingClientRect();
    el.style.top = `${rect.bottom + 4}px`;
    el.style.left = `${rect.left}px`;
    // focus the first item so Arrow/Enter work immediately
    el.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }, []);

  // Arrow/Enter navigation, mirroring the .fbmenu menuitem pattern.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      buttons[Math.max(index - 1, 0)]?.focus();
    }
    // Enter/Space fall through to the focused button's onClick; Esc is handled
    // by the transient stack (no local listener needed).
  };

  return (
    <div className="rowmenu" ref={menuRef} role="menu" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          className="rowmenu-item"
          role="menuitem"
          onClick={closeAndRun(item.run)}
        >
          <span className="rowmenu-glyph">{item.glyph}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
