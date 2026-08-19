import type { Tab } from "../types";

/** Expensive surfaces stay mounted briefly after a tab switch so returning to
 * a chat, board, or rich file does not rebuild its editor and transcript on the
 * WebKit main thread. The cap keeps a long tab bar from becoming a hidden app. */
export const WARM_SURFACE_LIMIT = 3;

export function isWarmSurface(tab: Tab): boolean {
  return (
    tab.surfaceKind === "chat" ||
    tab.surfaceKind === "canvas" ||
    tab.surfaceKind === "file" ||
    tab.surfaceKind === "browser"
  );
}

export function nextWarmSurfaceIds(
  previous: readonly string[],
  active: Tab | null,
  tabs: readonly Tab[],
): string[] {
  const available = new Set(tabs.filter(isWarmSurface).map((tab) => tab.id));
  const recent = active && isWarmSurface(active) ? [active.id, ...previous] : [...previous];
  return [...new Set(recent)].filter((id) => available.has(id)).slice(0, WARM_SURFACE_LIMIT);
}
