// Tauri seam — every Tauri API call in the frontend goes through here, guarded
// by isTauri(), so the whole UI renders in a plain browser (vite dev, no shell).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { DEFAULT_BREVE_PDF_THEME } from "../brand/brevePdfThemes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SearchHit } from "../types";

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
export async function setGlobalShortcut(actionId: string, accelerator: string | null): Promise<void> {
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

/** Swap the macOS Dock/app icon at runtime. "default" resets to the bundle icon. */
export async function setAppIcon(variant: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_app_icon", { variant });
}

/** Demo mode — swap to an isolated demo corpus (or back) + relaunch. Never
 * touches the real corpus config, so real notes are perfectly safe. */
export async function setDemoMode(on: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_demo_mode", { on });
}
/** Is demo mode currently on? */
export async function demoMode(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("demo_mode");
}

/** Manual drag (instead of data-tauri-drag-region) so double-clicking the
 * titlebar never triggers the built-in maximize/zoom. */
export async function startWindowDrag(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().startDragging();
}

/** Toggle the main window between maximized (zoom) and its restored size — the
 * standard macOS titlebar double-click, re-enabled here since the manual drag
 * suppresses the native one. */
export async function toggleMaximize(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().toggleMaximize();
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

/** Read the installed bundle version without exposing the Tauri app plugin to
 * presentation. Browser review has no bundle and returns null. */
export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
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
export async function downloadAndInstallUpdate(onProgress?: (pct: number) => void): Promise<void> {
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
  /** Current filename/title selectors plus durable rename aliases. */
  aliases?: string[];
  /** User-facing shelf/folder projection. */
  folderId: string;
  /** Physical folder containing the file (for Brain location/reveal). */
  diskFolderId?: string | undefined;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /** Where a note came from before it was moved into Archive/Trash — Rust
   * bakes the rule (set on entering a hidden root, cleared on leaving). Null
   * for a note that lives in a normal folder (Seth, 2026-06-13). */
  origin?: string | null;
  /** "note" (a .md file) · "board" (a .excalidraw canvas) · "file" (any other
   * file — image/pdf/…, surfaced read-only, opened in the OS default app). Rust
   * serde-defaults to "note" for back-compat, so it's optional on the wire. */
  kind?: "note" | "board" | "file";
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
  /** Physical folder containing the file (for Brain location/reveal). */
  diskFolderId?: string | undefined;
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

/** FULL-TEXT note search (corpus_search): Rust walks + reads + matches every
 * root — title > body ranking with a highlighted-match snippet (char offsets;
 * see SearchHit in src/types.ts). A local user read: secure notes stay in,
 * bodies are never logged. */
export function corpusSearch(query: string, limit?: number): Promise<SearchHit[]> {
  return corpusInvoke("corpus_search", limit === undefined ? { query } : { query, limit });
}

export function corpusRead(id: string): Promise<CorpusNoteDoc> {
  return corpusInvoke("corpus_read", { id });
}

export function corpusWrite(id: string, body: string): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_write", { id, body });
}

export function corpusCreate(
  folderId: string,
  body: string,
  policy?: { secure?: boolean },
): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_create", { folderId, body, secure: policy?.secure ?? false });
}

export function corpusDelete(id: string): Promise<void> {
  return corpusInvoke("corpus_delete", { id });
}

/** Hard-discard a BLANK note (ephemeral-note lifecycle) — bypasses the in-app
 * Trash folder; Rust re-verifies blankness and refuses anything with content. */
export function corpusDiscardBlank(id: string): Promise<void> {
  return corpusInvoke("corpus_discard_blank", { id });
}

/** Move a note into target_folder, PRESERVING its id + index; Rust creates the
 * folder if needed and bakes the origin rule (record where it came from on the
 * way into Archive/Trash, clear it on the way out). Tauri maps JS targetFolder
 * ↔ the Rust target_folder arg (Seth, 2026-06-13). */
export function corpusMove(id: string, targetFolder: string): Promise<CorpusNoteMeta> {
  return corpusInvoke("corpus_move", { id, targetFolder });
}

export function corpusCreateFolder(name: string, parentId: string | null): Promise<CorpusFolder> {
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
  /** Can this model see attached images? Gates the composer's image affordance. */
  vision: boolean;
  isDefault: boolean;
  /** Is this the shared MLX server's PINNED DEFAULT (what no-model callers like
   * Breve get)? A Settings badge + the uninstall guard — NOT a usability gate:
   * since server 0.3 every installed mlx model serves on demand per request.
   * Optional (absent on connected/preset synthetic models). */
  localDefault?: boolean;
}

/** The on-device model bridge (chat + web). Same guard+normalize contract as
 * corpusInvoke/memexInvoke: outside the shell it rejects with a clear Error
 * instead of hanging, and string command errors arrive as Error. */
function aiInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(new Error(`${cmd}: the on-device model only exists inside the Tauri shell`));
  }
  return invoke<T>(cmd, args).catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  });
}

/** Chat front: the on-device models the memex-ai store declares (kind:llm-chat).
 * Always returns at least the MLX default, even if the registry is missing. */
export function chatModels(): Promise<ChatModelInfo[]> {
  return aiInvoke("chat_models");
}

/** One message in the agent loop's transcript. `images` are base64 (raw or a full
 * `data:` URL) and only ride the vision/openai path. */
