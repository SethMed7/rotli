// App settings kept outside persist.ts (which sits at its size ceiling): each
// is one key in the app settings file on this Mac, with its own store and its
// own tolerant parser. persist.ts calls these three at its load, save, and
// subscribe points.

import { parseAmbient } from "../lib/ambient";
import { parseHidden } from "../lib/hideable";
import { useAmbient } from "./ambient";
import { useHidden } from "./hidden";

/** Load every extra from the app settings file's text. */
export function hydrateAppExtras(appSettings: string): void {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(appSettings);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    // unreadable: every extra is its default
  }
  useAmbient.setState({ prefs: parseAmbient(data.ambient) });
  useHidden.setState({ hidden: parseHidden(data.hidden) });
}

/** The extras' keys, for the app settings file. */
export function appExtrasSnapshot(): { ambient: unknown; hidden: unknown } {
  return { ambient: useAmbient.getState().prefs, hidden: useHidden.getState().hidden };
}

/** Save when any extra changes. */
export function subscribeAppExtras(save: () => void): () => void {
  const stops = [useAmbient.subscribe(save), useHidden.subscribe(save)];
  return () => stops.forEach((stop) => stop());
}
