// The SYSTEM zone is one stable set of app-managed surfaces: Library · Assets ·
// Archive · Trash. Switching vaults changes the rows' data, never their shape.
// It stays pinned below Home's scrolling body and can be collapsed as one zone.
//
// The rows are NOT dropdowns — each opens the Finder-style browser on the
// right, where a real file view belongs. No create affordances (external
// folders connect from Location settings).

import { type Destination, DEST } from "../../services/destinations";
import { openSystemRoot } from "../../services/systemNav";
import { SEC_SYSTEM, useUiStore } from "../../state/ui";
import type { NoteSummary } from "../../types";
import { ChevronRight, InboxGlyph, NotesStackGlyph } from "../glyphs";
import type { useRovingList } from "./useRovingList";

/** Trash rows at or past this count wear the alert badge — a quiet "worth
 * emptying" nudge, never a modal (the maintainer, 2026-07-31). */
const TRASH_NUDGE_AT = 40;

export interface SystemDestRow {
  id: Destination;
  label: string;
  Glyph: typeof InboxGlyph;
}

export function SidebarSystem({
  open,
  brainCount,
  destRows,
  notesByDest,
  brainEnabled,
  rowProps,
  zoom,
  here = null,
}: {
  open: boolean;
  brainCount: number;
  destRows: SystemDestRow[];
  notesByDest: Record<string, NoteSummary[]>;
  brainEnabled: boolean;
  /** The Home front's roving list — System rows join it while the zone is
   * open, and drop out of it while it is folded, exactly like a folder. */
  rowProps: ReturnType<typeof useRovingList>["rowProps"];
  zoom: number;
  /** The row the open note lives under when Main doesn't hold it. */
  here?: string | null;
}) {
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const contentView = useUiStore((s) => s.contentView);
  const systemRoot = useUiStore((s) => s.systemRoot);
  return (
    <div className="sb-system" style={{ zoom }}>
      {/* the zone header is a disclosure now (the maintainer, 2026-08-01) — the ⌄
          toolbar button's stage 2 folds it too */}
      <button
        type="button"
        className="sb-syshdr"
        aria-expanded={open}
        title={open ? "Hide the System area" : "Show the System area"}
        onClick={() => setDestExpanded(SEC_SYSTEM, !open)}
      >
        <span className="fsec">System</span>
        <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
          <ChevronRight size={11} />
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className={`frow${(contentView === "system" && systemRoot === "Brain") || here === "Brain" ? " sel" : ""}`}
            aria-current={here === "Brain" ? "location" : undefined}
            onClick={() => openSystemRoot("Brain")}
            title={
              brainEnabled
                ? "The Library — where the Librarian files everything"
                : "The Library — plain folders in this raw vault"
            }
            {...rowProps({ id: "Brain", kind: "folder" })}
          >
            <NotesStackGlyph size={14.5} />
            <span className="fname">Library</span>
            {brainCount > 0 && <span className="count">{brainCount}</span>}
          </button>
          {destRows.map(({ id, label, Glyph }) => {
            const destNotes = notesByDest[id] ?? [];
            const selected = (contentView === "system" && systemRoot === id) || here === id;
            // a piled-up Trash earns the alert badge (the maintainer, 2026-07-31) — the
            // browser's Empty Trash… is one click behind it
            const trashFull = id === DEST.trash && destNotes.length >= TRASH_NUDGE_AT;
            return (
              <button
                key={id}
                type="button"
                className={`frow${selected ? " sel" : ""}`}
                aria-current={here === id ? "location" : undefined}
                title={
                  trashFull ? `${destNotes.length} items — open Trash to review and empty it` : undefined
                }
                data-system-trash-drop={id === DEST.trash ? "1" : undefined}
                onClick={() => openSystemRoot(id)}
                {...rowProps({ id, kind: "folder" })}
              >
                <Glyph size={14.5} />
                <span className="fname">{label}</span>
                {destNotes.length > 0 && (
                  <span className={trashFull ? "count alert" : "count"}>{destNotes.length}</span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
