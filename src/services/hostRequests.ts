// What the native shell asks of the main page: a host's request to show
// Settings on a pane (host.rs `open_settings`), and the notice for something
// handed over from Finder that didn't open. Rust holds both until the page
// says it listens, so a cold launch's notice and request still arrive
// (docs/architecture/host-seams.md, "Held for the page").

import { hiddenPanes, opensPane, settingsNav } from "../components/settings/settingsNav";
import { type AppHost, appHost, notesOn } from "../host/registry";
import { type Platform, PLATFORM } from "../lib/featurePolicy";
import { type HeldForPage, hostPageReady, isTauri, listenHere, showMainWindow } from "../lib/tauri";
import { useUiStore } from "../state/ui";

/** Whether a request for `id` opens a pane, judged as a pane's link is: the
 * pane shows in this build's nav right now. An id no pane has warns under
 * the dev server instead of throwing, since the request came from outside. */
export function settingsPaneOpens(
  id: string,
  host: AppHost | null = appHost(),
  platform: Platform = PLATFORM,
  dev: boolean = !!import.meta.env.DEV,
): boolean {
  const nav = settingsNav(platform, host, hiddenPanes(host));
  try {
    return opensPane(id, nav, host, dev);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Settings on `id`, through the same store request the app's own links use.
 * A host without notes has Settings as its whole window already, so only the
 * pane changes: the open flag would switch its titlebar to the Settings
 * identity. */
export function openSettingsOn(id: string, host: AppHost | null = appHost()): void {
  const ui = useUiStore.getState();
  ui.setSettingsPaneRequest(id);
  if (notesOn(host)) ui.setSettingsOpen(true);
}

export interface SettingsRequestSteps {
  opens: (id: string) => boolean;
  open: (id: string) => void;
  show: () => Promise<void>;
}

const SETTINGS_STEPS: SettingsRequestSteps = {
  opens: (id) => settingsPaneOpens(id),
  open: (id) => openSettingsOn(id),
  show: () => showMainWindow(),
};

/** A host's Settings request: the window comes forward on the pane, or, for
 * an id that opens nothing, nothing happens at all. */
export function openSettingsFromHost(id: string, steps: SettingsRequestSteps = SETTINGS_STEPS): boolean {
  if (!steps.opens(id)) return false;
  steps.open(id);
  void steps.show().catch(() => {});
  return true;
}

export interface PageRequestHandlers {
  notice: (message: string) => void;
  settings: (id: string) => void;
}

/** What was held, in the order it came: notices first, then Settings. */
export function deliverHeld(held: HeldForPage, handlers: PageRequestHandlers): void {
  for (const message of held.notices) handlers.notice(message);
  for (const id of held.settings) handlers.settings(id);
}

type Listen = (event: string, handler: (event: { payload: string }) => void) => Promise<() => void>;

export interface PageTransport {
  /** `listenHere`: only this window's copy of an event Rust addresses to it. */
  listenHere: Listen;
  ready: () => Promise<HeldForPage>;
}

const TAURI_TRANSPORT: PageTransport = { listenHere: listenHere<string>, ready: hostPageReady };

/** Listen for notices and Settings requests, then take what Rust held.
 * Listening first means nothing falls between the two. Returns the stop. */
export function attachPageRequests(
  handlers: PageRequestHandlers,
  transport: PageTransport = TAURI_TRANSPORT,
): () => void {
  let stopped = false;
  const listening = Promise.all([
    transport.listenHere("rotli:open-notice", (event) => handlers.notice(event.payload)),
    transport.listenHere("rotli:open-settings", (event) => handlers.settings(event.payload)),
  ]);
  void listening
    .then(async () => {
      // a mount torn down before it listened leaves the held items to the next
      if (stopped) return;
      // Rust released them on this call: deliver them even if the mount went
      deliverHeld(await transport.ready(), handlers);
    })
    .catch(() => {});
  return () => {
    stopped = true;
    void listening.then((stops) => stops.forEach((stop) => stop())).catch(() => {});
  };
}

/** The main page's handlers: notices go to the row-error line, Settings
 * requests to `openSettingsFromHost`. */
export const MAIN_PAGE_HANDLERS: PageRequestHandlers = {
  notice: (message) => useUiStore.getState().setRowActionError(message),
  settings: (id) => void openSettingsFromHost(id),
};

/** The main page's wiring. A no-op outside the shell. */
export function attachMainPageRequests(): () => void {
  if (!isTauri()) return () => {};
  return attachPageRequests(MAIN_PAGE_HANDLERS);
}
