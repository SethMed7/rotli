// The SYSTEM zone — app-managed surfaces (Library · Assets · Archive · Trash)
// plus any added external folders. Still pinned to the sidebar's bottom, still
// outside the scrolling body, but COLLAPSIBLE since 2026-08-01 (Seth: "allow me
// to collapse the system area just to clean up the sidebar more"). It belongs
// to the HOME front: every row here is a store of notes and files, and a chat
// is filed into none of them (docs/design/sidebar-home-chat.md).
//
// The rows are NOT dropdowns — each opens the Finder-style browser on the
// right, where a real file view belongs. No create affordances (external
// folders connect from Location settings).

import { useState } from "react";

import { type CorpusRoot, corpusForgetFolder } from "../../lib/tauri";
import { type Destination, DEST } from "../../services/destinations";
import { useNotes } from "../../services/hooks";
import { openSystemRoot } from "../../services/systemNav";
import { useFocusedNoteId, usePanesStore } from "../../state/panes";
import { SEC_SYSTEM, useUiStore } from "../../state/ui";
import type { NoteSummary } from "../../types";
import { ChevronRight, FolderGlyph, InboxGlyph, NotesStackGlyph, glyphForNote } from "../glyphs";
import type { useRovingList } from "./useRovingList";

/** Trash rows at or past this count wear the alert badge — a quiet "worth
 * emptying" nudge, never a modal (Seth, 2026-07-31). */
const TRASH_NUDGE_AT = 40;

export interface SystemDestRow {
  id: Destination;
  label: string;
  Glyph: typeof InboxGlyph;
}

/** A top-level row for an ADDED external folder (Seth, 2026-06-27): a folder you
 * pointed rotli at without moving it into the memex. Self-contained (its own
 * useNotes over the root marker) so the zone can render N of them via
 * roots.map without breaking rules-of-hooks — the set is fixed per session (adding
 * or removing a folder relaunches). Expand to browse its notes; the × on hover
 * forgets the binding (a two-click confirm; the files on disk are never touched). */
function AddedRootRow({ root }: { root: CorpusRoot }) {
  const notes = useNotes(`${root.id}:`).data ?? [];
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const openNote = usePanesStore((s) => s.openNote);
  const focusedNoteId = useFocusedNoteId();
  return (
    <div>
      <button type="button" className="frow" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
          <ChevronRight size={10} />
        </span>
        <FolderGlyph size={14.5} />
        <span className="fname" title={root.absPath}>
          {root.label}
        </span>
        <span
          role="button"
          tabIndex={0}
          className={confirming ? "sb-root-x confirm" : "sb-root-x"}
          aria-label={confirming ? "Confirm remove folder" : "Remove this folder"}
          title="Remove this folder from rotli (the files are kept)"
          onClick={(e) => {
            e.stopPropagation();
            if (confirming)
              void corpusForgetFolder(root.id); // relaunches
            else setConfirming(true);
          }}
          onKeyDown={(e) => {
            // role="button" spans get no synthetic click from Enter/Space
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.click();
            }
          }}
        >
          {confirming ? "Remove?" : "×"}
        </span>
        <span className="count">{notes.length}</span>
      </button>
      {open &&
        notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={n.id === focusedNoteId ? "snrow sel" : "snrow"}
            style={{ paddingLeft: 44 }}
            onClick={(e) => openNote(n.id, { newTab: e.metaKey })}
          >
            {glyphForNote(n, { size: 14, className: "snicon" })}
            <span className="snt">{n.title || "Empty note"}</span>
          </button>
        ))}
      {open && notes.length === 0 && (
        <div className="sb-empty" style={{ paddingLeft: 44 }}>
          No notes in this folder yet.
        </div>
      )}
    </div>
  );
}

export function SidebarSystem({
  open,
  hasBrain,
  brainCount,
  destRows,
  notesByDest,
  addedRoots,
  brainEnabled,
  rowProps,
  zoom,
}: {
  open: boolean;
  hasBrain: boolean;
  brainCount: number;
  destRows: SystemDestRow[];
  notesByDest: Record<string, NoteSummary[]>;
  addedRoots: CorpusRoot[];
  brainEnabled: boolean;
  /** The Home front's roving list — System rows join it while the zone is
   * open, and drop out of it while it is folded, exactly like a folder. */
  rowProps: ReturnType<typeof useRovingList>["rowProps"];
  zoom: number;
}) {
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const contentView = useUiStore((s) => s.contentView);
  const systemRoot = useUiStore((s) => s.systemRoot);
  return (
    <div className="sb-system" style={{ zoom }}>
      {/* the zone header is a disclosure now (Seth, 2026-08-01) — the ⌄
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
          {hasBrain && (
            <button
              type="button"
              className={`frow${contentView === "system" && systemRoot === "Brain" ? " sel" : ""}`}
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
          )}
          {destRows.map(({ id, label, Glyph }) => {
            const destNotes = notesByDest[id] ?? [];
            const selected = contentView === "system" && systemRoot === id;
            // a piled-up Trash earns the alert badge (Seth, 2026-07-31) — the
            // browser's Empty Trash… is one click behind it
            const trashFull = id === DEST.trash && destNotes.length >= TRASH_NUDGE_AT;
            return (
              <button
                key={id}
                type="button"
                className={`frow${selected ? " sel" : ""}`}
                title={
                  trashFull ? `${destNotes.length} items — open Trash to review and empty it` : undefined
                }
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
          {/* added external folders (Seth, 2026-06-27): folders you point rotli at
              without moving them into the memex — browse + edit in place.
              Adding one moved to Location settings (2026-07-26). */}
          {addedRoots.length > 0 && <div className="fsec">Folders</div>}
          {addedRoots.map((r) => (
            <AddedRootRow key={r.id} root={r} />
          ))}
        </>
      )}
    </div>
  );
}
