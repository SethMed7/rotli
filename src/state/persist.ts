// Phase 2c — every preference survives relaunch. Two dot-files in the corpus
// root, both owned by the frontend, both rebuildable from nothing:
//
//   .rotli/settings.json   — app settings, hotkeys and per-note preferences.
//   .rotli/viewstate.json  — panes, tabs, selection and recent items.
//
// Hydration runs BEFORE the first render (main.tsx awaits it) so the first
// paint is already in the right theme — no flash, no spinner, nothing to
// watch. Saving is one debounced writer over all the durable stores, flushed
// when the window hides. Everything parses defensively: a corrupted or
// deleted dot-file means defaults, never a crash.
//
// In a plain browser (vite dev) every entry point here is a no-op — the
// in-memory demo corpus stays exactly as it was (the seam's whole point).

import { type HybridPreset, PROVIDER_IDS, type ProviderId } from "../ai/models";
import { DEFAULT_NEW_ITEM_KIND, NEW_ITEM_KINDS, type NewItemKind } from "../newItems/model";
import { useBindingsStore } from "../keys/bindings";
import { toAccelerator } from "../keys/chords";
import { allActions } from "../keys/registry";
// the quit-flush ack listener must exist from first paint — an idle ⌘Q acks
// instantly instead of riding out the Rust-side hold (#4).
import { createDebouncedTask } from "../lib/debouncedTask";
import { onQuitFlush } from "../lib/quitFlush";
import {
  corpusSettingsRead,
  corpusSettingsWrite,
  isTauri,
  organizerSetTrust,
  setDockVisible,
  setGlobalShortcut,
  setHideOnBlur,
} from "../lib/tauri";
import { listChats, loadConfig } from "../memex/service";
import { mainFolderIds } from "../services/mainTree";
import { inboxFolderId, notesService } from "../services/notes";
import type { PaneNode, Tab } from "../types";
import { MRU_CAP, useMruStore } from "./mru";
import { QUICK_MAX } from "./quick";
import {
  DEFAULT_NOTE_STYLE,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  type Measure,
  type NoteStyle,
  useNoteStyleStore,
} from "./noteStyle";
import { MIN_TABLE_COL_PX, MIN_TABLE_ROW_PX, noteIdOfWidthKey, useTableWidthsStore } from "./tableWidths";
import { hydrateMain, useMainStore } from "./main";
import { hydrateViews, useViewsStore } from "./views";
import { findLeaf, leaves, usePanesStore } from "./panes";
import { applyAccent, applySyntaxPalette, applyTheme } from "./theme";
import {
  ALL_NOTES,
  type BreveView,
  clampChatSidebarLimit,
  clampSidebarWidth,
  clampSidebarZoom,
  ORGANIZER_MODELS,
  ORGANIZER_TRUSTS,
  type OrganizerModel,
  type OrganizerTrust,
  RECENT,
  RESERVED_DESTS,
  SEC_CHAT,
  SEC_NOTES,
  type ThemeFamily,
  type ThemeSetting,
  type SyntaxPalette,
  useUiStore,
} from "./ui";
import { ACCENT_COLORS, type AccentColor } from "./ui";

const SAVE_DEBOUNCE_MS = 500;

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
const SYNTAX_PALETTES: readonly SyntaxPalette[] = ["rotli", "mono"];
const MEASURES: readonly Measure[] = ["narrow", "comfort", "wide"];

/** Drop the session-scoped per-chat keys — an unsaved chat's choice (globe,
 * measure) belongs to its pane for this session only, never to settings.json
 * (#7). Shared by the parse (heals a poisoned config) and the snapshot (never
 * writes one again). */
function persistableChatMap<T>(m: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(m).filter(([k]) => k !== "" && !k.startsWith("unsaved:")));
}

/** Shape-validate the persisted hybrid presets — a hand-edited or future-build
 * entry that doesn't parse is DROPPED, never half-loaded. Exported for tests. */
export function parseHybridPresets(raw: unknown): HybridPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: HybridPreset[] = [];
  for (const item of raw) {
    const p = record(item);
    if (typeof p.id !== "string" || !p.id) continue;
    if (typeof p.name !== "string" || !p.name) continue;
    if (typeof p.organizer !== "string" || !p.organizer) continue;
    if (!Array.isArray(p.routes)) continue;
    const routes: { when: string; model: string }[] = [];
    for (const r of p.routes) {
      const route = record(r);
      if (typeof route.when === "string" && typeof route.model === "string" && route.model) {
        routes.push({ when: route.when, model: route.model });
      }
    }
    if (routes.length === 0) continue;
    out.push({
      id: p.id,
      name: p.name,
      organizer: p.organizer,
      routes,
      ...(typeof p.fallback === "string" && p.fallback ? { fallback: p.fallback } : {}),
    });
  }
  return out;
}

