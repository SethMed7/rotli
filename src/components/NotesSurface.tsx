// The Notes surface: ONE sidebar · the pane tree (Seth, 2026-06-13). The
// two-rail era (folders + note list) is gone — a single unified compact-tree
// sidebar replaces both. Collapse grammar (r3 frame B) survives intact: a
// hidden sidebar leaves a warm-edge hover sliver that reveals it as an overlay
// (no layout shift) and is ALSO a clickable restore strip running the unified
// sidebar toggle. The sidebar is drag-resizable on its right edge; its width
// persists via .rotli/settings.json.

import { type CSSProperties, type PointerEvent, useState } from "react";
import { useNotes } from "../services/hooks";
import { DEST } from "../services/destinations";
import { useUiStore } from "../state/ui";
import { EmptyState } from "./EmptyState";
import { Sidebar } from "./Sidebar";
import { PaneTree } from "./PaneTree";
import { dispatch } from "../keys/registry";
import { SidebarGlyph } from "./glyphs";

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
  return (
    <div
      className="railgrip"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    />
  );
}

export function NotesSurface() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const [revealed, setRevealed] = useState(false);
  const allNotes = useNotes().data;
  const archived = useNotes(DEST.archive).data;
  const trashed = useNotes(DEST.trash).data;

  // the island empty state (r1 frame E) shows ONLY when the corpus is TRULY
  // empty. If anything sits in Archive/Trash, keep the sidebar so those notes
  // stay reachable and restorable — never strand them behind the empty state
  // (Seth, 2026-06-13).
  if (
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
      <PaneTree />
      {sidebarCollapsed && (
        // hover reveals the hidden sidebar; click restores it
        <div
          className="warm-edge"
          style={{ left: 0 }}
          onMouseEnter={() => setRevealed(true)}
          onMouseLeave={() => setRevealed(false)}
        >
          {/* the strip itself is the restore button (a sibling of the overlay,
              so overlay clicks never bubble into restore) */}
          <button
            type="button"
            className="edge-restore"
            aria-label="Show sidebar"
            onClick={() => dispatch("chrome.toggleSidebars")}
          >
            <span className="edgehint" aria-hidden="true" />
            <span className="edge-glyph" aria-hidden="true">
              <SidebarGlyph size={14} />
            </span>
          </button>
          {revealed && (
            <div className="rail-overlay">
              <Sidebar />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
