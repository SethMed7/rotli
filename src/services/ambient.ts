// Ambient audio and the sidebar player (2026-09-28; the rules are
// src/lib/ambient.ts). The effectful half, alive for the main window's whole
// life, never tied to the sidebar (which unmounts when it collapses):
//
// - one <audio> element for the ambient track, looped, faded in and out;
// - Claude FM, when it's the chosen source: a private browser page that never
//   shows, kept playing or paused to match the rules;
// - a question to each browser tab's page, "are you playing?" (WebKit's own
//   answer, private_browser_media.rs), kept in memory — often while anything
//   has media, rarely otherwise, and never two at once;
// - Rotli's own audio and video (a file, a Breve episode) noticed, so they
//   pause ambient too;
// - the player's buttons, which show their result at once and let the next
//   answer confirm it (the owner, 2026-09-28: play and pause felt laggy).

import { type AmbientPrefs, ambientSrc, CLAUDE_FM, isStream, playerView, stepTrack } from "../lib/ambient";
import { setupShows } from "../lib/reviewMode";
import {
  isTauri,
  privateBrowserClose,
  privateBrowserCreate,
  privateBrowserMedia,
  privateBrowserMediaState,
  privateBrowserSetVisible,
  type TabMediaAction,
  type TabMediaState,
} from "../lib/tauri";
import {
  forgetTabMedia,
  setInAppMedia,
  setTabMedia,
  useAmbient,
  useAmbientPreview,
  useTabMedia,
} from "../state/ambient";
import { useMediaDock } from "../state/mediaDock";
import { usePanesStore } from "../state/panes";
import { leaves } from "../state/paneTree";
import { useUiStore } from "../state/ui";
import { closeOrphanedTuck } from "./mediaDock";

/** How often tabs are asked: quickly while something has media, else rarely. */
const POLL_BUSY_MS = 400;
const POLL_IDLE_MS = 1500;
const FADE_TICK_MS = 30;
/** A pause is heard within ~0.1 s; a start ramps up over ~0.3 s. */
const FADE_OUT_STEP = 0.12;
const FADE_IN_STEP = 0.05;
/** Claude FM's hidden page (a private-browser id, never a tab). */
const FM_PAGE = "ambient-claude-fm";
/** Ask Claude FM to play or pause at most this often while it disagrees. */
const FM_NUDGE_MS = 2500;

// The one ambient element lives on the window, not in this module: a reloaded
// module (a development hot update, the owner 2026-09-28: "I hear the music
// but have no idea where it is coming from") picks up the element the old copy
// was playing instead of losing it, still sounding, with no control on it.
const shared = globalThis as { __rotliAmbientAudio?: HTMLAudioElement };
let audio: HTMLAudioElement | null = shared.__rotliAmbientAudio ?? null;
let fading: ReturnType<typeof setInterval> | null = null;

function trackElement(track: string): HTMLAudioElement {
  audio ??= Object.assign(new Audio(), { loop: true, preload: "auto", volume: 0 });
  shared.__rotliAmbientAudio = audio;
  const src = ambientSrc(track);
  if (!audio.src.endsWith(src)) audio.src = src;
  return audio;
}

function fadeTo(target: number, then?: () => void): void {
  if (fading) clearInterval(fading);
  fading = setInterval(() => {
    if (!audio) return;
    const step = target < audio.volume ? FADE_OUT_STEP : FADE_IN_STEP;
    const gap = target - audio.volume;
    audio.volume = Math.abs(gap) <= step ? target : audio.volume + Math.sign(gap) * step;
    if (audio.volume !== target) return;
    if (fading) clearInterval(fading);
    fading = null;
    then?.();
  }, FADE_TICK_MS);
}

function silenceTrack(): void {
  if (audio && !audio.paused) fadeTo(0, () => audio?.pause());
}

// ── Claude FM ──────────────────────────────────────────────────────────────

let fmOpen = false;
let fmState: TabMediaState = "none";
let fmNudged = 0;

function openFm(): void {
  if (fmOpen) return;
  fmOpen = true;
  fmNudged = 0;
  void privateBrowserCreate(FM_PAGE, CLAUDE_FM.url, { x: 0, y: 0, width: 1, height: 1 })
    .then(() => privateBrowserSetVisible(FM_PAGE, false))
    .catch(() => {
      fmOpen = false;
    });
}

