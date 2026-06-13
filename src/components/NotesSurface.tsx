// The Notes three-pane surface: folders rail · note list · pane tree.
// Collapse grammar (r3 frame B): a hidden rail leaves a warm-edge hover
// sliver; hovering it reveals the hidden rail(s) as an overlay — no layout
// shift. Rails are drag-resizable on their right edge (Seth, 2026-06-12);
// widths persist via .rotli/settings.json.

import { type CSSProperties, type PointerEvent, useState } from "react";
import { useNotes } from "../services/hooks";
import { useUiStore } from "../state/ui";
import { EmptyState } from "./EmptyState";
import { FoldersRail } from "./FoldersRail";
import { NoteList } from "./NoteList";
import { PaneTree } from "./PaneTree";

/** Drag grip on a rail's right edge — same pointer grammar as the pane
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
  const foldersCollapsed = useUiStore((s) => s.foldersCollapsed);
  const listCollapsed = useUiStore((s) => s.listCollapsed);
  const foldersWidth = useUiStore((s) => s.foldersWidth);
  const setFoldersWidth = useUiStore((s) => s.setFoldersWidth);
  const listWidth = useUiStore((s) => s.listWidth);
  const setListWidth = useUiStore((s) => s.setListWidth);
  const [revealed, setRevealed] = useState(false);
  const anyCollapsed = foldersCollapsed || listCollapsed;
  const allNotes = useNotes().data;

  // no notes at all → the island empty state (r1 frame E), nothing else
  if (allNotes && allNotes.length === 0) return <EmptyState />;

  // the warm edge sits where the hidden rail would begin
  const edgeLeft = foldersCollapsed ? 0 : foldersWidth;
  const railVars = {
    "--folders-w": `${foldersWidth}px`,
    "--list-w": `${listWidth}px`,
  } as CSSProperties;

  return (
    <div className="threepane" style={railVars}>
      {!foldersCollapsed && (
        <div className="rail-wrap">
          <FoldersRail />
          <RailGrip width={foldersWidth} onResize={setFoldersWidth} />
        </div>
      )}
      {!listCollapsed && (
        <div className="rail-wrap">
          <NoteList />
          <RailGrip width={listWidth} onResize={setListWidth} />
        </div>
      )}
      <PaneTree />
      {anyCollapsed && (
        // hover-reveal zone (pointer affordance, not a command — no registry)
        <div
          className="warm-edge"
          style={{ left: edgeLeft }}
          onMouseEnter={() => setRevealed(true)}
          onMouseLeave={() => setRevealed(false)}
        >
          <span className="edgehint" aria-hidden="true" />
          {revealed && (
            <div className="rail-overlay">
              {foldersCollapsed && <FoldersRail />}
              {listCollapsed && <NoteList />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
