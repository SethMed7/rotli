// Every preference survives relaunch. Vault-specific state stays in two
// frontend-owned dot-files inside the corpus:
//
//   .rotli/settings.json   — app settings, hotkeys and per-note preferences.
//   .rotli/viewstate.json  — panes, tabs, selection and recent items.
//
// App-shell/onboarding preferences also have a machine-level app-settings.json;
// that narrow sidecar is available before a vault exists and contains no notes,
// views, editor state, or vault AI policy.
//
// Hydration runs BEFORE the first render (main.tsx awaits it) so the first
// paint is already in the right theme — no flash, no spinner, nothing to
// watch. Saving is one debounced writer over all the durable stores, flushed
// when the window hides. Everything parses defensively: a corrupted or
// deleted dot-file means defaults, never a crash.
//
// In a plain browser (vite dev) every entry point here is a no-op — the
// in-memory demo corpus stays exactly as it was (the seam's whole point).
import { librarianModelId } from "../ai/librarianLane";
import { type HybridPreset, PROVIDER_IDS, type ProviderId, providerDefaultModel } from "../ai/models";
import { parseWebSearchProvider, type WebSearchProvider } from "../ai/searchProvider";
import {
  QUOKKA_IDLE_POSES,
  QUOKKA_ACCESSORIES,
  QUOKKA_LINE_COLORS,
  QUOKKA_STYLES,
  type QuokkaAccessory,
  type QuokkaIdlePose,
  type QuokkaLineColor,
  type QuokkaStyle,
  normalizeQuokkaAccessoryHue,
  normalizeQuokkaCustomHue,
  quokkaHueFromLegacyColor,
} from "../brand/quokka";
import { useBindingsStore } from "../keys/bindings";
import { toAccelerator } from "../keys/chords";
import { allActions } from "../keys/registry";
// the quit-flush ack listener must exist from first paint — an idle ⌘Q acks
// instantly instead of riding out the Rust-side hold (#4).
import { createDebouncedTask } from "../lib/debouncedTask";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import {
  DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
  PRIVATE_BROWSER_SEARCH_ENGINES,
  type PrivateBrowserSearchEngine,
} from "../lib/privateBrowser";
import { onQuitFlush } from "../lib/quitFlush";
import {
  appSettingsRead,
  appSettingsWrite,
  corpusStatus,
  corpusSettingsRead,
  corpusSettingsWrite,
  isTauri,
  organizerSetTrust,
  setDockVisible,
  setGlobalShortcut,
  setHideOnBlur,
} from "../lib/tauri";
import { activeInstance } from "../memex/config";
import { archiveChat, listChats, loadConfig } from "../memex/service";
import { DEFAULT_NEW_ITEM_KIND, NEW_ITEM_KINDS, type NewItemKind } from "../newItems/model";
import { mainFolderIds, mainNoteIds, removeFromMain } from "../services/mainTree";
import { inboxFolderId, notesService } from "../services/notes";
import { isRetentionEligible, parseRetentionDays } from "../services/retentionPolicy";
import type { PaneNode, Tab } from "../types";
import { DEFAULT_VOICE, VOICES } from "../voice/speech";
import { DEFAULT_ACCENT_HUE, DEFAULT_APPEARANCE } from "./appearanceDefaults";
import { hydrateMain, useMainStore } from "./main";
import { MRU_CAP, touchItemActivity, touchMru, useMruStore } from "./mru";
import {
  DEFAULT_NOTE_STYLE,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  type Measure,
  type NoteStyle,
  persistedNoteStyles,
  useNoteStyleStore,
} from "./noteStyle";
import { findLeaf, leaves, usePanesStore } from "./panes";
import { QUICK_MAX } from "./quick";
import { MIN_TABLE_COL_PX, MIN_TABLE_ROW_PX, noteIdOfWidthKey, useTableWidthsStore } from "./tableWidths";
import { applyAccent, applySyntaxPalette, applyTheme } from "./theme";
import {
  ALL_NOTES,
  type BreveView,
  CHAT_ARTIFACT_OPENS,
  CHAT_NAVIGATOR_STYLES,
  CHAT_NAMINGS,
  CHAT_WELCOME_STYLES,
  type ChatArtifactOpen,
  type ChatNavigatorStyle,
  type ChatNaming,
  type ChatReasoningEffort,
  type ChatServiceTier,
  type ChatWelcomeStyle,
  clampSidebarWidth,
  clampSidebarZoom,
  HOTKEY_PEEKS,
  type HotkeyPeek,
  TASK_CYCLES,
  type TaskCycle,
  ORGANIZER_MODELS,
  ORGANIZER_TRUSTS,
  type OrganizerModel,
  type OrganizerTrust,
  PANE_VAULT_MODES,
  type PaneVaultMode,
  RECENT,
  RESERVED_DESTS,
  SEC_SYSTEM,
  TAB_LAYOUTS,
  THEME_FAMILIES,
  TIME_FORMATS,
  type TimeFormat,
  type TabLayout,
  type SidebarView,
  type ThemeFamily,
  type ThemeSetting,
  type SyntaxPalette,
  useUiStore,
} from "./ui";
import { ACCENT_COLORS, type AccentColor } from "./ui";
import { useVaultStore } from "./vault";
import { hydrateViews, useViewsStore } from "./views";
import { durablePane, type PersistedViewstate } from "./viewstate";

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
const SYNTAX_PALETTES: readonly SyntaxPalette[] = ["rotli", "mono"];
const MEASURES: readonly Measure[] = ["narrow", "comfort", "wide"];

/** Drop the session-scoped per-chat keys — an unsaved chat's choice (globe,
 * measure) belongs to its pane for this session only, never to settings.json
 * (#7). Shared by the parse (heals a poisoned config) and the snapshot (never
 * writes one again). */
function persistableChatMap<T>(m: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(m).filter(([k]) => k !== "" && !k.startsWith("unsaved:")));
}

/** One-time migration of pre-vault-scoping chat-map keys (2026-08-03): a bare
 * slug re-homes to `<instanceId>:<slug>` when exactly ONE configured instance
 * has that slug. An ambiguous slug (two vaults, same name — the very collision
 * the scoping fixes) or an unknown one is left for the prune to drop; a
 * composite key already claimed keeps its value. Exported for tests. */
