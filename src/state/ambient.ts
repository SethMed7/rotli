// Ambient audio and the sidebar player (2026-09-28; src/lib/ambient.ts): the
// saved preference (Rotli's app settings on this Mac, state/appExtras.ts), and what
// each browser tab's page is doing right now (memory only, like everything
// else about a browser tab).

import { create } from "zustand";

import { type AmbientPrefs, DEFAULT_AMBIENT } from "../lib/ambient";
import type { TabMediaState } from "../lib/tauri";

export const useAmbient = create<{
  prefs: AmbientPrefs;
  setPrefs: (change: Partial<AmbientPrefs>) => void;
}>((set) => ({
  prefs: DEFAULT_AMBIENT,
  setPrefs: (change) => set((s) => ({ prefs: { ...s.prefs, ...change } })),
}));

export const useTabMedia = create<{
  /** Each browser tab's page, by tab id ("none" tabs are left out). */
  media: Record<string, TabMediaState>;
  /** The tab that played last: the player stays on it while it's paused. */
  recent: string | null;
  /** Rotli's own audio or video is playing (a file, a Breve episode). */
  inApp: boolean;
}>(() => ({ media: {}, recent: null, inApp: false }));

export function setTabMedia(tabId: string, state: TabMediaState): void {
  const now = useTabMedia.getState();
  if ((now.media[tabId] ?? "none") === state && (state !== "playing" || now.recent === tabId)) return;
  const { [tabId]: _old, ...rest } = now.media;
  useTabMedia.setState({
    media: state === "none" ? rest : { ...rest, [tabId]: state },
    recent: state === "playing" ? tabId : now.recent,
  });
}

/** A tab closed (or its page went away): it has no media any more. */
export function forgetTabMedia(tabId: string): void {
  const now = useTabMedia.getState();
  if (!(tabId in now.media) && now.recent !== tabId) return;
  const { [tabId]: _old, ...rest } = now.media;
  useTabMedia.setState({ media: rest, recent: now.recent === tabId ? null : now.recent });
}

export function setInAppMedia(inApp: boolean): void {
  if (useTabMedia.getState().inApp !== inApp) useTabMedia.setState({ inApp });
}

/** A preview from setup's Sound step (the owner, 2026-09-30: "offer play
 * buttons for them to preview, but the actual audio won't start till they
 * finish onboarding"): the one source that may sound before setup is done. */
export const useAmbientPreview = create<{ track: string | null }>(() => ({ track: null }));

export function setAmbientPreview(track: string | null): void {
  if (useAmbientPreview.getState().track !== track) useAmbientPreview.setState({ track });
}
