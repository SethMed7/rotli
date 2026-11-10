import type { CSSProperties } from "react";

// The wash starts a little before the icon, preserving nesting at every depth.
export const ROW_INSET_LEAD = 8;

export function rowInset(paddingLeft: number, inset: number): CSSProperties {
  return { paddingLeft, "--row-inset": `${Math.max(0, inset)}px` } as CSSProperties;
}
