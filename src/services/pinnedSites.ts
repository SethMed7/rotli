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

function stopIdle(slot: number): void {
  const timer = idle.get(slot);
  if (timer) clearTimeout(timer);
  idle.delete(slot);
}

/** Ask this Mac once whether pins can keep their own stores. The browser
 * twin of the Mac app says yes (its panel explains the page is the app's);
 * Rotli Web has no pins. */
export async function loadPinSupport(): Promise<void> {
  const supported =
    PLATFORM === "web" ? false : isTauri() ? await pinnedSitesSupported().catch(() => false) : true;
  usePinnedSites.setState({ supported });
}

/** The title bar's pin: open its panel, or close it when it's the one open. */
export function togglePin(id: string): void {
  const { open, setOpen } = usePinnedSites.getState();
  setOpen(open === id ? null : id);
}

export function closePinPanel(): void {
  usePinnedSites.getState().setOpen(null);
}

/** Show a pin's page over the panel's body (opened, or brought back). */
export function showPin(site: PinnedSite, bounds: PinBounds): Promise<void> {
  stopIdle(site.slot);
  live.add(site.slot);
  return pinnedSiteOpen(site.slot, site.url, site.store, bounds);
}

export function movePin(site: PinnedSite, bounds: PinBounds): Promise<void> {
  return pinnedSiteSetBounds(site.slot, bounds).catch(() => {});
}

/** The panel closed: hide the page, and close it once it's been hidden a while. */
export function hidePin(site: PinnedSite): void {
  if (!live.has(site.slot)) return;
  void pinnedSiteHide(site.slot).catch(() => {});
  stopIdle(site.slot);
  idle.set(
    site.slot,
    setTimeout(() => {
      idle.delete(site.slot);
      live.delete(site.slot);
      void pinnedSiteClose(site.slot).catch(() => {});
    }, PIN_IDLE_CLOSE_MS),
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

/** Unpin a site and sign it out: its page closes and its store is deleted. */
export async function removePin(id: string): Promise<void> {
  const { sites, setSites } = usePinnedSites.getState();
  const site = sites.find((candidate) => candidate.id === id);
  if (!site) return;
  setSites(sites.filter((candidate) => candidate.id !== id));
  stopIdle(site.slot);
  live.delete(site.slot);
  await pinnedSiteClose(site.slot).catch(() => {});
  await pinnedSiteForget(site.store).catch(() => {});
}

/** Whether a pin's page is a real one (the Mac app) or the browser twin's note. */
export const pinsAreNative = (): boolean => isTauri();