export interface ChatWireMsg {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

/** Multi-turn completion for the agentic client. The loop re-sends the growing
 * transcript each step; `formatJson` asks MLX to coerce a single JSON object. */
export function chatMessages(
  messages: ChatWireMsg[],
  opts?: {
    model?: string;
    endpoint?: string;
    api?: string;
    formatJson?: boolean;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> {
  return aiInvoke("chat_messages", {
    messages,
    model: opts?.model,
    endpoint: opts?.endpoint,
    api: opts?.api,
    formatJson: opts?.formatJson,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
  });
}

// ── connected models (the subscription CLIs + the Gemini key lane) ───────────

/** Settings → AI Models: one connected lane's cheap local probe (binary +
 * auth artifact; never a model call). */
export interface CliDetect {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
}

export function cliDetect(provider: string): Promise<CliDetect> {
  return aiInvoke("cli_detect", { provider });
}

/** One TOOL-LESS completion step on a connected CLI. Rust owns the binary +
 * model allowlist and the sandbox flags; the prompt is the only caller-shaped
 * input. `requestId` keys kill-on-cancel across the whole turn. */
export function cliComplete(args: {
  requestId: string;
  provider: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  return aiInvoke("cli_complete", { ...args });
}

/** Kill a live connected-CLI step (the composer's stop). Unknown id = no-op. */
export function cliCancel(requestId: string): Promise<void> {
  return aiInvoke("cli_cancel", { requestId });
}

// ── local model installer (the shared memex-ai store) ────────────────────────

/** In-flight download progress — the Settings UI polls this while an install
 * runs (byte total of the target dir; `done` once the weights land). */
export interface LocalInstallProgress {
  bytes: number;
  done: boolean;
}

/** Download an MLX model from Hugging Face into `~/.memex/ai/models/<name>` and
 * register it. Long-running (GB); poll `localModelInstallProgress(name)`. */
export function localModelInstall(args: {
  requestId: string;
  repo: string;
  name: string;
  approxMb?: number;
  vision?: boolean;
}): Promise<void> {
  return aiInvoke("local_model_install", { ...args });
}
export function localModelInstallProgress(name: string): Promise<LocalInstallProgress> {
  return aiInvoke("local_model_install_progress", { name });
}
export function localModelInstallCancel(requestId: string): Promise<void> {
  return aiInvoke("local_model_install_cancel", { requestId });
}
/** Make this installed model the shared server's DEFAULT (what no-model callers
 * like Breve get) — per-chat picks don't need this; any installed model serves. */
export function localModelSetDefault(id: string): Promise<void> {
  return aiInvoke("local_model_set_default", { id });
}
/** Remove an installed model (registry entry + trashed dir). Refuses the default one. */
export function localModelUninstall(id: string): Promise<void> {
  return aiInvoke("local_model_uninstall", { id });
}

/** "Scan my Mac" — the raw hardware facts; comfort tiers are computed in TS. */
export interface SystemProfile {
  chip: string;
  ramGb: number;
  cpuCores: number;
  freeDiskGb: number;
}
export function systemProfile(): Promise<SystemProfile> {
  return aiInvoke("system_profile");
}

/** Generate an image into a CHAT'S assets (`storage/chats/<slug>/`) via the
 * chosen connected engine. Rust pins the destination from the registered root
 * + slug — the prompt never shapes the path. Returns the corpus-relative path. */
export function generateImage(args: {
  requestId: string;
  root: string;
  slug: string;
  prompt: string;
  engine: "codex" | "agy";
}): Promise<string> {
  return aiInvoke("generate_image", { ...args });
}

/** Keychain account for the Gemini API key — one of keychain.rs's ALLOWED
 * names (parity.json keychainAllowedAccounts). */
export const SECRET_GEMINI_API_KEY = "gemini-api-key";

/** Keychain-backed secrets (Rust allowlists the names; a stored value never
 * crosses IPC back — only exists/absent does). */
export function secretStore(name: string, value: string): Promise<void> {
  return aiInvoke("secret_store", { name, value });
}
export function secretExists(name: string): Promise<boolean> {
  return aiInvoke("secret_exists", { name });
}
export function secretDelete(name: string): Promise<void> {
  return aiInvoke("secret_delete", { name });
}

/** One web search result the model sees. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/** Web search via DuckDuckGo (no key). Rejects a query that trips the secret guard. */
export function webSearch(query: string, limit?: number): Promise<WebResult[]> {
  return aiInvoke("web_search", { query, limit });
}

/** Fetch a page and return readable text (HTML stripped, capped by `maxChars`). */
export function webFetch(url: string, maxChars?: number): Promise<string> {
  return aiInvoke("web_fetch", { url, maxChars });
}

/** Open a rendered link in the user's browser/mail app (#14, audit 2026-07).
 * Rust allowlists the scheme (http/https/mailto only — never file:// or a
 * custom app scheme); the browser fallback keeps the review build working. */
export function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  }
  return invoke<void>("open_url", { url }).catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
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

/** A registered corpus root — the local default, the Vault, or an added folder. */
export interface CorpusRoot {
  id: string;
  label: string;
  absPath: string;
}

/** Add an arbitrary folder as a browsable + editable root (NOT moved into the
 * memex — opens read-write in place). No path ⇒ native folder picker. Adding a new
 * folder relaunches the app so it surfaces; returns false if the picker was cancelled. */
export function corpusAddFolder(path?: string): Promise<boolean> {
  return corpusInvoke("corpus_add_folder", path === undefined ? {} : { path });
}

/** Forget an added folder root (the files on disk are never touched). Relaunches. */
export function corpusForgetFolder(id: string): Promise<void> {
  return corpusInvoke("corpus_forget_folder", { id });
}

/** Reveal the corpus folder in Finder. */
export async function revealCorpus(): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_reveal");
}

/** Open a surfaced non-note FILE (kind "file") in the OS default app — rotli
 * never opens it as markdown. No-op outside Tauri. */
export async function corpusOpenFile(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_open_file", { id });
}

/** Import a dropped external file into the corpus's binary area (the memex
 * `storage/`, or local `Storage/`). `path` is the OS source path from a drag-drop;
 * rotli COPIES it. Returns the new file's wire id. No-op outside Tauri. */
export async function corpusImportFile(rootId: string, path: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_import_file", { rootId, path });
}

/** Absolute path for a corpus-relative path (e.g. a `storage:` asset). */
export async function corpusAbs(rootId: string, rel: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_abs", { rootId, rel });
}

/** Turn an image `src` from markdown into a displayable URL. `storage:NAME` →
 * the asset-protocol URL for `<corpus>/storage/NAME`; http/https/data/blob/asset
 * pass through; a bare relative path is treated as corpus-relative. macOS's
 * case-insensitive FS means `storage:` also resolves a legacy `Storage/` folder. */
export async function resolveImageSrc(src: string, rootId = "default"): Promise<string> {
  if (/^(https?:|data:|blob:|asset:)/i.test(src)) return src;
  const rel = src.startsWith("storage:") ? `storage/${src.slice("storage:".length)}` : src;
  const abs = await corpusAbs(rootId, rel);
  return abs ? convertFileSrc(abs) : "";
}

/** The corpus root a wire id belongs to ("default" for bare ids) — for
 * callers that must resolve RELATIVE resources (images) against the same
 * corpus the note lives in, not blindly against the default root. */
export function rootIdOf(id: string): string {
  return splitRootId(id).rootId;
}

/** Split a corpus wire id into its root + relative path. The default LOCAL root
 * emits BARE ids ("storage/x.mp3"); a non-default root prefixes "<rootid>:rel"
 * where rootid has no slash. Mirrors Rust `split_root_id`. */
function splitRootId(id: string): { rootId: string; rel: string } {
  const i = id.indexOf(":");
  if (i > 0 && !id.slice(0, i).includes("/")) {
    return { rootId: id.slice(0, i), rel: id.slice(i + 1) };
  }
  return { rootId: "default", rel: id };
}

/** Asset-protocol URL for a surfaced file note (kind "file"), to feed an
 * <audio>/<img>/<video>/<iframe>. "" outside Tauri or when it can't resolve. */
export async function fileAssetUrl(id: string): Promise<string> {
  if (!isTauri()) return "";
  const { rootId, rel } = splitRootId(id);
  const abs = await corpusAbs(rootId, rel);
  return abs ? convertFileSrc(abs) : "";
}

/** Read a surfaced FILE's text content (for the in-app text viewer). Capped on
 * the Rust side. "" outside Tauri. */
export async function corpusFileText(id: string, maxBytes?: number): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_file_text", { id, maxBytes });
}

/** Read a surfaced FILE as BASE64 (for a binary the viewer must parse, e.g. a
 * `.xlsx` spreadsheet). Capped on the Rust side. "" outside Tauri. */
export async function corpusFileBytes(id: string, maxBytes?: number): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_file_bytes", { id, maxBytes });
}