// ─── settings.json ───────────────────────────────────────────────────────────

interface PersistedSettings {
  v: 1;
  theme: ThemeSetting;
  themeFamily: ThemeFamily;
  matchLightFamily: ThemeFamily;
  matchDarkFamily: ThemeFamily;
  syntaxPalette: SyntaxPalette;
  accentColor: AccentColor;
  stayOpen: boolean;
  showInDock: boolean;
  /** What the generic New tab command creates. Markdown remains the safe default. */
  newTabDefault: NewItemKind;
  /** Editor spell-check (red squiggles); on by default. */
  spellcheck: boolean;
  /** Images follow their note into Archive/Trash (sole references only). */
  tidyImagesWithNote: boolean;
  /** Editor view: raw markdown vs beautified (WYSIWYG); beautified by default. */
  rawEditor: boolean;
  /** Block handles (drag/add/remove blocks); ON by default since the floating
   * rework (2026-07-01). A FRESH KEY on purpose: the gutter-era `blockHandles`
   * persisted its off-default into every config, which would keep the redesigned
   * handle hidden forever — this one-time reset lands everyone on the new
   * default; an explicit Off re-persists here. */
  blockHandles2: boolean;
  /** The user's name (onboarding / Settings → General); "" = unset. */
  userName: string;
  /** The model a NEW chat starts on — the last one picked anywhere (id from
   * ~/.memex/ai or a connected lane); null = the model store's default. */
  chatModelId: string | null;
  /** Per-chat model pick, keyed like chatWeb (slug; session keys never persist).
   * ADDITIVE (2026-08-01): an older build ignores this key and falls back to
   * chatModelId, which newer builds keep writing — so a downgrade lands on the
   * last model picked, exactly the pre-per-chat behavior. */
  chatModel: Record<string, string>;
  /** Per-chat web-search toggle (the composer globe), keyed by chat slug. The
   * session-scoped unsaved-chat keys ("unsaved:<paneId>", and the legacy "" key)
   * never persist — a stored one flipped the silent-egress default for every
   * future fresh chat (#7, audit 2026-07). */
  chatWeb: Record<string, boolean>;
  /** Per-chat measure (Narrow/Comfort/Wide), same keying + unsaved-key rule. */
  chatMeasure: Record<string, Measure>;
  /** Where a chat's attached note opens: a new tab (default) or a right split. */
  chatNoteOpen: "tab" | "split";
  /** Sidebar Chat section cap (5/10/15, default 5). */
  chatSidebarLimit: number;
  /** Connected subscription lanes (Settings → AI Models); all off by default —
   * a chat never leaves the Mac without the user flipping a lane on. */
  aiProviders: Record<ProviderId, boolean>;
  /** Hybrid model presets (organizer → routes → fallback). */
  hybridPresets: HybridPreset[];
  /** Connected models turned off inside an enabled lane (picker-hidden). */
  blockedModels: string[];
  /** Which connected engine draws generate_image: codex (default) or agy. */
  imageEngine: "codex" | "agy";
  /** How the Storage destination groups its binaries: Type / Date / Folder. */
  storageGrouping: "type" | "date" | "folder";
  /** The macOS Dock/app icon variant. */
  appIcon: "default" | "warm" | "paper" | "charcoal" | "clay";
  /** Raw frontmatter at the top of the note (Show file metadata): hide / show. */
  fileMetadata: "hide" | "show";
  /** The vault's Brain master switch (vault-vs-brain, 2026-07-26). The Rust
   * organizer and corpus filer gate read this same field independently.
   * Missing ⇒ true — an untouched vault behaves exactly like today. */
  brainEnabled: boolean;
  /** The organizer daemon's §4.3 trust rung; the Rust daemon re-reads this file
   * each cycle, so persisting here IS the durable knob. Default: suggest. */
  organizerTrust: OrganizerTrust;
  /** Which model the organizer runs. Remote choices remain opt-in. */
  organizerModel: OrganizerModel;
  /** Idle delay (seconds) before the organizer scans a just-touched note. The
   * Rust daemon's `organizerQuietSecs` knob; default 300 (5 min). */
  organizerQuietSecs: number;
  /** The Librarian's first-visit explainer was shown (2026-07-31). */
  librarianIntroSeen: boolean;
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
  /** Sidebar tree zoom factor (⌘+/⌘− with focus in the sidebar). */
  sidebarZoom: number;
  /** Which high-level sidebar lens and Breve section reopen on launch. */
  sidebarMode: "notes" | "breve";
  breveView: BreveView;
  expandedDests: Record<string, boolean>;
  /** Hotkey overrides keyed by action id; null = explicitly unbound. */
  bindings: Record<string, string | null>;
  /** The per-note Aa layer — NEVER written into the .md files. */
  noteStyles: Record<string, NoteStyle>;
  /** Per-table column widths (noteId-keyed view state) — NEVER in the .md. */
  tableWidths: Record<string, number[]>;
  /** Per-table row heights (2026-07-31), same keying + pruning as widths. */
  tableHeights: Record<string, number[]>;
}

