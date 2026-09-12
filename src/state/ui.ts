import { create } from "zustand";
// UI state only (the Zustand law). Data lives behind src/services/.

import { LIBRARIAN_LANES, type LibrarianChoice } from "../ai/librarianLane";
import { DEFAULT_PROVIDER_MODELS, type HybridPreset, type ProviderId } from "../ai/models";
import { DEFAULT_WEB_SEARCH_PROVIDER, type WebSearchProvider } from "../ai/searchProvider";
import {
  DEFAULT_QUOKKA_ACCESSORY_HUE,
  DEFAULT_QUOKKA_CUSTOM_HUE,
  type QuokkaAccessory,
  type QuokkaIdlePose,
  type QuokkaLineColor,
  type QuokkaStyle,
  normalizeQuokkaAccessoryHue,
  normalizeQuokkaCustomHue,
} from "../brand/quokka";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import {
  DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
  type PrivateBrowserSearchEngine,
} from "../lib/privateBrowser";
import { DEFAULT_NEW_ITEM_KIND, type NewItemKind } from "../newItems/model";
import { inboxFolderId } from "../services/notes";
import type { NoteSummary } from "../types";
import { DEFAULT_VOICE } from "../voice/speech";
import { DEFAULT_ACCENT_HUE, DEFAULT_APPEARANCE } from "./appearanceDefaults";
import type { Measure } from "./noteStyle";
import { systemPrefersDark } from "./systemScheme";

export type ThemeSetting = "light" | "dark" | "system";

/** Every family is a deliberately tuned light/dark pair. The first two retain
 * Rotli's original environments; the others are optional personality layers. */
export const THEME_FAMILIES = ["warm", "mono", "ocean", "grove", "iris", "midnight"] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];
export type OnboardingPhase = "preferences" | "vault" | "models";
export type SyntaxPalette = "rotli" | "mono";

/** The user's PRIMARY color (the maintainer, 2026-07-28): the active state, folder
 * color, selection wash — everything riding --accent. "default" keeps each
 * theme's own truth (warm clay / mono ink); a named accent overrides it in
 * both schemes. Chosen in onboarding, changeable in Settings → Appearance. */