function closeFm(): void {
  if (!fmOpen) return;
  fmOpen = false;
  fmState = "none";
  void privateBrowserClose(FM_PAGE).catch(() => {});
}

/** Keep Claude FM's page doing what the rules say. The page loads on its own
 * time, so a disagreement is nudged again until the page answers. */
function reconcileFm(wantsPlay: boolean, force = false): void {
  if (!fmOpen) return;
  const agrees = wantsPlay ? fmState === "playing" : fmState !== "playing";
  if (agrees) return;
  const now = Date.now();
  if (!force && now - fmNudged < FM_NUDGE_MS) return;
  fmNudged = now;
  void privateBrowserMedia(FM_PAGE, wantsPlay ? "play" : "pause").catch(() => {});
}

// ── the rules, applied ─────────────────────────────────────────────────────

/** What ambient does right now. Before setup is done only a preview from the
 * Sound step sounds; the chosen music starts once setup finishes. */
function ambientNow(): { prefs: AmbientPrefs; plays: boolean } {
  const { prefs } = useAmbient.getState();
  if (setupShows(isTauri(), import.meta.env.DEV, window.location.search, useUiStore.getState().onboarded)) {
    const preview = useAmbientPreview.getState().track;
    return { prefs: { ...prefs, enabled: !!preview, track: preview ?? prefs.track }, plays: !!preview };
  }
  const { media, recent, inApp } = useTabMedia.getState();
  return { prefs, plays: playerView(prefs, media, recent, inApp).ambientPlays };
}

/** The ambient source sounds exactly when the rules say it should. */
export function applyAmbient(): void {
  const { prefs, plays } = ambientNow();
  if (!prefs.enabled || !isStream(prefs.track)) closeFm();
  if (isStream(prefs.track) && prefs.enabled) {
    silenceTrack();
    if (plays) openFm();
    reconcileFm(plays, true);
    return;
  }
  if (!plays) return silenceTrack();
  const element = trackElement(prefs.track);
  if (!element.paused) return fadeTo(prefs.volume);
  // start audible at once rather than from silence, then ramp up
  element.volume = FADE_IN_STEP;
  // a play the webview refuses (no gesture yet at launch) reads as paused
  element.play().then(
    // the rules may have changed while play() was starting (paused, a
    // preview stopped, setup's step left): apply them again rather than fade
    // up regardless — that race kept a stopped track playing (2026-09-30)
    () => applyAmbient(),
    (error: unknown) => {
      // a play paused before it began (AbortError) was interrupted, not
      // refused; and a setup preview never changes the saved preference
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (setupShows(isTauri(), import.meta.env.DEV, window.location.search, useUiStore.getState().onboarded))
        return;
      useAmbient.getState().setPrefs({ playing: false });
    },
  );
}

function browserTabIds(): string[] {
  const docked = useMediaDock.getState().tabId;
  const open = leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.filter((tab) => tab.surfaceKind === "browser").map((tab) => tab.id),
  );
  return docked && !open.includes(docked) ? [...open, docked] : open;
}

/** Rotli's own media elements, anything playing out loud. */
function checkInApp(): void {
  if (typeof document === "undefined" || !("querySelectorAll" in document)) return;
  const elements = [...document.querySelectorAll<HTMLMediaElement>("audio, video")];
  setInAppMedia(elements.some((media) => !media.paused && !media.muted));
}

/** Ask every open browser tab (and a tucked one, and Claude FM) what it's doing. */
export async function pollTabMedia(): Promise<void> {
  const ids = browserTabIds();
  const { media, recent } = useTabMedia.getState();
  for (const id of [...Object.keys(media), ...(recent ? [recent] : [])])
    if (!ids.includes(id)) forgetTabMedia(id);
  checkInApp();
  await Promise.all([
    ...ids.map((id) =>
      privateBrowserMediaState(id).then(
        (state) => setTabMedia(id, state),
        () => setTabMedia(id, "none"), // not mounted: no page, no media
      ),
    ),
    fmOpen
      ? privateBrowserMediaState(FM_PAGE).then(
          (state) => {
            fmState = state;
          },
          () => {
            fmState = "none";
          },
        )
      : Promise.resolve(),
  ]);
  if (fmOpen) reconcileFm(ambientNow().plays);
}

