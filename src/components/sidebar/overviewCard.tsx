// The activity overview card at the top of a sidebar front: Home's "This week
// · Rotli activity" and Chat's "7 days · Model usage". One shape for both
// (2026-09-28); either can be hidden (Settings → Appearance → Show in Rotli).

import type { ReactNode } from "react";

export function OverviewCard({
  variant = "",
  label,
  current,
  onOpen,
  head,
  rows,
}: {
  /** An extra class for the card's own look ("sb-model-dashboard"). */
  variant?: string;
  label: string;
  /** Its dashboard is the page showing. */
  current: boolean;
  onOpen: () => void;
  head: readonly [string, string];
  /** The rows' cells; the second (chat) row takes the chat tint, and is left
   * out when Chat is turned off (Settings → Sidebar). */
  rows: readonly [ReactNode, ReactNode?];
}) {
  return (
    <button
      type="button"
      className={`sb-home-dashboard${variant ? ` ${variant}` : ""}${current ? " sel" : ""}`}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
    >
      <div className="sb-home-dashboard-head">
        <span>{head[0]}</span>
        <span>{head[1]}&nbsp; ↗</span>
      </div>
      <div className="sb-home-dashboard-row">{rows[0]}</div>
      {rows[1] !== undefined && <div className="sb-home-dashboard-row chat">{rows[1]}</div>}
    </button>
  );
}
