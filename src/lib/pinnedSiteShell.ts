// The pinned-site pages in the Mac app (src-tauri/src/pinned_site.rs). Off the
// Mac app every call is a quiet no-op: the browser build has no native pages.

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./tauri";

export interface PinBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether this Mac keeps a store per site (macOS 14+). */
export const pinnedSitesSupported = (): Promise<boolean> =>
  isTauri() ? invoke<boolean>("pinned_sites_supported") : Promise.resolve(false);

export const pinnedSiteOpen = (slot: number, url: string, store: string, bounds: PinBounds): Promise<void> =>
  isTauri() ? invoke("pinned_site_open", { slot, url, store, bounds }) : Promise.resolve();

export const pinnedSiteSetBounds = (slot: number, bounds: PinBounds): Promise<void> =>
  isTauri() ? invoke("pinned_site_set_bounds", { slot, bounds }) : Promise.resolve();

export const pinnedSiteHide = (slot: number): Promise<void> =>
  isTauri() ? invoke("pinned_site_hide", { slot }) : Promise.resolve();

export const pinnedSiteClose = (slot: number): Promise<void> =>
  isTauri() ? invoke("pinned_site_close", { slot }) : Promise.resolve();

/** Sign the site out: delete its store (close its page first). */
export const pinnedSiteForget = (store: string): Promise<void> =>
  isTauri() ? invoke("pinned_site_forget", { store }) : Promise.resolve();