export function rescopeChatMapKeys<T>(
  m: Record<string, T>,
  owners: ReadonlyMap<string, readonly string[]>,
): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith("unsaved:") || k.includes(":")) {
      out[k] = v;
      continue;
    }
    const own = owners.get(k);
    if (own?.length === 1) {
      const scoped = `${own[0]}:${k}`;
      if (!(scoped in out) && !(scoped in m)) out[scoped] = v;
    }
    changed = true;
  }
  return changed ? out : m;
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
  syntaxPalette: SyntaxPalette;
  accentColor: AccentColor;
  accentHue: number;
  quokkaCompanionEnabled: boolean;
  quokkaStyle: QuokkaStyle;
  quokkaCustomHue: number;
  quokkaLineColor: QuokkaLineColor;
  quokkaAccessory: QuokkaAccessory;
  quokkaAccessoryHue: number;
  quokkaIdlePose: QuokkaIdlePose;
  chatNavigatorStyle: ChatNavigatorStyle;
  stayOpen: boolean;
  showInDock: boolean;
  /** What the generic New tab command creates. Markdown remains the safe default. */
  newTabDefault: NewItemKind;
  /** Crowded pane tabs either scroll at a readable floor or shrink to fit. */
  tabLayout: TabLayout;
  /** Installation-wide provider used for private-browser searches. */
  privateBrowserSearchEngine: PrivateBrowserSearchEngine;
  /** Installation-wide remote MCP relay endpoint. Credentials remain in Keychain. */
  remoteAgentRelayUrl: string;
  /** Whether linked-vault content may share the pane workspace. */
  paneVaultMode: PaneVaultMode;
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
  /** App-global message clock display. */
  timeFormat: TimeFormat;
  /** Null means disabled. These remain vault-scoped because their effects are
   * limited to the active vault's projection and chat lifecycle lane. */
  mainAutoRemoveDays: number | null;
  chatAutoArchiveDays: number | null;
  /** The model a NEW chat starts on — the last one picked anywhere (id from
   * ~/.memex/ai or a connected lane); null = the model store's default. */
  chatModelId: string | null;
  /** Per-chat model pick, keyed like chatWeb (slug; session keys never persist).
   * ADDITIVE (2026-08-01): an older build ignores this key and falls back to
   * chatModelId, which newer builds keep writing — so a downgrade lands on the
   * last model picked, exactly the pre-per-chat behavior. */
  chatModel: Record<string, string>;
  chatReasoning: Record<string, ChatReasoningEffort>;
  chatServiceTier: Record<string, ChatServiceTier>;
  /** Per-chat web-search toggle (the composer globe), keyed by chat slug. The
   * session-scoped unsaved-chat keys ("unsaved:<tabId>", and the legacy "" key)
   * never persist — a stored one flipped the silent-egress default for every
   * future fresh chat (#7, audit 2026-07). */
  chatWeb: Record<string, boolean>;
  /** Per-chat measure (Narrow/Comfort/Wide), same keying + unsaved-key rule. */
  chatMeasure: Record<string, Measure>;
  /** Where a chat's attached note opens: a new tab (default) or a right split. */
  chatNoteOpen: "tab" | "split";
  /** Fresh-chat personality: quiet, or time-aware with restrained color. */
  chatWelcomeStyle: ChatWelcomeStyle;
  /** Ask in the chat header, or derive the title from the first message. */
  chatNaming: ChatNaming;
  /** Where chat-created files and boards open. */
  chatArtifactOpen: ChatArtifactOpen;
  /** What holding ⌘ reveals: inline badges (default), the grouped panel, or off. */
  hotkeyPeek: HotkeyPeek;
  /** Read replies aloud + the chosen voice (voice tier 0 — no mic, no entitlement). */
  readAloud: boolean;
  readAloudVoice: string;
  /** How a checkbox click cycles: `two` = open⇄done (default), `three` adds
   * the `[/]` in-progress stop. */
  taskCycle: TaskCycle;
  /** Connected subscription lanes (Settings → AI Models); all off by default —
   * a chat never leaves the Mac without the user flipping a lane on. */
  aiProviders: Record<ProviderId, boolean>;
  /** Default model for a provider mention without an explicit model id. */
  providerDefaults: Record<ProviderId, string>;
  /** Search destination for every globe-enabled chat in this vault. */
  webSearchProvider: WebSearchProvider;
  /** Hybrid model presets (organizer → routes → fallback). */
  hybridPresets: HybridPreset[];
  /** Connected models turned off inside an enabled lane (picker-hidden). */
  blockedModels: string[];
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
  /** The vault-wide default for secure ⇄ on-device AI visibility (2026-08-01).
   * true = a model running on this Mac may read secure notes; a per-note
   * `local_ai_allowed` line overrides it either way. Remote models are refused
   * regardless, always. Missing ⇒ true (docs/design/ai-visibility-matrix.md). */
  secureLocalAi: boolean;
  /** The organizer daemon's §4.3 trust rung; the Rust daemon re-reads this file
   * each cycle, so persisting here IS the durable knob. Default: suggest. */
  organizerTrust: OrganizerTrust;
  /** Which model the organizer runs. Remote choices remain opt-in. */
  organizerModel: OrganizerModel;
  organizerModelId: string | null;
  /** Idle delay (seconds) before the organizer scans a just-touched note. The
   * Rust daemon's `organizerQuietSecs` knob; default 300 (5 min). */
  organizerQuietSecs: number;
  /** The Librarian's first-visit explainer was shown (2026-07-31). */
  librarianIntroSeen: boolean;
  /** First-run onboarding gate — false until the flow is finished/skipped. */
  onboarded: boolean;
  /** The app version onboarding last completed at (the onboardingVersion gate). */
  onboardingVersion: string;
  /** First-run checkpoint that survives a vault-selection relaunch. */
  onboardingPhase: "preferences" | "vault" | "models";
  /** The Quick Note window's capped set, remembered note, and new-note folder
   * (the maintainer, 2026-06-15). */
  quickNoteIds: string[];
  captureOrder: string[];
  quickActiveId: string | null;
  quickFolder: string;
  quickVaultId: string | null;
  captureVaultId: string | null;
  /** The ONE sidebar's collapse state + width, and which dests are expanded —
   * the two-rail keys (foldersCollapsed/listCollapsed/lastOpenRails/
   * foldersWidth/listWidth) are retired (the maintainer, 2026-06-13). */
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  /** Sidebar tree zoom factor (⌘+/⌘− with focus in the sidebar). */
  sidebarZoom: number;
  /** Which high-level sidebar lens and Breve section reopen on launch. */
  sidebarMode: "notes" | "breve";
  /** Which sidebar FRONT reopens on launch: Home (notes) or Chat. ADDITIVE
   * (2026-08-01) — an older build ignores the key and opens its own default. */
  sidebarView: SidebarView;
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
let appSettingsPassthrough: Record<string, unknown> = {};
let appSettingsNeedsWrite = false;

