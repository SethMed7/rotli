// Tauri seam — every Tauri API call in the frontend goes through here, guarded
// by isTauri(), so the whole UI renders in a plain browser (vite dev, no shell).

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function hideMainWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_main_window");
}

export async function toggleMainWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("toggle_main_window");
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("show_main_window");
}

export async function hideCaptureWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_capture_window");
}

/** The summon law, applied from Rust: main visible → hide the app;
 * otherwise → the quick-capture card. */
export async function summon(): Promise<void> {
  if (!isTauri()) return;
  await invoke("summon");
}

/** Re-register an OS-wide chord (used when a global action is rebound);
 * null unregisters it. actionId ∈ { "capture.summon", "app.toggleWindow" }.
 * Rejects when the OS refuses the chord — the caller must NOT have committed
 * the rebind yet. */
export async function setGlobalShortcut(
  actionId: string,
  accelerator: string | null,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_summon_shortcut", { actionId, accelerator });
}

/** Settings → General → "Stay open": when false, clicking away no longer
 * hides the main window. */
export async function setHideOnBlur(hide: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_hide_on_blur", { hide });
}

/** Settings → General → "Show in Dock": Accessory (menu-bar only, default)
 * vs Regular (normal Dock app). */
export async function setDockVisible(visible: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_dock_visible", { visible });
}

/** Manual drag (instead of data-tauri-drag-region) so double-clicking the
 * titlebar never triggers the built-in maximize/zoom. */
export async function startWindowDrag(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().startDragging();
}

// ——— cross-webview events (the capture card and the main window are separate
//     webviews; the main window owns the in-memory corpus) ———

export interface CapturePayload {
  /** Correlates the save with its ack — the card clears the draft only then. */
  id: string;
  body: string;
  open: boolean;
}

/** Capture card → main window: "save this into Inbox" (+ open it if asked). */
export function emitCaptureSave(id: string, body: string, open: boolean): void {
  if (!isTauri()) return;
  void emit("rotli:capture", { id, body, open } satisfies CapturePayload);
}

export function onCaptureSave(cb: (payload: CapturePayload) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<CapturePayload>("rotli:capture", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}

/** Main window → capture card: the capture landed in the corpus — safe to
 * clear the draft. Without this round-trip a capture emitted while the main
 * webview isn't listening would vanish along with the already-cleared draft. */
export function emitCaptureAck(id: string): void {
  if (!isTauri()) return;
  void emit("rotli:capture-ack", id);
}

export function onCaptureAck(cb: (id: string) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<string>("rotli:capture-ack", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}

/** Rust → capture webview: the card was just summoned (refocus the field). */
export function onCaptureShow(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:capture-show", () => cb());
  return () => void unlisten.then((fn) => fn());
}

export interface RebindPayload {
  actionId: string;
  chord: string | null;
}

/** Keep both webviews' bindings stores in step when a chord is rebound. */
export function emitRebind(actionId: string, chord: string | null): void {
  if (!isTauri()) return;
  void emit("rotli:rebind", { actionId, chord } satisfies RebindPayload);
}

export function onRebind(cb: (payload: RebindPayload) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<RebindPayload>("rotli:rebind", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}
