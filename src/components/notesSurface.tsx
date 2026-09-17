import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
// The Notes surface: ONE sidebar · the pane tree (the maintainer, 2026-06-13). The
// two-rail era (folders + note list) is gone — a single unified compact-tree
// sidebar replaces both. Collapse grammar (r3 frame B) survives intact: a
// hidden sidebar leaves a warm-edge hover sliver that reveals it as an overlay
// (no layout shift) and is ALSO a clickable restore strip running the unified
// sidebar toggle. The sidebar is drag-resizable on its right edge; its width
// persists via .rotli/settings.json.
import { Suspense, lazy } from "react";

import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { DEST } from "../services/destinations";
import { useNotes } from "../services/hooks";
import { leaves, usePanesStore } from "../state/panes";
import { type SidebarSide, useUiStore } from "../state/ui";
import { AllChatsSurface } from "./allChatsSurface";
import { BoardSurface } from "./boardSurface";
import { DashboardSurface } from "./dashboardSurface";
import { EmptyState } from "./emptyState";
import { ClockGlyph } from "./glyphs";
import { NoteListSurface } from "./noteListSurface";
import { PaneTree } from "./paneTree";
import { Sidebar } from "./sidebar";
import { SidebarHoverRail } from "./sidebar/sidebarHoverRail";
import { SystemSurface } from "./systemSurface";
import { TasksSurface } from "./tasksSurface";

// Breve is a whole product surface most note sessions never enter — split it
// off the entry chunk like paneTree's CanvasSurface (perf audit 2026-07-30, #18)
const BreveSurface = lazy(() => import("./breve/breveSurface").then((m) => ({ default: m.BreveSurface })));

/** Drag grip on the sidebar's right edge — same pointer grammar as the pane
 * dividers (8px hit zone, cocoa-tinted line while dragging, never clay). */
function RailGrip({
  width,
  side,
  onResize,
}: {
  width: number;
  side: SidebarSide;
  onResize: (px: number) => void;
}) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    grip.classList.add("dragging");
    grip.setPointerCapture(event.pointerId);
    // on the right edge the grip sits on the rail's LEFT: dragging left widens
    const sign = side === "right" ? -1 : 1;
    const onMove = (e: globalThis.PointerEvent) => onResize(startWidth + sign * (e.clientX - startX));
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
  const sidebarSide = useUiStore((s) => s.sidebarSide);
  const sidebarReveal = useUiStore((s) => s.sidebarReveal);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const contentView = useUiStore((s) => s.contentView);
  const systemRoot = useUiStore((s) => s.systemRoot);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const allNotes = useNotes().data;
  const hasPaneContent = usePanesStore((s) =>
    leaves(s.root).some((leaf) => leaf.tabs.some((tab) => tab.surfaceKind !== "note" || Boolean(tab.noteId))),
  );
  const archived = useNotes(DEST.archive).data;
  const trashed = useNotes(DEST.trash).data;

  const notesLoaded = Boolean(allNotes && archived && trashed);
  const vaultIsEmpty =
    notesLoaded &&
    (allNotes?.length ?? 0) === 0 &&
    (archived?.length ?? 0) === 0 &&
    (trashed?.length ?? 0) === 0;

  const railVars = { "--sidebar-w": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className="threepane" style={railVars} data-sidebar-side={sidebarSide}>
      {/* the sidebar's edge and reveal are the owner's (2026-09-17): pinned in
          the flow on either side, or a hover overlay off the window's edge */}
      {sidebarReveal === "hover" ? (
        <SidebarHoverRail side={sidebarSide} />
      ) : (
        !sidebarCollapsed && (
          <div className="rail-wrap">
            <Sidebar />
            <RailGrip width={sidebarWidth} side={sidebarSide} onResize={setSidebarWidth} />
          </div>
        )
      )}
      {/* the content area: the note panes, or a grid view (Board / All notes)
          that renders HERE so the sidebar never moves (the maintainer, 2026-06-24) */}
      {LAUNCH_FEATURES.breve && sidebarMode === "breve" ? (
        <Suspense fallback={null}>
          <BreveSurface />
        </Suspense>
      ) : contentView === "board" ? (
        <BoardSurface />
      ) : contentView === "dashboard" ? (
        <DashboardSurface />
      ) : contentView === "allNotes" ? (
        <NoteListSurface title="All notes" searchable searchPlaceholder="Search all notes…" />
      ) : contentView === "allChats" ? (
        <AllChatsSurface />
      ) : contentView === "tasks" ? (
        <TasksSurface />
      ) : contentView === "system" && systemRoot ? (
        <SystemSurface key={systemRoot} rootId={systemRoot} />
      ) : contentView === "recent" ? (
        <NoteListSurface title="Recent" glyph={<ClockGlyph size={15} />} />
      ) : vaultIsEmpty && !hasPaneContent ? (
        <EmptyState />
      ) : (
        <PaneTree />
      )}
      {/* collapsed → no warm-edge sliver (the maintainer, 2026-06-15: it was an unclear,
          disliked line). The titlebar's always-visible sidebar toggle is the
          clear reopen now. */}
    </div>
  );
}
