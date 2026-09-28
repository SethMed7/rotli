// Where the sidebar sits (split out of ui.ts, 2026-09-27, which sits at its
// size ceiling).

/** Which edge the ONE sidebar lives on (the owner, 2026-09-17). */
export const SIDEBAR_SIDES = ["left", "right"] as const;
export type SidebarSide = (typeof SIDEBAR_SIDES)[number];
/** Pinned in the flow, or out of the way until the pointer reaches the edge. */
export const SIDEBAR_REVEALS = ["pinned", "hover"] as const;
export type SidebarReveal = (typeof SIDEBAR_REVEALS)[number];