export interface FileStat {
  len: number;
  /** Whether the USER write lane may save this file (false in a memex/linked library). */
  writable: boolean;
  /** Whether this storage asset may move into the memex Archive or Trash. */
  lifecycleMutable: boolean;
  /** Filesystem birth/modify stamps (ms since epoch) — derived display facts
   * for the file-details panel; null when the filesystem can't report one. */
  createdMs: number | null;
  modifiedMs: number | null;
}

/** Size + writability probe for a surfaced file — the sheet editor decides
 * read-only vs editable up front. null outside Tauri (browser demo = read-only). */
export async function corpusFileStat(id: string): Promise<FileStat | null> {
  if (!isTauri()) return null;
  return invoke<FileStat>("corpus_file_stat", { id });
}

/** Move a surfaced storage asset into an in-memex lifecycle sink. */
export async function corpusMoveFileToSink(id: string, sink: "Archive" | "Trash"): Promise<string> {
  if (!isTauri()) return id;
  return invoke<string>("corpus_move_file_to_sink", { id, sink });
}

/** Restore a surfaced file from Archive/Trash to its original storage path. */
export async function corpusRestoreFile(id: string): Promise<string> {
  if (!isTauri()) return id;
  return invoke<string>("corpus_restore_file", { id });
}

/** Save a surfaced FILE's bytes back to disk (base64) — the sheet editor's
 * explicit Save. `bak` copies the pre-rotli original to `<name>.bak` once. */
export async function corpusWriteFileBytes(id: string, base64: string, bak = false): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_write_file_bytes", { id, base64, bak });
}

/** Create a Rotli-owned .xlsx/.docx in its managed storage lane. */
export async function corpusCreateManagedFile(name: string, base64: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_create_managed_file", { name, base64 });
}

/** Convert a legacy document or embedded-text PDF into a new managed DOCX
 * with local adapters. The source is never overwritten. */
export async function corpusConvertDocument(id: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_convert_document", { id });
}

/** False for read-only roots, including the production snapshot mounted in dev. */
export async function corpusManagedFileCreationAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("corpus_managed_file_creation_available");
}

/** Reveal a surfaced file in Finder. No-op outside Tauri. */
export async function corpusRevealFile(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_reveal_file", { id });
}

/** Which of the known "Open with …" apps (Numbers, Excel, Word, Pages, …) are installed. */
export async function corpusOpenWithApps(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("corpus_open_with_apps");
}

/** Open a surfaced file with a specific installed app (Rust allowlists names). */
export async function corpusOpenFileWith(id: string, app: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_open_file_with", { id, app });
}

