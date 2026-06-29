// Phase 2c — every preference survives relaunch. Two dot-files in the corpus
// root, both owned by the frontend, both rebuildable from nothing:
//
//   .rotli/settings.json   — app settings: theme + glass, General toggles,
//                            hotkey overrides, the per-note Aa map, rails.
//   .rotli/viewstate.json  — UI state: the pane tree + tabs, focused pane,
//                            selected folder, the ⌘K recents (MRU).
//   .rotli/background.json — the custom glass wallpaper, as a data URL.
//
// Hydration runs BEFORE the first render (main.tsx awaits it) so the first
// paint is already in the right theme — no flash, no spinner, nothing to
// watch. Saving is one debounced writer over all the durable stores, flushed
// when the window hides. Everything parses defensively: a corrupted or
// deleted dot-file means defaults, never a crash.
//
// In a plain browser (vite dev) every entry point here is a no-op — the
// in-memory demo corpus stays exactly as it was (the seam's whole point).

import { useBindingsStore } from "../keys/bindings";
import { toAccelerator } from "../keys/chords";
import { allActions } from "../keys/registry";
import { GLASS_BG_SRC } from "../lib/glassBackgrounds";
import {
  corpusSettingsRead,
  corpusSettingsWrite,
  isTauri,
  setDockVisible,
  setGlobalShortcut,
  setHideOnBlur,
} from "../lib/tauri";
import { inboxFolderId, notesService } from "../services/notes";
import type { PaneNode, Tab } from "../types";
import { useMruStore } from "./mru";
import { QUICK_MAX } from "./quick";
import {
  DEFAULT_NOTE_STYLE,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  type Measure,
  type NoteStyle,
  useNoteStyleStore,
} from "./noteStyle";
import { findLeaf, leaves, usePanesStore } from "./panes";
import { applyTheme } from "./theme";
import {
  ALL_NOTES,
  clampSidebarWidth,
  GLASS_BACKGROUNDS,
  GLASS_BLURS,
  GLASS_CANVASES,
  GLASS_TINTS,
  type GlassBackground,
  type GlassBlur,
  type GlassCanvas,
  type GlassClarity,
  type GlassTint,
  RECENT,
  RESERVED_DESTS,
  SEC_CHAT,
  SEC_INBOX,
  SEC_NOTES,
  type ThemeFamily,
  type ThemeSetting,
  useUiStore,
} from "./ui";

const SAVE_DEBOUNCE_MS = 500;
const MRU_CAP = 24;

/** Which webview this is — only the MAIN window hydrates viewstate, applies
 * shell side-effects (window/dock/global chords), and WRITES the dot-files (one
 * writer). The capture + quick windows only read settings (theme + the quick
 * set), so they never race the writer or double-register OS chords. */
function isMainSurface(): boolean {
  return (new URLSearchParams(window.location.search).get("window") ?? "main") === "main";
}

// ─── defensive parsing helpers ───────────────────────────────────────────────

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const THEME_SETTINGS: readonly ThemeSetting[] = ["light", "dark", "system"];
const THEME_FAMILIES: readonly ThemeFamily[] = ["warm", "mono"];
const TINTS: readonly GlassTint[] = GLASS_TINTS.map((t) => t.value);
const BACKGROUNDS: readonly GlassBackground[] = [
  ...GLASS_BACKGROUNDS.map((b) => b.value),
  "custom",
];
const CLARITIES: readonly GlassClarity[] = ["frosted", "clear"];
const BLURS: readonly GlassBlur[] = GLASS_BLURS.map((b) => b.value);
const CANVASES: readonly GlassCanvas[] = GLASS_CANVASES.map((c) => c.value);
const MEASURES: readonly Measure[] = ["narrow", "comfort", "wide"];

// ─── settings.json ───────────────────────────────────────────────────────────