/** Keys the file carried that this build doesn't know — a hand-set daemon knob
 * (e.g. the organizer's documented `organizerThreshold`), a future build's
 * setting after a downgrade. The writer must ROUND-TRIP them: rebuilding the
 * file from the known-key literal alone destroyed them on the next theme
 * toggle (#35, audit 2026-07). Captured at hydration, spread under every
 * snapshot (known keys always win). */
let settingsPassthrough: Record<string, unknown> = {};

/** Exported for tests (the safe-default locks); production callers stay inside
 * this module. */
export function parseSettings(raw: string): PersistedSettings {
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
  // table column widths + row heights — only arrays of finite positive numbers
  const tableWidths: Record<string, number[]> = {};
  for (const [key, cols] of Object.entries(record(data.tableWidths))) {
    if (
      Array.isArray(cols) &&
      cols.length > 0 &&
      cols.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)
    ) {
      tableWidths[key] = cols.map((w) => Math.max(MIN_TABLE_COL_PX, Math.round(w)));
    }
  }
  const tableHeights: Record<string, number[]> = {};
  for (const [key, rows] of Object.entries(record(data.tableHeights))) {
    if (
      Array.isArray(rows) &&
      rows.length > 0 &&
      rows.every((h) => typeof h === "number" && Number.isFinite(h) && h > 0)
    ) {
      tableHeights[key] = rows.map((h) => Math.max(MIN_TABLE_ROW_PX, Math.round(h)));
    }
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
    // the left-menu sections + the Capture(Inbox) & Vault dests inside Notes
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
    syntaxPalette: asEnum(data.syntaxPalette, SYNTAX_PALETTES, "rotli"),
    accentColor: asEnum(data.accentColor, ACCENT_COLORS, "default"),
    stayOpen: asBool(data.stayOpen, false),
    showInDock: asBool(data.showInDock, false),
    newTabDefault: asEnum(data.newTabDefault, NEW_ITEM_KINDS, DEFAULT_NEW_ITEM_KIND),
    spellcheck: asBool(data.spellcheck, true),
    tidyImagesWithNote: asBool(data.tidyImagesWithNote, true),
    rawEditor: asBool(data.rawEditor, false),
    blockHandles2: asBool(data.blockHandles2, true),
    userName: typeof data.userName === "string" ? data.userName : "",
    chatModelId: typeof data.chatModelId === "string" ? data.chatModelId : null,
    chatModel: (() => {
      // ids are opaque strings (a model registry entry or a preset id) — shape
      // is all we can validate; a non-string entry is dropped, not guessed
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(record(data.chatModel))) {
        if (typeof v === "string" && v !== "") out[k] = v;
      }
      return persistableChatMap(out);
    })(),
    chatWeb: (() => {
      const out: Record<string, boolean> = {};
      const src = data.chatWeb;
      if (src && typeof src === "object") {
        for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
          if (typeof v === "boolean") out[k] = v;
        }
      }
      return persistableChatMap(out);
    })(),
    chatMeasure: (() => {
      const out: Record<string, Measure> = {};
      for (const [k, v] of Object.entries(record(data.chatMeasure))) {
        if (typeof v === "string" && (MEASURES as readonly string[]).includes(v)) {
          out[k] = v as Measure;
        }
      }
      return persistableChatMap(out);
    })(),
    chatNoteOpen: data.chatNoteOpen === "split" ? "split" : "tab",
    // 5/10/15 only; any other value (hand-edit, future build) → default 5
    chatSidebarLimit: clampChatSidebarLimit(data.chatSidebarLimit),
    // booleans only, unknown lanes ignored — the safe default is every lane OFF
    aiProviders: (() => {
      const src = record(data.aiProviders);
      const out = { claude: false, codex: false, agy: false, gemini: false };
      for (const id of PROVIDER_IDS) {
        if (typeof src[id] === "boolean") out[id] = src[id];
      }
      return out;
    })(),
    hybridPresets: parseHybridPresets(data.hybridPresets),
    blockedModels: Array.isArray(data.blockedModels)
      ? data.blockedModels.filter((x): x is string => typeof x === "string")
      : [],
    imageEngine: data.imageEngine === "agy" ? "agy" : "codex",
    storageGrouping:
      data.storageGrouping === "date" || data.storageGrouping === "folder" ? data.storageGrouping : "type",
    appIcon:
      data.appIcon === "warm" ||
      data.appIcon === "paper" ||
      data.appIcon === "charcoal" ||
      data.appIcon === "clay"
        ? data.appIcon
        : "default",
    // hide is the safe default — metadata never surprises a fresh (or old) config
    fileMetadata: data.fileMetadata === "show" ? "show" : "hide",
    // Organize is the DEFAULT rung (Seth, 2026-07-02): the daemon only ever
    // changes a note's location + metadata — journaled and undoable, never the
    // note's words — so full auto-organize is the intended out-of-box behavior.
    // An unknown rung (hand-edit, future build) falls to the same default.
    // the Brain master switch (vault-vs-brain, 2026-07-26): a MISSING field
    // means ON — every existing vault keeps today's behavior untouched
    brainEnabled: asBool(data.brainEnabled, true),
    organizerTrust: asEnum(data.organizerTrust, ORGANIZER_TRUSTS, "organize"),
    // default LOCAL (on-device) so organizing never leaves the Mac unless chosen
    organizerModel: asEnum(data.organizerModel, ORGANIZER_MODELS, "local"),
    // idle delay before organizing; default 5 min, non-negative finite only
    organizerQuietSecs:
      typeof data.organizerQuietSecs === "number" &&
      Number.isFinite(data.organizerQuietSecs) &&
      data.organizerQuietSecs >= 0
        ? data.organizerQuietSecs
        : 300,
    librarianIntroSeen: asBool(data.librarianIntroSeen, false),
    // a fresh install reads an empty config ("{}"); an upgrade has prior keys but
    // not this one — treat that as already-onboarded so we don't re-run first-run
    // onboarding on existing users (same migration shape as expandedDests above)
    onboarded: typeof data.onboarded === "boolean" ? data.onboarded : Object.keys(data).length > 0,
    onboardingVersion: typeof data.onboardingVersion === "string" ? data.onboardingVersion : "",
    quickNoteIds,
    captureOrder,
    quickActiveId,
    quickFolder,
    // missing keys default — old configs predate the single sidebar, never crash
    sidebarCollapsed: asBool(data.sidebarCollapsed, false),
    sidebarWidth: clampSidebarWidth(typeof data.sidebarWidth === "number" ? data.sidebarWidth : 240),
    sidebarZoom: clampSidebarZoom(typeof data.sidebarZoom === "number" ? data.sidebarZoom : 1),
    sidebarMode: data.sidebarMode === "breve" ? "breve" : "notes",
    breveView:
      data.breveView === "watchlist" || data.breveView === "routines" || data.breveView === "settings"
        ? data.breveView
        : // the retired Models/Configure views merged into Settings (2026-07-30)
          data.breveView === "models" || data.breveView === "configure"
          ? "settings"
          : "briefs",
    expandedDests,
    bindings,
    noteStyles,
    tableWidths,
    tableHeights,
  };
}

