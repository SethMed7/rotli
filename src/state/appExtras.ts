// App settings kept outside persist.ts (which sits at its size ceiling): each
// is one key in the app settings file on this Mac, with its own store and its
// own tolerant parser. persist.ts calls these three at its load, save, and
// subscribe points.

import { parseAmbient } from "../lib/ambient";
import { parseHidden } from "../lib/hideable";
import { parseFronts } from "../lib/sidebarFronts";
import { useAmbient } from "./ambient";
import { useFronts } from "./fronts";
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
  useFronts.setState({ prefs: parseFronts(data.sidebarFronts) });
}

/** The extras' keys, for the app settings file. */
export function appExtrasSnapshot(): { ambient: unknown; hidden: unknown; sidebarFronts: unknown } {
  return {
    ambient: useAmbient.getState().prefs,
    hidden: useHidden.getState().hidden,
    sidebarFronts: useFronts.getState().prefs,
  };
}

/** Save when any extra changes. */
export function subscribeAppExtras(save: () => void): () => void {
  const stops = [useAmbient.subscribe(save), useHidden.subscribe(save), useFronts.subscribe(save)];
  return () => stops.forEach((stop) => stop());
}
