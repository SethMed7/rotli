import { memo } from "react";

import { SHOW_HOTKEYS } from "../../lib/hotkeyHint";
import { iconKind } from "../../lib/sidebarLook";
import { QUICK_MAX, togglePinQuick } from "../../state/quick";
import { useUiStore } from "../../state/ui";
import type { NoteSummary } from "../../types";
import { PinGlyph, StarGlyph } from "../glyphs";
import { glyphForNote } from "../noteGlyph";
import { MainSlotHint } from "./useHomeLeader";

// A tab switch changes two row highlights, not every note's label and glyph.
// React Compiler is lint-only; these stable leaves need an explicit boundary.
export const MainNoteLabel = memo(function MainNoteLabel({
  note,
  title,
  slot,
}: {
  note: NoteSummary;
  title: string;
  slot: number | undefined;
}) {
  return (
    <>
      {glyphForNote(note, { size: 14, className: `snicon kind-${iconKind(note)}` })}
      <span className="snt">{title}</span>
      {slot !== undefined && <MainSlotHint slot={slot} />}
      {note.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
    </>
  );
});

export const QuickAccessStar = memo(function QuickAccessStar({
  id,
  starred,
  full,
}: {
  id: string;
  starred: boolean;
  full: boolean;
}) {
  const label = starred
    ? "Unstar — remove from Quick access"
    : full
      ? `Quick access is full (${QUICK_MAX}) — unstar one first`
      : SHOW_HOTKEYS
        ? "Star for Quick access (the ⌥ Quick window)"
        : "Star for Quick access";
  return (
    <span
      role="button"
      tabIndex={0}
      className={`snactbtn mstar${starred ? " on" : ""}${full ? " full" : ""}`}
      aria-label={label}
      aria-pressed={starred}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        if (full) {
          useUiStore.getState().setRowActionError(`Quick access is full (${QUICK_MAX}) — unstar one first.`);
          return;
        }
        togglePinQuick(id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.click();
        }
      }}
    >
      <StarGlyph size={13} filled={starred} />
    </span>
  );
});