interface PersistedSettings {
  v: 1;
  theme: ThemeSetting;
  themeFamily: ThemeFamily;
  matchLightFamily: ThemeFamily;
  matchDarkFamily: ThemeFamily;
  glassMode: boolean;
  glassTint: GlassTint;
  glassBackground: GlassBackground;
  glassClarity: GlassClarity;
  glassBlur: GlassBlur;
  glassCanvas: GlassCanvas;
  stayOpen: boolean;
  showInDock: boolean;
  /** Editor spell-check (red squiggles); on by default. */
  spellcheck: boolean;
  /** Editor view: raw markdown vs beautified (WYSIWYG); beautified by default. */
  rawEditor: boolean;
  /** Block handles (drag/add/remove blocks); off by default. */
  blockHandles: boolean;
  /** Route ⌥C quick captures to the active memex's inbox.md; off by default. */
  captureToBrainInbox: boolean;
  /** The on-device model the Chat surface uses (id from ~/.memex/ai); null = default. */
  chatModelId: string | null;
  /** First-run onboarding gate — false until the flow is finished/skipped. */
  onboarded: boolean;
  /** The app version onboarding last completed at (the onboardingVersion gate). */
  onboardingVersion: string;
  /** The Quick Note window's capped set, remembered note, and new-note folder
   * (Seth, 2026-06-15). */
  quickNoteIds: string[];
  captureOrder: string[];
  quickActiveId: string | null;
  quickFolder: string;
  /** The ONE sidebar's collapse state + width, and which dests are expanded —
   * the two-rail keys (foldersCollapsed/listCollapsed/lastOpenRails/
   * foldersWidth/listWidth) are retired (Seth, 2026-06-13). */
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  expandedDests: Record<string, boolean>;
  /** Hotkey overrides keyed by action id; null = explicitly unbound. */
  bindings: Record<string, string | null>;
  /** The per-note Aa layer — NEVER written into the .md files. */
  noteStyles: Record<string, NoteStyle>;
}