function busy(): boolean {
  return fmOpen || Object.keys(useTabMedia.getState().media).length > 0 || !!useMediaDock.getState().tabId;
}

/** Silence everything the player can reach: the ambient track, Claude FM's
 * page, a tucked tab, and every browser tab (⌘K → Stop all sound). */
export function stopAllSound(): void {
  useAmbient.getState().setPrefs({ playing: false });
  if (fading) clearInterval(fading);
  fading = null;
  audio?.pause();
  forceCloseFm();
  for (const id of browserTabIds()) tabMediaAction(id, "pause");
}

/** Close Claude FM's page whether or not this copy opened it (a page left
 * from before a reload is still a native view, still playing). */
function forceCloseFm(): void {
  fmOpen = false;
  fmState = "none";
  void privateBrowserClose(FM_PAGE).catch(() => {});
}

/** Start the player's machinery (main window, once). */
export function startAmbient(): () => void {
  // nothing from a previous run keeps sounding unseen
  forceCloseFm();
  closeOrphanedTuck();
  if (audio && !useAmbient.getState().prefs.playing) audio.pause();
  const unsubscribe = [
    useAmbient.subscribe(applyAmbient),
    useTabMedia.subscribe(applyAmbient),
    useAmbientPreview.subscribe(applyAmbient),
    // finishing setup starts the music chosen in it
    useUiStore.subscribe((state, prev) => {
      if (state.onboarded !== prev.onboarded) applyAmbient();
    }),
  ];
  const events = ["play", "pause", "ended", "emptied", "volumechange"] as const;
  for (const name of events) document.addEventListener(name, checkInApp, true);
  // one question at a time: the next waits for this one's answers
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loop = () => {
    void pollTabMedia().finally(() => {
      if (!stopped) timer = setTimeout(loop, busy() ? POLL_BUSY_MS : POLL_IDLE_MS);
    });
  };
  loop();
  // the chosen track is ready before the first press
  const { prefs } = useAmbient.getState();
  if (prefs.enabled && !isStream(prefs.track)) trackElement(prefs.track).load();
  applyAmbient();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const name of events) document.removeEventListener(name, checkInApp, true);
    for (const stop of unsubscribe) stop();
    audio?.pause();
    closeFm();
  };
}

// ── the player's buttons ────────────────────────────────────────────────────

/** What a tab's page will be doing once an action lands. */
function expected(action: TabMediaAction): TabMediaState | null {
  if (action === "play") return "playing";
  if (action === "pause" || action === "stop") return "paused";
  return null;
}

export function tabMediaAction(tabId: string, action: TabMediaAction): void {
  // show the result at once; the next answers confirm (or correct) it
  const next = expected(action);
  if (next) setTabMedia(tabId, next);
  void privateBrowserMedia(tabId, action)
    .catch(() => {})
    .then(() => {
      setTimeout(() => void pollTabMedia(), 150);
      setTimeout(() => void pollTabMedia(), 700);
    });
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

/** Claude FM out of hiding (the owner, 2026-09-28: "a way for me to open
 * that tab in browser since it's coming from YouTube"): an ordinary browser
 * tab on the stream, and ambient steps back so the two never both play. The
 * stream is live, so starting it fresh loses nothing. */
export function openClaudeFmTab(): void {
  useAmbient.getState().setPrefs({ playing: false });
  closeFm();
  usePanesStore.getState().openBrowser(CLAUDE_FM.url);
}

/** Pick what ambient plays (the player's menu): a track or Claude FM. */
export function chooseAmbient(id: string): void {
  useAmbient.getState().setPrefs({ track: id, playing: true });
}

/** Show the tab that's playing: its pane, its tab, back from Breve or a board. */
export function openMediaTab(tabId: string): void {
  const leaf = leaves(usePanesStore.getState().root).find((l) => l.tabs.some((tab) => tab.id === tabId));
  if (!leaf) return;
  useUiStore.getState().setSidebarMode("notes");
  if (useUiStore.getState().sidebarMode !== "notes") return;
  usePanesStore.getState().activateTab(leaf.id, tabId);
}

// a development hot update replaces this module: stop what the old copy runs
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (fading) clearInterval(fading);
    audio?.pause();
    forceCloseFm();
  });
}
