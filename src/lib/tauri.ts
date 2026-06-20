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

/** Finish a capture (Enter-save / Esc-dismiss): hide the card AND return focus
 * to where you were — rotli's main window if you were in it, otherwise the app
 * you came from. So capturing from another app never surfaces rotli (#5). */
export async function finishCapture(): Promise<void> {
  if (!isTauri()) return;
  await invoke("finish_capture_window");
}

/** The Quick Note window (Raycast-style floating note): summoned by its own
 * global chord (default ⌥Q), hides on blur. toggle = show if hidden / behind,
 * hide if focused. */
export async function toggleQuickWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("toggle_quick_window");
}

export async function showQuickWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("show_quick_window");
}

export async function hideQuickWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_quick_window");
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

// ——— the corpus (phase 2) — typed wrappers over the Rust corpus commands
//     (src-tauri/src/corpus.rs). Only FsNotesService and the persistence
//     layer (src/state/persist.ts) call these, and both exist only inside the
//     shell; the guard turns a stray browser call into a loud, clear
//     rejection instead of a silent hang. ———

/** Folder ids ARE relative paths inside the corpus root ("Work/Myela"). */
export interface CorpusFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CorpusNoteMeta {
  id: string;
  title: string;
  snippet: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /** Where a note came from before it was moved into Archive/Trash — Rust
   * bakes the rule (set on entering a hidden root, cleared on leaving). Null
   * for a note that lives in a normal folder (Seth, 2026-06-13). */
  origin?: string | null;
}

export interface CorpusListPayload {
  folders: CorpusFolder[];
  notes: CorpusNoteMeta[];
}

export interface CorpusNoteDoc {
  id: string;
  folderId: string;
  /** Frontmatter stripped — exactly what the editor edits. */
  body: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /** The restore breadcrumb (see CorpusNoteMeta.origin); corpus_read returns
   * it so restore can send a note back where it came from (Seth, 2026-06-13). */
  origin?: string | null;
}

/** Tauri command errors arrive as plain strings — normalize to Error so
 * callers (the editor model's unknown-note eviction) can rely on .message. */
function corpusInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(new Error(`${cmd}: the corpus only exists inside the Tauri shell`));
  }
  return invoke<T>(cmd, args).catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  });
}

export function corpusList(): Promise<CorpusListPayload> {
  return corpusInvoke("corpus_list");
}

export function corpusRead(id: string): Promise<CorpusNoteDoc> {
  return corpusInvoke("corpus_read", { id });
}

export function corpusWrite(id: string, body: string, pinned: boolean): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_write", { id, body, pinned });
}

export function corpusCreate(folderId: string, body: string): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_create", { folderId, body });
}

export function corpusDelete(id: string): Promise<void> {
  return corpusInvoke("corpus_delete", { id });
}

/** Move a note into target_folder, PRESERVING its id + index; Rust creates the
 * folder if needed and bakes the origin rule (record where it came from on the
 * way into Archive/Trash, clear it on the way out). Tauri maps JS targetFolder
 * ↔ the Rust target_folder arg (Seth, 2026-06-13). */
export function corpusMove(id: string, targetFolder: string): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_move", { id, targetFolder });
}

export function corpusCreateFolder(
  name: string,
  parentId: string | null,
): Promise<CorpusFolder> {
  return corpusInvoke("corpus_create_folder", { name, parentId });
}

/** Settings → Storage truth: the real root (home shortened to `~`), every
 * folder, every note file — what actually exists on disk, never a mock. */
export interface CorpusOverview {
  root: string;
  folders: string[];
  files: string[];
}

export function corpusOverview(): Promise<CorpusOverview> {
  return corpusInvoke("corpus_overview");
}

/** Reveal the corpus folder in Finder. */
export async function revealCorpus(): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_reveal");
}

/** Open a native folder picker; if a (empty) destination is chosen, move the
 * whole corpus there, persist it as the new root, and relaunch into it.
 * Resolves false when the picker is cancelled; rejects with a clear message
 * when the target isn't usable. */
export async function relocateCorpus(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("corpus_relocate");
}

/** The `.rotli/` dot-files — opaque JSON strings the frontend owns. Missing
 * file reads as "{}". `background` carries the custom glass wallpaper. */
export type SettingsFile = "settings" | "viewstate" | "background";

export function corpusSettingsRead(file: SettingsFile): Promise<string> {
  return corpusInvoke("corpus_settings_read", { file });
}

export function corpusSettingsWrite(file: SettingsFile, contents: string): Promise<void> {
  return corpusInvoke("corpus_settings_write", { file, contents });
}

/** Rust → main window: the corpus changed UNDER the app (a folder dropped in,
 * a note edited in another editor). Debounced Rust-side; the frontend just
 * invalidates and refetches — content appears when ready, no spinners. */
export function onCorpusChanged(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:corpus-changed", () => cb());
  return () => void unlisten.then((fn) => fn());
}

// ——— cross-webview events (the capture card and the main window are separate
//     webviews; the main window owns the corpus service) ———

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

/** Rust → quick webview: the card was just summoned (refocus the editor). */
export function onQuickShow(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:quick-show", () => cb());
  return () => void unlisten.then((fn) => fn());
}

export interface QuickStatePayload {
  /** The capped set of quick-access note ids, in switcher order. */
  ids: string[];
  /** The note the window reopens on (remembers where you were). */
  activeId: string | null;
  /** Folder new quick notes are created in. */
  folder: string;
}

/** Keep the quick-access set in step across the main + quick webviews — the
 * same one-keymap-two-webviews pattern as rebinds. Only the MAIN window
 * persists it (the single settings writer); the quick window emits its changes
 * so main can record them. */
export function emitQuickSet(state: QuickStatePayload): void {
  if (!isTauri()) return;
  void emit("rotli:quick-set", state);
}

export function onQuickSet(cb: (state: QuickStatePayload) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<QuickStatePayload>("rotli:quick-set", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}

/** Theme + glass settings, broadcast from the MAIN window so the quick + capture
 * webviews follow the chosen theme live (they each apply their own theme from
 * their store; without this they'd only pick it up from settings.json at launch
 * and go stale when you change it). Loose string types avoid a ui<->tauri import
 * cycle; the receiver casts back to the ui store's unions. */
export interface ThemePayload {
  theme: "light" | "dark" | "system";
  themeFamily: "warm" | "mono";
  matchLightFamily: "warm" | "mono";
  matchDarkFamily: "warm" | "mono";
  glassMode: boolean;
  glassTint: string;
  glassBackground: string;
  glassClarity: string;
  glassBlur: string;
  glassCanvas: string;
  /** The custom glass wallpaper data-URL (or null) — must ride along so a
   * window picks up a wallpaper uploaded/changed AFTER it launched. */
  customBackground: string | null;
}

export function emitThemeSet(payload: ThemePayload): void {
  if (!isTauri()) return;
  void emit("rotli:theme-set", payload);
}

export function onThemeSet(cb: (payload: ThemePayload) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<ThemePayload>("rotli:theme-set", (event) => cb(event.payload));
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
