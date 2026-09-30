// Which sidebar fronts are on and where Rotli opens (src/lib/sidebarFronts.ts
// has the rules), kept in the app settings on this Mac (state/appExtras.ts).

import { create } from "zustand";

import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import {
  DEFAULT_FRONTS,
  FRONTS,
  type Front,
  type FrontsPrefs,
  enabledFronts,
  frontOf,
  frontState,
  homeFront,
  withFront,
} from "../lib/sidebarFronts";
import { useUiStore } from "./ui";

/** The fronts this build has: Breve only where it ships. */
export const AVAILABLE_FRONTS: readonly Front[] = FRONTS.filter(
  (front) => front !== "breve" || LAUNCH_FEATURES.breve,
);

export const useFronts = create<{
  prefs: FrontsPrefs;
  setFront: (front: Front, on: boolean) => void;
  setHome: (front: Front) => void;
}>((set) => ({
  prefs: { ...DEFAULT_FRONTS, off: [] },
  setFront: (front, on) => set((s) => ({ prefs: withFront(s.prefs, front, on, AVAILABLE_FRONTS) })),
  setHome: (front) =>
    set((s) =>
      enabledFronts(s.prefs, AVAILABLE_FRONTS).includes(front) ? { prefs: { ...s.prefs, home: front } } : s,
    ),
}));

export function frontOn(front: Front): boolean {
  return enabledFronts(useFronts.getState().prefs, AVAILABLE_FRONTS).includes(front);
}

export function useFrontOn(front: Front): boolean {
  return useFronts((s) => enabledFronts(s.prefs, AVAILABLE_FRONTS).includes(front));
}

/** How many fronts are on (the switcher hides at one). */
export function useFrontCount(): number {
  return useFronts((s) => enabledFronts(s.prefs, AVAILABLE_FRONTS).length);
}

/** The sidebar's mode and view for where Rotli opens (a vault's load). */
export function landingFront(): ReturnType<typeof frontState> {
  return frontState(homeFront(useFronts.getState().prefs, AVAILABLE_FRONTS));
}

/** Keep the sidebar off any front that's turned off: anything that lands on
 * one (a chat tab focused, a restored state) steps to the home front. */
export function enforceFronts(): () => void {
  const check = () => {
    const ui = useUiStore.getState();
    if (frontOn(frontOf(ui.sidebarMode, ui.sidebarView))) return;
    useUiStore.setState(frontState(homeFront(useFronts.getState().prefs, AVAILABLE_FRONTS)));
  };
  const stops = [useUiStore.subscribe(check), useFronts.subscribe(check)];
  check();
  return () => stops.forEach((stop) => stop());
}