function parseSettings(raw: string): PersistedSettings {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(raw));
  } catch {
    data = {};
  }
  const bindings: Record<string, string | null> = {};
  for (const [id, chord] of Object.entries(record(data.bindings))) {
    if (typeof chord === "string" || chord === null) bindings[id] = chord;
  }
  const noteStyles: Record<string, NoteStyle> = {};
  for (const [id, style] of Object.entries(record(data.noteStyles))) {
    const s = record(style);
    const size =
      typeof s.size === "number" && Number.isFinite(s.size)
        ? Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, s.size))
        : DEFAULT_NOTE_STYLE.size;
    noteStyles[id] = { size, measure: asEnum(s.measure, MEASURES, DEFAULT_NOTE_STYLE.measure) };
  }
  // expandedDests — keep only boolean entries; missing → seed Inbox + Vault so
  // an old config (which lacked this key) opens with the default tree. A stale
  // "Brain" key from before the Brain→Vault rename is harmless: it just expands a
  // plain folder that may no longer exist (no crash), so we leave it as-is.
  const rawDests = record(data.expandedDests);
  const expandedDests: Record<string, boolean> = {};
  for (const [id, open] of Object.entries(rawDests)) {
    if (typeof open === "boolean") expandedDests[id] = open;
  }
  if (Object.keys(expandedDests).length === 0) {
    // the three left-menu sections + the Capture(Inbox) & Vault dests inside Notes
    expandedDests[SEC_INBOX] = true;
    expandedDests[SEC_CHAT] = true;
    expandedDests[SEC_NOTES] = true;
    expandedDests.Inbox = true;
    expandedDests["vault:"] = true;
  }
  // the quick set: keep only string ids, cap at QUICK_MAX; the active note must
  // be one of them; the folder falls back to Inbox
  const quickNoteIds = Array.isArray(data.quickNoteIds)
    ? data.quickNoteIds.filter((x): x is string => typeof x === "string").slice(0, QUICK_MAX)
    : [];
  const captureOrder = Array.isArray(data.captureOrder)
    ? data.captureOrder.filter((x): x is string => typeof x === "string")
    : [];
  // the open note is decoupled from the pinned set — keep it even if unpinned;
  // fall back to the first favorite, else nothing.
  const quickActiveId =
    typeof data.quickActiveId === "string" && data.quickActiveId
      ? data.quickActiveId
      : (quickNoteIds[0] ?? null);
  const quickFolder =
    typeof data.quickFolder === "string" && data.quickFolder ? data.quickFolder : inboxFolderId;
  return {
    v: 1,
    theme: asEnum(data.theme, THEME_SETTINGS, "light"),
    themeFamily: asEnum(data.themeFamily, THEME_FAMILIES, "warm"),
    matchLightFamily: asEnum(data.matchLightFamily, THEME_FAMILIES, "warm"),
    matchDarkFamily: asEnum(data.matchDarkFamily, THEME_FAMILIES, "warm"),
    glassMode: asBool(data.glassMode, false),
    glassTint: asEnum(data.glassTint, TINTS, "dusk"),
    glassBackground: asEnum(data.glassBackground, BACKGROUNDS, "field"),
    glassClarity: asEnum(data.glassClarity, CLARITIES, "frosted"),
    glassBlur: asEnum(data.glassBlur, BLURS, "standard"),
    glassCanvas: asEnum(data.glassCanvas, CANVASES, "glass"),
    stayOpen: asBool(data.stayOpen, false),
    showInDock: asBool(data.showInDock, false),
    spellcheck: asBool(data.spellcheck, true),
    rawEditor: asBool(data.rawEditor, false),
    blockHandles: asBool(data.blockHandles, false),
    captureToBrainInbox: asBool(data.captureToBrainInbox, false),
    chatModelId: typeof data.chatModelId === "string" ? data.chatModelId : null,
    // a fresh install reads an empty config ("{}"); an upgrade has prior keys but
    // not this one — treat that as already-onboarded so we don't re-run first-run
    // onboarding on existing users (same migration shape as expandedDests above)
    onboarded:
      typeof data.onboarded === "boolean" ? data.onboarded : Object.keys(data).length > 0,
    onboardingVersion: typeof data.onboardingVersion === "string" ? data.onboardingVersion : "",
    quickNoteIds,
    captureOrder,
    quickActiveId,
    quickFolder,
    // missing keys default — old configs predate the single sidebar, never crash
    sidebarCollapsed: asBool(data.sidebarCollapsed, false),
    sidebarWidth: clampSidebarWidth(typeof data.sidebarWidth === "number" ? data.sidebarWidth : 240),
    expandedDests,
    bindings,
    noteStyles,
  };
}

function applySettings(s: PersistedSettings): void {
  useUiStore.setState({
    theme: s.theme,
    themeFamily: s.themeFamily,
    matchLightFamily: s.matchLightFamily,
    matchDarkFamily: s.matchDarkFamily,
    glassMode: s.glassMode,
    glassTint: s.glassTint,
    glassBackground: s.glassBackground,
    glassClarity: s.glassClarity,
    glassBlur: s.glassBlur,
    glassCanvas: s.glassCanvas,
    stayOpen: s.stayOpen,
    showInDock: s.showInDock,
    spellcheck: s.spellcheck,
    rawEditor: s.rawEditor,
    blockHandles: s.blockHandles,
    captureToBrainInbox: s.captureToBrainInbox,
    chatModelId: s.chatModelId,
    onboarded: s.onboarded,
    onboardingVersion: s.onboardingVersion,
    quickNoteIds: s.quickNoteIds,
    captureOrder: s.captureOrder,
    quickActiveId: s.quickActiveId,
    quickFolder: s.quickFolder,
    sidebarCollapsed: s.sidebarCollapsed,
    sidebarWidth: s.sidebarWidth,
    expandedDests: s.expandedDests,
  });
  useBindingsStore.setState({ overrides: s.bindings });
  useNoteStyleStore.setState({ styles: s.noteStyles });
}

/** The custom glass wallpaper, stored as a data URL in background.json. When
 * "custom" is selected but the image is gone, fall back to the tint field. */
