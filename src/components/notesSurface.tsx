// The Notes surface: ONE sidebar · the pane tree (Seth, 2026-06-13). The
// two-rail era (folders + note list) is gone — a single unified compact-tree
// sidebar replaces both. Collapse grammar (r3 frame B) survives intact: a
// hidden sidebar leaves a warm-edge hover sliver that reveals it as an overlay
// (no layout shift) and is ALSO a clickable restore strip running the unified
// sidebar toggle. The sidebar is drag-resizable on its right edge; its width
// persists via .rotli/settings.json.

import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { useNotes } from "../services/hooks";
import { DEST } from "../services/destinations";
import { useUiStore } from "../state/ui";
import { AllChatsSurface } from "./allChatsSurface";
import { BoardSurface } from "./boardSurface";
import { EmptyState } from "./emptyState";
import { ClockGlyph } from "./glyphs";
import { NoteListSurface } from "./noteListSurface";
import { Sidebar } from "./sidebar";
import { PaneTree } from "./paneTree";
import { BreveSurface } from "./breve/breveSurface";

/** Drag grip on the sidebar's right edge — same pointer grammar as the pane
 * dividers (8px hit zone, cocoa-tinted line while dragging, never clay). */
function RailGrip({ width, onResize }: { width: number; onResize: (px: number) => void }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    grip.classList.add("dragging");
    grip.setPointerCapture(event.pointerId);
    const onMove = (e: globalThis.PointerEvent) => onResize(startWidth + (e.clientX - startX));
    const end = () => {
      grip.classList.remove("dragging");
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") onResize(width - step);
    else if (event.key === "ArrowRight") onResize(width + step);
    else if (event.key === "Home") onResize(190);
    else if (event.key === "End") onResize(460);
    else return;
    event.preventDefault();
  };
  return (
    <div
      className="railgrip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={190}
      aria-valuemax={460}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

export function NotesSurface() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const contentView = useUiStore((s) => s.contentView);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const allNotes = useNotes().data;
  const archived = useNotes(DEST.archive).data;
  const trashed = useNotes(DEST.trash).data;

  // the island empty state (r1 frame E) shows ONLY when the corpus is TRULY
  // empty. If anything sits in Archive/Trash, keep the sidebar so those notes
  // stay reachable and restorable — never strand them behind the empty state
  // (Seth, 2026-06-13).
  if (
    sidebarMode === "notes" &&
    allNotes &&
    archived &&
    trashed &&
    allNotes.length === 0 &&
    archived.length === 0 &&
    trashed.length === 0
  ) {
    return <EmptyState />;
  }

  const railVars = { "--sidebar-w": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className="threepane" style={railVars}>
      {!sidebarCollapsed && (
        <div className="rail-wrap">
          <Sidebar />
          <RailGrip width={sidebarWidth} onResize={setSidebarWidth} />
        </div>
      )}
      {/* the content area: the note panes, or a grid view (Board / All notes)
          that renders HERE so the sidebar never moves (Seth, 2026-06-24) */}
      {sidebarMode === "breve" ? (
        <BreveSurface />
      ) : contentView === "board" ? (
        <BoardSurface />
      ) : contentView === "allNotes" ? (
        <NoteListSurface title="All notes" searchable searchPlaceholder="Search all notes…" />
      ) : contentView === "allChats" ? (
        <AllChatsSurface />
      ) : contentView === "recent" ? (
        <NoteListSurface title="Recent" glyph={<ClockGlyph size={15} />} />
      ) : (
        <PaneTree />
      )}
      {/* collapsed → no warm-edge sliver (Seth, 2026-06-15: it was an unclear,
          disliked line). The titlebar's always-visible sidebar toggle is the
          clear reopen now. */}
    </div>
  );
}