/** The unknown-key remainder of a settings.json — everything parseSettings has
 * no field for. Pure (exported for tests); hydration stores the result in
 * `settingsPassthrough` so the snapshot can round-trip it (#35). */
export function unknownSettingsKeys(raw: string): Record<string, unknown> {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(raw));
  } catch {
    return {};
  }
  const known = new Set(Object.keys(parseSettings("{}")));
  const retired = new Set([
    "glassMode",
    "glassTint",
    "glassBackground",
    "glassClarity",
    "glassBlur",
    "glassCanvas",
  ]);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key) && !retired.has(key)));
}

function applySettings(s: PersistedSettings): void {
  useUiStore.setState({
    theme: s.theme,
    themeFamily: s.themeFamily,
    matchLightFamily: s.matchLightFamily,
    matchDarkFamily: s.matchDarkFamily,
    syntaxPalette: s.syntaxPalette,
    accentColor: s.accentColor,
    stayOpen: s.stayOpen,
    showInDock: s.showInDock,
    newTabDefault: s.newTabDefault,
    spellcheck: s.spellcheck,
    tidyImagesWithNote: s.tidyImagesWithNote,
    rawEditor: s.rawEditor,
    blockHandles: s.blockHandles2,
    userName: s.userName,
    chatModelId: s.chatModelId,
    chatModel: s.chatModel,
    chatWeb: s.chatWeb,
    chatMeasure: s.chatMeasure,
    chatNoteOpen: s.chatNoteOpen,
    chatSidebarLimit: s.chatSidebarLimit,
    aiProviders: s.aiProviders,
    hybridPresets: s.hybridPresets,
    blockedModels: s.blockedModels,
    imageEngine: s.imageEngine,
    storageGrouping: s.storageGrouping,
    appIcon: s.appIcon,
    fileMetadata: s.fileMetadata,
    brainEnabled: s.brainEnabled,
    organizerTrust: s.organizerTrust,
    organizerModel: s.organizerModel,
    organizerQuietSecs: s.organizerQuietSecs,
    librarianIntroSeen: s.librarianIntroSeen,
    onboarded: s.onboarded,
    onboardingVersion: s.onboardingVersion,
    quickNoteIds: s.quickNoteIds,
    captureOrder: s.captureOrder,
    quickActiveId: s.quickActiveId,
    quickFolder: s.quickFolder,
    sidebarCollapsed: s.sidebarCollapsed,
    sidebarWidth: s.sidebarWidth,
    sidebarZoom: s.sidebarZoom,
    sidebarMode: s.sidebarMode,
    breveView: s.breveView,
    expandedDests: s.expandedDests,
  });
  useBindingsStore.setState({ overrides: s.bindings });
  useNoteStyleStore.setState({ styles: s.noteStyles });
  useTableWidthsStore.setState({ widths: s.tableWidths, heights: s.tableHeights });
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
  // push the persisted trust rung to the daemon NOW — it also re-reads
  // settings.json each cycle, so this is immediacy, not correctness
  organizerSetTrust(s.organizerTrust).catch(() => {});
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
  activeView: string | null;
  mru: string[];
}