export interface FrontmatterView {
  id: string;
  created: string;
  updated: string;
  locked: boolean;
  /** Secrets detected (auto-flagged) → never sent to a remote model + gitignored. */
  secure: boolean;
  /** Explicit opt-in for a secure note to be read by loopback-local AI. */
  localAiAllowed: boolean;
  /** Pinned to the top of every list (pinned → updated → id sort). */
  pinned: boolean;
  /** the foreign frontmatter lines (shelf/reach/area/summary/tags/links/…). */
  fields: string[];
}

/** Read a note's frontmatter for the metadata panel (display + lock state). */
export async function corpusFrontmatter(id: string): Promise<FrontmatterView | null> {
  if (!isTauri()) return null;
  return invoke<FrontmatterView>("corpus_frontmatter", { id });
}

/** Toggle the per-note AI lock (writes/removes a `locked: true` frontmatter line). */
export async function corpusSetLocked(id: string, locked: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_locked", { id, locked });
}

/** Toggle the per-note PIN (the typed `pinned` frontmatter fact) — floats the
 * note to the top of every list. Does not bump the note's `updated` stamp. */
export async function corpusSetPinned(id: string, pinned: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_pinned", { id, pinned });
}

/** The note's frontmatter as RAW TEXT (fences included), byte-exact from disk —
 * the "Show file metadata" view renders this above the body. "" when the note
 * has none (or outside Tauri). */
export async function corpusRawFrontmatter(id: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_raw_frontmatter", { id });
}

/** Write back a user-edited raw frontmatter block. Rust keeps the typed lines
 * verbatim, restores the reserved provenance keys (id/owner/created), and
 * refuses notes the user can't write (the same gate as every editor save). */
export async function corpusWriteFrontmatterRaw(id: string, block: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_write_frontmatter_raw", { id, block });
}

// ── the AI Filer (contract v3.7) — driven by the manual "file this note" for now ──

/** Set an AI-owned field (area/summary/tags/…) via the Filer lane. */
export async function corpusSetAiField(id: string, key: string, value: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_ai_field", { id, key, value });
}

/** File a note into the brain per its `area` field. Returns the note's NEW rel
 * path (a .md note's WIRE id is its ULID and survives the move — the rel path is
 * for the journal + retargeting a pane opened by path). */
export async function corpusFileNote(id: string): Promise<string> {
  return invoke<string>("corpus_file_note", { id });
}

/** Resolve a note's wire id to its current REL PATH — the ULID→rel bridge (a rel
 * path passes through). Staged-detection and the filing journal use this. */
export async function corpusNotePath(id: string): Promise<string> {
  return invoke<string>("corpus_note_path", { id });
}

/** Resolve a note's stable wire id all the way to its current ABSOLUTE file
 * path. Derived from the corpus router each time — never duplicated into
 * frontmatter, where a rename or filing move could make it stale. */
export async function corpusNoteAbsolutePath(id: string): Promise<string> {
  const wirePath = await corpusNotePath(id);
  const { rootId, rel } = splitRootId(wirePath);
  return corpusAbs(rootId, rel);
}

/** Move a note to a folder in the brain via the Filer lane (re-file / UNDO). */
export async function corpusFilerMove(id: string, targetFolder: string): Promise<CorpusNoteMeta> {
  return invoke<CorpusNoteMeta>("corpus_filer_move", { id, targetFolder });
}

/** (Re)write a generated per-area overview `wiki/<area>/_index.md` wholesale —
 * approving a daemon "index" proposal writes its full proposed body verbatim. */
export async function corpusWriteIndex(area: string, body: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_write_index", { area, body });
}

// ── the organizer daemon (Phase 4) — status + the trust knob. The daemon runs
//    in Rust (src-tauri/src/organizer.rs) and journals PROPOSALS; these wrappers
//    only read status and move the §4.3 trust rung. ──

export interface OrganizerStatus {
  /** false = no memex corpus, the worker never spawned. */
  running: boolean;
  trust: string;
  queued: number;
  lastRunAt: string | null;
  lastError: string | null;
  /** Notes skipped because they look like they hold secrets (§4.2.3) — the
   * daemon never read them; the UI tells the user to review them personally. */
  secureSkipped: number;
  modelOffline: boolean;
  /** A cycle is executing right now (drives the Activity live band). */
  busy: boolean;
}

export async function organizerStatus(): Promise<OrganizerStatus> {
  if (!isTauri()) {
    return {
      running: false,
      trust: "suggest",
      queued: 0,
      lastRunAt: null,
      lastError: null,
      secureSkipped: 0,
      modelOffline: false,
      busy: false,
    };
  }
  return invoke<OrganizerStatus>("organizer_status");
}

/** The Settings "Run now" nudge — bypasses quiet/idle/AC/thermal (never chat). */
export async function organizerRunOnce(): Promise<void> {
  if (!isTauri()) return;
  await invoke("organizer_run_once");
}

/** The Activity Stop button — finish the current note, requeue the rest. It
 * cannot abort an in-flight model call; it lands at the next boundary. */
export async function organizerStop(): Promise<void> {
  if (!isTauri()) return;
  await invoke("organizer_stop");
}

/** Immediate in-memory Brain flip (vault-vs-brain, 2026-07-26) — OFF stops an
 * in-flight cycle at the next candidate; ON un-parks the worker and owes it a
 * sweep. settings.json stays the durable backstop via the normal persist. */
export async function organizerSetBrain(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("organizer_set_brain", { enabled });
}

/** One secure-review row (feature B, decision 2026-07-22): a note the daemon
 * skipped as secure. `flagged` = the explicit frontmatter flag (already
 * protected) vs detector-only (the "Mark it secure?" confirm lane). */
export interface SecureHint {
  rel: string;
  title: string;
  flagged: boolean;
}

/** The current review rows, re-validated fresh in Rust per call. */
export async function organizerSecureHints(): Promise<SecureHint[]> {
  if (!isTauri()) return [];
  return invoke<SecureHint[]>("organizer_secure_hints");
}

