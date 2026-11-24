// The section header Home's tree wears: the named view as ONE switcher —
// name + caret, uppercase — then quiet add buttons on the right. (The Chat
// front had its own view row until 2026-11-24; views are a Home feature now.)

import type { MouseEvent, ReactNode, RefObject } from "react";

import { ChevronRight } from "../glyphs";

interface HeaderAction {
  label: string;
  glyph: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** the guided tour's anchor, where it points at this control */
  tour?: string;
}

/** The section header both fronts wear (the owner, 2026-09-21: Chat "should
 * follow same style" as Home's MAIN): the view name as ONE switcher — name +
 * caret, uppercase — then quiet add buttons on the right. */
export function ViewSectionHeader({
  current,
  viewRef,
  onPickView,
  actions,
  groupLabel,
  tour = false,
}: {
  current: string;
  viewRef: RefObject<HTMLButtonElement | null>;
  onPickView: (event: MouseEvent<HTMLButtonElement>) => void;
  actions: HeaderAction[];
  groupLabel?: string;
  tour?: boolean;
}) {
  return (
    <div className="fsec fsec-hdr" {...(groupLabel ? { role: "group", "aria-label": groupLabel } : {})}>
      <button
        type="button"
        className="fsec-view"
        ref={viewRef}
        data-tour={tour ? "views" : undefined}
        title="Change view"
        aria-haspopup="menu"
        aria-label={`Current view: ${current}. Change view`}
        onClick={onPickView}
      >
        <span>{current}</span>
        <span className="caret-down" aria-hidden="true">
          <ChevronRight size={9} />
        </span>
      </button>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="fsec-add"
          data-tour={action.tour}
          aria-label={action.label}
          title={action.label}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.glyph}
        </button>
      ))}
    </div>
  );
}
