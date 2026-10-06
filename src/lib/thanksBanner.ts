// The thank-you card after onboarding (2026-09-28): what its banner says and
// where its share buttons go. Pure: the card draws and the services open.
//
// Share links carry ONLY the fixed caption and the site — never the person's
// name or any choice they made (that would be personal data leaving through a
// URL). The banner image is theirs to attach.

export const SITE_URL = "https://rotli.co";
export const BANNER_FILE_NAME = "rotli-thank-you.png";
export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 630;

export const SHARE_CAPTION =
  "I just set up Rotli: a calm, local-first workspace for notes, tasks, and AI, in one folder I own.";

export const FRIEND_INVITE = `I’ve started using Rotli for notes. It keeps everything in a folder on your Mac, no account needed. ${SITE_URL}`;

export function shareOnXUrl(): string {
  const params = new URLSearchParams({ text: SHARE_CAPTION, url: SITE_URL });
  return `https://x.com/intent/post?${params.toString()}`;
}

export interface BannerText {
  headline: string;
  subline: string;
}

const NAME_LIMIT = 24;

/** First name, trimmed to fit the headline. */
function shortName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0] ?? "";
  return first.length > NAME_LIMIT ? `${first.slice(0, NAME_LIMIT - 1)}…` : first;
}

/** A thank-you, by first name (the owner, 2026-10-02: "more of a thank you
 * message, less of a welcome", and no badges for the choices made). */
export function bannerText(userName: string): BannerText {
  const name = shortName(userName);
  return {
    headline: name ? `Thank you, ${name}` : "Thank you",
    subline: "for trying Rotli. We’re so glad you’re here.",
  };
}

/** Tell a friend: a mail draft holding the invite, nobody addressed. */
export function friendInviteMailto(): string {
  const subject = encodeURIComponent("Try Rotli");
  return `mailto:?subject=${subject}&body=${encodeURIComponent(FRIEND_INVITE)}`;
}

// --- reading a rendered quokka's computed styles (components/onboarding/bannerCanvas.ts)

export type Point = readonly [number, number];

function length(token: string, size: number): number | null {
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return null;
  if (token.endsWith("%")) return (value / 100) * size;
  return value; // px, or a bare 0
}

/** A computed `clip-path` as a polygon in the box's own pixels: `polygon(…)`
 * and `inset(…)` (the two the quokka uses). `none` → null. */
export function clipPolygon(value: string, width: number, height: number): Point[] | null {
  const polygon = /^polygon\((.*)\)$/.exec(value.trim());
  if (polygon) {
    const points: Point[] = [];
    for (const pair of polygon[1]!.split(",")) {
      const [x, y] = pair.trim().split(/\s+/);
      const px = x === undefined ? null : length(x, width);
      const py = y === undefined ? null : length(y, height);
      if (px === null || py === null) return null;
      points.push([px, py]);
    }
    return points.length >= 3 ? points : null;
  }
  const inset = /^inset\(([^)]*)\)$/.exec(value.trim());
  if (!inset) return null;
  const parts = inset[1]!.trim().split(/\s+/);
  const [t, r = t, b = t, l = r] = parts;
  const top = length(t!, height);
  const right = length(r!, width);
  const bottom = length(b!, height);
  const left = length(l!, width);
  if (top === null || right === null || bottom === null || left === null) return null;
  return [
    [left, top],
    [width - right, top],
    [width - right, height - bottom],
    [left, height - bottom],
  ];
}

/** A computed `transform` (`matrix(a, b, c, d, e, f)`); `none` → identity. */
export function transformMatrix(value: string): [number, number, number, number, number, number] | null {
  if (value.trim() === "none") return [1, 0, 0, 1, 0, 0];
  const match = /^matrix\(([^)]*)\)$/.exec(value.trim());
  if (!match) return null;
  const numbers = match[1]!.split(",").map((part) => Number.parseFloat(part));
  if (numbers.length !== 6 || numbers.some((n) => !Number.isFinite(n))) return null;
  return numbers as [number, number, number, number, number, number];
}

/** The url inside a computed `mask-image: url("…")`. A quoted url may hold
 * the other quote (an inline SVG's `xmlns='…'`), so only its own quote ends it. */
export function maskUrl(value: string): string | null {
  const match = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^"')\s]+))\s*\)/.exec(value);
  const url = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
  return url ? url.replace(/\\(.)/g, "$1") : null;
}
