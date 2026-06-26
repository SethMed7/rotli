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

// ——— in-app updates (Part 2 — the signed updater feed) — guarded so the
//     browser/dev demo never imports the plugins; outside Tauri every call is a
//     safe no-op ("nothing available, nothing to install"). The Rust side
//     registers tauri-plugin-updater + tauri-plugin-process and the capability
//     grants updater:default + process:allow-restart. CARL rule 2: nothing here
//     pings on its own — the UI (Settings + a quiet App.tsx mount check) drives it.

export interface UpdateStatus {
  available: boolean;
  version?: string;
  notes?: string;
}

/** Ask the feed once whether a newer signed build exists. Resolves
 * { available:false } outside Tauri, or when the feed says we're current. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!isTauri()) return { available: false };
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return { available: false };
  // exactOptionalPropertyTypes: only set the optional keys when present —
  // never assign explicit undefined.
  const status: UpdateStatus = { available: true };
  if (update.version) status.version = update.version;
  if (update.body) status.notes = update.body;
  return status;
}

/** Download + install the pending update (re-checks so we hold a fresh handle),
 * reporting 0–100% progress, then relaunch into the new build. No-op outside
 * Tauri or when nothing is available. */
export async function downloadAndInstallUpdate(
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (!isTauri()) return;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return;
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress?.(0);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0);
    } else if (event.event === "Finished") {
      onProgress?.(100);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
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
  /** "note" (a .md file) or "board" (a .excalidraw canvas). Rust serde-defaults
   * to "note" for back-compat, so it's optional on the wire. */
  kind?: "note" | "board";
}

/** What corpus_read_board returns — the raw .excalidraw JSON plus file meta.
 * No pinned/origin (boards carry no frontmatter and never enter the index). */
export interface CorpusBoardDoc {
  id: string;
  folderId: string;
  /** The raw .excalidraw JSON string, verbatim. */
  body: string;
  createdAt: number;
  updatedAt: number;
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

// ——— boards (Excalidraw): real *.excalidraw files in the corpus, next to the
//     .md notes. A board id IS its corpus-relative path; boards carry no
//     frontmatter and never join the ulid index. ———

/** Read a board's raw .excalidraw JSON. Rejects if the id isn't .excalidraw,
 * escapes the root, or the file is missing. */
export function corpusReadBoard(id: string): Promise<CorpusBoardDoc> {
  return corpusInvoke("corpus_read_board", { id });
}

/** Write a board's raw .excalidraw JSON verbatim (passes the memex writable
 * gate). Returns the board's meta (kind === "board"). */
export function corpusWriteBoard(id: string, body: string): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_write_board", { id, body });
}

/** Create a new board in folderId (filename auto-picked, collision-safe).
 * Omit body for an empty Excalidraw scene. The returned meta.id IS the new
 * board's corpus-relative path. */
export function corpusCreateBoard(folderId: string, body?: string): Promise<CorpusNoteMeta> {
  // exactOptionalPropertyTypes: only pass body when present.
  return corpusInvoke("corpus_create_board", body === undefined ? { folderId } : { folderId, body });
}

/** Rename a board (.excalidraw) within its folder. `name` is a free stem (no
 * extension). Returns the board's NEW meta — its `id` is the new relpath, so the
 * caller retargets any open canvas tab to it. */
export function corpusRenameBoard(id: string, name: string): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_rename_board", { id, name });
}

/** One chat-capable model the memex-ai store can serve (read from
 * ~/.memex/ai/registry.json by Rust). `api` is the server wire shape. */
export interface ChatModelInfo {
  id: string;
  label: string;
  provider: string;
  endpoint: string;
  api: string;
  isDefault: boolean;
}

/** Chat front: the on-device models the memex-ai store declares (kind:llm-chat).
 * Always returns at least the MLX default, even if the registry is missing. */
export function chatModels(): Promise<ChatModelInfo[]> {
  return invoke<ChatModelInfo[]>("chat_models");
}

/** Chat front: one-shot completion from the on-device model. The Rust side POSTs
 * the local model server (the webview CSP can't reach localhost). Rejects with a
 * readable error string if the model isn't running. Pass the picked model's
 * endpoint/model/api to target a specific memex-ai model (else the MLX default). */
