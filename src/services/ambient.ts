// Ambient audio and the sidebar player (2026-09-28; the rules are
// src/lib/ambient.ts). The effectful half, alive for the main window's whole
// life, never tied to the sidebar (which unmounts when it collapses):
//
// - one <audio> element for the ambient track, looped, faded in and out;
// - a once-a-second question to each browser tab's page, "are you playing?"
//   (WebKit's own answer, private_browser_media.rs), kept in memory;
// - Rotli's own audio and video (a file, a Breve episode) noticed, so they
//   pause ambient too;
// - the player's buttons.

import { ambientSrc, playerView, stepTrack } from "../lib/ambient";
import { privateBrowserMedia, privateBrowserMediaState, type TabMediaAction } from "../lib/tauri";
import { forgetTabMedia, setInAppMedia, setTabMedia, useAmbient, useTabMedia } from "../state/ambient";
import { usePanesStore } from "../state/panes";
import { leaves } from "../state/paneTree";
import { useUiStore } from "../state/ui";

const POLL_MS = 1000;
const VOLUME = 0.4;
const FADE_STEP = 0.04;
const FADE_TICK_MS = 40;

let audio: HTMLAudioElement | null = null;
let fading: ReturnType<typeof setInterval> | null = null;

function trackElement(track: string): HTMLAudioElement {
  audio ??= Object.assign(new Audio(), { loop: true, preload: "auto", volume: 0 });
  const src = ambientSrc(track);
  if (!audio.src.endsWith(src)) audio.src = src;
  return audio;
}

function fadeTo(target: number, then?: () => void): void {
  if (fading) clearInterval(fading);
  fading = setInterval(() => {
    if (!audio) return;
    const gap = target - audio.volume;
    audio.volume = Math.abs(gap) <= FADE_STEP ? target : audio.volume + Math.sign(gap) * FADE_STEP;
    if (audio.volume !== target) return;
    if (fading) clearInterval(fading);
    fading = null;
    then?.();
  }, FADE_TICK_MS);
}

/** The ambient track sounds exactly when the rules say it should. */
export function applyAmbient(): void {
  const { prefs } = useAmbient.getState();
  const { media, recent, inApp } = useTabMedia.getState();
  if (!playerView(prefs, media, recent, inApp).ambientPlays) {
    if (audio && !audio.paused) fadeTo(0, () => audio?.pause());
    return;
  }
  const element = trackElement(prefs.track);
  if (!element.paused) return fadeTo(VOLUME);
  element.volume = 0;
  // a play the webview refuses (no gesture yet at launch) reads as paused
  element.play().then(
    () => fadeTo(VOLUME),
    () => useAmbient.getState().setPrefs({ playing: false }),
  );
}

function browserTabIds(): string[] {
  return leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.filter((tab) => tab.surfaceKind === "browser").map((tab) => tab.id),
  );
}

/** Rotli's own media elements, anything playing out loud. */
function checkInApp(): void {
  if (typeof document === "undefined" || !("querySelectorAll" in document)) return;
  const elements = [...document.querySelectorAll<HTMLMediaElement>("audio, video")];
  setInAppMedia(elements.some((media) => !media.paused && !media.muted));
}

/** Ask every open browser tab what its page is doing. */
export async function pollTabMedia(): Promise<void> {
  const ids = browserTabIds();
  const { media, recent } = useTabMedia.getState();
  for (const id of [...Object.keys(media), ...(recent ? [recent] : [])])
    if (!ids.includes(id)) forgetTabMedia(id);
  checkInApp();
  await Promise.all(
    ids.map((id) =>
      privateBrowserMediaState(id).then(
        (state) => setTabMedia(id, state),
        () => setTabMedia(id, "none"), // not mounted: no page, no media
      ),
    ),
  );
}

/** Start the player's machinery (main window, once). */
export function startAmbient(): () => void {
  const unsubscribe = [useAmbient.subscribe(applyAmbient), useTabMedia.subscribe(applyAmbient)];
  const events = ["play", "pause", "ended", "emptied", "volumechange"] as const;
  for (const name of events) document.addEventListener(name, checkInApp, true);
  const timer = setInterval(() => void pollTabMedia(), POLL_MS);
  applyAmbient();
  return () => {
    clearInterval(timer);
    for (const name of events) document.removeEventListener(name, checkInApp, true);
    for (const stop of unsubscribe) stop();
    audio?.pause();
  };
}

// ── the player's buttons ────────────────────────────────────────────────────

export function tabMediaAction(tabId: string, action: TabMediaAction): void {
  void privateBrowserMedia(tabId, action)
    .catch(() => {})
    .then(() => setTimeout(() => void pollTabMedia(), 250));
}

/** The ambient toggle on the player's left: over a playing tab, ambient takes
 * over (the tab pauses); otherwise it plays or pauses ambient. */
export function toggleAmbient(): void {
  const { prefs, setPrefs } = useAmbient.getState();
  const { media, recent, inApp } = useTabMedia.getState();
  const view = playerView(prefs, media, recent, inApp);
  if (view.tab && view.tabPlaying) {
    setPrefs({ playing: true });
    tabMediaAction(view.tab, "pause");
  } else setPrefs({ playing: !prefs.playing });
}

export function stopAmbient(): void {
  useAmbient.getState().setPrefs({ playing: false });
  if (audio) audio.currentTime = 0;
}

export function stepAmbient(step: 1 | -1): void {
  const { prefs, setPrefs } = useAmbient.getState();
  setPrefs({ track: stepTrack(prefs.track, step) });
}

/** Show the tab that's playing: its pane, its tab, back from Breve or a board. */
export function openMediaTab(tabId: string): void {
  const leaf = leaves(usePanesStore.getState().root).find((l) => l.tabs.some((tab) => tab.id === tabId));
  if (!leaf) return;
  useUiStore.getState().setSidebarMode("notes");
  if (useUiStore.getState().sidebarMode !== "notes") return;
  usePanesStore.getState().activateTab(leaf.id, tabId);
}