/** "Not sensitive": persist the dismissal for this exact content — the note is
 * never re-nagged until something the detector sees changes. Never writes into
 * the note itself. */
export async function organizerDismissSecure(rel: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("organizer_dismiss_secure", { rel });
}

/** Flip the daemon's in-memory trust rung NOW; persistence rides settings.json
 * (the daemon re-reads it each cycle as the backstop — no ordering dependency). */
export async function organizerSetTrust(level: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("organizer_set_trust", { level });
}

/** Teach the daemon a field value the user just APPROVED (#28, audit 2026-07):
 * records it as daemon-owned in `.rotli/organizer.json` so the never-clobber
 * baseline keeps maintaining the field instead of freezing it as a user edit.
 * `note` = the note's state key (its frontmatter ULID, else its rel path). */
export async function organizerLearnField(note: string, key: string, value: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("organizer_learn_field", { note, key, value });
}

/** Append one JSON line to the brain change journal (`.rotli/brain-journal.jsonl`). */
export async function corpusJournalAppend(line: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_journal_append", { line });
}

/** Read the whole brain change journal (jsonl text; "" outside Tauri / when none). */
export async function corpusJournalRead(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_journal_read");
}

/** Prune resolved journal entries older than keepDays (0 = all resolved
 * history). Pending proposals always survive. Returns lines removed. */
export async function corpusJournalPrune(keepDays: number): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("corpus_journal_prune", { keepDays });
}

/** Empty-Trash lane (the ONLY hard delete; Rust re-checks the note already
 * lives in Trash). The file lands in the OS Trash — recoverable, never gone. */
export async function corpusPurge(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_purge", { id });
}

/** Rel→wire-id bridge for OPEN lanes: Librarian journal rows may be
 * path-addressed (an _index.md has no frontmatter ULID), but tabs and title
 * lookups key on wire ids. Passes wire ids through unchanged. */
export async function corpusResolveRef(target: string): Promise<string> {
  if (!isTauri()) return target;
  return invoke<string>("corpus_resolve_ref", { target });
}

/** Toggle the per-note SECURE flag (secrets → never sent remote, gitignored). */
export async function corpusSetSecure(id: string, secure: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_secure", { id, secure });
}

/** Permit loopback-local AI to read a secure note. Remote providers remain
 * categorically blocked regardless of this value. */
export async function corpusSetLocalAiAccess(id: string, allowed: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_local_ai_access", { id, allowed });
}

/** One legacy secure-intake note (decision 2026-07-22): flagged `secure: true`
 * yet physically still in Brain intake. `title`/`rel` feed the user's local
 * repair preview only — the repair journal stays content-free. */
export interface SecureRepairCandidate {
  id: string;
  rel: string;
  title: string;
  folder: string;
}

export interface SecureRepairReport {
  repaired: number;
  /** Per-note refusal messages — transient UI text, never persisted. */
  failed: string[];
}

/** One open Markdown checkbox — the Tasks projection (decision 2026-07-25).
 * `line` indexes the editor body's lines: the toggle handle. */
export interface TaskItem {
  noteId: string;
  noteTitle: string;
  line: number;
  text: string;
}

/** Every open checkbox in the default corpus, derived per call. */
export async function corpusTasks(): Promise<TaskItem[]> {
  if (!isTauri()) return [];
  return invoke<TaskItem[]>("corpus_tasks");
}

/** Check one task off — Rust re-validates the exact text before flipping. */
export async function corpusToggleTask(id: string, line: number, expect: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_toggle_task", { id, line, expect });
}

/** Preview legacy secure-intake state in the default memex (read-only). */
export async function secureRepairScan(): Promise<SecureRepairCandidate[]> {
  if (!isTauri()) return [];
  return invoke<SecureRepairCandidate[]>("corpus_secure_repair_scan");
}

/** Repair every current candidate — Rust re-validates each note on disk, moves
 * it into the protected lane ignore-first, and journals it content-free. */
export async function secureRepairApply(): Promise<SecureRepairReport> {
  if (!isTauri()) return { repaired: 0, failed: [] };
  return invoke<SecureRepairReport>("corpus_secure_repair_apply");
}

/** Read a note for an AI model. Rust requires both a loopback endpoint and a
 * matching registered on-device model; a localhost frontier proxy fails closed.
 * Secure notes additionally require explicit per-note Local AI permission. */
export async function corpusReadAi(
  id: string,
  model: Pick<ChatModelInfo, "id" | "endpoint">,
): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("corpus_read_ai", { id, modelId: model.id, endpoint: model.endpoint });
}

/** Which of `ids` this model may READ — ONE batched probe instead of a serial
 * corpus_read_ai per note (perf audit 2026-07-30, #4). Rust runs the exact
 * read_for_ai enforcement per id; the TS side only filters with the answer. */
export async function corpusReadableIds(
  ids: string[],
  model: Pick<ChatModelInfo, "id" | "endpoint">,
): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("corpus_readable_ids", { ids, modelId: model.id, endpoint: model.endpoint });
}

// ——— the unified Location model (corpus.json) — ONE folder = your notes = your
//     brain, plus connected read-only "other brains". Replaces corpus-root.txt +
//     corpus-memex-root.txt + corpus-roots.json + memex-instances.json. ———

/** A connected "other brain" — a memex rotli reads, with per-brain write perms. */
export interface ConnectedBrain {
  id: string;
  label: string;
  absPath: string;
  memexId: string | null;
  mode: string | null;
  perms: MemexPerms;
  /** The vault's Librarian switch — a per-root display fact the view derives
   * from that root's own settings sidecar (never stored in corpus.json). */
  brainEnabled: boolean;
}