const APP_SETTINGS_KEYS = new Set([
  "v",
  "theme",
  "themeFamily",
  // Retired independent System pair. System now follows the OS within the one
  // selected theme family.
  "matchLightFamily",
  "matchDarkFamily",
  "syntaxPalette",
  "accentColor",
  "accentHue",
  "quokkaCompanionEnabled",
  "quokkaStyle",
  "quokkaCustomHue",
  "quokkaLineColor",
  // Retired native color-well key: recognized so it migrates once and is not
  // preserved forever as an unknown setting.
  "quokkaCustomColor",
  "quokkaAccessory",
  "quokkaAccessoryHue",
  "quokkaIdlePose",
  "chatNavigatorStyle",
  "stayOpen",
  "showInDock",
  "tabLayout",
  "privateBrowserSearchEngine",
  "remoteAgentRelayUrl",
  "paneVaultMode",
  "userName",
  "timeFormat",
  "chatWelcomeStyle",
  "chatNaming",
  "hotkeyPeek",
  "appIcon",
  "onboarded",
  "onboardingVersion",
  "onboardingPhase",
  "bindings",
]);

export function unknownAppSettingsKeys(raw: string): Record<string, unknown> {
  try {
    return Object.fromEntries(
      Object.entries(record(JSON.parse(raw))).filter(([key]) => !APP_SETTINGS_KEYS.has(key)),
    );
  } catch {
    return {};
  }
}

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
    noteStyles[id] = {
      size,
      measure: asEnum(s.measure, MEASURES, DEFAULT_NOTE_STYLE.measure),
    };
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
  const savedProviderDefaults = record(data.providerDefaults) as Partial<Record<ProviderId, string>>;
  const providerDefaults = Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, providerDefaultModel(id, savedProviderDefaults)]),
  ) as Record<ProviderId, string>;
  const providerDefaultIds = new Set(Object.values(providerDefaults));
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
    // the System zone + the Capture(Inbox) & Vault dests inside Home
    expandedDests[SEC_SYSTEM] = true;
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
  const quickVaultId = typeof data.quickVaultId === "string" && data.quickVaultId ? data.quickVaultId : null;
  const captureVaultId =
    typeof data.captureVaultId === "string" && data.captureVaultId ? data.captureVaultId : null;
  return {
    v: 1,
    theme: asEnum(data.theme, THEME_SETTINGS, "light"),
    themeFamily: asEnum(data.themeFamily, THEME_FAMILIES, "warm"),
    syntaxPalette: asEnum(data.syntaxPalette, SYNTAX_PALETTES, "rotli"),
    accentColor: asEnum(data.accentColor, ACCENT_COLORS, "default"),
    accentHue:
      typeof data.accentHue === "number" &&
      Number.isFinite(data.accentHue) &&
      data.accentHue >= 0 &&
      data.accentHue <= 359
        ? Math.round(data.accentHue)
        : DEFAULT_ACCENT_HUE,
    quokkaCompanionEnabled: asBool(data.quokkaCompanionEnabled, false),
    quokkaStyle: asEnum(data.quokkaStyle, QUOKKA_STYLES, "cocoa"),
    quokkaCustomHue:
      data.quokkaCustomHue === undefined
        ? quokkaHueFromLegacyColor(data.quokkaCustomColor)
        : normalizeQuokkaCustomHue(data.quokkaCustomHue),
    // Auto, Black, and White are all real picker choices (Settings → Appearance
    // → Line color); an explicit Black used to be remapped to Auto here and
    // silently vanished on every relaunch (2026-09-01).
    quokkaLineColor: asEnum(data.quokkaLineColor, QUOKKA_LINE_COLORS, "auto"),
    quokkaAccessory: asEnum(data.quokkaAccessory, QUOKKA_ACCESSORIES, "none"),
    quokkaAccessoryHue: normalizeQuokkaAccessoryHue(data.quokkaAccessoryHue),
    quokkaIdlePose: asEnum(data.quokkaIdlePose, QUOKKA_IDLE_POSES, "rest"),
    chatNavigatorStyle: asEnum(data.chatNavigatorStyle, CHAT_NAVIGATOR_STYLES, "paws"),
    stayOpen: asBool(data.stayOpen, false),
    showInDock: asBool(data.showInDock, false),
    newTabDefault: asEnum(data.newTabDefault, NEW_ITEM_KINDS, DEFAULT_NEW_ITEM_KIND),
    tabLayout: asEnum(data.tabLayout, TAB_LAYOUTS, "scroll"),
    privateBrowserSearchEngine: asEnum(
      data.privateBrowserSearchEngine,
      PRIVATE_BROWSER_SEARCH_ENGINES,
      DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
    ),
    remoteAgentRelayUrl:
      typeof data.remoteAgentRelayUrl === "string" && data.remoteAgentRelayUrl.length <= 2048
        ? data.remoteAgentRelayUrl.trim()
        : "",
    paneVaultMode: asEnum(data.paneVaultMode, PANE_VAULT_MODES, "single"),
    spellcheck: asBool(data.spellcheck, true),
    tidyImagesWithNote: asBool(data.tidyImagesWithNote, true),
    rawEditor: asBool(data.rawEditor, false),
    blockHandles2: asBool(data.blockHandles2, true),
    userName: typeof data.userName === "string" ? data.userName : "",
    timeFormat: asEnum(data.timeFormat, TIME_FORMATS, "12"),
    mainAutoRemoveDays: parseRetentionDays(data.mainAutoRemoveDays),
    chatAutoArchiveDays: parseRetentionDays(data.chatAutoArchiveDays),
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
    chatReasoning: (() => {
      const out: Record<string, ChatReasoningEffort> = {};
      for (const [k, v] of Object.entries(record(data.chatReasoning))) {
        if (["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(String(v))) {
          out[k] = v as ChatReasoningEffort;
        }
      }
      return persistableChatMap(out);
    })(),
    chatServiceTier: (() => {
      const out: Record<string, ChatServiceTier> = {};
      for (const [k, v] of Object.entries(record(data.chatServiceTier))) {
        if (v === "standard" || v === "fast") out[k] = v;
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
    chatWelcomeStyle: asEnum(data.chatWelcomeStyle, CHAT_WELCOME_STYLES, "lively"),
    chatNaming: asEnum(data.chatNaming, CHAT_NAMINGS, "ask"),
    chatArtifactOpen: asEnum(data.chatArtifactOpen, CHAT_ARTIFACT_OPENS, "sidecar"),
    // an unknown/absent value reads as the default rather than disabling the
    // peek — a typo in the file must never silently remove a discoverability aid
    hotkeyPeek: HOTKEY_PEEKS.includes(data.hotkeyPeek as HotkeyPeek)
      ? (data.hotkeyPeek as HotkeyPeek)
      : "badges",
    // OFF unless explicitly stored — a voice model must never be fetched
    // because a config file was unreadable
    readAloud: data.readAloud === true,
    readAloudVoice: VOICES.some((v) => v.id === data.readAloudVoice)
      ? (data.readAloudVoice as string)
      : DEFAULT_VOICE,
    // an unknown value keeps the classic two-state click: a garbled file must
    // never silently change what a click does to someone's tasks
    taskCycle: TASK_CYCLES.includes(data.taskCycle as TaskCycle) ? (data.taskCycle as TaskCycle) : "two",
    // Provider-account safety migration: only documented official-client
    // preferences survive. Unknown legacy flags are discarded.
    aiProviders: {
      claude: record(data.aiProviders).claude === true,
      codex: record(data.aiProviders).codex === true,
      cursor: record(data.aiProviders).cursor === true,
      antigravity: record(data.aiProviders).antigravity === true,
    },
    providerDefaults,
    webSearchProvider: parseWebSearchProvider(data.webSearchProvider),
    hybridPresets: parseHybridPresets(data.hybridPresets),
    blockedModels: Array.isArray(data.blockedModels)
      ? data.blockedModels.filter((x): x is string => typeof x === "string" && !providerDefaultIds.has(x))
      : [],
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
    // Organize is the DEFAULT rung (the maintainer, 2026-07-02): the daemon only ever
    // changes a note's location + metadata — journaled and undoable, never the
    // note's words — so full auto-organize is the intended out-of-box behavior.
    // An unknown rung (hand-edit, future build) falls to the same default.
    // the Brain master switch (vault-vs-brain, 2026-07-26): a MISSING field
    // means ON — every existing vault keeps today's behavior untouched
    brainEnabled: asBool(data.brainEnabled, true),
    // secure ⇄ on-device visibility: a MISSING field means ON, matching Rust
    secureLocalAi: asBool(data.secureLocalAi, true),
    organizerTrust: asEnum(data.organizerTrust, ORGANIZER_TRUSTS, "organize"),
    // default LOCAL (on-device) so organizing never leaves the Mac unless chosen
    organizerModel: asEnum(data.organizerModel, ORGANIZER_MODELS, "local"),
    organizerModelId: librarianModelId(
      asEnum(data.organizerModel, ORGANIZER_MODELS, "local"),
      data.organizerModelId,
    ),
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
    onboardingPhase:
      data.onboardingPhase === "vault" || data.onboardingPhase === "models"
        ? data.onboardingPhase
        : "preferences",
    quickNoteIds,
    captureOrder,
    quickActiveId,
    quickFolder,
    quickVaultId,
    captureVaultId,
    // missing keys default — old configs predate the single sidebar, never crash
    sidebarCollapsed: asBool(data.sidebarCollapsed, false),
    sidebarWidth: clampSidebarWidth(typeof data.sidebarWidth === "number" ? data.sidebarWidth : 240),
    sidebarZoom: clampSidebarZoom(typeof data.sidebarZoom === "number" ? data.sidebarZoom : 1),
    sidebarMode: LAUNCH_FEATURES.breve && data.sidebarMode === "breve" ? "breve" : "notes",
    // Home is the safe default front — a fresh (or unknown) value opens on notes
    sidebarView: data.sidebarView === "chat" ? "chat" : "home",
    breveView:
      data.breveView === "dashboard" ||
      data.breveView === "briefs" ||
      data.breveView === "notifications" ||
      data.breveView === "watchlist" ||
      data.breveView === "routines" ||
      data.breveView === "settings"
        ? data.breveView
        : // the retired Models/Configure views merged into Settings (2026-07-30)
          data.breveView === "models" || data.breveView === "configure"
          ? "settings"
          : "dashboard",
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
    "vaultWelcomeSeen",
    "matchLightFamily",
    "matchDarkFamily",
    "imageEngine",
  ]);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key) && !retired.has(key)));
}

