// UI state only (the Zustand law). Data lives behind src/services/.

import type { HybridPreset, ProviderId } from "../ai/models";
import { DEFAULT_NEW_ITEM_KIND, type NewItemKind } from "../newItems/model";
import { inboxFolderId } from "../services/notes";
import type { Measure } from "./noteStyle";
import type { NoteSummary } from "../types";
import { create } from "zustand";

export type ThemeSetting = "light" | "dark" | "system";

/** Theme family: Warm is the branded pair; Mono is Paper and Charcoal. */
export type ThemeFamily = "warm" | "mono";
export type SyntaxPalette = "rotli" | "mono";

/** The user's PRIMARY color (Seth, 2026-07-28): the active state, folder
 * color, selection wash — everything riding --accent. "default" keeps each
 * theme's own truth (warm clay / mono ink); a named accent overrides it in
 * both schemes. Chosen in onboarding, changeable in Settings → Appearance. */
export const ACCENT_COLORS = ["default", "blue", "green", "violet", "rose", "amber"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

/** The four solid themes, in the order the titlebar sun cycles them. */
export const SOLID_THEMES: { family: ThemeFamily; mode: "light" | "dark"; label: string }[] = [
  { family: "warm", mode: "light", label: "Warm Light" },
  { family: "warm", mode: "dark", label: "Warm Dark" },
  { family: "mono", mode: "light", label: "Paper" },
  { family: "mono", mode: "dark", label: "Charcoal" },
];

/** The organizer daemon's §4.3 trust ladder, monotonic in risk. Off = dormant ·
 * Suggest (default) = journal proposals only · Tidy = applies annotations +
 * files brand-new captures · Organize = applies everything, fully journaled. */
export type OrganizerTrust = "off" | "suggest" | "tidy" | "organize";
/** The macOS Dock/app icon variants (Settings → Appearance → App icon). */
export type AppIcon = "default" | "warm" | "paper" | "charcoal" | "clay";

export const ORGANIZER_TRUSTS: readonly OrganizerTrust[] = ["off", "suggest", "tidy", "organize"];

/** Which model organizes the Brain: `local` = the on-device MLX server (default,
 * never leaves the Mac); `claude` = `claude -p` Sonnet (Seth's pick — non-secure
 * notes go remote, secure/locked never do). The Rust daemon re-reads this. */
export type OrganizerModel = "local" | "claude" | "gemini35";

export const ORGANIZER_MODELS: readonly OrganizerModel[] = ["local", "claude", "gemini35"];

/** How many recent chats the sidebar Chat section shows before "All chats" takes
 * over — the accordion is a LIMITED view. 5 (default) / 10 / 15 (Seth's decision
 * 2026-07-03: the old flat 12 was too much). */
export const CHAT_SIDEBAR_LIMITS: readonly number[] = [5, 10, 15];
export const DEFAULT_CHAT_SIDEBAR_LIMIT = 5;

/** Coerce any stored / hand-set value to an allowed chat cap; unknown → default.
 * Pure (exported for the persist parse + its tests). */
export function clampChatSidebarLimit(n: unknown): number {
  return typeof n === "number" && CHAT_SIDEBAR_LIMITS.includes(n) ? n : DEFAULT_CHAT_SIDEBAR_LIMIT;
}

/** The folders rail selection: the two smart rows or a real folder id. */
export const ALL_NOTES = "all";
export const RECENT = "recent";
export const TASKS = "tasks";

/** What the content area (right of the sidebar) renders: the note panes, the
 * Board grid, the searchable All-notes grid, or the Chat surface. All of these
 * are views in the pane area — the sidebar never moves for them, so the three
 * left-menu sections (Inbox · Chat · Notes) stay visible (Seth, 2026-06-24;
 * Chat folded in from a full-surface front 2026-06-26). */
// (the old "chat" contentView is retired — chat is a PANE surface now)
export type ContentView = "panes" | "board" | "allNotes" | "allChats" | "recent" | "tasks" | "system";

/** The sidebar's high-level lens. Breve is an operational view over the same
 * corpus, not a separate window or a tab, so switching lenses must leave the
 * current notes contentView and pane tree untouched. */
export type SidebarMode = "notes" | "breve";
export type BreveView = "briefs" | "watchlist" | "routines" | "models" | "configure";

/** The three top-level left-menu sections (Seth's decided IA, 2026-06-26): Inbox
 * (email) · Chat · Notes. Each is a collapsible accordion; its open state lives in
 * expandedDests under these reserved ids (so it persists like a destination). */
export const SEC_INBOX = "sec:inbox";
export const SEC_CHAT = "sec:chat";
export const SEC_NOTES = "sec:notes";
/** The MAIN section's own collapse key (2026-07-26: Main is collapsible). */
export const SEC_MAIN = "sec:main";

/** Sidebar width clamp — small enough to tuck away, never wide enough to eat
 * the editor (one rail now, not two — Seth, 2026-06-13). */
export const clampSidebarWidth = (px: number): number => Math.min(460, Math.max(190, Math.round(px)));

/** Sidebar zoom clamp + step (⌘+/⌘− with focus in the sidebar). Rounded to one
 * decimal so repeated steps never drift on float error. */
export const SIDEBAR_ZOOM_STEP = 0.1;
export const clampSidebarZoom = (z: number): number => Math.min(1.4, Math.max(0.8, Math.round(z * 10) / 10));

/** The reserved destination ids the sidebar seeds open (Inbox + Vault) and the
 * persistence layer trusts as a valid folder selection before the first list
 * resolves (Seth, 2026-06-13). "vault:" is the external-root MARKER (Track 2);
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

  /** When "Match the system" is on, which theme each OS appearance maps to —
   * decoupled from the active family so you can pair, say, Paper (light) with
   * Warm Dark (dark). A theme is (family, mode); these store the family, the
   * mode is fixed by the OS (Seth, 2026-06-15). */
  matchLightFamily: ThemeFamily;
  setMatchLightFamily: (family: ThemeFamily) => void;
  matchDarkFamily: ThemeFamily;
  setMatchDarkFamily: (family: ThemeFamily) => void;
  /** Raw Markdown syntax colors. Rotli is the calm blue + active accent
   * default; Mono keeps the grammar but renders it in the environment ink. */
  syntaxPalette: SyntaxPalette;
  setSyntaxPalette: (palette: SyntaxPalette) => void;
  /** The primary color — see ACCENT_COLORS. "default" = the theme's own. */
  accentColor: AccentColor;
  setAccentColor: (accent: AccentColor) => void;

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

  /** First-run gate: false until the user finishes (or skips) onboarding, or
   * after a manual "Reset & re-onboard". Persisted in settings.json; the
   * onboarding surface shows whenever this is false (Tauri only). */
  onboarded: boolean;
  setOnboarded: (done: boolean) => void;
  /** The app version the user last completed onboarding at — the onboardingVersion
   * gate re-onboards on every 0.x update, then freezes post-1.0. */
  onboardingVersion: string;
  setOnboardingVersion: (v: string) => void;

  /** The Quick Note window's capped set (Seth, 2026-06-15): up to QUICK_MAX
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

  /** The ONE sidebar — collapse state (remembered per window, persisted in the
   * shell) and width (px; drag the grip on its right edge). The two-rail era is
   * gone: folders + note-list collapse into a single navigator (Seth,
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
  breveView: BreveView;
  setBreveView: (view: BreveView) => void;
  /** Transient edit guard for Breve forms. Never persisted: drafts live only
   * for the mounted workspace and must be resolved before changing lenses. */
  breveDirty: boolean;
  setBreveDirty: (dirty: boolean) => void;

  /** Which destinations in the sidebar tree are expanded, keyed by dest id —
   * Inbox + Vault open by default (Seth, 2026-06-13). */
  expandedDests: Record<string, boolean>;
  toggleDestExpanded: (id: string) => void;
  setDestExpanded: (id: string, open: boolean) => void;
  /** Bumped to ask the sidebar to REVEAL the focused note — expand its folder
   * chain AND scroll its row into view (Seth, 2026-07-03: "I can't find where
   * this file is"). The editor's location chip fires it. Not persisted. */
  revealNonce: number;
  /** "auto" reveals in Main when the note is pinned there (Main's copy wins);
   * "brain" forces the reveal to the note's REAL home in the Brain, bypassing the
   * Main short-circuit — the "Open in Brain" menu action (Seth, 2026-07-08). */
  revealMode: "auto" | "brain";
  /** Explicit target for a menu-triggered reveal. Keeping it beside the nonce
   * avoids a render race where the sidebar still sees the previously focused
   * tab when "Show in Brain" is invoked from another row. */
  revealNoteId: string | null;
  revealFocusedNote: (mode?: "auto" | "brain", noteId?: string) => void;
  /** Collapse every expanded destination + folder at once (the sidebar's
   * collapse-all toolbar button). `defaultOpenIds` are the rows that read the
   * map with an OPEN default (Main folders, the Brain header) — they get an
   * explicit `false`, or wiping the map would EXPAND them (#83, audit
   * 2026-07). The three sections stay open by design (an all-empty sidebar
   * helps nobody). */
  collapseAllDests: (defaultOpenIds?: string[]) => void;

  /** Folders-rail selection (window-level). */
  selectedFolderId: string;
  setSelectedFolderId: (id: string) => void;
  /** Bumped by the sidebar's New-folder button while a System browser is open —
   * the browser answers by opening its create-folder input at its cwd. */
  systemFolderNonce: number;
  requestSystemFolder: () => void;
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
   * default (Seth, 2026-06-22); a Settings → Editor switch. Persisted. */
  spellcheck: boolean;
  setSpellcheck: (on: boolean) => void;

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

  /** Settings as its own surface in the window (r1 frame F); Esc returns. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  /** What the content area (right of the sidebar) shows: the note panes, the
   * Board grid (quick captures), or the All-notes grid. The sidebar stays put —
   * Board/All-notes are VIEWS in the pane area, not full-surface takeovers
   * (Seth, 2026-06-24). Esc returns to "panes". Not persisted (transient). */
  contentView: ContentView;
  /** Which System root the browser surface shows (contentView "system") —
   * "Brain" (the Library) or a destination id. Transient, like contentView. */
  systemRoot: string | null;
  setSystemRoot: (id: string | null) => void;
  setContentView: (view: ContentView) => void;

  /** The board id currently being renamed inline in the sidebar (its row shows a
   * text input), or null. Set on right-click "Rename" and on new-board create so
   * the user names it immediately (Seth, 2026-06-26). */
  renamingBoardId: string | null;
  setRenamingBoardId: (id: string | null) => void;
  renamingChatSlug: string | null;
  setRenamingChatSlug: (slug: string | null) => void;

  /** The note whose title is being edited in the rename dialog (opened from the
   * right-click menu), or null. `current` seeds the input (Seth, 2026-07-01). */
  renameTarget: { id: string; current: string } | null;
  setRenameTarget: (t: { id: string; current: string } | null) => void;

  /** A failed row-menu action (file-to-brain, board rename …) surfaced as an
   * inline note in the sidebar — the menu that launched the action is gone by
   * the time it fails, so this is its error home (#11, audit 2026-07). Not
   * persisted (transient); dismissed by the × or replaced by the next failure. */
  rowActionError: string | null;
  setRowActionError: (e: string | null) => void;

  /** The user's name — onboarding's "What should rotli call you?" / Settings →
   * General. Personalizes AI chat (the prompt persona line). Persisted; "" = unset. */
  userName: string;
  setUserName: (name: string) => void;

  /** The on-device model id the Chat surface sends to, picked from the memex-ai
   * store (~/.memex/ai/registry.json). null = use the store's default. Persisted. */
  chatModelId: string | null;
  setChatModelId: (id: string | null) => void;
  /** Per-chat web-search toggle (the composer globe), keyed by chat slug. Off by
   * default; only an enabled chat may use the web_search/web_fetch tools. Persisted —
   * except the session-scoped "unsaved:<paneId>" keys: a not-yet-saved chat's choice
   * lives under its PANE (never a shared "" key that would leak web-ON into every
   * future fresh chat — #7, audit 2026-07) and is carried to the slug on bind. */
  chatWeb: Record<string, boolean>;
  setChatWeb: (slug: string, on: boolean) => void;
  /** Drop one chatWeb key — the unsaved-pane key after bind carries it to the slug. */
  clearChatWeb: (key: string) => void;
  /** Per-chat measure (Narrow/Comfort/Wide — the notes Aa vocabulary), keyed
   * exactly like chatWeb (slug, or "unsaved:<paneId>" until the first send
   * binds it). Missing key = comfort. Persisted (unsaved keys excluded). */
  chatMeasure: Record<string, Measure>;
  setChatMeasure: (key: string, m: Measure) => void;
  clearChatMeasure: (key: string) => void;
  /** Where a chat's attached note opens from the header toggle: a new tab in
   * this pane, or a right split beside the chat. Persisted. */
  chatNoteOpen: "tab" | "split";
  setChatNoteOpen: (v: "tab" | "split") => void;
  /** How many recent chats the sidebar Chat section shows before "All chats"
   * (5/10/15, default 5 — Seth, 2026-07-03). Persisted. */
  chatSidebarLimit: number;
  setChatSidebarLimit: (n: number) => void;
  /** Connected subscription models (Settings → AI Models): which lanes are
   * enabled. A lane must ALSO detect as installed+authed to serve. Persisted. */
  aiProviders: Record<ProviderId, boolean>;
  setAiProvider: (id: ProviderId, on: boolean) => void;
  /** Hybrid model presets (organizer → routes → fallback). Persisted. */
  hybridPresets: HybridPreset[];
  setHybridPresets: (list: HybridPreset[]) => void;
  /** Individual CONNECTED models turned off inside an enabled lane (e.g. keep
   * Sonnet, block Opus) — hidden from the picker + preset editor. Persisted. */
  blockedModels: string[];
  toggleBlockedModel: (id: string) => void;
  /** Which connected engine draws the chat's generate_image tool. Persisted. */
  imageEngine: "codex" | "agy";
  setImageEngine: (e: "codex" | "agy") => void;
  /** How the Storage destination groups its binaries (a Settings knob): by Type
   * (default), Date, or Folder (raw on-disk). Persisted. */
  storageGrouping: "type" | "date" | "folder";
  setStorageGrouping: (g: "type" | "date" | "folder") => void;
  /** The macOS Dock/app icon variant (Settings → Appearance). "default" is the
   * shipped icon; the rest re-tile the quokka in a theme palette. Persisted. */
  appIcon: AppIcon;
  setAppIcon: (v: AppIcon) => void;
  /** "Show file metadata" (Seth, 2026-07-01): render the note's raw frontmatter
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
  organizerTrust: OrganizerTrust;
  setOrganizerTrust: (t: OrganizerTrust) => void;
  /** Which model the organizer runs (design §4; Seth, 2026-07-03). Persisted;
   * the Rust daemon re-reads settings.json each cycle, so no push command. */
  organizerModel: OrganizerModel;
  setOrganizerModel: (m: OrganizerModel) => void;
  /** Idle delay (seconds) before the organizer scans a just-touched note. */
  organizerQuietSecs: number;
  setOrganizerQuietSecs: (n: number) => void;

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
  theme: "light",
  setTheme: (theme) => set({ theme }),
  // the titlebar sun: Warm Light → Warm Dark → Paper → Charcoal (Seth's law);
  // a "system" setting resolves to its current mode before stepping on
  cycleTheme: () =>
    set((s) => {
      const mode =
        s.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : s.theme;
      const i = SOLID_THEMES.findIndex((t) => t.family === s.themeFamily && t.mode === mode);
      const next = SOLID_THEMES[(i + 1) % SOLID_THEMES.length];
      return next ? { themeFamily: next.family, theme: next.mode } : s;
    }),

  themeFamily: "warm",
  setThemeFamily: (family) => set({ themeFamily: family }),

  matchLightFamily: "warm",
  setMatchLightFamily: (family) => set({ matchLightFamily: family }),
  matchDarkFamily: "warm",
  setMatchDarkFamily: (family) => set({ matchDarkFamily: family }),
  syntaxPalette: "rotli",
  setSyntaxPalette: (palette) => set({ syntaxPalette: palette }),
  accentColor: "default",
  setAccentColor: (accent) => set({ accentColor: accent }),

  stayOpen: false,
  setStayOpen: (on) => set({ stayOpen: on }),
  showInDock: false,
  setShowInDock: (on) => set({ showInDock: on }),
  newTabDefault: DEFAULT_NEW_ITEM_KIND,
  setNewTabDefault: (kind) => set({ newTabDefault: kind }),

  onboarded: false,
  setOnboarded: (done) => set({ onboarded: done }),
  onboardingVersion: "",
  setOnboardingVersion: (v) => set({ onboardingVersion: v }),

  quickNoteIds: [],
  setQuickNoteIds: (ids) => set({ quickNoteIds: ids }),
  captureOrder: [],
  setCaptureOrder: (ids) => set({ captureOrder: ids }),
  quickActiveId: null,
  setQuickActiveId: (id) => set({ quickActiveId: id }),
  // "Inbox" on disk (fs mode); the seeded Inbox id in the browser
  quickFolder: inboxFolderId,
  setQuickFolder: (folder) => set({ quickFolder: folder }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  sidebarWidth: 240,
  setSidebarWidth: (px) => set({ sidebarWidth: clampSidebarWidth(px) }),
  sidebarZoom: 1,
  setSidebarZoom: (z) => set({ sidebarZoom: clampSidebarZoom(z) }),
  sidebarMode: "notes",
  setSidebarMode: (mode) => {
    const current = get();
    if (
      current.sidebarMode === "breve" &&
      mode !== "breve" &&
      current.breveDirty &&
      typeof window !== "undefined" &&
      !window.confirm("Discard your unsaved Breve changes and return to Notes?")
    )
      return;
    set({ sidebarMode: mode, ...(mode === "breve" ? {} : { breveDirty: false }) });
  },
  breveView: "briefs",
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

  // the three sections open by default, plus the Capture(Inbox) + Vault dests
  // inside Notes — so a fresh window shows the full three-section tree.
  expandedDests: {
    [SEC_INBOX]: true,
    [SEC_CHAT]: true,
    [SEC_NOTES]: true,
    Inbox: true,
    "vault:": true,
  },
  toggleDestExpanded: (id) =>
    set((s) => ({ expandedDests: { ...s.expandedDests, [id]: !s.expandedDests[id] } })),
  setDestExpanded: (id, open) => set((s) => ({ expandedDests: { ...s.expandedDests, [id]: open } })),
  revealNonce: 0,
  revealMode: "auto",
  revealNoteId: null,
  revealFocusedNote: (mode = "auto", noteId) =>
    set((s) => ({
      revealNonce: s.revealNonce + 1,
      revealMode: mode,
      revealNoteId: noteId ?? null,
    })),
  collapseAllDests: (defaultOpenIds = []) =>
    set((s) => ({
      expandedDests: {
        // section fold states (sec:*) are the user's own arrangement —
        // collapse-all folds the TREES; it must never REOPEN a folded section
        // (replacing the map wiped them back to default-open — Seth, 2026-07-27)
        ...Object.fromEntries(Object.entries(s.expandedDests).filter(([id]) => id.startsWith("sec:"))),
        ...Object.fromEntries(defaultOpenIds.map((id) => [id, false])),
      },
    })),

  selectedFolderId: ALL_NOTES,
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),
  systemFolderNonce: 0,
  requestSystemFolder: () => set((s) => ({ systemFolderNonce: s.systemFolderNonce + 1 })),
  systemSelection: [],
  setSystemSelection: (items) => set({ systemSelection: items }),
  activeView: null,
  setActiveView: (name) => set({ activeView: name, selectedFolderId: "main:" }),

  formatBarVisible: true,
  setFormatBarVisible: (visible) => set({ formatBarVisible: visible }),

  spellcheck: true,
  setSpellcheck: (on) => set({ spellcheck: on }),

  rawEditor: false,
  setRawEditor: (on) => set({ rawEditor: on }),

  blockHandles: true,
  setBlockHandles: (on) => set({ blockHandles: on }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  contentView: "panes",
  setContentView: (view) => set({ contentView: view }),
  systemRoot: null,
  setSystemRoot: (id) => set({ systemRoot: id }),
  renameTarget: null,
  setRenameTarget: (t) => set({ renameTarget: t }),

  renamingBoardId: null,
  setRenamingBoardId: (id) => set({ renamingBoardId: id }),
  renamingChatSlug: null,
  setRenamingChatSlug: (slug) => set({ renamingChatSlug: slug }),
  rowActionError: null,
  setRowActionError: (e) => set({ rowActionError: e }),

  userName: "",
  setUserName: (name) => set({ userName: name }),

  chatModelId: null,
  setChatModelId: (id) => set({ chatModelId: id }),
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
  chatSidebarLimit: DEFAULT_CHAT_SIDEBAR_LIMIT,
  setChatSidebarLimit: (n) => set({ chatSidebarLimit: clampChatSidebarLimit(n) }),
  aiProviders: { claude: false, codex: false, agy: false, gemini: false },
  setAiProvider: (id, on) => set((s) => ({ aiProviders: { ...s.aiProviders, [id]: on } })),
  hybridPresets: [],
  setHybridPresets: (list) => set({ hybridPresets: list }),
  blockedModels: [],
  toggleBlockedModel: (id) =>
    set((s) => ({
      blockedModels: s.blockedModels.includes(id)
        ? s.blockedModels.filter((x) => x !== id)
        : [...s.blockedModels, id],
    })),
  imageEngine: "codex",
  setImageEngine: (e) => set({ imageEngine: e }),
  storageGrouping: "type",
  setStorageGrouping: (g) => set({ storageGrouping: g }),
  appIcon: "default",
  setAppIcon: (v) => set({ appIcon: v }),
  fileMetadata: "hide",
  setFileMetadata: (v) => set({ fileMetadata: v }),
  // Organize by default (Seth, 2026-07-02): the daemon only ever changes a
  // note's LOCATION + METADATA — journaled and undoable — never the words.
  brainEnabled: true,
  setBrainEnabled: (on) => set({ brainEnabled: on }),
  organizerTrust: "organize",
  setOrganizerTrust: (t) => set({ organizerTrust: t }),
  organizerModel: "local",
  setOrganizerModel: (m) => set({ organizerModel: m }),
  organizerQuietSecs: 300,
  setOrganizerQuietSecs: (n) => set({ organizerQuietSecs: n }),

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
