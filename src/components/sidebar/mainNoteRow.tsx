import { memo } from "react";

import type { NoteSummary } from "../../types";
import { MainNoteLabel, QuickAccessStar } from "./mainNoteLabel";
import { rowInset, ROW_INSET_LEAD } from "./mainRowStyle";
import type { RovingRowProps } from "./useRovingList";

// Focus and open-note changes affect at most two rows per commit. Keep the
// complete DOM row behind a stable boundary, including its roving callbacks.
export const MainNoteRow = memo(function MainNoteRow({
  note,
  parentId,
  title,
  slot,
  focused,
  gathered,
  dropClass,
  dragging,
  padding,
  starred,
  quickFull,
  ...roving
}: {
  note: NoteSummary;
  parentId: string;
  title: string;
  slot: number | undefined;
  focused: boolean;
  gathered: boolean;
  dropClass: string;
  dragging: boolean;
  padding: number;
  starred: boolean;
  quickFull: boolean;
} & RovingRowProps) {
  return (
    <div
      data-main-id={note.id}
      data-note-id={note.id}
      data-main-parent={parentId}
      data-main-slot={slot}
      className={`snrow main-row${focused ? " sel" : ""}${gathered ? " msel" : ""}${dropClass}${dragging ? " dragging" : ""}`}
      style={rowInset(padding, padding - ROW_INSET_LEAD)}
    >
      <button
        type="button"
        className="main-note-open"
        aria-current={focused ? "page" : undefined}
        {...roving}
      >
        <MainNoteLabel note={note} title={title} slot={slot} />
      </button>
      <QuickAccessStar id={note.id} starred={starred} full={quickFull} />
    </div>
  );
});