async function loadCustomBackground(): Promise<void> {
  let dataUrl: unknown;
  try {
    dataUrl = record(JSON.parse(await corpusSettingsRead("background"))).dataUrl;
  } catch {
    dataUrl = null;
  }
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    useUiStore.setState({ customBackground: dataUrl });
  } else {
    useUiStore.setState({ glassBackground: "field" });
  }
}

/** Settings that live OUTSIDE the webview: window behavior, Dock policy, and
 * the OS-registered global chords (Rust registered the DEFAULTS at setup —
 * overrides re-register here). A chord the OS now refuses (claimed by another
 * app since last run) falls back to the action's default, never half-applied. */
function applyShellSideEffects(s: PersistedSettings): void {
  // During onboarding the window must NOT hide on blur (the Rust default is
  // true) — assert it BEFORE first paint so the flow can't vanish in the gap
  // before App's reactive effect runs. App.tsx re-applies on finish.
  if (s.stayOpen || !s.onboarded) void setHideOnBlur(false);
  if (s.showInDock) void setDockVisible(true);
  for (const action of allActions()) {
    if (!action.global || !(action.id in s.bindings)) continue;
    const chord = s.bindings[action.id] ?? null;
    setGlobalShortcut(action.id, chord ? toAccelerator(chord) : null).catch(() => {
      useBindingsStore.getState().setOverride(action.id, action.defaultChord);
    });
  }
}

// ─── viewstate.json ──────────────────────────────────────────────────────────

interface PersistedViewstate {
  v: 1;
  root: PaneNode;
  focusedPaneId: string;
  selectedFolderId: string;
  mru: string[];
}

function validTab(v: unknown, alive: Set<string>): Tab | null {
  const o = record(v);
  if (typeof o.id !== "string" || !o.id) return null;
  const vs = record(o.viewState);
  const viewState = {
    cursor: typeof vs.cursor === "number" ? vs.cursor : 0,
    scroll: typeof vs.scroll === "number" ? vs.scroll : 0,
  };
  // canvas: boards have no alive-set (ids are paths, no ulid index), so accept
  // any non-empty boardId — the surface handles a since-deleted board itself.
  if (o.surfaceKind === "canvas") {
    if (typeof o.boardId !== "string" || !o.boardId) return null;
    return { id: o.id, surfaceKind: "canvas", boardId: o.boardId, viewState };
  }
  if (o.surfaceKind === "chat") {
    return {
      id: o.id,
      surfaceKind: "chat",
      chatSlug: typeof o.chatSlug === "string" ? o.chatSlug : null,
      viewState,
    };
  }
  if (o.surfaceKind !== "note") return null;
  if (typeof o.noteId !== "string" || !alive.has(o.noteId)) return null;
  return { id: o.id, surfaceKind: "note", noteId: o.noteId, viewState };
}

/** Validate + prune in one pass: structure must hold AND every tab's note must
 * still exist on disk (relaunch after an external delete). Empty leaves drop,
 * single-child splits collapse, sizes renormalize — exactly the live tree's
 * own invariants. Returns null when nothing usable survives. */
function validPane(v: unknown, alive: Set<string>): PaneNode | null {
  const o = record(v);
  if (typeof o.id !== "string" || !o.id) return null;
  if (o.kind === "leaf") {
    if (!Array.isArray(o.tabs)) return null;
    const tabs = o.tabs.map((t) => validTab(t, alive)).filter((t): t is Tab => t !== null);
    const first = tabs[0];
    if (!first) return null;
    const activeTabId = tabs.find((t) => t.id === o.activeTabId)?.id ?? first.id;
    return { kind: "leaf", id: o.id, tabs, activeTabId };
  }
  if (o.kind === "split") {
    if (o.dir !== "row" && o.dir !== "col") return null;
    if (!Array.isArray(o.children)) return null;
    const rawSizes: unknown[] = Array.isArray(o.sizes) ? o.sizes : [];
    const children: PaneNode[] = [];
    const sizes: number[] = [];
    o.children.forEach((child, i) => {
      const node = validPane(child, alive);
      if (!node) return;
      const raw = rawSizes[i];
      children.push(node);
      sizes.push(typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1);
    });
    const only = children[0];
    if (!only) return null;
    if (children.length === 1) return only;
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return { kind: "split", id: o.id, dir: o.dir, children, sizes: sizes.map(x => x / total) };
  }
  return null;
}

