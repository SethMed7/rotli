// Pinned sites, the effectful half (docs/decisions/2026-10-01-pinned-sites.md):
// the panel opens a pin's own page, dismissing it hides the page and keeps it
// alive for a quick return, a page hidden ten minutes is closed (WebKit keeps
// a hidden page running), and removing a pin closes its page and deletes its
// store, which signs the site out.

import { PLATFORM } from "../lib/featurePolicy";
import { type PinnedSite, withPin } from "../lib/pinnedSites";
import {
  type PinBounds,
  pinnedSiteClose,
  pinnedSiteForget,
  pinnedSiteHide,
  pinnedSiteOpen,
  pinnedSiteSetBounds,
  pinnedSitesSupported,
} from "../lib/pinnedSiteShell";
import { isTauri } from "../lib/tauri";
import { usePinnedSites } from "../state/pinnedSites";

/** A page hidden this long is closed; its session stays in its store. */
export const PIN_IDLE_CLOSE_MS = 10 * 60 * 1000;

const idle = new Map<number, ReturnType<typeof setTimeout>>();
const live = new Set<number>();
/** Each show of a slot; an idle close for an older one does nothing. */
const shown = new Map<number, number>();
/** A slot's close still in flight: a reopen waits for it, so it never shows a closing page. */
const closing = new Map<number, Promise<void>>();

function stopIdle(slot: number): void {
  const timer = idle.get(slot);
  if (timer) clearTimeout(timer);
  idle.delete(slot);
}

function closeSlot(slot: number): Promise<void> {
  live.delete(slot);
  const done = pinnedSiteClose(slot).finally(() => {
    if (closing.get(slot) === done) closing.delete(slot);
  });
  closing.set(slot, done);
  return done;
}

/** Ask this Mac once whether pins can keep their own stores. The browser
 * twin of the Mac app says yes (its panel explains the page is the app's);
 * Rotli Web has no pins. */
export async function loadPinSupport(): Promise<void> {
  const supported =
    PLATFORM === "web" ? false : isTauri() ? await pinnedSitesSupported().catch(() => false) : true;
  usePinnedSites.setState({ supported });
}

/** Pins can be added only once this Mac has said it keeps a store per site;
 * a pin already saved can always be removed. */
export const canAddPins = (supported: boolean | null): boolean => supported === true;

/** The title bar's pin: open its panel, or close it when it's the one open. */
export function togglePin(id: string): void {
  const { open, setOpen } = usePinnedSites.getState();
  setOpen(open === id ? null : id);
}

export function closePinPanel(): void {
  usePinnedSites.getState().setOpen(null);
}

/** Show a pin's page over the panel's body (opened, or brought back). */
export async function showPin(site: PinnedSite, bounds: PinBounds): Promise<void> {
  stopIdle(site.slot);
  const generation = (shown.get(site.slot) ?? 0) + 1;
  shown.set(site.slot, generation);
  await closing.get(site.slot)?.catch(() => {});
  if (shown.get(site.slot) !== generation) return;
  await pinnedSiteOpen(site.slot, site.url, site.store, bounds);
  live.add(site.slot);
}

export function movePin(site: PinnedSite, bounds: PinBounds): Promise<void> {
  return pinnedSiteSetBounds(site.slot, site.store, bounds).catch(() => {});
}

/** The panel closed: hide the page, and close it once it's been hidden a while
 * (unless it's shown again first). */
export function hidePin(site: PinnedSite, idleMs = PIN_IDLE_CLOSE_MS): void {
  if (!live.has(site.slot)) return;
  void pinnedSiteHide(site.slot).catch(() => {});
  stopIdle(site.slot);
  const generation = shown.get(site.slot);
  idle.set(
    site.slot,
    setTimeout(() => {
      idle.delete(site.slot);
      if (shown.get(site.slot) !== generation) return;
      void closeSlot(site.slot).catch(() => {});
    }, idleMs),
  );
}

/** Pin a site (Settings). Returns false when it can't be added. */
export function addPin(name: string, link: string): boolean {
  const { sites, setSites } = usePinnedSites.getState();
  const next = withPin(sites, name, link);
  if (!next) return false;
  setSites(next);
  return true;
}

/** Unpin a site and sign it out: its page closes, then its store is deleted,
 * and only then is its slot free for another pin. A failure keeps the pin
 * (so removing can be tried again) and is thrown for Settings to show. */
export async function removePin(id: string): Promise<void> {
  const site = usePinnedSites.getState().sites.find((candidate) => candidate.id === id);
  if (!site) return;
  stopIdle(site.slot);
  shown.set(site.slot, (shown.get(site.slot) ?? 0) + 1);
  if (usePinnedSites.getState().open === id) closePinPanel();
  await closeSlot(site.slot);
  await pinnedSiteForget(site.store);
  const { sites, setSites } = usePinnedSites.getState();
  setSites(sites.filter((candidate) => candidate.id !== id));
}

/** A native page draws over everything, so ⌘K, Settings, and menus put the
 * open pin away the moment they open, before they paint. Returns the stop. */
export function hidePinsUnderOverlays(
  overlays: readonly { subscribe: (listener: () => void) => () => void; isOpen: () => boolean }[],
): () => void {
  const stops = overlays.map((overlay) =>
    overlay.subscribe(() => {
      const { open, sites } = usePinnedSites.getState();
      const site = sites.find((candidate) => candidate.id === open);
      if (!site || !overlay.isOpen()) return;
      hidePin(site);
      closePinPanel();
    }),
  );
  return () => stops.forEach((stop) => stop());
}

/** Whether a pin's page is a real one (the Mac app) or the browser twin's note. */
export const pinsAreNative = (): boolean => isTauri();