/** The active corpus, enriched with whether it IS a memex (derived) + its perms. */
export interface CorpusRefView {
  absPath: string;
  isMemex: boolean;
  memexId: string | null;
  /** when isMemex: "chats+inbox" | "read-only"; else null */
  perms: MemexPerms | null;
  /** The active vault's Librarian switch (see ConnectedBrain.brainEnabled). */
  brainEnabled: boolean;
}

/** The whole Location config (the one place "where do my notes live" is decided). */
export interface CorpusConfigView {
  corpus: CorpusRefView;
  brains: ConnectedBrain[];
  /** Arbitrary plain folders added to the sidebar (the "add a folder" feature). */
  folders: CorpusRoot[];
  activeBrainId: string | null;
}

/** The whole Location config; migrates the four legacy files in on first read.
 * Browser preview gets a sane empty config so the UI still renders. */
export function corpusListConfig(): Promise<CorpusConfigView> {
  if (!isTauri()) {
    return Promise.resolve({
      corpus: {
        absPath: "~/Documents/rotli",
        isMemex: false,
        memexId: null,
        perms: null,
        brainEnabled: true,
      },
      brains: [],
      folders: [],
      activeBrainId: null,
    });
  }
  return corpusInvoke("corpus_list_config");
}

/** "Choose folder…" — the ONE smart picker for your notes folder. Detects a memex
 * (browse it), an empty folder (move your notes there / start fresh), or a plain
 * folder (use as-is), then relaunches. False when the picker is cancelled. */
export async function corpusChooseFolder(path?: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("corpus_choose_folder", { path: path ?? null });
}

/** Onboarding "create a new vault": scaffold a fresh memex at `path` and make it
 * your corpus (the corpus IS a memex). Relaunches on success. */
export async function corpusInitMemex(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_init_memex", { path });
}

/** Scaffold + switch to a scratch PRACTICE vault at an app-chosen home
 * (2026-07-26): settings carry along, the outgoing vault stays registered as a
 * connected library, and no existing file is touched. Relaunches on success. */
export async function corpusCreatePracticeVault(): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_create_practice_vault");
}

/** Connect a memex as a brain (read + write per its perms); relaunches so its row
 * appears. False when the picker is cancelled. */
export async function corpusConnectBrain(path?: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("corpus_connect_brain", { path: path ?? null });
}

/** Forget a connected brain (binding only; files untouched). Relaunches. */
export async function corpusForgetBrain(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_forget_brain", { id });
}

/** Make a connected brain the active write target. No relaunch. */
export async function corpusSetActiveBrain(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_active_brain", { id });
}

/** Set a brain's write perms. No relaunch. */
export async function corpusSetBrainPerms(id: string, perms: MemexPerms): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_brain_perms", { id, perms });
}

/** The `.rotli/` dot-files — opaque JSON strings the frontend owns. */
export type SettingsFile = "settings" | "viewstate" | "main" | "views";

/** The dot-files the app may WRITE through this lane. `main` goes through
 * corpusMainWrite (which also keeps it committable); `organizer` is the
 * daemon's own convergence state and is never webview-writable (#44). */
export type WritableSettingsFile = "settings" | "viewstate";

export function corpusSettingsRead(file: SettingsFile): Promise<string> {
  return corpusInvoke("corpus_settings_read", { file });
}

export function corpusSettingsWrite(file: WritableSettingsFile, contents: string): Promise<void> {
  return corpusInvoke("corpus_settings_write", { file, contents });
}

/** Write `.rotli/main.json` — the Main arrangement. A separate command from settings
 * because it ALSO ensures the corpus `.gitignore` COMMITS it (durable user work,
 * unlike the per-machine settings/viewstate). Read it back with corpusSettingsRead("main"). */
export function corpusMainWrite(contents: string): Promise<void> {
  return corpusInvoke("corpus_main_write", { contents });
}

/** Write `.rotli/views.json` through the Rust synchronization boundary. The
 * host validates unique names and singular membership, then keeps Markdown's
 * managed `view_tag` aligned; boards and binaries remain frontmatter-free. */
export function corpusViewsWrite(contents: string): Promise<void> {
  return corpusInvoke("corpus_views_write", { contents });
}

export interface WorkspaceOpenRequest {
  id: string;
  kind: "note" | "board" | "file";
}

/** Consume the small local mailbox written by `rotli open`. The request holds
 * only a corpus id + kind; the app still resolves and reads through its normal
 * service path. */
export function workspaceTakeOpenRequest(): Promise<WorkspaceOpenRequest | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invoke<WorkspaceOpenRequest | null>("workspace_take_open_request");
}

/** Rust → main window: the corpus changed UNDER the app (a folder dropped in,
 * a note edited in another editor). Debounced Rust-side; the frontend just
 * invalidates and refetches — content appears when ready, no spinners. */
