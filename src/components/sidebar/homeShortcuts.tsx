// The rows at the top of Home: the activity overview card, All notes,
// Captures and Tasks (split out of sidebarHome.tsx, 2026-09-28, so each can be
// hidden from Settings → Appearance → Show in Rotli; src/lib/hideable.ts).

import { dispatch } from "../../keys/registry";
import type { Hidden } from "../../lib/hideable";
import { DEST } from "../../services/destinations";
import { useFrontOn } from "../../state/fronts";
import { useHidden } from "../../state/hidden";
import { ALL_NOTES, TASKS, useUiStore } from "../../state/ui";
import { FileGlyph, TaskGlyph } from "../glyphs";
import type { homeDashboardSnapshot } from "./homeDashboardModel";
import { OverviewCard } from "./overviewCard";
import type { RovingRow, RovingRowProps } from "./useRovingList";

/** Capture-board glyph — a 2×2 grid of cards (the quick-capture Board button).
 * Named distinctly from the imported CanvasItemGlyph (the .excalidraw board icon)
 * so the two never get crossed. Same stroke/viewBox grammar as the family. */
function CaptureBoardGlyph({ size = 16 }: { size?: number }) {
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
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** The rows the keyboard walks, in the order they show, minus hidden ones. */
export function shownShortcuts(hidden: Hidden, capturesRow: string): RovingRow[] {
  return [
    ...(hidden.allNotes ? [] : [{ id: ALL_NOTES, kind: "smart" as const }]),
    ...(hidden.captures ? [] : [{ id: capturesRow, kind: "smart" as const }]),
    ...(hidden.tasks ? [] : [{ id: TASKS, kind: "smart" as const }]),
  ];
}

export function HomeShortcuts({
  dashboard,
  counts,
  here,
  capturesRow,
  rowFor,
}: {
  dashboard: ReturnType<typeof homeDashboardSnapshot>;
  counts: { allNotes: number; captures: number; tasks: number };
  here: string | null;
  capturesRow: string;
  rowFor: (row: RovingRow) => RovingRowProps;
}) {
  const hidden = useHidden((s) => s.hidden);
  const chatOn = useFrontOn("chat");
  const contentView = useUiStore((s) => s.contentView);
  const dashboardSection = useUiStore((s) => s.dashboardSection);
  const setDashboardSection = useUiStore((s) => s.setDashboardSection);
  const setContentView = useUiStore((s) => s.setContentView);
  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  return (
    <>
      {!hidden.overview && (
        <OverviewCard
          label="Open Rotli activity dashboard"
          current={contentView === "dashboard" && dashboardSection === "rotli"}
          onOpen={() => {
            setDashboardSection("rotli");
            setContentView("dashboard");
          }}
          head={["This week", "Rotli activity"]}
          rows={[
            <>
              <strong>Notes</strong>
              <span>{dashboard.notes.newInRange} new</span>
              <span>{dashboard.notes.updatedInRange} updated</span>
            </>,
            // Chat turned off (Settings → Sidebar): no Chats row
            chatOn ? (
              <>
                <strong>Chats</strong>
                <span>{dashboard.chat.activeInRange} active</span>
                <span>{dashboard.chat.total} saved</span>
              </>
            ) : undefined,
          ]}
        />
      )}
      {!hidden.allNotes && (
        <button
          type="button"
          className={`frow${contentView === "allNotes" ? " sel" : ""}`}
          onClick={() => {
            setSelectedFolderId(ALL_NOTES);
            setContentView("allNotes");
          }}
          {...rowFor({ id: ALL_NOTES, kind: "smart" })}
        >
          <FileGlyph size={14.5} />
          <span className="fname">All notes</span>
          {counts.allNotes > 0 && <span className="count">{counts.allNotes}</span>}
        </button>
      )}
      {/* Captures — quick captures collected as cards; opens its grid in the
          content area (an action row, not a roving folder). */}
      {!hidden.captures && (
        <button
          type="button"
          className={`frow${contentView === "board" || here === DEST.board ? " sel" : ""}`}
          aria-current={here === DEST.board ? "location" : undefined}
          onClick={() => dispatch("board.open")}
          {...rowFor({ id: capturesRow, kind: "smart" })}
        >
          <CaptureBoardGlyph size={14.5} />
          <span className="fname">Captures</span>
          {counts.captures > 0 && <span className="count">{counts.captures}</span>}
        </button>
      )}
      {/* Tasks — every open checkbox across your notes, one view
          (decision 2026-07-25). The count is OPEN tasks, not notes. */}
      {!hidden.tasks && (
        <button
          type="button"
          className={`frow${contentView === "tasks" ? " sel" : ""}`}
          onClick={() => {
            setSelectedFolderId(TASKS);
            setContentView("tasks");
          }}
          {...rowFor({ id: TASKS, kind: "smart" })}
        >
          <TaskGlyph size={14.5} />
          <span className="fname">Tasks</span>
          {counts.tasks > 0 && <span className="count">{counts.tasks}</span>}
        </button>
      )}
    </>
  );
}
