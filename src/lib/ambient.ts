// Ambient audio and the sidebar player (the owner, 2026-09-28). With Ambient
// audio on (Settings → General), one of the studio's ambient tracks is always
// there to play, from the player just above the sidebar's footer. Anything
// playing in a tab takes over: the ambient track pauses and waits as a small
// toggle on the player's left, and clicking it pauses that tab instead. When
// the tab pauses or closes, ambient comes back. With Ambient audio off, the
// player appears only while a tab has media.
//
// The pure half: the tracks, the saved preference, and what the player shows
// and plays for a given moment. The tracks are the studio's playlist
// (studio.rotli.co, code-synthesized, MIT), shipped in public/ambient/ so they
// play offline.

import type { TabMediaState } from "./tauri";

export interface AmbientTrack {
  id: string;
  title: string;
  /** The theme family whose sound it is. */
  family: string;
}

export const AMBIENT_TRACKS: readonly AmbientTrack[] = [
  { id: "linen", title: "Linen", family: "warm" },
  { id: "graphite", title: "Graphite", family: "mono" },
  { id: "tide", title: "Tide", family: "ocean" },
  { id: "canopy", title: "Canopy", family: "grove" },
  { id: "dusk", title: "Dusk", family: "iris" },
  { id: "lamplight", title: "Lamplight", family: "midnight" },
];

export const ambientSrc = (id: string) => `/ambient/${id}.m4a`;

/** Claude FM (the owner, 2026-09-28): Anthropic's 24/7 lo-fi stream on
 * YouTube, the one Claude Code's /radio opens. Chosen as the ambient source,
 * it plays in a private browser page that never shows, kept behind the
 * player; it needs the network, unlike the tracks. */
export const CLAUDE_FM = { id: "claude-fm", title: "Claude FM", url: "https://clau.de/radio" } as const;

export const isStream = (id: string): boolean => id === CLAUDE_FM.id;

/** Everything the player's menu offers: the tracks, then Claude FM. */
export const AMBIENT_SOURCES: readonly { id: string; title: string }[] = [
  ...AMBIENT_TRACKS,
  { id: CLAUDE_FM.id, title: CLAUDE_FM.title },
];

export interface AmbientPrefs {
  enabled: boolean;
  track: string;
  /** Whether the person wants it playing (kept across launches; a tab's
   * media still takes over). */
  playing: boolean;
}

export const DEFAULT_AMBIENT: AmbientPrefs = { enabled: false, track: "linen", playing: false };

const known = (id: unknown): id is string => AMBIENT_SOURCES.some((source) => source.id === id);

/** The preference read tolerantly: anything missing or malformed is the default. */
export function parseAmbient(value: unknown): AmbientPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AMBIENT };
  const prefs = value as Record<string, unknown>;
  return {
    enabled: prefs.enabled === true,
    track: known(prefs.track) ? prefs.track : DEFAULT_AMBIENT.track,
    playing: prefs.playing === true,
  };
}

/** The track that sounds like a theme family (Linen for any other). */
export function trackForFamily(family: string): string {
  return AMBIENT_TRACKS.find((track) => track.family === family)?.id ?? DEFAULT_AMBIENT.track;
}

export function trackTitle(id: string): string {
  return AMBIENT_SOURCES.find((source) => source.id === id)?.title ?? id;
}

/** The track before or after `id`, wrapping around. From Claude FM (a live
 * stream, nothing to skip), Next goes to the first track and Previous to the
 * last. */
export function stepTrack(id: string, step: 1 | -1): string {
  const at = AMBIENT_TRACKS.findIndex((track) => track.id === id);
  if (at < 0) return AMBIENT_TRACKS[step === 1 ? 0 : AMBIENT_TRACKS.length - 1]!.id;
  const next = (at + step + AMBIENT_TRACKS.length) % AMBIENT_TRACKS.length;
  return AMBIENT_TRACKS[next]!.id;
}

/** What each browser tab's page is doing, by tab id. */
export type TabMedia = Readonly<Record<string, TabMediaState>>;

export interface PlayerView {
  /** The player shows at all. */
  visible: boolean;
  /** The tab the player controls, or null (then it controls ambient). */
  tab: string | null;
  /** That tab is playing right now. */
  tabPlaying: boolean;
  /** The ambient track should be sounding. */
  ambientPlays: boolean;
  /** Ambient waits as the small toggle on the player's left (a tab has media). */
  ambientDocked: boolean;
}

const hasMedia = (state: TabMediaState | undefined) => !!state && state !== "none";

/** The player for one moment. `recent` is the tab that last played (it keeps
 * the player while it's paused); `inApp` is Rotli's own audio or video
 * playing (a file, a Breve episode), which pauses ambient but gets no controls. */
export function playerView(
  prefs: AmbientPrefs,
  media: TabMedia,
  recent: string | null,
  inApp = false,
): PlayerView {
  const tabs = Object.keys(media);
  const playing = recent && media[recent] === "playing" ? recent : tabs.find((id) => media[id] === "playing");
  const tab =
    playing ?? (recent && hasMedia(media[recent]) ? recent : tabs.find((id) => hasMedia(media[id]))) ?? null;
  const tabPlaying = !!tab && media[tab] === "playing";
  return {
    visible: prefs.enabled || tab !== null,
    tab,
    tabPlaying,
    ambientPlays: prefs.enabled && prefs.playing && !tabPlaying && !inApp,
    ambientDocked: prefs.enabled && tab !== null,
  };
}
