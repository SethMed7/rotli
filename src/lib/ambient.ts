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
import { parseStations, type YouTubeStation } from "./youtubeStation";

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

// The build's base: "/" in the Mac app, "/app/" for Rotli Web, which the site
// serves under /app/ (a bare /ambient/ would ask the marketing site).
const BASE: string = import.meta.env?.BASE_URL ?? "/";

export const ambientSrc = (id: string, base = BASE) => `${base}ambient/${id}.m4a`;

/** Claude FM (the owner, 2026-09-28): Anthropic's 24/7 lo-fi stream on
 * YouTube, the one Claude Code's /radio opens. Chosen as the ambient source,
 * it plays in a private browser page that never shows, kept behind the
 * player; it needs the network, unlike the tracks. */
export const CLAUDE_FM = { id: "claude-fm", title: "Claude FM", url: "https://clau.de/radio" } as const;

/** Claude FM or one of the person's own YouTube stations: both play in the
 * hidden page, need the network, and have no Stop or volume of their own. */
export const isStream = (id: string): boolean => id === CLAUDE_FM.id || id.startsWith("yt-");

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
  /** How loud the studio track plays, 0–1 (the owner, 2026-09-30: "a way to
   * pause or change the volume … it might be too high"). Claude FM plays in
   * its own page, at the page's volume. */
  volume: number;
  /** The person's own YouTube stations (src/lib/youtubeStation.ts), after Claude FM. */
  stations: YouTubeStation[];
}

/** The player shows from the first run, quiet until the person presses Play
 * (the owner, 2026-10-01: set up while they're already in; they hide it or
 * pick music there, and it no longer needs a setup screen). */
export const DEFAULT_AMBIENT: AmbientPrefs = {
  enabled: true,
  track: "linen",
  playing: false,
  volume: 0.4,
  stations: [],
};

/** Every source for these preferences: the tracks, Claude FM, then the
 * person's own stations. */
export function ambientSources(prefs: Pick<AmbientPrefs, "stations">): { id: string; title: string }[] {
  return [...AMBIENT_SOURCES, ...prefs.stations.map(({ id, title }) => ({ id, title }))];
}

/** The address a stream plays: Claude FM's, or a station's rebuilt one. */
export function streamUrl(prefs: Pick<AmbientPrefs, "stations">, id: string): string | null {
  if (id === CLAUDE_FM.id) return CLAUDE_FM.url;
  return prefs.stations.find((station) => station.id === id)?.url ?? null;
}

/** The preference read tolerantly: anything missing or malformed is the default. */
export function parseAmbient(value: unknown): AmbientPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AMBIENT };
  const prefs = value as Record<string, unknown>;
  const stations = parseStations(prefs.stations);
  const known = (id: unknown): id is string =>
    ambientSources({ stations }).some((source) => source.id === id);
  return {
    // a saved choice either way stands; anything else is the default (shown)
    enabled: typeof prefs.enabled === "boolean" ? prefs.enabled : DEFAULT_AMBIENT.enabled,
    track: known(prefs.track) ? prefs.track : DEFAULT_AMBIENT.track,
    playing: prefs.playing === true,
    volume:
      typeof prefs.volume === "number" && prefs.volume >= 0 && prefs.volume <= 1
        ? prefs.volume
        : DEFAULT_AMBIENT.volume,
    stations,
  };
}

/** The track that sounds like a theme family (Linen for any other). */
export function trackForFamily(family: string): string {
  return AMBIENT_TRACKS.find((track) => track.family === family)?.id ?? DEFAULT_AMBIENT.track;
}

export function trackTitle(id: string, prefs: Pick<AmbientPrefs, "stations"> = DEFAULT_AMBIENT): string {
  return ambientSources(prefs).find((source) => source.id === id)?.title ?? id;
}

/** The track before or after `id`, wrapping around. From a stream (Claude FM
 * or a station, nothing to skip), Next goes to the first track and Previous to
 * the last. */
export function stepTrack(id: string, step: 1 | -1): string {
  const at = AMBIENT_TRACKS.findIndex((track) => track.id === id);
  if (at < 0) return AMBIENT_TRACKS[step === 1 ? 0 : AMBIENT_TRACKS.length - 1]!.id;
  const next = (at + step + AMBIENT_TRACKS.length) % AMBIENT_TRACKS.length;
  return AMBIENT_TRACKS[next]!.id;
}

/** How long a stream page must stay paused, unasked, to count as the person's
 * pause (a page's own stall, an ad ending, is shorter). */
export const STREAM_HOLD_MS = 1200;
/** A pause landing this soon after Rotli asked for one is Rotli's own. */
export const STREAM_QUIET_MS = 3000;

/** When the stream page's current outside pause began, after one poll: set
 * when it stops playing without Rotli having asked (AirPods, a media key, the
 * page's own button), kept while it stays paused, cleared once it plays. A
 * pause Rotli asked for (the Pause button, a tab taking over) never starts it. */
export function nextPausedSince(
  was: TabMediaState,
  state: TabMediaState,
  pausedSince: number | null,
  askedPauseAt: number,
  now: number,
): number | null {
  if (state !== "paused") return null;
  if (pausedSince !== null || was !== "playing") return pausedSince;
  return now - askedPauseAt < STREAM_QUIET_MS ? null : now;
}

/** The stream page's next step (streamFollow). */
export const STREAM_STEP = {
  pauseTheirs: "pause-theirs",
  playTheirs: "play-theirs",
  hold: "hold",
  nudge: "nudge",
} as const;
export type StreamStep = (typeof STREAM_STEP)[keyof typeof STREAM_STEP];

/** What to do with the stream page this poll: let an outside pause or play
 * stand as the person's choice, wait while an outside pause settles, or nudge
 * the page toward the rules. */
export function streamFollow(moment: {
  state: TabMediaState;
  /** The rules say ambient sounds now. */
  plays: boolean;
  /** The person's saved choice. */
  playing: boolean;
  pausedSince: number | null;
  askedPauseAt: number;
  now: number;
}): StreamStep {
  const held = moment.pausedSince === null ? null : moment.now - moment.pausedSince;
  if (moment.plays && held !== null)
    return held >= STREAM_HOLD_MS ? STREAM_STEP.pauseTheirs : STREAM_STEP.hold;
  if (moment.state === "playing" && !moment.playing && moment.now - moment.askedPauseAt >= STREAM_QUIET_MS)
    return STREAM_STEP.playTheirs;
  return STREAM_STEP.nudge;
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