function applySettings(s: PersistedSettings): void {
  useUiStore.setState({
    theme: s.theme,
    themeFamily: s.themeFamily,
    syntaxPalette: s.syntaxPalette,
    accentColor: s.accentColor,
    accentHue: s.accentHue,
    quokkaCompanionEnabled: s.quokkaCompanionEnabled,
    quokkaStyle: s.quokkaStyle,
    quokkaCustomHue: s.quokkaCustomHue,
    quokkaLineColor: s.quokkaLineColor,
    quokkaAccessory: s.quokkaAccessory,
    quokkaAccessoryHue: s.quokkaAccessoryHue,
    quokkaIdlePose: s.quokkaIdlePose,
    chatNavigatorStyle: s.chatNavigatorStyle,
    stayOpen: s.stayOpen,
    showInDock: s.showInDock,
    newTabDefault: s.newTabDefault,
    tabLayout: s.tabLayout,
    privateBrowserSearchEngine: s.privateBrowserSearchEngine,
    remoteAgentRelayUrl: s.remoteAgentRelayUrl,
    paneVaultMode: s.paneVaultMode,
    spellcheck: s.spellcheck,
    tidyImagesWithNote: s.tidyImagesWithNote,
    rawEditor: s.rawEditor,
    blockHandles: s.blockHandles2,
    userName: s.userName,
    timeFormat: s.timeFormat,
    mainAutoRemoveDays: s.mainAutoRemoveDays,
    chatAutoArchiveDays: s.chatAutoArchiveDays,
    chatModelId: s.chatModelId,
    chatModel: s.chatModel,
    chatReasoning: s.chatReasoning,
    chatServiceTier: s.chatServiceTier,
    chatWeb: s.chatWeb,
    chatMeasure: s.chatMeasure,
    chatNoteOpen: s.chatNoteOpen,
    chatWelcomeStyle: s.chatWelcomeStyle,
    chatNaming: s.chatNaming,
    chatArtifactOpen: s.chatArtifactOpen,
    hotkeyPeek: s.hotkeyPeek,
    readAloud: s.readAloud,
    readAloudVoice: s.readAloudVoice,
    taskCycle: s.taskCycle,
    aiProviders: { ...s.aiProviders },
    providerDefaults: { ...s.providerDefaults },
    webSearchProvider: s.webSearchProvider,
    hybridPresets: s.hybridPresets,
    blockedModels: s.blockedModels,
    storageGrouping: s.storageGrouping,
    appIcon: s.appIcon,
    fileMetadata: s.fileMetadata,
    brainEnabled: s.brainEnabled,
    secureLocalAi: s.secureLocalAi,
    organizerTrust: s.organizerTrust,
    organizerModel: s.organizerModel,
    organizerModelId: s.organizerModelId,
    organizerQuietSecs: s.organizerQuietSecs,
    librarianIntroSeen: s.librarianIntroSeen,
    onboarded: s.onboarded,
    onboardingVersion: s.onboardingVersion,
    onboardingPhase: s.onboardingPhase,
    quickNoteIds: s.quickNoteIds,
    captureOrder: s.captureOrder,
    quickActiveId: s.quickActiveId,
    quickFolder: s.quickFolder,
    quickVaultId: s.quickVaultId,
    captureVaultId: s.captureVaultId,
    sidebarCollapsed: s.sidebarCollapsed,
    sidebarWidth: s.sidebarWidth,
    sidebarZoom: s.sidebarZoom,
    sidebarMode: s.sidebarMode,
    sidebarView: s.sidebarView,
    breveView: s.breveView,
    expandedDests: s.expandedDests,
  });
  useBindingsStore.setState({ overrides: s.bindings });
  useNoteStyleStore.setState({ styles: s.noteStyles });
  useTableWidthsStore.setState({
    widths: s.tableWidths,
    heights: s.tableHeights,
  });
}