export const ACCENT_COLORS = ["default", "blue", "green", "violet", "rose", "amber", "custom"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

/** Quiet long-chat landmarks. Every treatment opens the same accessible prompt
 * overview; this preference changes only the small trail beside the thread. */
export const CHAT_NAVIGATOR_STYLES = ["lines", "dots", "paws", "ears"] as const;
export type ChatNavigatorStyle = (typeof CHAT_NAVIGATOR_STYLES)[number];

/** Solid environments, in the order the titlebar sun cycles them. */
export const SOLID_THEMES: {
  family: ThemeFamily;
  mode: "light" | "dark";
  label: string;
}[] = [
  { family: "warm", mode: "light", label: "Warm Light" },
  { family: "warm", mode: "dark", label: "Warm Dark" },
  { family: "mono", mode: "light", label: "Paper" },
  { family: "mono", mode: "dark", label: "Charcoal" },
  { family: "ocean", mode: "light", label: "Ocean Light" },
  { family: "ocean", mode: "dark", label: "Ocean Dark" },
  { family: "grove", mode: "light", label: "Grove Light" },
  { family: "grove", mode: "dark", label: "Grove Dark" },
  { family: "iris", mode: "light", label: "Iris Light" },
  { family: "iris", mode: "dark", label: "Iris Dark" },
  { family: "midnight", mode: "light", label: "Moonlight" },
  { family: "midnight", mode: "dark", label: "Midnight" },
];

/** Settings/onboarding presentation. Each family is one theme with a light and
 * dark environment; System can choose two families independently. */
export const THEME_FAMILY_PRESENTATIONS: readonly {
  family: ThemeFamily;
  label: string;
  description: string;
  lightLabel: string;
  darkLabel: string;
}[] = [
  {
    family: "warm",
    label: "Rotli",
    description: "Clay and cream by day, cocoa at night.",
    lightLabel: "Warm Light",
    darkLabel: "Warm Dark",
  },
  {
    family: "mono",
    label: "Paper & Charcoal",
    description: "Paper in Light, Charcoal in Dark.",
    lightLabel: "Paper",
    darkLabel: "Charcoal",
  },
  {
    family: "ocean",
    label: "Ocean",
    description: "Airy blue by day, deep water at night.",
    lightLabel: "Ocean Light",
    darkLabel: "Ocean Dark",
  },
  {
    family: "grove",
    label: "Grove",
    description: "Soft green by day, forest at night.",
    lightLabel: "Grove Light",
    darkLabel: "Grove Dark",
  },
  {
    family: "iris",
    label: "Iris",
    description: "Lavender by day, inked violet at night.",
    lightLabel: "Iris Light",
    darkLabel: "Iris Dark",
  },
  {
    family: "midnight",
    label: "Midnight",
    description: "Cool white by day, near-black at night.",
    lightLabel: "Moonlight",
    darkLabel: "Midnight",
  },
];

/** The organizer daemon's §4.3 trust ladder, monotonic in risk. Off = dormant ·
 * Suggest (default) = journal proposals only · Tidy = applies annotations +
 * files brand-new captures · Organize = applies everything, fully journaled. */
export type OrganizerTrust = "off" | "suggest" | "tidy" | "organize";
/** The macOS Dock/app icon variants (Settings → Appearance → App icon). */
export type AppIcon = "default" | "warm" | "paper" | "charcoal" | "clay";

export const ORGANIZER_TRUSTS: readonly OrganizerTrust[] = ["off", "suggest", "tidy", "organize"];

/** Where the Librarian files notes: this Mac or a connected client from
 * ai/librarianLane (Cursor never). Junk and legacy ids coerce to `local`
 * (asEnum); Rust also requires the lane to be on in Connections. */
export type OrganizerModel = LibrarianChoice;

export const ORGANIZER_MODELS: readonly OrganizerModel[] = ["local", ...LIBRARIAN_LANES];

/** How holding ⌘ reveals the keyboard map (the maintainer, 2026-08-04: "I'd prefer little
 * boxes around the UI so I can visually see and instantly toggle exactly where
 * I want to go"). `badges` pins each chord to the control it drives; `panel` is
 * the grouped list; `off` disables the peek entirely. */
export type HotkeyPeek = "badges" | "panel" | "off";

export const HOTKEY_PEEKS: readonly HotkeyPeek[] = ["badges", "panel", "off"];

/** What a CLICK on a checkbox does (the maintainer, 2026-08-04, from ZenNotes: "offer
 * partial complete… click once for in progress and again for complete").
 * `two` is the classic open⇄done. `three` adds the in-progress stop. Typing
 * `[/]` yourself always works — this governs the click only. */
export type TaskCycle = "two" | "three";

export const TASK_CYCLES: readonly TaskCycle[] = ["two", "three"];

/** How much personality the fresh-chat welcome carries. Both modes stay still;
 * `lively` adds a time-aware character and restrained semantic color, while
 * `calm` keeps the same useful layout deliberately quiet. */
export type ChatWelcomeStyle = "calm" | "lively";

export const CHAT_WELCOME_STYLES: readonly ChatWelcomeStyle[] = ["calm", "lively"];

/** How a fresh chat gets its display title. `ask` puts a quiet, skippable
 * field in the persistent chat header; `automatic` derives it from the first
 * message without adding another stop before the composer. */
export type ChatNaming = "ask" | "automatic";

export const CHAT_NAMINGS: readonly ChatNaming[] = ["ask", "automatic"];

/** How the pane tab bar handles a crowded strip. `scroll` preserves a
 * readable tab floor and pans horizontally; `fit` keeps every tab visible by
 * shrinking them and ellipsizing their labels. */
export type TabLayout = "scroll" | "fit";

export const TAB_LAYOUTS: readonly TabLayout[] = ["scroll", "fit"];

/** Legacy persistence shape. Rotli now normalizes this to `single`: connected
 * vaults are switch targets, never simultaneous pane data sources. */
export type PaneVaultMode = "single" | "multiple";

export const PANE_VAULT_MODES: readonly PaneVaultMode[] = ["single"];

/** Clock used beside durable chat-message timestamps. */
export type TimeFormat = "12" | "24";

export const TIME_FORMATS: readonly TimeFormat[] = ["12", "24"];

/** Where a chat-created artifact opens. `sidecar` is the working default: one
 * pane immediately to the right of the chat is reused for every artifact. */
export type ChatArtifactOpen = "sidecar" | "split" | "tab";

export const CHAT_ARTIFACT_OPENS: readonly ChatArtifactOpen[] = ["sidecar", "split", "tab"];

export type ChatReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ChatServiceTier = "standard" | "fast";

/** The per-chat key every chat-scoped map uses: `<instanceId>:<slug>` for a
 * saved chat, or a TAB-scoped session key while the chat is still unsaved
 * (never a shared "" key — that leaked one chat's choice into every future
 * fresh chat, #7). VAULT-scoped since 2026-08-03: a bare slug collided across
 * brains sharing one corpus settings.json, so two vaults' same-named chats
 * shared one model pick / globe / measure. */
export function chatKey(instanceId: string | null, slug: string | null, tabId: string): string {
  if (!slug) return `unsaved:${tabId}`;
  return instanceId ? `${instanceId}:${slug}` : slug;
}

/** Move a renamed chat's entries in every per-chat map to its new key — a
 * rename used to orphan the model pick, globe, and measure under the old slug
 * until the GC deleted them (audit 2026-08-03). */
export function retargetChatMapKeys(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  const s = useUiStore.getState();
  const move = <T>(m: Record<string, T>): Record<string, T> | null => {
    if (!(oldKey in m)) return null;
    const next = { ...m };
    if (!(newKey in next)) next[newKey] = next[oldKey] as T;
    delete next[oldKey];
    return next;
  };
  const chatModel = move(s.chatModel);
  const chatWeb = move(s.chatWeb);
  const chatMeasure = move(s.chatMeasure);
  const chatReasoning = move(s.chatReasoning);
  const chatServiceTier = move(s.chatServiceTier);
  useUiStore.setState({
    ...(chatModel ? { chatModel } : {}),
    ...(chatWeb ? { chatWeb } : {}),
    ...(chatMeasure ? { chatMeasure } : {}),
    ...(chatReasoning ? { chatReasoning } : {}),
    ...(chatServiceTier ? { chatServiceTier } : {}),
  });
}

/** Which model a chat runs on: its own pick, else the new-chat seed. Pure
 * (exported for tests) — a chat that has never been pinned inherits, a chat
 * that has been pinned is immune to picks made in other panes. */
export function chatModelFor(map: Record<string, string>, key: string, seed: string | null): string | null {
  return map[key] ?? seed;
}

/** The folders rail selection: the two smart rows or a real folder id. */
export const ALL_NOTES = "all";
export const RECENT = "recent";
export const TASKS = "tasks";

/** What the content area (right of the sidebar) renders: the note panes, the
 * Board grid, the searchable All-notes grid, or the Chat surface. All of these
 * are views in the pane area — the sidebar never moves for them, so the
 * left-menu sections (Chat · Notes) stay visible (the maintainer, 2026-06-24;
 * Chat folded in from a full-surface front 2026-06-26). */
// (the old "chat" contentView is retired — chat is a PANE surface now)
export type ContentView =
  | "panes"
  | "dashboard"
  | "board"
  | "allNotes"
  | "allChats"
  | "recent"
  | "tasks"
  | "system";

/** The dashboard deliberately has two non-overlapping lenses. Rotli activity
 * comes from the vault; model usage comes from provider-owned local session
 * histories. Keeping the active lens explicit prevents the two from reading
 * like one kind of telemetry. */
export type DashboardSection = "rotli" | "models";

/** The Breve lens preserves the notes contentView and pane tree;
 * stable builds refuse to activate it. */
export type SidebarMode = "notes" | "breve";
/** Breve stays a vault-bound operational lens. Dashboard is the news-hub
 * landing, Notifications is the sanitized routine activity projection, and
 * the durable briefs/routines/watchlist/settings surfaces remain available. */
export type BreveView = "dashboard" | "briefs" | "notifications" | "routines" | "watchlist" | "settings";

/** The sidebar's FRONTS (the maintainer, 2026-08-01, from Claude Desktop's Home|Code
 * pill): a two-segment switcher under the vault header replaces the old stacked
 * "Chat ›" / "Notes ›" accordions. Home is the notes world — and eventually a
 * dashboard; Chat is the chat world. Each front owns the whole sidebar body and
 * scrolls on its own; neither collapses. A THIRD front (the parked email Inbox)
 * joins by adding one entry here — see docs/design/sidebar-home-chat.md. */
export type SidebarView = "home" | "chat";

/** The SYSTEM zone's collapse key (the maintainer, 2026-08-01: "allow me to collapse the
 * system area just to clean up the sidebar more"). Lives in expandedDests under
 * a reserved "sec:" id so it persists like a destination; default OPEN.
 * The retired section keys ("sec:chat", "sec:notes", and the parked email
 * front's "sec:inbox") are no longer rendered by anything — persist.ts keeps
 * every "sec:"-shaped key by SHAPE so a downgrade still finds its state. */
export const SEC_SYSTEM = "sec:system";

/** Sidebar width clamp — small enough to tuck away, never wide enough to eat
 * the editor (one rail now, not two — the maintainer, 2026-06-13). */
export const clampSidebarWidth = (px: number): number => Math.min(460, Math.max(190, Math.round(px)));

/** Sidebar zoom clamp + step (⌘+/⌘− with focus in the sidebar). Rounded to one
 * decimal so repeated steps never drift on float error. */
export const SIDEBAR_ZOOM_STEP = 0.1;
export const clampSidebarZoom = (z: number): number => Math.min(1.4, Math.max(0.8, Math.round(z * 10) / 10));

/** The reserved destination ids the sidebar seeds open (Inbox + Vault) and the
 * persistence layer trusts as a valid folder selection before the first list
 * resolves (the maintainer, 2026-06-13). "vault:" is the external-root MARKER (Track 2);
 * a stale "Brain" key from before the rename is simply absent here, so it
 * degrades to a safe default rather than crashing. */
export const RESERVED_DESTS = ["Inbox", "vault:", "Storage", "Board", "Archive", "Trash"] as const;

interface UiState {
  /** Explicit three-way setting. "system" mirrors the OS only while selected;
   * the default is "light" so demos are deterministic. */
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  cycleTheme: () => void;

  /** Which token family the mode resolves into (warm = kit default). */
  themeFamily: ThemeFamily;
  setThemeFamily: (family: ThemeFamily) => void;

  /** Raw Markdown syntax colors. Rotli is the calm blue + active accent
   * default; Mono keeps the grammar but renders it in the environment ink. */
  syntaxPalette: SyntaxPalette;
  setSyntaxPalette: (palette: SyntaxPalette) => void;
  /** The primary color — see ACCENT_COLORS. "default" = the theme's own. */
  accentColor: AccentColor;
  setAccentColor: (accent: AccentColor) => void;
  /** Hue used by the contrast-managed Custom accent (0–359). */
  accentHue: number;
  setAccentHue: (hue: number) => void;
  /** The optional personal companion layer. Onboarding characters are exempt. */
  quokkaCompanionEnabled: boolean;
  setQuokkaCompanionEnabled: (enabled: boolean) => void;
  /** Canonical full-body quokka treatment used across product character placements. */
  quokkaStyle: QuokkaStyle;
  setQuokkaStyle: (style: QuokkaStyle) => void;
  /** Hue used by the contrast-managed Custom body treatment (0–359). */
  quokkaCustomHue: number;
  setQuokkaCustomHue: (hue: number) => void;
  /** Deliberate black/white ink independent from the workspace theme. */
  quokkaLineColor: QuokkaLineColor;
  setQuokkaLineColor: (color: QuokkaLineColor) => void;
  /** Optional signature accessory used only on eligible full-body placements. */
  quokkaAccessory: QuokkaAccessory;
  setQuokkaAccessory: (accessory: QuokkaAccessory) => void;
  /** Hue used by colorable accessory layers (0–359). */
  quokkaAccessoryHue: number;
  setQuokkaAccessoryHue: (hue: number) => void;
  /** Preferred mood/pose for personal idle placements, never semantic empty states. */
  quokkaIdlePose: QuokkaIdlePose;
  setQuokkaIdlePose: (pose: QuokkaIdlePose) => void;
  /** Visual treatment for the prompt navigator shown in longer chats. */
  chatNavigatorStyle: ChatNavigatorStyle;
  setChatNavigatorStyle: (style: ChatNavigatorStyle) => void;

  /** General: visitor (click-away hides, default) vs resident (stays open). */
  stayOpen: boolean;
  setStayOpen: (on: boolean) => void;
  /** General: show the app in the Dock (default off — menu bar only). */
  showInDock: boolean;
  setShowInDock: (on: boolean) => void;

  /** What the generic New tab command (⌘T by default) creates. Explicit New
   * menu actions always keep their own kind. */
  newTabDefault: NewItemKind;
  setNewTabDefault: (kind: NewItemKind) => void;
  /** Whether crowded pane tabs scroll or shrink to stay in the window. */
  tabLayout: TabLayout;
  setTabLayout: (layout: TabLayout) => void;
  /** Search provider used by fresh private-browser tabs and address-bar queries. */
  privateBrowserSearchEngine: PrivateBrowserSearchEngine;
  setPrivateBrowserSearchEngine: (engine: PrivateBrowserSearchEngine) => void;
  /** Installation-wide remote MCP endpoint. The bearer stays in Keychain and
   * every app launch still starts disconnected. */
  remoteAgentRelayUrl: string;
  setRemoteAgentRelayUrl: (url: string) => void;
  /** Compatibility field; active sessions are always single-vault. */
  paneVaultMode: PaneVaultMode;
  setPaneVaultMode: (mode: PaneVaultMode) => void;

  /** First-run gate: false until the user finishes (or skips) onboarding, or
   * after a manual "Reset & re-onboard". Persisted in settings.json; the
   * onboarding surface shows whenever this is false (Tauri only). */
  onboarded: boolean;
  setOnboarded: (done: boolean) => void;
  /** The app version the user last completed onboarding at — the onboardingVersion
   * gate re-onboards on every 0.x update, then freezes post-1.0. */
  onboardingVersion: string;
  setOnboardingVersion: (v: string) => void;
  /** Durable first-run checkpoint. Vault selection may relaunch the native app,
   * so the next launch must resume at model setup instead of starting over. */
  onboardingPhase: OnboardingPhase;
  setOnboardingPhase: (phase: OnboardingPhase) => void;
  /** The Quick Note window's capped set (the maintainer, 2026-06-15): up to QUICK_MAX
   * note ids, in switcher order. The mutations + cross-webview sync live in
   * state/quick.ts; these are the raw fields the persistence layer reads. */
  quickNoteIds: string[];
  setQuickNoteIds: (ids: string[]) => void;
  /** Manual order of the Captures grid (ids). Unknown ids fall back to
   * newest-first. Persisted in settings.json — never written into the notes. */
  captureOrder: string[];
  setCaptureOrder: (ids: string[]) => void;
  /** Which quick note the window reopens on — "remember where I am". */
  quickActiveId: string | null;
  setQuickActiveId: (id: string | null) => void;
  /** Folder new quick notes (the "+") are created in. */
  quickFolder: string;
  setQuickFolder: (folder: string) => void;
  /** Exact writable memex for new Quick Notes; null preserves current routing. */
  quickVaultId: string | null;
  setQuickVaultId: (id: string | null) => void;
  /** Exact writable memex for Quick capture; null preserves current routing. */
  captureVaultId: string | null;
  setCaptureVaultId: (id: string | null) => void;

  /** The ONE sidebar — collapse state (remembered per window, persisted in the
   * shell) and width (px; drag the grip on its right edge). The two-rail era is
   * gone: folders + note-list collapse into a single navigator (the maintainer,
   * 2026-06-13). */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (px: number) => void;
  /** Sidebar tree zoom (⌘+/⌘− while focus is in the sidebar) — a CSS zoom
   * factor on the rows, clamped to a readable band. */
  sidebarZoom: number;
  setSidebarZoom: (z: number) => void;
  /** Notes is the normal Inbox/Chat/Notes tree; Breve swaps only the sidebar
   * navigation + right workspace while preserving the user's open panes. */
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  /** Which FRONT the sidebar shows in notes mode: Home (the notes world) or
   * Chat. Persisted, so the app reopens where you left it. */
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  breveView: BreveView;
  setBreveView: (view: BreveView) => void;
  /** Transient edit guard for Breve forms. Never persisted: drafts live only
   * for the mounted workspace and must be resolved before changing lenses. */
  breveDirty: boolean;
  setBreveDirty: (dirty: boolean) => void;

  /** Which destinations in the sidebar tree are expanded, keyed by dest id —
   * Inbox + Vault open by default (the maintainer, 2026-06-13). */
  expandedDests: Record<string, boolean>;
  toggleDestExpanded: (id: string) => void;
  setDestExpanded: (id: string, open: boolean) => void;
  /** Bumped to ask the sidebar to REVEAL the focused note — expand its folder
   * chain AND scroll its row into view (the maintainer, 2026-07-03: "I can't find where
   * this file is"). The editor's location chip fires it. Not persisted. */
  revealNonce: number;
  /** "auto" reveals in Main when the note is pinned there (Main's copy wins);
   * "brain" forces the reveal to the note's REAL home in the Brain, bypassing the
   * Main short-circuit — the "Open in Brain" menu action (the maintainer, 2026-07-08). */
  revealMode: "auto" | "brain";
  /** Explicit target for a menu-triggered reveal. Keeping it beside the nonce
   * avoids a render race where the sidebar still sees the previously focused
   * tab when "Show in Brain" is invoked from another row. */
  revealNoteId: string | null;
  revealFocusedNote: (mode?: "auto" | "brain", noteId?: string) => void;
  /** TWO-STAGE collapse (the sidebar's collapse-all toolbar button, the maintainer
   * 2026-07-31): while any folder/dest tree is open, a press folds the TREES
   * and leaves the zones alone; once everything inside is folded, the next
   * press folds the SYSTEM zone itself (sec:system — the fronts replaced the
   * old sec:chat / sec:notes sections, 2026-08-01).
   * `defaultOpenIds` are the rows that read the map with an OPEN default
   * (Main folders, chat folders, the Brain header) — they get an explicit
   * `false`, or wiping the map would EXPAND them (#83, audit 2026-07), and
   * they're also how stage 1 knows those trees are still open. */
  collapseAllDests: (defaultOpenIds?: string[]) => void;

  /** Folders-rail selection (window-level). */
  selectedFolderId: string;
  setSelectedFolderId: (id: string) => void;
  /** Bumped by the sidebar's New-folder button while a System browser is open —
   * the browser answers by opening its create-folder input at its cwd. */
  systemFolderNonce: number;
  requestSystemFolder: () => void;
  /** Bumped by the sidebar header's New-folder button when the panes (not a
   * System browser) are showing — the ACTIVE FRONT answers: Home opens its
   * inline Main-folder input, Chat mints a chat folder and renames it inline.
   * The header lives in the shell, the input lives in the front, so the nonce
   * is the seam (the requestSystemFolder pattern). Transient. */
  sidebarFolderNonce: number;
  requestSidebarFolder: () => void;
  /** The System browser's current multi-selection (Finder gestures: ⌘/⇧-click,
   * rubber band) — item SUMMARIES so ⌘⌫'s registry action can trash kind-aware
   * without reaching back into a component. */
  systemSelection: NoteSummary[];
  setSystemSelection: (items: NoteSummary[]) => void;

  /** null is Main, the all-items reference view. A string is the exact unique
   * name of the active additional view from `.rotli/views.json`. */
  activeView: string | null;
  setActiveView: (name: string | null) => void;

  /** The bottom-center resident slot's visibility — 1c's focus mode hides
   * the format bar through this flag. */
  formatBarVisible: boolean;
  setFormatBarVisible: (visible: boolean) => void;

  /** Spell-check: red squiggles under misspellings in the editor. On by
   * default (the maintainer, 2026-06-22); a Settings → Editor switch. Persisted. */
  spellcheck: boolean;
  setSpellcheck: (on: boolean) => void;

  /** Images follow their note into Archive/Trash when only that note uses
   * them (the maintainer, 2026-07-30). On by default; a Settings → General switch. */
  tidyImagesWithNote: boolean;
  setTidyImagesWithNote: (on: boolean) => void;

  /** Editor view: false = beautified (live WYSIWYG), true = raw markdown source.
   * A per-eye preference — the .md is identical either way. Persisted. */
  rawEditor: boolean;
  setRawEditor: (on: boolean) => void;

  /** Block handles — ONE floating +/⠿ handle beside the hovered block: drag to
   * reorder, click for add/move/delete. ON by default (invisible until hover —
   * low-pulse by construction); the Aa panel is the escape hatch. The .md is the
   * source of truth — every action is a plain text edit. Persisted. */
  blockHandles: boolean;
  setBlockHandles: (on: boolean) => void;

  /** ⌘K palette visibility; full-screen overlays share one flat scrim. */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  /** Quick Look peek (the maintainer, 2026-07-29): the item previewed in a modal without
   * opening its full surface; null = closed. */
  previewItem: NoteSummary | null;
  setPreviewItem: (item: NoteSummary | null) => void;

  /** Settings as its own surface in the window (r1 frame F); Esc returns. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  /** What the content area (right of the sidebar) shows: the note panes, the
   * Board grid (quick captures), or the All-notes grid. The sidebar stays put —
   * Board/All-notes are VIEWS in the pane area, not full-surface takeovers
   * (the maintainer, 2026-06-24). Esc returns to "panes". Not persisted (transient). */
  contentView: ContentView;
  dashboardSection: DashboardSection;
  setDashboardSection: (section: DashboardSection) => void;
  /** Which System root the browser surface shows (contentView "system") —
   * "Brain" (the Library) or a destination id. Transient, like contentView. */
  systemRoot: string | null;
  setSystemRoot: (id: string | null) => void;
  setContentView: (view: ContentView) => void;

  /** The existing board id currently being renamed inline in the sidebar (its
   * row shows a text input), or null. New boards use the name-first request
   * below, before any file exists. */
  renamingBoardId: string | null;
  setRenamingBoardId: (id: string | null) => void;
  /** An ordinary user-invoked board creation waiting for its required name.
   * The request carries presentation intent only; no file exists yet. */
  boardCreationRequest: { newTab: boolean } | null;
  setBoardCreationRequest: (request: { newTab: boolean } | null) => void;
  renamingChatSlug: string | null;
  setRenamingChatSlug: (slug: string | null) => void;

  /** The note whose title is being edited in the rename dialog (opened from the
   * right-click menu), or null. `current` seeds the input (the maintainer, 2026-07-01). */
  renameTarget: { id: string; current: string } | null;
  setRenameTarget: (t: { id: string; current: string } | null) => void;

  /** A failed row-menu action (file-to-brain, board rename …) surfaced as an
   * inline note in the sidebar — the menu that launched the action is gone by
   * the time it fails, so this is its error home (#11, audit 2026-07). Not
   * persisted (transient); dismissed by the × or replaced by the next failure. */
  rowActionError: string | null;
  setRowActionError: (e: string | null) => void;

  /** The chat that was focused when a NEW chat was opened (the maintainer, 2026-07-30:
   * "this chat should default to folder I was in") — the first save reads it
   * to file the new chat into the same folder, then clears it. Transient. */
  newChatOrigin: string | null;
  setNewChatOrigin: (slug: string | null) => void;

  /** The user's name — onboarding's "What should rotli call you?" / Settings →
   * General. Personalizes AI chat (the prompt persona line). Persisted; "" = unset. */
  userName: string;
  setUserName: (name: string) => void;
  timeFormat: TimeFormat;
  setTimeFormat: (format: TimeFormat) => void;
  /** Optional, vault-scoped housekeeping. Null is deliberately OFF. Main
   * cleanup unlinks only the projection; chat cleanup uses recoverable Archive. */
  mainAutoRemoveDays: number | null;
  setMainAutoRemoveDays: (days: number | null) => void;
  chatAutoArchiveDays: number | null;
  setChatAutoArchiveDays: (days: number | null) => void;

  /** The model a BRAND-NEW chat starts on — the last model picked anywhere.
   * null = the model store's own default. A chat that has made (or inherited)
   * its own pick reads `chatModel` below instead; this is only the seed.
   * Persisted. */
  chatModelId: string | null;
  setChatModelId: (id: string | null) => void;
  /** Per-chat model pick (the maintainer, 2026-08-01: two chat panes must be able to run
   * different models at once), keyed exactly like chatWeb — the chat slug, or
   * "unsaved:<tabId>" until the first send binds it. Missing key = the
   * `chatModelId` seed; the chat surface pins its own entry as soon as the
   * model catalog settles, so a pick in one pane can never move another pane's
   * chat. Persisted (unsaved keys excluded, like every per-chat map). */
  chatModel: Record<string, string>;
  setChatModel: (key: string, id: string) => void;
  clearChatModel: (key: string) => void;
  /** Optional provider-native quality controls. Rust independently validates
   * these values before constructing process argv. */
  chatReasoning: Record<string, ChatReasoningEffort>;
  setChatReasoning: (key: string, value: ChatReasoningEffort | null) => void;
  chatServiceTier: Record<string, ChatServiceTier>;
  setChatServiceTier: (key: string, value: ChatServiceTier | null) => void;
  /** Per-chat web-search toggle (the composer globe), keyed by chat slug. Off by
   * default; only an enabled chat may use the web_search/web_fetch tools. Persisted —
   * except the session-scoped "unsaved:<tabId>" keys: a not-yet-saved chat's choice
   * lives under its TAB (never a shared "" key that would leak web-ON into every
   * future fresh chat — #7, audit 2026-07) and is carried to the slug on bind. */
  chatWeb: Record<string, boolean>;
  setChatWeb: (slug: string, on: boolean) => void;
  /** Drop one chatWeb key — the unsaved-tab key after bind carries it to the slug. */
  clearChatWeb: (key: string) => void;
  /** Per-chat measure (Narrow/Comfort/Wide — the notes Aa vocabulary), keyed
   * exactly like chatWeb (slug, or "unsaved:<tabId>" until the first send
   * binds it). Missing key = comfort. Persisted (unsaved keys excluded). */
  chatMeasure: Record<string, Measure>;
  setChatMeasure: (key: string, m: Measure) => void;
  clearChatMeasure: (key: string) => void;
  /** Where a chat's attached note opens from the header toggle: a new tab in
   * this pane, or a right split beside the chat. Persisted. */
  chatNoteOpen: "tab" | "split";
  setChatNoteOpen: (v: "tab" | "split") => void;
  /** The fresh-chat welcome's visual personality. Machine-level appearance. */
  chatWelcomeStyle: ChatWelcomeStyle;
  setChatWelcomeStyle: (v: ChatWelcomeStyle) => void;
  /** Whether a fresh chat asks for a name in its header or names itself from
   * the first message. Existing chat names always remain directly editable. */
  chatNaming: ChatNaming;
  setChatNaming: (v: ChatNaming) => void;
  /** Where files and boards created by chat open. Persisted per vault. */
  chatArtifactOpen: ChatArtifactOpen;
  setChatArtifactOpen: (v: ChatArtifactOpen) => void;
  /** Read replies aloud — the voice tier that needs no microphone and no
   * entitlement (docs/design/voice.md). Off by default: the voice model is
   * fetched on FIRST USE, so nobody pays for a voice they never asked for. */
  readAloud: boolean;
  setReadAloud: (on: boolean) => void;
  /** Which Kokoro voice reads. Persisted. */
  readAloudVoice: string;
  setReadAloudVoice: (id: string) => void;
  /** What holding ⌘ reveals (the maintainer, 2026-08-04). `badges` pins each chord to the
   * control it drives, right where the eye already is; `panel` is the original
   * grouped shortcut map; `off` disables the peek. Persisted. */
  hotkeyPeek: HotkeyPeek;
  setHotkeyPeek: (v: HotkeyPeek) => void;
  /** How clicking a checkbox cycles: open⇄done, or through in progress.
   * Default `two` — the behaviour every existing note was written under.
   * Persisted. */
  taskCycle: TaskCycle;
  setTaskCycle: (v: TaskCycle) => void;
  /** Connected-provider flags. Only documented official-client lanes exist. */
  aiProviders: Record<ProviderId, boolean>;
  /** Model used by `@provider` when the message omits `:model`. */
  providerDefaults: Record<ProviderId, string>;
  setProviderDefault: (provider: ProviderId, model: string) => void;
  /** The vault's one web-search destination. The chat globe remains the
   * per-chat consent switch and never changes this provider. */
  webSearchProvider: WebSearchProvider;
  setWebSearchProvider: (provider: WebSearchProvider) => void;
  setAiProvider: (id: ProviderId, on: boolean) => void;
  /** Hybrid model presets (organizer → routes → fallback). Persisted. */
  hybridPresets: HybridPreset[];
  setHybridPresets: (list: HybridPreset[]) => void;
  /** Individual CONNECTED models turned off inside an enabled lane (e.g. keep
   * Sonnet, block Opus) — hidden from the picker + preset editor. Persisted. */
  blockedModels: string[];
  toggleBlockedModel: (id: string) => void;
  /** How the Storage destination groups its binaries (a Settings knob): by Type
   * (default), Date, or Folder (raw on-disk). Persisted. */
  storageGrouping: "type" | "date" | "folder";
  setStorageGrouping: (g: "type" | "date" | "folder") => void;
  /** The macOS Dock/app icon variant (Settings → Appearance). "default" is the
   * shipped icon; the rest re-tile the quokka in a theme palette. Persisted. */
  appIcon: AppIcon;
  setAppIcon: (v: AppIcon) => void;
  /** "Show file metadata" (the maintainer, 2026-07-01): render the note's raw frontmatter
   * block at the top of the file — monospaced, editable, exactly as it sits on
   * disk — instead of the old panel field list. hide (default) / show. Persisted. */
  fileMetadata: "hide" | "show";
  setFileMetadata: (v: "hide" | "show") => void;
  /** The organizer daemon's trust rung (design §4.3): what it may auto-APPLY.
   * Suggest (the shipped default) = journal proposals only, provably write-free
   * on the corpus. Persisted; the caller ALSO pushes it to Rust via
   * organizerSetTrust (the daemon re-reads settings.json as the backstop). */
  /** The vault's Brain master switch (vault-vs-brain, 2026-07-26): false = a
   * RAW vault — the organizer never acts, nothing files or enriches. Persisted
   * per-vault in settings.json; Rust reads the same field independently.
   * Flipping it NEVER moves or rewrites a file. */
  brainEnabled: boolean;
  setBrainEnabled: (on: boolean) => void;
  /** The vault-wide default for secure ⇄ on-device AI visibility (the maintainer,
   * 2026-08-01): true = a model running on this Mac may read secure notes.
   * A per-note `local_ai_allowed` line overrides it in either direction, and
   * NO value here ever opens a secure note to a remote model. Persisted
   * per-vault in settings.json; Rust reads the same field independently
   * (docs/design/ai-visibility-matrix.md). */
  secureLocalAi: boolean;
  setSecureLocalAi: (on: boolean) => void;
  organizerTrust: OrganizerTrust;
  setOrganizerTrust: (t: OrganizerTrust) => void;
  /** Which model the organizer runs (design §4; the maintainer, 2026-07-03). Persisted;
   * the Rust daemon re-reads settings.json each cycle, so no push command. */
  organizerModel: OrganizerModel;
  setOrganizerModel: (m: OrganizerModel) => void;
  /** Idle delay (seconds) before the organizer scans a just-touched note. */
  organizerQuietSecs: number;
  setOrganizerQuietSecs: (n: number) => void;
  /** The Librarian's first-visit explainer was shown (2026-07-31) — the ?
   * button in the surface re-opens it anytime. Persisted. */
  librarianIntroSeen: boolean;
  setLibrarianIntroSeen: (seen: boolean) => void;
  /** A one-shot request for WHICH Settings pane opens next (2026-07-31: the
   * Librarian's gear jumps straight to Settings → Librarian). Consumed by the
   * Settings surface on open; null = the surface's own last pane. */
  settingsPaneRequest: string | null;
  setSettingsPaneRequest: (pane: string | null) => void;

  /** A newer signed build is on the feed — set once by App.tsx's quiet on-mount
   * check (CARL rule 2: no auto-download, no modal). Just lets Settings → General
   * surface "Update available". Transient, not persisted. */
  updateAvailable: boolean;
  setUpdateAvailable: (on: boolean) => void;
  /** The version the feed offers, when known (e.g. "0.2.0"). */
  updateVersion: string | null;
  setUpdateVersion: (version: string | null) => void;

  /** ⌥⌘F focus mode (r3 frame E): chrome leaves, one centered column. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;

  /** Open transient close-callbacks, top = last. Esc (app.hide, the one
   * registry dispatcher) closes the topmost transient before the window —
   * the quokka rule, without ad-hoc keydown listeners. */
  transients: (() => void)[];
  registerTransient: (close: () => void) => () => void;
  closeTopTransient: () => boolean;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: DEFAULT_APPEARANCE.theme,
  setTheme: (theme) => set({ theme }),
  // The titlebar sun walks the same ordered environment catalog shown in Appearance;
  // a "system" setting resolves to its current mode before stepping on.
  cycleTheme: () =>
    set((s) => {
      const mode = s.theme === "system" ? (systemPrefersDark() ? "dark" : "light") : s.theme;
      const i = SOLID_THEMES.findIndex((t) => t.family === s.themeFamily && t.mode === mode);
      const next = SOLID_THEMES[(i + 1) % SOLID_THEMES.length];
      return next ? { themeFamily: next.family, theme: next.mode } : s;
    }),

  themeFamily: DEFAULT_APPEARANCE.themeFamily,
  setThemeFamily: (family) => set({ themeFamily: family }),

  syntaxPalette: "rotli",
  setSyntaxPalette: (palette) => set({ syntaxPalette: palette }),
  accentColor: "default",
  setAccentColor: (accent) => set({ accentColor: accent }),
  accentHue: DEFAULT_ACCENT_HUE,
  setAccentHue: (hue) => set({ accentHue: Math.max(0, Math.min(359, Math.round(hue))) }),
  quokkaCompanionEnabled: false,
  setQuokkaCompanionEnabled: (enabled) => set({ quokkaCompanionEnabled: enabled }),
  quokkaStyle: "cocoa",
  setQuokkaStyle: (style) => set({ quokkaStyle: style }),
  quokkaCustomHue: DEFAULT_QUOKKA_CUSTOM_HUE,
  setQuokkaCustomHue: (hue) => set({ quokkaCustomHue: normalizeQuokkaCustomHue(hue) }),
  quokkaLineColor: "auto",
  setQuokkaLineColor: (color) => set({ quokkaLineColor: color }),
  quokkaAccessory: "none",
  setQuokkaAccessory: (accessory) => set({ quokkaAccessory: accessory }),
  quokkaAccessoryHue: DEFAULT_QUOKKA_ACCESSORY_HUE,
  setQuokkaAccessoryHue: (hue) => set({ quokkaAccessoryHue: normalizeQuokkaAccessoryHue(hue) }),
  quokkaIdlePose: "rest",
  setQuokkaIdlePose: (pose) => set({ quokkaIdlePose: pose }),
  chatNavigatorStyle: "paws",
  setChatNavigatorStyle: (style) => set({ chatNavigatorStyle: style }),

  stayOpen: false,
  setStayOpen: (on) => set({ stayOpen: on }),
  showInDock: false,
  setShowInDock: (on) => set({ showInDock: on }),
  newTabDefault: DEFAULT_NEW_ITEM_KIND,
  setNewTabDefault: (kind) => set({ newTabDefault: kind }),
  tabLayout: "scroll",
  setTabLayout: (layout) => set({ tabLayout: layout }),
  privateBrowserSearchEngine: DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
  setPrivateBrowserSearchEngine: (engine) => set({ privateBrowserSearchEngine: engine }),
  remoteAgentRelayUrl: "",
  setRemoteAgentRelayUrl: (url) => set({ remoteAgentRelayUrl: url }),
  paneVaultMode: "single",
  setPaneVaultMode: (mode) => set({ paneVaultMode: mode }),

  onboarded: false,
  setOnboarded: (done) => set({ onboarded: done }),
  onboardingVersion: "",
  setOnboardingVersion: (v) => set({ onboardingVersion: v }),
  onboardingPhase: "preferences",
  setOnboardingPhase: (phase) => set({ onboardingPhase: phase }),
  quickNoteIds: [],
  setQuickNoteIds: (ids) => set({ quickNoteIds: ids }),
  captureOrder: [],
  setCaptureOrder: (ids) => set({ captureOrder: ids }),
  quickActiveId: null,
  setQuickActiveId: (id) => set({ quickActiveId: id }),
  // "Inbox" on disk (fs mode); the seeded Inbox id in the browser
  quickFolder: inboxFolderId,
  setQuickFolder: (folder) => set({ quickFolder: folder }),
  quickVaultId: null,
  setQuickVaultId: (id) => set({ quickVaultId: id }),
  captureVaultId: null,
  setCaptureVaultId: (id) => set({ captureVaultId: id }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  sidebarWidth: 240,
  setSidebarWidth: (px) => set({ sidebarWidth: clampSidebarWidth(px) }),
  sidebarZoom: 1,
  setSidebarZoom: (z) => set({ sidebarZoom: clampSidebarZoom(z) }),
  sidebarMode: "notes",
  setSidebarMode: (mode) => {
    if (mode === "breve" && !LAUNCH_FEATURES.breve) return;
    const current = get();
    if (
      current.sidebarMode === "breve" &&
      mode !== "breve" &&
      current.breveDirty &&
      typeof window !== "undefined" &&
      !window.confirm("Discard your unsaved Breve changes and return to Notes?")
    )
      return;
    set({
      sidebarMode: mode,
      ...(mode === "breve" ? {} : { breveDirty: false }),
    });
  },
  sidebarView: "home",
  setSidebarView: (view) => set({ sidebarView: view }),
  breveView: "dashboard",
  setBreveView: (view) => {
    const current = get();
    if (
      current.breveView !== view &&
      current.breveDirty &&
      typeof window !== "undefined" &&
      !window.confirm("Discard your unsaved changes and open another Breve section?")
    )
      return;
    set({ breveView: view, breveDirty: false });
  },
  breveDirty: false,
  setBreveDirty: (dirty) => set({ breveDirty: dirty }),

  // the System zone open by default, plus the Capture(Inbox) + Vault dests
  // inside Home — so a fresh window shows the full tree.
  expandedDests: {
    [SEC_SYSTEM]: true,
    Inbox: true,
    "vault:": true,
  },
  toggleDestExpanded: (id) =>
    set((s) => ({
      expandedDests: { ...s.expandedDests, [id]: !s.expandedDests[id] },
    })),
  setDestExpanded: (id, open) => set((s) => ({ expandedDests: { ...s.expandedDests, [id]: open } })),
  revealNonce: 0,
  revealMode: "auto",
  revealNoteId: null,
  // an explicit reveal always points at NOTE content, so it moves the sidebar
  // to Home first — revealing into a front that can't render the row is a
  // silent no-op (the maintainer's IA, 2026-08-01). Doing it HERE covers every caller.
  revealFocusedNote: (mode = "auto", noteId) =>
    set((s) => ({
      revealNonce: s.revealNonce + 1,
      revealMode: mode,
      revealNoteId: noteId ?? null,
      sidebarView: "home" as SidebarView,
    })),
  collapseAllDests: (defaultOpenIds = []) =>
    set((s) => {
      // Stage detection is namespace-aware: default-OPEN rows (main:*,
      // chatfolder:*, Brain) count as open unless explicitly false; every
      // other non-section key counts only when explicitly true (absent means
      // closed for dest rows like Inbox).
      const anyTreeOpen =
        defaultOpenIds.some((id) => s.expandedDests[id] !== false) ||
        Object.entries(s.expandedDests).some(([id, open]) => !id.startsWith("sec:") && open === true);
      const treesFolded = {
        // zone fold states (sec:*) are the user's own arrangement —
        // stage 1 folds the TREES; it must never REOPEN a folded zone
        // (replacing the map wiped them back to default-open — the maintainer, 2026-07-27)
        ...Object.fromEntries(Object.entries(s.expandedDests).filter(([id]) => id.startsWith("sec:"))),
        ...Object.fromEntries(defaultOpenIds.map((id) => [id, false])),
      };
      if (anyTreeOpen) return { expandedDests: treesFolded };
      // stage 2 (everything inside already folded): fold the SYSTEM zone —
      // the one remaining sec:* surface now that the fronts replaced the
      // Chat/Notes accordions (2026-08-01)
      return { expandedDests: { ...treesFolded, [SEC_SYSTEM]: false } };
    }),

  selectedFolderId: ALL_NOTES,
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),
  systemFolderNonce: 0,
  requestSystemFolder: () => set((s) => ({ systemFolderNonce: s.systemFolderNonce + 1 })),
  sidebarFolderNonce: 0,
  requestSidebarFolder: () => set((s) => ({ sidebarFolderNonce: s.sidebarFolderNonce + 1 })),
  systemSelection: [],
  setSystemSelection: (items) => set({ systemSelection: items }),
  activeView: null,
  setActiveView: (name) => set({ activeView: name, selectedFolderId: "main:" }),

  formatBarVisible: true,
  setFormatBarVisible: (visible) => set({ formatBarVisible: visible }),

  spellcheck: true,
  setSpellcheck: (on) => set({ spellcheck: on }),
  tidyImagesWithNote: true,
  setTidyImagesWithNote: (on) => set({ tidyImagesWithNote: on }),

  rawEditor: false,
  setRawEditor: (on) => set({ rawEditor: on }),

  blockHandles: true,
  setBlockHandles: (on) => set({ blockHandles: on }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  previewItem: null,
  setPreviewItem: (item) => set({ previewItem: item }),

  settingsOpen: false,
  // closing also clears any un-consumed pane request — a gear click that was
  // Esc'd before the lazy surface mounted must not redirect the NEXT open (F8)
  setSettingsOpen: (open) =>
    set(open ? { settingsOpen: true } : { settingsOpen: false, settingsPaneRequest: null }),

  contentView: "panes",
  setContentView: (view) => set({ contentView: view }),
  dashboardSection: "rotli",
  setDashboardSection: (section) => set({ dashboardSection: section }),
  systemRoot: null,
  setSystemRoot: (id) => set({ systemRoot: id }),
  renameTarget: null,
  setRenameTarget: (t) => set({ renameTarget: t }),

  renamingBoardId: null,
  setRenamingBoardId: (id) => set({ renamingBoardId: id }),
  boardCreationRequest: null,
  setBoardCreationRequest: (request) => set({ boardCreationRequest: request }),
  renamingChatSlug: null,
  setRenamingChatSlug: (slug) => set({ renamingChatSlug: slug }),
  rowActionError: null,
  setRowActionError: (e) => set({ rowActionError: e }),

  newChatOrigin: null,
  setNewChatOrigin: (slug) => set({ newChatOrigin: slug }),

  userName: "",
  setUserName: (name) => set({ userName: name }),
  timeFormat: "12",
  setTimeFormat: (format) => set({ timeFormat: format }),
  mainAutoRemoveDays: null,
  setMainAutoRemoveDays: (days) => set({ mainAutoRemoveDays: days }),
  chatAutoArchiveDays: null,
  setChatAutoArchiveDays: (days) => set({ chatAutoArchiveDays: days }),

  chatModelId: null,
  setChatModelId: (id) => set({ chatModelId: id }),
  chatModel: {},
  setChatModel: (key, id) =>
    set((s) => (s.chatModel[key] === id ? s : { chatModel: { ...s.chatModel, [key]: id } })),
  clearChatModel: (key) =>
    set((s) => {
      if (!(key in s.chatModel)) return s;
      const { [key]: _gone, ...rest } = s.chatModel;
      return { chatModel: rest };
    }),
  chatReasoning: {},
  setChatReasoning: (key, value) =>
    set((s) => {
      const next = { ...s.chatReasoning };
      if (value === null) delete next[key];
      else next[key] = value;
      return { chatReasoning: next };
    }),
  chatServiceTier: {},
  setChatServiceTier: (key, value) =>
    set((s) => {
      const next = { ...s.chatServiceTier };
      if (value === null) delete next[key];
      else next[key] = value;
      return { chatServiceTier: next };
    }),
  chatWeb: {},
  setChatWeb: (slug, on) => set((s) => ({ chatWeb: { ...s.chatWeb, [slug]: on } })),
  clearChatWeb: (key) =>
    set((s) => {
      if (!(key in s.chatWeb)) return s;
      const { [key]: _gone, ...rest } = s.chatWeb;
      return { chatWeb: rest };
    }),
  chatMeasure: {},
  setChatMeasure: (key, m) => set((s) => ({ chatMeasure: { ...s.chatMeasure, [key]: m } })),
  clearChatMeasure: (key) =>
    set((s) => {
      if (!(key in s.chatMeasure)) return s;
      const { [key]: _gone, ...rest } = s.chatMeasure;
      return { chatMeasure: rest };
    }),
  chatNoteOpen: "tab",
  setChatNoteOpen: (v) => set({ chatNoteOpen: v }),
  chatWelcomeStyle: "lively",
  setChatWelcomeStyle: (v) => set({ chatWelcomeStyle: v }),
  chatNaming: "ask",
  setChatNaming: (v) => set({ chatNaming: v }),
  chatArtifactOpen: "sidecar",
  setChatArtifactOpen: (v) => set({ chatArtifactOpen: v }),
  hotkeyPeek: "badges",
  setHotkeyPeek: (v) => set({ hotkeyPeek: v }),
  readAloud: false,
  setReadAloud: (on) => set({ readAloud: on }),
  readAloudVoice: DEFAULT_VOICE,
  setReadAloudVoice: (id) => set({ readAloudVoice: id }),
  taskCycle: "two",
  setTaskCycle: (v) => set({ taskCycle: v }),
  aiProviders: { claude: false, codex: false, cursor: false, antigravity: false },
  setAiProvider: (id, on) =>
    set((s) => ({
      aiProviders: { ...s.aiProviders, [id]: on },
    })),
  providerDefaults: { ...DEFAULT_PROVIDER_MODELS },
  setProviderDefault: (provider, model) =>
    set((s) => ({
      providerDefaults: { ...s.providerDefaults, [provider]: model },
      blockedModels: s.blockedModels.filter((id) => id !== model),
    })),
  webSearchProvider: DEFAULT_WEB_SEARCH_PROVIDER,
  setWebSearchProvider: (provider) => set({ webSearchProvider: provider }),
  hybridPresets: [],
  setHybridPresets: (list) => set({ hybridPresets: list }),
  blockedModels: [],
  toggleBlockedModel: (id) =>
    set((s) => ({
      blockedModels: s.blockedModels.includes(id)
        ? s.blockedModels.filter((x) => x !== id)
        : [...s.blockedModels, id],
    })),
  storageGrouping: "type",
  setStorageGrouping: (g) => set({ storageGrouping: g }),
  appIcon: "default",
  setAppIcon: (v) => set({ appIcon: v }),
  fileMetadata: "hide",
  setFileMetadata: (v) => set({ fileMetadata: v }),
  // Organize by default (the maintainer, 2026-07-02): the daemon only ever changes a
  // note's LOCATION + METADATA — journaled and undoable — never the words.
  brainEnabled: true,
  setBrainEnabled: (on) => set({ brainEnabled: on }),
  secureLocalAi: true,
  setSecureLocalAi: (on) => set({ secureLocalAi: on }),
  organizerTrust: "organize",
  setOrganizerTrust: (t) => set({ organizerTrust: t }),
  organizerModel: "local",
  setOrganizerModel: (m) => set({ organizerModel: m }),
  organizerQuietSecs: 300,
  setOrganizerQuietSecs: (n) => set({ organizerQuietSecs: n }),
  librarianIntroSeen: false,
  setLibrarianIntroSeen: (seen) => set({ librarianIntroSeen: seen }),
  settingsPaneRequest: null,
  setSettingsPaneRequest: (pane) => set({ settingsPaneRequest: pane }),

  updateAvailable: false,
  setUpdateAvailable: (on) => set({ updateAvailable: on }),
  updateVersion: null,
  setUpdateVersion: (version) => set({ updateVersion: version }),

  focusMode: false,
  setFocusMode: (on) => set({ focusMode: on }),

  transients: [],
  registerTransient: (close) => {
    set((s) => ({ transients: [...s.transients, close] }));
    return () => set((s) => ({ transients: s.transients.filter((t) => t !== close) }));
  },
  closeTopTransient: () => {
    const top = get().transients[get().transients.length - 1];
    if (!top) return false;
    top();
    return true;
  },
}));

/** A vault change is a workspace boundary, not a continuation of the outgoing
 * navigation context. Run this after the target vault has hydrated so its
 * persisted Chat/Breve selection cannot override the Home landing. */
export function resetUiForVaultSwitch(): void {
  useUiStore.setState({
    sidebarMode: "notes",
    sidebarView: "home",
    contentView: "panes",
    breveDirty: false,
  });
}
