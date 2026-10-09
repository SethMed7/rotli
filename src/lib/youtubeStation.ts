// Your own YouTube stations (the owner, 2026-10-01: "offer option to add
// another url, must be youtube, for people to add their own yt fm music they
// like"). A pasted link is never kept as typed: it is read for a video or
// playlist id and rebuilt as a www.youtube.com address, the one host the
// hidden player page knows how to play, skip, and pause.

export interface YouTubeStation {
  /** `yt-<video>` or `yt-list-<playlist>`: stable, and never Claude FM's id. */
  id: string;
  title: string;
  /** The rebuilt address (never the pasted text). */
  url: string;
}

/** How many stations a person keeps beside the studio tracks and Claude FM. */
export const MAX_STATIONS = 3;
export const STATION_TITLE_MAX = 40;
export const DEFAULT_STATION_TITLE = "YouTube station";

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
/** Paths whose next segment is the video: /live/ID, /shorts/ID, /embed/ID. */
const VIDEO_PATHS = new Set(["live", "shorts", "embed"]);

function readUrl(input: string): URL | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The video id a YouTube address names: `undefined` for none, `null` for a
 * malformed one (which rejects the whole link). */
function videoOf(url: URL): string | null | undefined {
  const host = url.hostname.toLowerCase();
  const [first, second] = url.pathname.split("/").filter(Boolean);
  const raw =
    host === "youtu.be"
      ? first
      : first === "watch"
        ? url.searchParams.get("v")
        : VIDEO_PATHS.has(first ?? "")
          ? second
          : undefined;
  if (raw === undefined || raw === null) return undefined;
  return VIDEO_ID.test(raw) ? raw : null;
}

/** A YouTube video or playlist link as a station's id and address, or null
 * for anything else (another site, a channel page, a malformed id). */
export function parseYouTubeLink(input: string): { id: string; url: string } | null {
  const url = readUrl(input);
  if (!url || !HOSTS.has(url.hostname.toLowerCase())) return null;
  const video = videoOf(url);
  if (video === null) return null;
  const rawList = url.searchParams.get("list");
  const list = rawList && LIST_ID.test(rawList) ? rawList : undefined;
  if (video) {
    return {
      id: `yt-${video}`,
      url: `https://www.youtube.com/watch?v=${video}${list ? `&list=${list}` : ""}`,
    };
  }
  const [first] = url.pathname.split("/").filter(Boolean);
  if (list && (first === "playlist" || first === "watch")) {
    return { id: `yt-list-${list}`, url: `https://www.youtube.com/watch?list=${list}` };
  }
  return null;
}

/** A station's name as shown: trimmed, bounded, never empty. */
export function stationTitle(value: unknown): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text ? text.slice(0, STATION_TITLE_MAX) : DEFAULT_STATION_TITLE;
}

/** Saved stations read tolerantly: each address is parsed again (a hand-edited
 * file can't smuggle another host in), duplicates and extras are dropped. */
export function parseStations(value: unknown): YouTubeStation[] {
  if (!Array.isArray(value)) return [];
  const stations: YouTubeStation[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const saved = entry as Record<string, unknown>;
    const parsed = typeof saved.url === "string" ? parseYouTubeLink(saved.url) : null;
    if (!parsed || stations.some((station) => station.id === parsed.id)) continue;
    stations.push({ ...parsed, title: stationTitle(saved.title) });
    if (stations.length === MAX_STATIONS) break;
  }
  return stations;
}
