import type { Tab } from "../types";

/** Expensive editing surfaces stay mounted briefly after a tab switch so
 * returning does not rebuild them on the WebKit main thread. Browser tabs are
 * different: their native webview owns session-only cookies and history, so an
 * open browser tab stays mounted until that tab actually closes. */
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
  const browserIds = new Set(tabs.filter((tab) => tab.surfaceKind === "browser").map((tab) => tab.id));
  const recentUnique = [...new Set(recent)].filter((id) => available.has(id));
  const retainedBrowsers = recentUnique.filter((id) => browserIds.has(id));
  const remainingBrowsers = tabs
    .filter((tab) => tab.surfaceKind === "browser" && !retainedBrowsers.includes(tab.id))
    .map((tab) => tab.id);
  const retainedHeavy = recentUnique.filter((id) => !browserIds.has(id)).slice(0, WARM_SURFACE_LIMIT);
  return [...retainedBrowsers, ...remainingBrowsers, ...retainedHeavy];
}