async function hydrateViewstate(): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(await corpusSettingsRead("viewstate")));
  } catch {
    return; // first run / corrupted file → the default pristine pane
  }
  // the disk truth gates everything id-shaped: tabs, MRU, the folder selection
  const [notes, folders] = await Promise.all([
    notesService.listNotes(),
    notesService.listFolders(),
  ]);
  const alive = new Set(notes.map((n) => n.id));

  // the Aa map is keyed by note id — drop entries whose notes are gone, so
  // settings.json never accumulates orphans across deletes
  const styles = useNoteStyleStore.getState().styles;
  const kept = Object.entries(styles).filter(([id]) => alive.has(id));
  if (kept.length !== Object.keys(styles).length) {
    useNoteStyleStore.setState({ styles: Object.fromEntries(kept) });
  }

  const root = validPane(data.root, alive);
  if (root) {
    const focusedPaneId =
      typeof data.focusedPaneId === "string" && findLeaf(root, data.focusedPaneId)
        ? data.focusedPaneId
        : leaves(root)[0]?.id;
    if (focusedPaneId) usePanesStore.setState({ root, focusedPaneId });
  }

  // reserved dest ids (Inbox/vault:/Storage/Board/Archive/Trash) join the smart
  // rows + real folders in the valid set, so a fresh corpus that selected a
  // destination before its first list resolved isn't reset to All Notes
  // (Seth, 2026-06-13). A stored "Brain" id from before the rename is no longer
  // reserved — it's restored only if "Brain" is still a real folder, else
  // ignored (falls back to ALL_NOTES), never a crash (Invariant 6).
  const folderIds = new Set<string>([
    ALL_NOTES,
    RECENT,
    ...RESERVED_DESTS,
    ...folders.map((f) => f.id),
  ]);
  if (typeof data.selectedFolderId === "string" && folderIds.has(data.selectedFolderId)) {
    useUiStore.setState({ selectedFolderId: data.selectedFolderId });
  }

  if (Array.isArray(data.mru)) {
    const ids = data.mru
      .filter((id): id is string => typeof id === "string" && alive.has(id))
      .slice(0, MRU_CAP);
    if (ids.length > 0) useMruStore.setState({ ids });
  }
}

// ─── first paint ─────────────────────────────────────────────────────────────

/** Mirror App.tsx's theme effects BEFORE React renders — useEffect runs after
 * the first paint, so without this a restored dark/glass theme would flash the
 * index.html light pin for a frame. App re-applies identically on mount. */
function prePaint(): void {
  const s = useUiStore.getState();
  applyTheme(s.theme, s.themeFamily, s.glassMode, s.glassTint, {
    light: s.matchLightFamily,
    dark: s.matchDarkFamily,
  });
  const root = document.documentElement;
  root.dataset.glassCanvas = s.glassCanvas;
  root.dataset.glassClarity = s.glassClarity;
  root.dataset.glassBlur = s.glassBlur;
  const src =
    s.glassBackground === "custom"
      ? s.customBackground
      : s.glassBackground === "field"
        ? null
        : GLASS_BG_SRC[s.glassBackground];
  if (s.glassMode && src) {
    root.dataset.glassBg = "image";
    root.style.setProperty("--glass-wallpaper", `url("${src}")`);
  }
}

// ─── hydrate (awaited by main.tsx before the first render) ───────────────────

/** Load everything durable from `.rotli/` into the stores. Never throws, never
 * blocks on bad data — a deleted or corrupted dot-file just means defaults. */
export async function hydratePersistedState(): Promise<void> {
  if (!isTauri()) return; // the browser keeps the in-memory demo, untouched
  try {
    const settings = parseSettings(await corpusSettingsRead("settings"));
    applySettings(settings);
    if (settings.glassBackground === "custom") await loadCustomBackground();
    if (isMainSurface()) {
      await hydrateViewstate();
      applyShellSideEffects(settings);
    }
  } catch {
    // defaults are already in the stores — render proceeds
  }
  prePaint();
}