export function onCorpusChanged(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:corpus-changed", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: `rotli open <id>` wrote its mailbox and activated the
 * app (the Reopen event) — consume the request NOW. Replaces the app-lifetime
 * 750ms workspaceTakeOpenRequest poll (perf audit 2026-07-30, #15). */
export function onOpenRequest(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:open-request", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: the organizer daemon appended to the brain journal (a
 * new proposal or an auto-applied action) — refetch it so Activity + the
 * sidebar badge update within a beat, no polling. */
export function onBrainJournal(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:brain-journal", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: the ⌥F global chord fired — surface the window with the
 * ⌘K palette open ("find", the search twin of ⌥A's "ask"). */
export function onSummonSearch(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:summon-search", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** One live organizer-progress beat (2026-07-31): the daemon narrates a cycle
 * — start (queue size), each note it looks at (title only, never content),
 * and the end tally. The Activity surface renders these as the working feed. */
export interface OrganizerProgress {
  phase: "start" | "note" | "end";
  total?: number;
  title?: string;
  rel?: string;
  applied?: number;
  proposals?: number;
  requeued?: number;
  secureSkipped?: number;
  stopped?: boolean;
  error?: boolean;
}

export function onOrganizerProgress(cb: (p: OrganizerProgress) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<OrganizerProgress>("rotli:organizer-progress", (e) => cb(e.payload));
  return () => void unlisten.then((fn) => fn());
}

// ——— the memex seam (Stage 1) — typed wrappers over the Rust memex commands
//     (src-tauri/src/memex.rs). rotli connects to / initiates a memex instance
//     (the shared identity/personality/wiki/history/chats/inbox.md spine; for Seth, ~/memex-vault)
//     and OWNS chats/ + the wiki/_inbox/ staging, nothing else (inbox.md is not a
//     rotli surface — #96, audit 2026-07). Mirror-not-import: the byte-shape
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
  /** fs mtime in ms (0 when unreadable) — ⌥A summon-chat picks the newest. */
  modifiedMs: number;
  /** `pinned: true` frontmatter — the sidebar sorts pinned chats first. */
  pinned: boolean;
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
export function memexReadContract(root: string): Promise<MemexContractRaw> {
  return memexInvoke("memex_read_contract", { root });
}
export function memexRead(root: string, rel: string): Promise<string> {
  return memexInvoke("memex_read", { root, rel });
}
export function memexListChats(root: string): Promise<MemexChatSummary[]> {
  return memexInvoke("memex_list_chats", { root });
}
/** The chat-folder manifest (a rebuildable .rotli sidecar) — "" when absent. */
export function memexChatFolders(root: string): Promise<string> {
  return memexInvoke("memex_chat_folders", { root });
}
export function memexWriteChatFolders(root: string, contents: string): Promise<void> {
  return memexInvoke("memex_write_chat_folders", { root, contents });
}
export function memexWriteChat(root: string, slug: string, contents: string): Promise<string> {
  return memexInvoke("memex_write_chat", { root, slug, contents });
}

/** Rename a chat file (chats/<old>.md → chats/<new>.md). Returns the new slug. */
export function memexRenameChat(root: string, oldSlug: string, newSlug: string): Promise<string> {
  return memexInvoke("memex_rename_chat", { root, oldSlug, newSlug });
}
export function memexDeleteChat(root: string, slug: string): Promise<void> {
  return memexInvoke("memex_delete_chat", { root, slug });
}
export function memexArchiveChat(root: string, slug: string): Promise<void> {
  return memexInvoke("memex_archive_chat", { root, slug });
}
/** Reveal `chats/<slug>.md` in Finder — the chat row's "Show in Finder". */
export function memexRevealChat(root: string, slug: string): Promise<void> {
  return memexInvoke("memex_reveal_chat", { root, slug });
}
/** Write a v3.5 note into wiki/_inbox/, or wiki/_secure/ when its composed
 * frontmatter carries secure:true. Returns the absolute path. */
export function memexWriteNote(root: string, stem: string, contents: string): Promise<string> {
  return memexInvoke("memex_write_note", { root, stem, contents });
}
export function memexValidate(root: string): Promise<MemexValidateReport> {
  return memexInvoke("memex_validate", { root });
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

/** Rust → main window: the ⌥A global chord fired — land in a chat. The window
 * is already shown Rust-side; the webview only picks/creates the chat tab. */
export function onSummonChat(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:summon-chat", () => cb());
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

/** Theme settings, broadcast from the MAIN window so the quick + capture
 * webviews follow the chosen theme live (they each apply their own theme from
 * their store; without this they'd only pick it up from settings.json at launch
 * and go stale when you change it). Loose string types avoid a ui<->tauri import
 * cycle; the receiver casts back to the ui store's unions. */
export interface ThemePayload {
  theme: "light" | "dark" | "system";
  themeFamily: "warm" | "mono";
  matchLightFamily: "warm" | "mono";
  matchDarkFamily: "warm" | "mono";
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

// ——— Breve data seam — fixed-path snapshot, copy-only migration, and the
// explicit legacy → Rotli scheduler takeover.

export type BreveRoutineSchedule =
  | { kind: "dailyAt"; hhmm: string; leadMinutes: number }
  | { kind: "everySecs"; secs: number }
  | { kind: "alwaysOn" };

export interface BreveRoutine {
  id: string;
  label: string;
  kind: "brief" | "creators" | "watchers" | "doctor" | "signal";
  enabled: boolean;
  schedule: BreveRoutineSchedule;
  lanes: string[];
}

export type BrevePdfThemePreset = "charcoal" | "warmLight" | "warmDark" | "paper" | "custom";

export interface BrevePdfPalette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  rule: string;
}

export interface BrevePdfTheme {
  preset: BrevePdfThemePreset;
  custom: BrevePdfPalette;
}

export interface BreveConfig {
  version: 1;
  timezone: string;
  deliveryTimes: { morning: string; lunch: string; night: string };
  leadMinutes: number;
  leadOverrides: { morning?: number; lunch?: number; night?: number };
  briefModel: string;
  modelPolicy: { primary: string; fallbacks: string[]; localHelper: string | null };
  pdfTheme: BrevePdfTheme;
  routines: BreveRoutine[];
  travel?: { start: string; end: string; tz: string } | null;
}

export interface BreveBrief {
  stem: string;
  title: string;
  kind: "morning" | "lunch" | "night";
  date: string;
  imported: boolean;
  path?: string;
  /** Vault-relative path of the spoken version (storage/breveAudios/<stem>.mp3)
   * when the runtime produced one — the reader shows a player. */
  audioPath?: string;
}

export interface BreveSnapshot {
  source: "rotli" | "legacy" | "empty";
  legacyRoot: string | null;
  config: BreveConfig;
  watchlist: string;
  counts: { sections: number; topics: number; creators: number; pages: number };
  creators: Array<{ name: string; handle: string; channelId?: string }>;
  pages: Array<{ id: number; url: string; condition: string }>;
  briefs: BreveBrief[];
  artifactCount: number;
  imported: boolean;
  scheduler: "rotli" | "legacy-launchd" | "none";
}

export interface BreveDeliverySettings {
  emailFrom: string;
  emailTo: string[];
  signalBot: string;
  signalOwner: string;
  signalOwnerUuid: string;
  resendKeyConfigured: boolean;
}

let browserBreveDelivery: BreveDeliverySettings = {
  emailFrom: "Breve <briefs@example.com>",
  emailTo: ["you@example.com"],
  signalBot: "+14075550101",
  signalOwner: "+14075550102",
  signalOwnerUuid: "",
  resendKeyConfigured: false,
};

function browserBreveSnapshot(): BreveSnapshot {
  return {
    source: "rotli",
    legacyRoot: null,
    config: {
      version: 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      deliveryTimes: { morning: "07:00", lunch: "12:00", night: "18:00" },
      leadMinutes: 30,
      leadOverrides: { morning: 60 },
      briefModel: "sonnet",
      modelPolicy: {
        primary: "sonnet",
        fallbacks: ["haiku", "Gemini 3.5 Flash (Medium)", "gpt-5.4-mini"],
        localHelper: "gemma-3-12b-it-qat-4bit",
      },
      pdfTheme: DEFAULT_BREVE_PDF_THEME,
      routines: [],
    },
    watchlist: "",
    counts: { sections: 6, topics: 34, creators: 4, pages: 3 },
    creators: [],
    pages: [],
    briefs: [
      {
        stem: "2026-07-10",
        title: "Breve — July 10, 2026",
        kind: "morning",
        date: "2026-07-10",
        imported: true,
      },
      {
        stem: "2026-07-10-lunch",
        title: "Breve — July 10, 2026 · Lunchtime",
        kind: "lunch",
        date: "2026-07-10",
        imported: true,
      },
      {
        stem: "2026-07-09-night",
        title: "Breve — July 9, 2026 · The Archive",
        kind: "night",
        date: "2026-07-09",
        imported: true,
      },
    ],
    artifactCount: 208,
    imported: true,
    scheduler: "rotli",
  };
}

export function breveSnapshot(): Promise<BreveSnapshot> {
  if (!isTauri()) return Promise.resolve(browserBreveSnapshot());
  return invoke<BreveSnapshot>("breve_snapshot");
}

export function breveImportLegacy(): Promise<BreveSnapshot> {
  if (!isTauri()) return Promise.resolve(browserBreveSnapshot());
  return invoke<BreveSnapshot>("breve_import_legacy");
}

export function breveTakeover(): Promise<BreveSnapshot> {
  if (!isTauri()) return Promise.resolve({ ...browserBreveSnapshot(), source: "rotli", scheduler: "rotli" });
  return invoke<BreveSnapshot>("breve_takeover");
}

export function breveRetireLegacy(): Promise<BreveSnapshot> {
  if (!isTauri()) return Promise.resolve({ ...browserBreveSnapshot(), source: "rotli" });
  return invoke<BreveSnapshot>("breve_retire_legacy");
}

export function breveWriteConfig(config: BreveConfig): Promise<BreveSnapshot> {
  if (!isTauri()) return Promise.resolve({ ...browserBreveSnapshot(), source: "rotli", config });
  return invoke<BreveSnapshot>("breve_write_config", { config });
}

export function breveWriteWatchlist(markdown: string): Promise<BreveSnapshot> {
  if (!isTauri()) return Promise.resolve({ ...browserBreveSnapshot(), source: "rotli", watchlist: markdown });
  return invoke<BreveSnapshot>("breve_write_watchlist", { markdown });
}

export function breveDeliverySettings(): Promise<BreveDeliverySettings> {
  if (!isTauri())
    return Promise.resolve({ ...browserBreveDelivery, emailTo: [...browserBreveDelivery.emailTo] });
  return invoke<BreveDeliverySettings>("breve_delivery_settings");
}

export function breveWriteDeliverySettings(settings: BreveDeliverySettings): Promise<BreveDeliverySettings> {
  if (!isTauri()) {
    browserBreveDelivery = { ...settings, emailTo: [...settings.emailTo] };
    return Promise.resolve({ ...browserBreveDelivery, emailTo: [...browserBreveDelivery.emailTo] });
  }
  return invoke<BreveDeliverySettings>("breve_write_delivery_settings", { settings });
}

export function breveTestEmail(): Promise<string> {
  if (!isTauri()) return Promise.resolve("Test email simulated in browser dev mode");
  return invoke<string>("breve_test_email");
}

export function breveTestSignal(): Promise<string> {
  if (!isTauri()) return Promise.resolve("Test Signal simulated in browser dev mode");
  return invoke<string>("breve_test_signal");
}

export function breveStoreResendKey(value: string): Promise<void> {
  if (!isTauri()) {
    browserBreveDelivery = { ...browserBreveDelivery, resendKeyConfigured: !!value.trim() };
    return Promise.resolve();
  }
  return invoke<void>("breve_store_resend_key", { value });
}

export function breveRemoveResendKey(): Promise<void> {
  if (!isTauri()) {
    browserBreveDelivery = { ...browserBreveDelivery, resendKeyConfigured: false };
    return Promise.resolve();
  }
  return invoke<void>("breve_remove_resend_key");
}