/** Installation preferences that remain meaningful before (and across) vaults.
 * Vault-scoped editor, content, and AI policy never enter this sidecar. */
function applyAppSettings(s: PersistedSettings): void {
  useUiStore.setState({
    theme: s.theme,
    themeFamily: s.themeFamily,
    syntaxPalette: s.syntaxPalette,
    accentColor: s.accentColor,
    accentHue: s.accentHue,
    quokkaCompanionEnabled: s.quokkaCompanionEnabled,
    quokkaStyle: s.quokkaStyle,
    quokkaCustomHue: s.quokkaCustomHue,
    quokkaLineColor: s.quokkaLineColor,
    quokkaAccessory: s.quokkaAccessory,
    quokkaAccessoryHue: s.quokkaAccessoryHue,
    quokkaIdlePose: s.quokkaIdlePose,
    chatNavigatorStyle: s.chatNavigatorStyle,
    stayOpen: s.stayOpen,
    showInDock: s.showInDock,
    tabLayout: s.tabLayout,
    privateBrowserSearchEngine: s.privateBrowserSearchEngine,
    remoteAgentRelayUrl: s.remoteAgentRelayUrl,
    paneVaultMode: s.paneVaultMode,
    userName: s.userName,
    timeFormat: s.timeFormat,
    chatWelcomeStyle: s.chatWelcomeStyle,
    chatNaming: s.chatNaming,
    hotkeyPeek: s.hotkeyPeek,
    appIcon: s.appIcon,
    onboarded: s.onboarded,
    onboardingVersion: s.onboardingVersion,
    onboardingPhase: s.onboardingPhase,
  });
  useBindingsStore.setState({ overrides: s.bindings });
}

