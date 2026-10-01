// Pinned sites (docs/decisions/2026-10-01-pinned-sites.md; the owner,
// 2026-10-01: "up to 3 bookmarks of places you log in to, and they stay
// logged in"). The pure half: what a pin is, how a pasted address and saved
// pins are checked, and the random store id each pin's signed-in session
// lives under (src-tauri/src/pinned_site.rs).

export interface PinnedSite {
  /** Stable for the pin's life (`pin-<store prefix>`). */
  id: string;
  /** The page slot, 0–2: which native page shows it. */
  slot: number;
  label: string;
  /** An https address, normalized. */
  url: string;
  /** 32 lowercase hex characters: the pin's own WebKit store. */
  store: string;
}

export const MAX_PINS = 3;
export const PIN_LABEL_MAX = 24;
const STORE = /^[0-9a-f]{32}$/;

/** A pasted address as a pin's https address, or null. A bare host is https. */
export function pinnedUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** A pin's name: the person's, or the site's host. */
export function pinLabel(name: string, url: string): string {
  const text = name.trim().replace(/\s+/g, " ").slice(0, PIN_LABEL_MAX);
  if (text) return text;
  return new URL(url).hostname.replace(/^www\./, "");
}

/** The pin's one-letter mark in the title bar. */
export function pinMark(label: string): string {
  const letter = [...label].find((char) => /[\p{L}\p{N}]/u.test(char));
  return letter ? letter.toLocaleUpperCase() : "•";
}

/** Fills 16 bytes with randomness (crypto's, unless a test hands its own). */
export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
const cryptoBytes: RandomBytes = (bytes) => crypto.getRandomValues(bytes);

/** A fresh store id: 16 random bytes, never all zero. */
export function newStore(random: RandomBytes = cryptoBytes): string {
  for (;;) {
    const bytes = random(new Uint8Array(16));
    if (bytes.some((byte) => byte !== 0))
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export const PIN_PROBLEMS = {
  notHttps: "That isn’t an https address.",
  pinned: "That site is already pinned.",
} as const;

/** Why a pin can't be added, or null when it can. */
export function pinProblem(link: string, sites: readonly PinnedSite[]): string | null {
  if (sites.length >= MAX_PINS) return `You can pin ${MAX_PINS} sites; remove one first.`;
  const url = pinnedUrl(link);
  if (!url) return PIN_PROBLEMS.notHttps;
  if (sites.some((site) => new URL(site.url).origin === new URL(url).origin)) return PIN_PROBLEMS.pinned;
  return null;
}

/** The pins with one more, in the lowest free slot; null when it can't be added. */
export function withPin(
  sites: readonly PinnedSite[],
  name: string,
  link: string,
  random?: RandomBytes,
): PinnedSite[] | null {
  const url = pinnedUrl(link);
  if (!url || pinProblem(link, sites)) return null;
  const slot = [0, 1, 2].find((free) => !sites.some((site) => site.slot === free))!;
  const store = newStore(random);
  return [...sites, { id: `pin-${store.slice(0, 12)}`, slot, label: pinLabel(name, url), url, store }];
}

/** Saved pins read tolerantly: each is checked again; a bad, duplicate, or
 * extra one drops. */
export function parsePinnedSites(value: unknown): PinnedSite[] {
  if (!Array.isArray(value)) return [];
  const sites: PinnedSite[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const saved = entry as Record<string, unknown>;
    const url = typeof saved.url === "string" ? pinnedUrl(saved.url) : null;
    const store =
      typeof saved.store === "string" && STORE.test(saved.store) && /[1-9a-f]/.test(saved.store)
        ? saved.store
        : null;
    const slot = typeof saved.slot === "number" && Number.isInteger(saved.slot) ? saved.slot : -1;
    if (!url || !store || slot < 0 || slot >= MAX_PINS) continue;
    const origin = new URL(url).origin;
    if (
      sites.some((site) => site.slot === slot || site.store === store || new URL(site.url).origin === origin)
    )
      continue;
    const label = pinLabel(typeof saved.label === "string" ? saved.label : "", url);
    sites.push({ id: `pin-${store.slice(0, 12)}`, slot, label, url, store });
    if (sites.length === MAX_PINS) break;
  }
  return sites;
}
