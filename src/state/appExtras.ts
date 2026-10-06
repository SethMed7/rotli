// App settings kept outside persist.ts (which sits at its size ceiling): each
// is one key in the app settings file on this Mac, with its own store and its
// own tolerant parser. persist.ts calls these three at its load, save, and
// subscribe points.

import { parseAmbient } from "../lib/ambient";
import { parseHidden } from "../lib/hideable";
import { parsePinnedSites } from "../lib/pinnedSites";
import { parseFronts } from "../lib/sidebarFronts";
import { parseSidebarLook } from "../lib/sidebarLook";
import { useAmbient } from "./ambient";
import { appearanceLookSnapshot, parseAppearanceLook, useAppearanceLook } from "./appearanceLook";
import { useFronts } from "./fronts";
import { useGraphStore } from "./graph";
import { parseHandToAiMode, useHandToAiMode } from "./handToAiMode";
import { useHidden } from "./hidden";
import { usePinnedSites } from "./pinnedSites";
import { useSidebarLook } from "./sidebarLook";
import { useVaultView } from "./vaultView";

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
  useVaultView.setState({ on: data.vaultView === true });
  usePinnedSites.setState({ sites: parsePinnedSites(data.pinnedSites) });
  useSidebarLook.setState({ look: parseSidebarLook(data.sidebarLook) });
  useHandToAiMode.setState({ mode: parseHandToAiMode(data.handToAiMode) });
  useAppearanceLook.setState(parseAppearanceLook(data));
  // on unless someone switched it off
  useGraphStore.setState({ librarianLinks: data.graphLibrarianLinks !== false });
}

/** The extras' keys, for the app settings file. */
export function appExtrasSnapshot(): {
  ambient: unknown;
  hidden: unknown;
  sidebarFronts: unknown;
  vaultView: unknown;
  pinnedSites: unknown;
  sidebarLook: unknown;
  handToAiMode: unknown;
  themeCycle: unknown;
  themeCyclePicks: unknown;
  outlineImages: unknown;
  graphLibrarianLinks: unknown;
} {
  return {
    ambient: useAmbient.getState().prefs,
    hidden: useHidden.getState().hidden,
    sidebarFronts: useFronts.getState().prefs,
    vaultView: useVaultView.getState().on,
    pinnedSites: usePinnedSites.getState().sites,
    sidebarLook: useSidebarLook.getState().look,
    handToAiMode: useHandToAiMode.getState().mode,
    ...appearanceLookSnapshot(),
    graphLibrarianLinks: useGraphStore.getState().librarianLinks,
  };
}

/** Save when any extra changes. */
export function subscribeAppExtras(save: () => void): () => void {
  const stops = [
    useAmbient.subscribe(save),
    useHidden.subscribe(save),
    useFronts.subscribe(save),
    useVaultView.subscribe(save),
    useSidebarLook.subscribe(save),
    useHandToAiMode.subscribe(save),
    useAppearanceLook.subscribe(save),
    // only the pins themselves, not which panel is open
    usePinnedSites.subscribe((state, prev) => state.sites !== prev.sites && save()),
    // only the Librarian switch, not the session's scope
    useGraphStore.subscribe((state, prev) => state.librarianLinks !== prev.librarianLinks && save()),
  ];
  return () => stops.forEach((stop) => stop());
}