function withAppSettings(vault: PersistedSettings, app: PersistedSettings): PersistedSettings {
  return {
    ...vault,
    theme: app.theme,
    themeFamily: app.themeFamily,
    syntaxPalette: app.syntaxPalette,
    accentColor: app.accentColor,
    accentHue: app.accentHue,
    quokkaCompanionEnabled: app.quokkaCompanionEnabled,
    quokkaStyle: app.quokkaStyle,
    quokkaCustomHue: app.quokkaCustomHue,
    quokkaLineColor: app.quokkaLineColor,
    quokkaAccessory: app.quokkaAccessory,
    quokkaAccessoryHue: app.quokkaAccessoryHue,
    quokkaIdlePose: app.quokkaIdlePose,
    chatNavigatorStyle: app.chatNavigatorStyle,
    stayOpen: app.stayOpen,
    showInDock: app.showInDock,
    tabLayout: app.tabLayout,
    privateBrowserSearchEngine: app.privateBrowserSearchEngine,
    remoteAgentRelayUrl: app.remoteAgentRelayUrl,
    paneVaultMode: app.paneVaultMode,
    userName: app.userName,
    timeFormat: app.timeFormat,
    chatWelcomeStyle: app.chatWelcomeStyle,
    chatNaming: app.chatNaming,
    hotkeyPeek: app.hotkeyPeek,
    appIcon: app.appIcon,
    onboarded: app.onboarded,
    onboardingVersion: app.onboardingVersion,
    onboardingPhase: app.onboardingPhase,
    bindings: app.bindings,
  };
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

/** Revalidate ONE persisted tab against the live Tab union — every surfaceKind
 * must have a branch here, or its tabs silently vanish at relaunch (and a
 * single-tab leaf's split collapses with them — #34, audit 2026-07: file +
 * activity were missing). Exported for round-trip tests. */
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
      ...(typeof o.vaultId === "string" && o.vaultId ? { vaultId: o.vaultId } : {}),
    };
  }
  // file: like canvas, ids are paths (no alive-set) — FileSurface itself shows
  // the honest error for a since-deleted file.
  if (o.surfaceKind === "file") {
    if (typeof o.fileId !== "string" || !o.fileId) return null;
    return { id: o.id, surfaceKind: "file", fileId: o.fileId, ...preview };
  }
  if (o.surfaceKind === "activity") {
    return { id: o.id, surfaceKind: "activity" };
  }
  // Private browser tabs are session-only by product contract. Explicitly
  // discard them at hydration so URLs/history can never survive a relaunch.
  if (o.surfaceKind === "browser") return null;
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
    return {
      kind: "split",
      id: o.id,
      dir: o.dir,
      children,
      sizes: sizes.map((x) => x / total),
    };
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
  // (the maintainer, 2026-06-13). A stored "Brain" id from before the rename is no longer
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
  const finiteTouches = (value: unknown, keep?: (key: string) => boolean): Record<string, number> =>
    Object.fromEntries(
      Object.entries(record(value))
        .filter(
          ([key, at]) => (!keep || keep(key)) && typeof at === "number" && Number.isFinite(at) && at > 0,
        )
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 4096)
        .map(([key, at]) => [key, at as number]),
    ) as Record<string, number>;
  useMruStore.setState({
    itemTouchedAt: finiteTouches(data.itemTouchedAt, (id) => alive.has(id)),
    chatTouchedAt: finiteTouches(data.chatTouchedAt),
  });
  // Every active tab is visible immediately after hydration, so it counts as
  // viewed before the user clicks it. Chat surfaces add a vault-qualified touch
  // when they mount and know their owning instance.
  for (const leaf of leaves(usePanesStore.getState().root)) {
    const active = leaf.tabs.find((tab) => tab.id === leaf.activeTabId);
    if (active?.surfaceKind === "note") touchMru(active.noteId);
    else if (active?.surfaceKind === "canvas") touchItemActivity(active.boardId);
    else if (active?.surfaceKind === "file") touchItemActivity(active.fileId);
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
/** Set once Main has hydrated on the main surface — gates the deferred GC so it
 * never runs before its dependency (the Main manifest) is in place, and never on
 * a non-main surface. */
let mainMapsReady = false;

/** Post-first-render maintenance: the orphan-map GC that used to be awaited
 * before the first paint (perf audit 2026-08). main.tsx kicks this AFTER the
 * initial render so it never delays pixels; it still runs every launch. No-op
 * until Main has hydrated (mainMapsReady) — the same dependency the awaited call
 * had — and a no-op on any non-main surface. Keeps gcPersistedMaps's own
 * keep-on-error semantics (it swallows read failures internally). */
export async function runDeferredMaintenance(): Promise<void> {
  if (!mainMapsReady) return;
  await gcPersistedMaps();
  await runAutoRetentionMaintenance();
}

/** Apply the two opt-in inactivity policies. Main is a reference projection,
 * so cleanup only unlinks refs. Chats use the existing recoverable archive
 * operation. A failed listing or invalid timestamp selects nothing. */
let retentionMaintenanceInFlight: Promise<void> | null = null;

export function runAutoRetentionMaintenance(now = Date.now()): Promise<void> {
  if (retentionMaintenanceInFlight) return retentionMaintenanceInFlight;
  const current = performAutoRetentionMaintenance(now);
  retentionMaintenanceInFlight = current;
  void current.then(
    () => {
      if (retentionMaintenanceInFlight === current) retentionMaintenanceInFlight = null;
    },
    () => {
      if (retentionMaintenanceInFlight === current) retentionMaintenanceInFlight = null;
    },
  );
  return current;
}

async function performAutoRetentionMaintenance(now: number): Promise<void> {
  if (!mainMapsReady || !isTauri()) return;
  const ui = useUiStore.getState();
  if (ui.mainAutoRemoveDays === null && ui.chatAutoArchiveDays === null) return;

  const openItems = new Set<string>();
  const openChatSlugs = new Set<string>();
  for (const leaf of leaves(usePanesStore.getState().root)) {
    for (const tab of leaf.tabs) {
      if (tab.surfaceKind === "note") openItems.add(tab.noteId);
      else if (tab.surfaceKind === "canvas") openItems.add(tab.boardId);
      else if (tab.surfaceKind === "file") openItems.add(tab.fileId);
      else if (tab.surfaceKind === "chat" && tab.chatSlug) openChatSlugs.add(tab.chatSlug);
    }
  }

  if (ui.mainAutoRemoveDays !== null) {
    try {
      const summaries = new Map((await notesService.listAll()).map((note) => [note.id, note]));
      const main = useMainStore.getState();
      let tree = main.manifest.tree;
      for (const id of mainNoteIds(tree)) {
        const note = summaries.get(id);
        if (
          note &&
          isRetentionEligible(
            {
              updatedAt: note.updatedAt,
              ...(useMruStore.getState().itemTouchedAt[id] !== undefined
                ? { viewedAt: useMruStore.getState().itemTouchedAt[id] }
                : {}),
              pinned: note.pinned,
              open: openItems.has(id),
            },
            ui.mainAutoRemoveDays,
            now,
          )
        ) {
          tree = removeFromMain(tree, id);
        }
      }
      if (tree !== main.manifest.tree) main.setTree(tree);
    } catch {
      // A failed corpus listing means "unknown", never "safe to unlink".
    }
  }

  if (ui.chatAutoArchiveDays !== null) {
    try {
      const instance = activeInstance(await loadConfig());
      if (!instance) return;
      const chats = await listChats(instance);
      for (const chat of chats) {
        if (
          isRetentionEligible(
            {
              updatedAt: chat.modifiedMs,
              ...(useMruStore.getState().chatTouchedAt[`${instance.id}:${chat.slug}`] !== undefined
                ? {
                    viewedAt: useMruStore.getState().chatTouchedAt[`${instance.id}:${chat.slug}`],
                  }
                : {}),
              pinned: chat.pinned,
              open: openChatSlugs.has(chat.slug),
            },
            ui.chatAutoArchiveDays,
            now,
          )
        ) {
          try {
            await archiveChat(instance, chat.slug);
          } catch {
            // A per-chat refusal (including read-only policy) cannot turn into
            // a broader operation. Continue with the independently eligible set.
          }
        }
      }
    } catch {
      // Unreadable config or chat listing fails closed.
    }
  }
}

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
      // live keys are VAULT-scoped `<instanceId>:<slug>` (2026-08-03); `owners`
      // re-homes pre-scoping bare-slug keys to the one instance that has the slug
      const composite = new Set<string>();
      const owners = new Map<string, string[]>();
      cfg.instances.forEach((inst, i) => {
        for (const c of lists[i] ?? []) {
          composite.add(`${inst.id}:${c.slug}`);
          owners.set(c.slug, [...(owners.get(c.slug) ?? []), inst.id]);
        }
      });
      const ui = useUiStore.getState();
      const liveKey = (k: string) => composite.has(k) || k.startsWith("unsaved:");
      const kept = pruneMap(rescopeChatMapKeys(ui.chatWeb, owners), liveKey);
      if (kept !== ui.chatWeb) useUiStore.setState({ chatWeb: kept });
      const keptMeasure = pruneMap(rescopeChatMapKeys(ui.chatMeasure, owners), liveKey);
      if (keptMeasure !== ui.chatMeasure) useUiStore.setState({ chatMeasure: keptMeasure });
      const keptModel = pruneMap(rescopeChatMapKeys(ui.chatModel, owners), liveKey);
      if (keptModel !== ui.chatModel) useUiStore.setState({ chatModel: keptModel });
      const keptReasoning = pruneMap(rescopeChatMapKeys(ui.chatReasoning, owners), liveKey);
      if (keptReasoning !== ui.chatReasoning) useUiStore.setState({ chatReasoning: keptReasoning });
      const keptTier = pruneMap(rescopeChatMapKeys(ui.chatServiceTier, owners), liveKey);
      if (keptTier !== ui.chatServiceTier) useUiStore.setState({ chatServiceTier: keptTier });
    }
  } catch {
    // an unreadable chats/ anywhere — keep everything
  }
  try {
    const folders = await notesService.listFolders();
    const valid = new Set<string>([
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
      // "sec:*" zone keys are kept by SHAPE, not by name: sec:system is live,
      // and the retired sec:chat / sec:notes / sec:inbox keys must survive so a
      // downgrade (or the parked Inbox front's return) finds its fold state
      (k) =>
        valid.has(k) ||
        k.startsWith("sec:") ||
        k.endsWith(":") ||
        k.startsWith("Storage/") ||
        k.startsWith("chatfolder:"),
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
  applyTheme(s.theme, s.themeFamily);
  applySyntaxPalette(s.syntaxPalette);
  applyAccent(s.accentColor, s.accentHue);
}

// ─── hydrate (awaited by main.tsx before the first render) ───────────────────

/** Load everything durable from `.rotli/` into the stores. Never throws, never
 * blocks on bad data — a deleted or corrupted dot-file just means defaults. */
export async function hydratePersistedState(): Promise<void> {
  if (!isTauri()) return; // the browser keeps the in-memory demo, untouched
  let configured = true;
  try {
    configured = await corpusStatus();
  } catch {
    // A status failure must not strand an existing installation at activation.
    configured = true;
  }
  useVaultStore.getState().setStatus(configured ? "configured" : "unconfigured");

  let shellSettings = parseSettings("{}");
  let appSettings = shellSettings;
  let appSettingsPresent = false;
  try {
    const appRaw = await appSettingsRead();
    appSettingsPresent = Object.keys(record(JSON.parse(appRaw))).length > 0;
    appSettingsPassthrough = unknownAppSettingsKeys(appRaw);
    appSettingsNeedsWrite = !appSettingsPresent;
    appSettings = parseSettings(appRaw);
    shellSettings = appSettings;
    if (appSettingsPresent) applyAppSettings(appSettings);
  } catch {
    // in-memory app defaults remain
  }

  if (configured) {
    try {
      const raw = await corpusSettingsRead("settings");
      const settings = parseSettings(raw);
      shellSettings = settings;
      // keys this build doesn't know survive every rewrite (#35) — main window
      // only would suffice (it's the one writer), but capturing here is harmless
      settingsPassthrough = unknownSettingsKeys(raw);
      applySettings(settings);
      if (appSettingsPresent) {
        applyAppSettings(appSettings);
        shellSettings = withAppSettings(settings, appSettings);
      } else {
        shellSettings = settings;
      }
      if (isMainSurface()) {
        // Main + Views are independent reads. Viewstate validates against both.
        await Promise.all([hydrateMain(), hydrateViews()]);
        await hydrateViewstate();
        mainMapsReady = true;
      }
    } catch {
      // a missing/corrupt vault sidecar means defaults + app preferences
    }
  } else if (!appSettingsPresent) {
    // The first-ever paint is Rotli Light. Existing installations are
    // untouched because either their app sidecar or their configured vault
    // supplies the prior choice.
    useUiStore.setState({
      ...DEFAULT_APPEARANCE,
      stayOpen: false,
      showInDock: false,
    });
    shellSettings = {
      ...shellSettings,
      theme: DEFAULT_APPEARANCE.theme,
      themeFamily: DEFAULT_APPEARANCE.themeFamily,
    };
  }
  if (isMainSurface()) {
    applyShellSideEffects(shellSettings);
  }
  prePaint();
}

// ─── save (one debounced writer, main window only) ───────────────────────────

/** Everything a floating webview must mirror from the main window, as the
 * SAME serialized shapes the settings files use: the app-wide settings
 * (theme, accent, quokka, syntax palette, hotkey peek, time format, rebinds…)
 * plus the vault's per-note typography. Main emits this on every change and
 * the quick + capture windows apply it, so a setting never goes stale there
 * until relaunch (2026-09-01: only theme + quokka used to travel). */
export interface AppearanceBroadcast {
  app: string;
  noteStyles: string;
}

export function appearanceBroadcast(): AppearanceBroadcast {
  return { app: appSettingsSnapshot(), noteStyles: JSON.stringify(persistedNoteStyles()) };
}

export function applyAppearanceBroadcast(payload: AppearanceBroadcast): void {
  applyAppSettings(parseSettings(payload.app));
  const styles: Record<string, NoteStyle> = {};
  for (const [id, style] of Object.entries(record(JSON.parse(payload.noteStyles)))) {
    if (style && typeof style === "object") styles[id] = style as NoteStyle;
  }
  useNoteStyleStore.setState({ styles });
}

function appSettingsSnapshot(): string {
  const ui = useUiStore.getState();
  return JSON.stringify({
    ...appSettingsPassthrough,
    v: 1,
    theme: ui.theme,
    themeFamily: ui.themeFamily,
    syntaxPalette: ui.syntaxPalette,
    accentColor: ui.accentColor,
    accentHue: ui.accentHue,
    quokkaCompanionEnabled: ui.quokkaCompanionEnabled,
    quokkaStyle: ui.quokkaStyle,
    quokkaCustomHue: ui.quokkaCustomHue,
    quokkaLineColor: ui.quokkaLineColor,
    quokkaAccessory: ui.quokkaAccessory,
    quokkaAccessoryHue: ui.quokkaAccessoryHue,
    quokkaIdlePose: ui.quokkaIdlePose,
    chatNavigatorStyle: ui.chatNavigatorStyle,
    stayOpen: ui.stayOpen,
    showInDock: ui.showInDock,
    tabLayout: ui.tabLayout,
    privateBrowserSearchEngine: ui.privateBrowserSearchEngine,
    remoteAgentRelayUrl: ui.remoteAgentRelayUrl,
    paneVaultMode: ui.paneVaultMode,
    userName: ui.userName,
    timeFormat: ui.timeFormat,
    chatWelcomeStyle: ui.chatWelcomeStyle,
    chatNaming: ui.chatNaming,
    hotkeyPeek: ui.hotkeyPeek,
    appIcon: ui.appIcon,
    onboarded: ui.onboarded,
    onboardingVersion: ui.onboardingVersion,
    onboardingPhase: ui.onboardingPhase,
    bindings: useBindingsStore.getState().overrides,
  });
}

function settingsSnapshot(): string {
  const ui = useUiStore.getState();
  const snapshot: PersistedSettings = {
    v: 1,
    theme: ui.theme,
    themeFamily: ui.themeFamily,
    syntaxPalette: ui.syntaxPalette,
    accentColor: ui.accentColor,
    accentHue: ui.accentHue,
    quokkaCompanionEnabled: ui.quokkaCompanionEnabled,
    quokkaStyle: ui.quokkaStyle,
    quokkaCustomHue: ui.quokkaCustomHue,
    quokkaLineColor: ui.quokkaLineColor,
    quokkaAccessory: ui.quokkaAccessory,
    quokkaAccessoryHue: ui.quokkaAccessoryHue,
    quokkaIdlePose: ui.quokkaIdlePose,
    chatNavigatorStyle: ui.chatNavigatorStyle,
    stayOpen: ui.stayOpen,
    showInDock: ui.showInDock,
    newTabDefault: ui.newTabDefault,
    tabLayout: ui.tabLayout,
    privateBrowserSearchEngine: ui.privateBrowserSearchEngine,
    remoteAgentRelayUrl: ui.remoteAgentRelayUrl,
    paneVaultMode: ui.paneVaultMode,
    spellcheck: ui.spellcheck,
    tidyImagesWithNote: ui.tidyImagesWithNote,
    rawEditor: ui.rawEditor,
    blockHandles2: ui.blockHandles,
    userName: ui.userName,
    timeFormat: ui.timeFormat,
    mainAutoRemoveDays: ui.mainAutoRemoveDays,
    chatAutoArchiveDays: ui.chatAutoArchiveDays,
    chatModelId: ui.chatModelId,
    chatModel: persistableChatMap(ui.chatModel),
    chatReasoning: persistableChatMap(ui.chatReasoning),
    chatServiceTier: persistableChatMap(ui.chatServiceTier),
    chatWeb: persistableChatMap(ui.chatWeb),
    chatMeasure: persistableChatMap(ui.chatMeasure),
    chatNoteOpen: ui.chatNoteOpen,
    chatWelcomeStyle: ui.chatWelcomeStyle,
    chatNaming: ui.chatNaming,
    chatArtifactOpen: ui.chatArtifactOpen,
    hotkeyPeek: ui.hotkeyPeek,
    readAloud: ui.readAloud,
    readAloudVoice: ui.readAloudVoice,
    taskCycle: ui.taskCycle,
    aiProviders: { ...ui.aiProviders },
    providerDefaults: { ...ui.providerDefaults },
    webSearchProvider: ui.webSearchProvider,
    hybridPresets: ui.hybridPresets,
    blockedModels: ui.blockedModels,
    storageGrouping: ui.storageGrouping,
    appIcon: ui.appIcon,
    fileMetadata: ui.fileMetadata,
    brainEnabled: ui.brainEnabled,
    secureLocalAi: ui.secureLocalAi,
    organizerTrust: ui.organizerTrust,
    organizerModel: ui.organizerModel,
    organizerModelId: ui.organizerModelId,
    organizerQuietSecs: ui.organizerQuietSecs,
    librarianIntroSeen: ui.librarianIntroSeen,
    onboarded: ui.onboarded,
    onboardingVersion: ui.onboardingVersion,
    onboardingPhase: ui.onboardingPhase,
    quickNoteIds: ui.quickNoteIds,
    captureOrder: ui.captureOrder,
    quickActiveId: ui.quickActiveId,
    quickFolder: ui.quickFolder,
    quickVaultId: ui.quickVaultId,
    captureVaultId: ui.captureVaultId,
    sidebarCollapsed: ui.sidebarCollapsed,
    sidebarWidth: ui.sidebarWidth,
    sidebarZoom: ui.sidebarZoom,
    sidebarMode: ui.sidebarMode,
    sidebarView: ui.sidebarView,
    breveView: ui.breveView,
    expandedDests: ui.expandedDests,
    bindings: useBindingsStore.getState().overrides,
    noteStyles: persistedNoteStyles(),
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
    root: durablePane(panes.root),
    focusedPaneId: panes.focusedPaneId,
    selectedFolderId: useUiStore.getState().selectedFolderId,
    activeView: useUiStore.getState().activeView,
    mru: useMruStore.getState().ids,
    itemTouchedAt: useMruStore.getState().itemTouchedAt,
    chatTouchedAt: useMruStore.getState().chatTouchedAt,
  };
  return JSON.stringify(snapshot);
}

/** Durably write the current settings snapshot RIGHT NOW (awaitable) — used
 * before a deliberate relaunch so flags like `onboarded` survive the restart. */
export async function flushSettingsNow(): Promise<void> {
  if (!isTauri()) return;
  const writes: Array<Promise<void>> = [appSettingsWrite(appSettingsSnapshot())];
  if (useVaultStore.getState().status === "configured") {
    writes.push(corpusSettingsWrite("settings", settingsSnapshot()));
  }
  await Promise.all(writes);
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

  const configured = useVaultStore.getState().status === "configured";

  let lastAppSettings = appSettingsNeedsWrite ? "" : appSettingsSnapshot();
  const appDrain = async (): Promise<void> => {
    const next = appSettingsSnapshot();
    if (next === lastAppSettings) return;
    await appSettingsWrite(next);
    lastAppSettings = next;
  };
  const appSaver = createDebouncedTask(SAVE_DEBOUNCE_MS, appDrain);
  if (appSettingsNeedsWrite) appSaver.schedule();

  // The corpus writer simply stays dormant until activation relaunches into a
  // configured vault. No command in a skipped first run can create `.rotli/`.
  const corpusDrain = configured
    ? createPersistDrain(
        corpusSettingsWrite,
        { settings: settingsSnapshot, viewstate: viewstateSnapshot },
        { settings: settingsSnapshot(), viewstate: viewstateSnapshot() },
        () => corpusSaver.schedule(),
      )
    : async () => {};
  const corpusSaver = createDebouncedTask(SAVE_DEBOUNCE_MS, corpusDrain);

  const schedule = (): void => {
    appSaver.schedule();
    if (configured) corpusSaver.schedule();
  };
  const flush = (): Promise<void> =>
    Promise.all([appSaver.flush(), ...(configured ? [corpusSaver.flush()] : [])]).then(() => {});

  const unsubs = [
    useUiStore.subscribe(schedule),
    useBindingsStore.subscribe(schedule),
    useNoteStyleStore.subscribe(schedule),
    useTableWidthsStore.subscribe(schedule),
    usePanesStore.subscribe(schedule),
    useMruStore.subscribe(schedule),
  ];
  const onVisibility = (): void => {
    if (document.hidden) void flush().catch(() => {});
  };
  const onPageHide = (): void => {
    void flush().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  // ⌘Q / tray-Quit with the window still up fires neither of the above —
  // the quit handshake (#4) holds the exit until the write actually lands,
  // so it must receive the flush PROMISE, not a fire-and-forget call.
  onQuitFlush(flush);

  return () => {
    void flush().catch(() => {});
    for (const unsub of unsubs) unsub();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  };
}