// ─── save (one debounced writer, main window only) ───────────────────────────

function settingsSnapshot(): string {
  const ui = useUiStore.getState();
  const snapshot: PersistedSettings = {
    v: 1,
    theme: ui.theme,
    themeFamily: ui.themeFamily,
    matchLightFamily: ui.matchLightFamily,
    matchDarkFamily: ui.matchDarkFamily,
    glassMode: ui.glassMode,
    glassTint: ui.glassTint,
    glassBackground: ui.glassBackground,
    glassClarity: ui.glassClarity,
    glassBlur: ui.glassBlur,
    glassCanvas: ui.glassCanvas,
    stayOpen: ui.stayOpen,
    showInDock: ui.showInDock,
    spellcheck: ui.spellcheck,
    rawEditor: ui.rawEditor,
    blockHandles: ui.blockHandles,
    captureToBrainInbox: ui.captureToBrainInbox,
    chatModelId: ui.chatModelId,
    onboarded: ui.onboarded,
    onboardingVersion: ui.onboardingVersion,
    quickNoteIds: ui.quickNoteIds,
    captureOrder: ui.captureOrder,
    quickActiveId: ui.quickActiveId,
    quickFolder: ui.quickFolder,
    sidebarCollapsed: ui.sidebarCollapsed,
    sidebarWidth: ui.sidebarWidth,
    expandedDests: ui.expandedDests,
    bindings: useBindingsStore.getState().overrides,
    noteStyles: useNoteStyleStore.getState().styles,
  };
  return JSON.stringify(snapshot);
}

function viewstateSnapshot(): string {
  const panes = usePanesStore.getState();
  const snapshot: PersistedViewstate = {
    v: 1,
    root: panes.root,
    focusedPaneId: panes.focusedPaneId,
    selectedFolderId: useUiStore.getState().selectedFolderId,
    mru: useMruStore.getState().ids,
  };
  return JSON.stringify(snapshot);
}

/** Durably write the current settings snapshot RIGHT NOW (awaitable) — used
 * before a deliberate relaunch so flags like `onboarded` survive the restart. */
export async function flushSettingsNow(): Promise<void> {
  if (!isTauri()) return;
  await corpusSettingsWrite("settings", settingsSnapshot());
}

/** Subscribe the one writer to every durable store. Writes are debounced,
 * deduplicated against the last written payload, and flushed the moment the
 * window hides (visibilitychange) or unloads (pagehide). Call once, after
 * hydration, in the main window — no-op anywhere else. */
export function attachPersistence(): () => void {
  if (!isTauri() || !isMainSurface()) return () => {};

  // seed from the just-hydrated state so hydration itself never writes back
  let lastSettings = settingsSnapshot();
  let lastViewstate = viewstateSnapshot();
  let lastBackground = useUiStore.getState().customBackground;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const settings = settingsSnapshot();
    if (settings !== lastSettings) {
      lastSettings = settings;
      void corpusSettingsWrite("settings", settings);
    }
    const viewstate = viewstateSnapshot();
    if (viewstate !== lastViewstate) {
      lastViewstate = viewstate;
      void corpusSettingsWrite("viewstate", viewstate);
    }
    const background = useUiStore.getState().customBackground;
    if (background !== lastBackground) {
      lastBackground = background;
      const contents = background?.startsWith("data:image/")
        ? JSON.stringify({ v: 1, dataUrl: background })
        : "{}";
      void corpusSettingsWrite("background", contents);
    }
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  const unsubs = [
    useUiStore.subscribe(schedule),
    useBindingsStore.subscribe(schedule),
    useNoteStyleStore.subscribe(schedule),
    usePanesStore.subscribe(schedule),
    useMruStore.subscribe(schedule),
  ];
  const onVisibility = (): void => {
    if (document.hidden) flush();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);

  return () => {
    flush();
    for (const unsub of unsubs) unsub();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
  };
}