/** Revalidate ONE persisted tab against the live Tab union — every surfaceKind
 * must have a branch here, or its tabs silently vanish at relaunch (and a
 * single-tab leaf's split collapses with them — #34, audit 2026-07: file +
 * activity were missing). Exported for the per-kind round-trip tests. */
export function validTab(v: unknown, alive: Set<string>): Tab | null {
  const o = record(v);
  if (typeof o.id !== "string" || !o.id) return null;
  // legacy trees carried a per-tab viewState nobody ever wrote or read —
  // the field is retired (slice 4, 2026-07-28); hydration simply drops it
  const preview = o.preview === true ? { preview: true as const } : {};
  // canvas: boards have no alive-set (ids are paths, no ulid index), so accept
  // any non-empty boardId — the surface handles a since-deleted board itself.
  if (o.surfaceKind === "canvas") {
    if (typeof o.boardId !== "string" || !o.boardId) return null;
    return { id: o.id, surfaceKind: "canvas", boardId: o.boardId, ...preview };
  }
  if (o.surfaceKind === "chat") {
    return {
      id: o.id,
      surfaceKind: "chat",
      chatSlug: typeof o.chatSlug === "string" ? o.chatSlug : null,
    };
  }
  // file: like canvas, ids are paths (no alive-set) — FileSurface itself shows
  // the honest error for a since-deleted file.
  if (o.surfaceKind === "file") {
    if (typeof o.fileId !== "string" || !o.fileId) return null;
    return { id: o.id, surfaceKind: "file", fileId: o.fileId, ...preview };
  }
  // activity: a singleton view with no binding — nothing to validate but shape.
  if (o.surfaceKind === "activity") {
    return { id: o.id, surfaceKind: "activity" };
  }
  if (o.surfaceKind !== "note") return null;
  if (typeof o.noteId !== "string" || !alive.has(o.noteId)) return null;
  return { id: o.id, surfaceKind: "note", noteId: o.noteId, ...preview };
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
    return { kind: "split", id: o.id, dir: o.dir, children, sizes: sizes.map((x) => x / total) };
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
  const [notes, folders] = await Promise.all([notesService.listNotes(), notesService.listFolders()]);
  const alive = new Set(notes.map((n) => n.id));

  // the Aa map is keyed by note id — drop entries whose notes are gone, so
  // settings.json never accumulates orphans across deletes
  const styles = useNoteStyleStore.getState().styles;
  const kept = Object.entries(styles).filter(([id]) => alive.has(id));
  if (kept.length !== Object.keys(styles).length) {
    useNoteStyleStore.setState({ styles: Object.fromEntries(kept) });
  }
  // same discipline for table column widths + row heights (key prefix = note id)
  const widths = useTableWidthsStore.getState().widths;
  const keptWidths = Object.entries(widths).filter(([key]) => alive.has(noteIdOfWidthKey(key)));
  if (keptWidths.length !== Object.keys(widths).length) {
    useTableWidthsStore.setState({ widths: Object.fromEntries(keptWidths) });
  }
  const heights = useTableWidthsStore.getState().heights;
  const keptHeights = Object.entries(heights).filter(([key]) => alive.has(noteIdOfWidthKey(key)));
  if (keptHeights.length !== Object.keys(heights).length) {
    useTableWidthsStore.setState({ heights: Object.fromEntries(keptHeights) });
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
  const folderIds = new Set<string>([ALL_NOTES, RECENT, ...RESERVED_DESTS, ...folders.map((f) => f.id)]);
  const storedActive = typeof data.activeView === "string" ? data.activeView : null;
  const activeView = useViewsStore.getState().manifest.views.some((view) => view.name === storedActive)
    ? storedActive
    : null;
  useUiStore.setState({ activeView });
  const activeTree = activeView
    ? (useViewsStore.getState().manifest.views.find((view) => view.name === activeView)?.tree ?? [])
    : useMainStore.getState().manifest.tree;
  for (const id of mainFolderIds(activeTree)) folderIds.add(id);
  folderIds.add("main:");
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

// ─── persisted-map GC (#78, audit 2026-07) ──────────────────────────────────

/** Keep only entries whose key passes `keep`. Returns the SAME object when
 * nothing was dropped (no pointless store write). Pure — exported for tests. */
export function pruneMap<T>(m: Record<string, T>, keep: (k: string) => boolean): Record<string, T> {
  const kept = Object.entries(m).filter(([k]) => keep(k));
  return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept);
}

/** GC the grow-only persisted maps the way the noteStyles prune above already
 * does for the Aa layer: chatWeb keys whose chat no longer exists, and
 * expandedDests keys whose folder/Main row is gone (#78). Conservative on
 * purpose — a failed read skips ITS prune entirely (the useMainGcIds lesson:
 * better to keep a stale boolean than to drop live state on an error). */
async function gcPersistedMaps(): Promise<void> {
  // chatWeb — live slugs are the UNION of every configured brain's chats/
  // listing, not just the active one's (review, 2026-07): pruning against the
  // active brain alone deleted every per-chat web toggle belonging to a
  // non-active brain's chats on the first relaunch after switching brains —
  // silent state loss, and the toggles were gone when the user switched back.
  // No configured instance ⇒ nothing is listable ⇒ leave the map alone; ANY
  // failed listing aborts the whole prune (the same keep-on-error rule).
  try {
    const cfg = await loadConfig();
    if (cfg.instances.length > 0) {
      // list every brain's chats/ together (audit 2026-07-30, #13) — Promise.all
      // keeps the keep-on-error rule: ONE failed listing rejects and the catch
      // below skips the whole prune
      const lists = await Promise.all(cfg.instances.map((inst) => listChats(inst)));
      const slugs = new Set<string>();
      for (const list of lists) for (const c of list) slugs.add(c.slug);
      const ui = useUiStore.getState();
      const liveKey = (k: string) => slugs.has(k) || k.startsWith("unsaved:");
      const kept = pruneMap(ui.chatWeb, liveKey);
      if (kept !== ui.chatWeb) useUiStore.setState({ chatWeb: kept });
      const keptMeasure = pruneMap(ui.chatMeasure, liveKey);
      if (keptMeasure !== ui.chatMeasure) useUiStore.setState({ chatMeasure: keptMeasure });
      const keptModel = pruneMap(ui.chatModel, liveKey);
      if (keptModel !== ui.chatModel) useUiStore.setState({ chatModel: keptModel });
    }
  } catch {
    // an unreadable chats/ anywhere — keep everything
  }
  try {
    const folders = await notesService.listFolders();
    const valid = new Set<string>([
      "sec:inbox", // the removed Inbox front's persisted key — kept valid so
      // the user's open/closed state survives the front's return (ROADMAP.md)
      SEC_CHAT,
      SEC_NOTES,
      "Brain", // the Brain section header keys its accordion here
      ...RESERVED_DESTS,
      ...folders.map((f) => f.id),
      ...mainFolderIds(useMainStore.getState().manifest.tree),
    ]);
    const ui = useUiStore.getState();
    const kept = pruneMap(
      ui.expandedDests,
      // root markers ("vault:", "<rootid>:"), the synthetic Storage grouping
      // rows, and chat VIRTUAL folders aren't in listFolders — keep them by
      // shape (chatfolder:* pruning silently re-expanded folded chat folders
      // on every relaunch — review, 2026-07-31)
      (k) => valid.has(k) || k.endsWith(":") || k.startsWith("Storage/") || k.startsWith("chatfolder:"),
    );
    if (kept !== ui.expandedDests) useUiStore.setState({ expandedDests: kept });
  } catch {
    // unreadable folders — keep everything
  }
}

// ─── first paint ─────────────────────────────────────────────────────────────

/** Apply the restored theme before React's first paint. */
function prePaint(): void {
  const s = useUiStore.getState();
  applyTheme(s.theme, s.themeFamily, {
    light: s.matchLightFamily,
    dark: s.matchDarkFamily,
  });
  applySyntaxPalette(s.syntaxPalette);
  applyAccent(s.accentColor);
}

// ─── hydrate (awaited by main.tsx before the first render) ───────────────────

/** Load everything durable from `.rotli/` into the stores. Never throws, never
 * blocks on bad data — a deleted or corrupted dot-file just means defaults. */
export async function hydratePersistedState(): Promise<void> {
  if (!isTauri()) return; // the browser keeps the in-memory demo, untouched
  try {
    const raw = await corpusSettingsRead("settings");
    const settings = parseSettings(raw);
    // keys this build doesn't know survive every rewrite (#35) — main window
    // only would suffice (it's the one writer), but capturing here is harmless
    settingsPassthrough = unknownSettingsKeys(raw);
    applySettings(settings);
    if (isMainSurface()) {
      // Main + Views are independent reads — hydrate them together (perf
      // audit 2026-07-30, #13). Viewstate is NOT independent: it validates
      // activeView/selection against BOTH hydrated manifests, so it waits.
      await Promise.all([hydrateMain(), hydrateViews()]);
      await hydrateViewstate();
      await gcPersistedMaps(); // needs the hydrated Main manifest (#78)
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
    syntaxPalette: ui.syntaxPalette,
    accentColor: ui.accentColor,
    stayOpen: ui.stayOpen,
    showInDock: ui.showInDock,
    newTabDefault: ui.newTabDefault,
    spellcheck: ui.spellcheck,
    tidyImagesWithNote: ui.tidyImagesWithNote,
    rawEditor: ui.rawEditor,
    blockHandles2: ui.blockHandles,
    userName: ui.userName,
    chatModelId: ui.chatModelId,
    chatModel: persistableChatMap(ui.chatModel),
    chatWeb: persistableChatMap(ui.chatWeb),
    chatMeasure: persistableChatMap(ui.chatMeasure),
    chatNoteOpen: ui.chatNoteOpen,
    chatSidebarLimit: ui.chatSidebarLimit,
    aiProviders: ui.aiProviders,
    hybridPresets: ui.hybridPresets,
    blockedModels: ui.blockedModels,
    imageEngine: ui.imageEngine,
    storageGrouping: ui.storageGrouping,
    appIcon: ui.appIcon,
    fileMetadata: ui.fileMetadata,
    brainEnabled: ui.brainEnabled,
    organizerTrust: ui.organizerTrust,
    organizerModel: ui.organizerModel,
    organizerQuietSecs: ui.organizerQuietSecs,
    librarianIntroSeen: ui.librarianIntroSeen,
    onboarded: ui.onboarded,
    onboardingVersion: ui.onboardingVersion,
    quickNoteIds: ui.quickNoteIds,
    captureOrder: ui.captureOrder,
    quickActiveId: ui.quickActiveId,
    quickFolder: ui.quickFolder,
    sidebarCollapsed: ui.sidebarCollapsed,
    sidebarWidth: ui.sidebarWidth,
    sidebarZoom: ui.sidebarZoom,
    sidebarMode: ui.sidebarMode,
    breveView: ui.breveView,
    expandedDests: ui.expandedDests,
    bindings: useBindingsStore.getState().overrides,
    noteStyles: useNoteStyleStore.getState().styles,
    tableWidths: useTableWidthsStore.getState().widths,
    tableHeights: useTableWidthsStore.getState().heights,
  };
  // unknown keys ride under the known ones (known always win) — see #35
  return JSON.stringify({ ...settingsPassthrough, ...snapshot });
}

function viewstateSnapshot(): string {
  const panes = usePanesStore.getState();
  const snapshot: PersistedViewstate = {
    v: 1,
    root: panes.root,
    focusedPaneId: panes.focusedPaneId,
    selectedFolderId: useUiStore.getState().selectedFolderId,
    activeView: useUiStore.getState().activeView,
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

/** One drain of the debounced writer. The high-water marks advance ONLY when
 * a write LANDS — advancing before (the pre-audit shape) meant one transient
 * failure marked the payload written and it never retried: theme/keys/panes
 * silently reverted at next launch (perf audit 2026-07-30, correctness #4).
 * Exported for tests (the shell's corpusSettingsWrite doesn't exist under bun). */
export function createPersistDrain(
  write: (key: "settings" | "viewstate", payload: string) => Promise<void>,
  snapshot: { settings: () => string; viewstate: () => string },
  seed: { settings: string; viewstate: string },
  onFailure: () => void,
): () => Promise<void> {
  let lastSettings = seed.settings;
  let lastViewstate = seed.viewstate;
  return () => {
    const writes: Array<Promise<void>> = [];
    const settings = snapshot.settings();
    if (settings !== lastSettings) {
      writes.push(
        write("settings", settings).then(() => {
          lastSettings = settings;
        }),
      );
    }
    const viewstate = snapshot.viewstate();
    if (viewstate !== lastViewstate) {
      writes.push(
        write("viewstate", viewstate).then(() => {
          lastViewstate = viewstate;
        }),
      );
    }
    return Promise.allSettled(writes).then((results) => {
      if (results.some((r) => r.status === "rejected")) onFailure();
    });
  };
}

/** Subscribe the one writer to every durable store. Writes are debounced,
 * deduplicated against the last written payload, and flushed the moment the
 * window hides (visibilitychange) or unloads (pagehide). Call once, after
 * hydration, in the main window — no-op anywhere else. */
export function attachPersistence(): () => void {
  if (!isTauri() || !isMainSurface()) return () => {};

  // NOTE the deliberate ordering: `drain` closes over `saver`, which is
  // assigned on the next line. Safe — onFailure only ever fires after an async
  // write settles, long past this block — but don't hoist `drain` elsewhere.
  const drain = createPersistDrain(
    corpusSettingsWrite,
    { settings: settingsSnapshot, viewstate: viewstateSnapshot },
    // seed from the just-hydrated state so hydration itself never writes back
    { settings: settingsSnapshot(), viewstate: viewstateSnapshot() },
    // a failed write re-arms the debounce so the payload retries even with no
    // further store change (hide/quit flushes retry it too)
    () => saver.schedule(),
  );
  const saver = createDebouncedTask(SAVE_DEBOUNCE_MS, drain);

  const unsubs = [
    useUiStore.subscribe(saver.schedule),
    useBindingsStore.subscribe(saver.schedule),
    useNoteStyleStore.subscribe(saver.schedule),
    useTableWidthsStore.subscribe(saver.schedule),
    usePanesStore.subscribe(saver.schedule),
    useMruStore.subscribe(saver.schedule),
  ];
  const onVisibility = (): void => {
    if (document.hidden) void saver.flush();
  };
  const onPageHide = (): void => {
    void saver.flush();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  // ⌘Q / tray-Quit with the window still up fires neither of the above —
  // the quit handshake (#4) holds the exit until the write actually lands,
  // so it must receive the flush PROMISE, not a fire-and-forget call.
  onQuitFlush(() => saver.flush());

  return () => {
    void saver.flush();
    for (const unsub of unsubs) unsub();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  };
}
