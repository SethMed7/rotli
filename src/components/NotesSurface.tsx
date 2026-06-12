// The Notes three-pane surface: folders rail · note list · pane tree.
// Collapse grammar (r3 frame B): a hidden rail leaves a warm-edge hover
// sliver; hovering it reveals the hidden rail(s) as an overlay — no layout
// shift. State is remembered per window (ui store, in-memory).

import { useState } from "react";
import { useNotes } from "../services/hooks";
import { useUiStore } from "../state/ui";
import { EmptyState } from "./EmptyState";
import { FoldersRail } from "./FoldersRail";
import { NoteList } from "./NoteList";
import { PaneTree } from "./PaneTree";

const FOLDERS_RAIL_WIDTH = 198;

export function NotesSurface() {
  const foldersCollapsed = useUiStore((s) => s.foldersCollapsed);
  const listCollapsed = useUiStore((s) => s.listCollapsed);
  const [revealed, setRevealed] = useState(false);
  const anyCollapsed = foldersCollapsed || listCollapsed;
  const allNotes = useNotes().data;

  // no notes at all → the island empty state (r1 frame E), nothing else
  if (allNotes && allNotes.length === 0) return <EmptyState />;

  // the warm edge sits where the hidden rail would begin
  const edgeLeft = foldersCollapsed ? 0 : FOLDERS_RAIL_WIDTH;

  return (
    <div className="threepane">
      {!foldersCollapsed && <FoldersRail />}
      {!listCollapsed && <NoteList />}
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