export function chatComplete(
  prompt: string,
  opts?: { model?: string; endpoint?: string; api?: string },
): Promise<string> {
  return invoke<string>("chat_complete", {
    prompt,
    model: opts?.model,
    endpoint: opts?.endpoint,
    api: opts?.api,
  });
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

/** Connect a destination root to an external folder (Track 2 multi-root): opens
 * a native folder picker (no path) — or takes an explicit path (programmatic) —
 * and REGISTERS the chosen dir as that destination's root in corpus-roots.json.
 * It REGISTERS, never moves/relocates. For the "vault" dest the folder MUST be a
 * valid memex (else it rejects). The app restarts on success, so it never
 * resolves in practice; resolves false only when the picker is cancelled. */
export async function corpusSetRoot(destId: string, path?: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("corpus_set_root", { destId, path: path ?? null });
}

/** Point rotli's Notes tree at a memex instance (Increment 3): validates the
 * path is a real memex, remembers it as the corpus-memex pointer, and relaunches
 * into it. The legacy ~/Documents/rotli corpus is left untouched — this is a
 * reversible pointer swap. Rejects with a clear message if the folder isn't a
 * memex. The app restarts on success, so this never resolves in practice. */
export async function corpusUseMemex(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_use_memex", { path });
}

/** Forget the memex pointer and relaunch into the legacy ~/Documents/rotli
 * corpus. The reversible counterpart to corpusUseMemex. */
export async function corpusUseLegacy(): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_use_legacy");
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

// ——— the memex seam (Stage 1) — typed wrappers over the Rust memex commands
//     (src-tauri/src/memex.rs). rotli connects to / initiates a memex instance
//     (the shared self/wiki/history/chats/inbox.md spine; for Seth, ~/memex-vault)
//     and OWNS chats/ + inbox.md, nothing else. Mirror-not-import: the byte-shape
//     of what we write lives in src/memex/contract.ts; these only move bytes. ———

/** A folder probed for a memex signature (the memex.json `mx_` marker). */
export interface DetectedMemex {
  root: string;
  label: string;
  /** "memex" (real, mx_ memex.json) · "plain" (a dir, no valid memex.json) ·
   * "fresh" (empty/absent — safe to init). */
  kind: "memex" | "plain" | "fresh";
  memexId: string | null;
  contract: string | null;
  hasUsersJson: boolean;
  /** Raw users.json contents (TS parses access mode with the mirror codec). */
  usersJson: string | null;
}

export type MemexPerms = "chats+inbox" | "read-only";

/** A registered memex instance (the machine-level registry lives outside any
 * corpus, in the app config dir). */
export interface MemexInstanceEntry {
  id: string;
  label: string;
  absPath: string;
  role: string;
  memexId: string | null;
  mode: string | null;
  perms: MemexPerms;
}

export interface MemexRegistry {
  version: number;
  activeId: string | null;
  instances: MemexInstanceEntry[];
}

export interface MemexContractRaw {
  memexJson: string;
  usersJson: string;
  identitiesJson: string;
}

export interface MemexChatSummary {
  slug: string;
  title: string;
  source: string;
  attachedTo: string;
  path: string;
}

/** One entry in the READ-ONLY Memory browser — a subdir or a .md file. */
export interface MemexDirEntry {
  name: string;
  rel: string;
  isDir: boolean;
}

export interface MemexValidateReport {
  ok: boolean;
  skipped: boolean;
  stdout: string;
  errors: number;
  warnings: number;
}

function memexInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(new Error(`${cmd}: the memex bridge only exists inside the Tauri shell`));
  }
  return invoke<T>(cmd, args).catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  });
}

export function memexDetect(): Promise<DetectedMemex[]> {
  return memexInvoke("memex_detect");
}
export function memexInspect(path: string): Promise<DetectedMemex> {
  return memexInvoke("memex_inspect", { path });
}
export function memexReadContract(root: string): Promise<MemexContractRaw> {
  return memexInvoke("memex_read_contract", { root });
}
export function memexRead(root: string, rel: string): Promise<string> {
  return memexInvoke("memex_read", { root, rel });
}
export function memexListChats(root: string): Promise<MemexChatSummary[]> {
  return memexInvoke("memex_list_chats", { root });
}
export function memexListDir(root: string, rel: string): Promise<MemexDirEntry[]> {
  return memexInvoke("memex_list_dir", { root, rel });
}
export function memexInit(path: string, label: string): Promise<MemexInstanceEntry> {
  return memexInvoke("memex_init", { path, label });
}
export function memexConnect(path: string, label: string): Promise<MemexInstanceEntry> {
  return memexInvoke("memex_connect", { path, label });
}
export function memexWriteChat(root: string, slug: string, contents: string): Promise<string> {
  return memexInvoke("memex_write_chat", { root, slug, contents });
}
/** Write a v3.5 note (full bytes composed by the contract codec) into wiki/_inbox/
 *  staging as `<stem>.md`. Returns the absolute path. */
export function memexWriteNote(root: string, stem: string, contents: string): Promise<string> {
  return memexInvoke("memex_write_note", { root, stem, contents });
}
export function memexAppendInbox(root: string, line: string): Promise<void> {
  return memexInvoke("memex_append_inbox", { root, line });
}
export function memexValidate(root: string): Promise<MemexValidateReport> {
  return memexInvoke("memex_validate", { root });
}
export function memexListInstances(): Promise<MemexRegistry> {
  return memexInvoke("memex_list_instances");
}
export function memexSetActive(id: string): Promise<void> {
  return memexInvoke("memex_set_active", { id });
}
export function memexSetPerms(id: string, perms: MemexPerms): Promise<void> {
  return memexInvoke("memex_set_perms", { id, perms });
}
export function memexPickFolder(): Promise<string | null> {
  return memexInvoke("memex_pick_folder");
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
