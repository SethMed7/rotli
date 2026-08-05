// Settings — the r1 frame F window grammar: left nav (Hotkeys · Appearance ·
// Storage · Plugins) + one surface. Esc closes back to notes (the registry's
// app.hide chain). Storage shows the corpus story with the future default path
// ~/Documents/rotli; "Later" cards are quiet and non-interactive. Hotkeys is
// the rebind list: click a chord, press the next combo (a quiet inline note if
// the chord is taken).

import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import { makeTauriHost } from "../ai/host";
import { suggestPresets } from "../ai/hybrid";
import {
  CLI_CATALOG,
  type HybridPreset,
  type LocalCatalogEntry,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type ProviderId,
  STARTER_PRESETS,
  fitLabel,
  flattenModels,
  installableCatalog,
  isValidRepo,
  mergedModels,
  nameFromRepo,
  scanVerdict,
} from "../ai/models";
import { verifyLane } from "../ai/verify";
import { resolveChord, useBindingsStore } from "../keys/bindings";
import { chordFromEvent, formatChord } from "../keys/chords";
import {
  type KeyAction,
  allActions,
  conflictFor,
  dispatch,
  getAction,
  rebind,
  setDispatchSuspended,
} from "../keys/registry";
import {
  type ChatModelInfo,
  type MemexValidateReport,
  type SystemProfile,
  appVersion,
  chatModels,
  checkForUpdate,
  cliDetect,
  corpusAddFolder,
  corpusOverview,
  demoMode,
  downloadAndInstallUpdate,
  isTauri,
  localModelInstall,
  localModelInstallCancel,
  localModelInstallProgress,
  localModelSetDefault,
  localModelUninstall,
  organizerRunOnce,
  organizerSetBrain,
  organizerSetTrust,
  revealCorpus,
  SECRET_GEMINI_API_KEY,
  secretDelete,
  secretExists,
  secretStore,
  setAppIcon,
  setDemoMode,
  setDockVisible,
  setHideOnBlur,
  systemProfile,
} from "../lib/tauri";
import { CORPUS_INSTANCE_ID, type MemexInstance, type Perms } from "../memex/config";
import {
  useChooseFolder,
  useConnectBrain,
  useDetectMemex,
  useForgetBrain,
  useMemexConfig,
  useRunValidate,
  useSetActiveMemex,
  useSetMemexPerms,
} from "../memex/useMemex";
import { NEW_ITEM_DEFINITIONS } from "../newItems/model";
import { isChatsPath, isHidden, isVault, isWikiPath } from "../services/destinations";
import { useFolders } from "../services/hooks";
import { queryClient } from "../services/query";
import { resetAndReonboard } from "../state/onboarding";
import { usePanesStore } from "../state/panes";
import { setQuickFolderSynced } from "../state/quick";
import { ACCENT_COLORS, type AppIcon, type OrganizerTrust, SOLID_THEMES, useUiStore } from "../state/ui";
import { VOICES } from "../voice/speech";
import { Character, type CharacterName, QuokkaMark } from "./character";
import {
  CheckGlyph,
  CloudGlyph,
  DatabaseGlyph,
  KeyboardGlyph,
  LaptopGlyph,
  NotesStackGlyph,
  PlusGlyph,
  ShieldGlyph,
  SunGlyph,
} from "./glyphs";

type SettingsPane =
  | "general"
  | "hotkeys"
  | "appearance"
  | "brain"
  | "security"
  | "models"
  | "location"
  | "plugins";

const NAV: { id: SettingsPane; label: string; glyph: typeof KeyboardGlyph }[] = [
  { id: "general", label: "General", glyph: LaptopGlyph },
  { id: "hotkeys", label: "Hotkeys", glyph: KeyboardGlyph },
  { id: "appearance", label: "Appearance", glyph: SunGlyph },
  // the organizer daemon's trust ladder (design §4.3) — minimal Phase-4 pane;
  // capability checkboxes / Pause / Reset Brain are Phase 5 (§4.8)
  { id: "brain", label: "Librarian", glyph: NotesStackGlyph },
  // the secure-note explainer (decision 2026-07-22, feature C) — the ONE plain-
  // language home for the fail-closed rules; contract stays the spec
  { id: "security", label: "Security", glyph: ShieldGlyph },
  // connected subscription models + hybrid presets (Seth, 2026-07-02)
  { id: "models", label: "AI Models", glyph: CloudGlyph },
  // Storage + Memory collapsed into one "Location" tab (Seth, 2026-06-27): your
  // notes folder *is* (or can become) a brain — one concept, not two overlapping
  // ones. See LocationPane below.
  { id: "location", label: "Location", glyph: DatabaseGlyph },
  { id: "plugins", label: "Plugins", glyph: PlusGlyph },
];

/** A settings pane heading with its quokka character accent (Seth, 2026-06-26) —
 * a small, muted line-art quokka at the top-right of each section. The accent
 * tints with the theme (currentColor) and stays a quiet flourish, never the
 * focus. Each pane gets the character that fits it. */
function PaneHead({ title, char }: { title: string; char: CharacterName }) {
  return (
    <div className="set-panehead">
      <h3>{title}</h3>
      <Character name={char} size={56} className="set-paneaccent" />
    </div>
  );
}

// ——— shared settings controls (Seth, 2026-06-15) ———

/** The sliding track + knob every switch shares — state comes from the parent's
 * .on class (`.swrow`/`.ailane-sw`), so this stays a dumb visual. */
function SwitchKnob() {
  return (
    <span className="sw" aria-hidden="true">
      <span className="swknob" />
    </span>
  );
}

/** A real on/off switch — label + description on the left, a sliding track on
 * the right. Replaces the old ambiguous dot-in-a-box "sysrow". */
function Toggle({
  on,
  onChange,
  title,
  desc,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  title: string;
  desc?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled}
      disabled={disabled}
      className={`${on ? "swrow on" : "swrow"}${disabled ? " disabled" : ""}`}
      onClick={disabled ? undefined : onChange}
    >
      <span className="swtext">
        <span className="swt">{title}</span>
        {desc && <span className="swd">{desc}</span>}
      </span>
      <SwitchKnob />
    </button>
  );
}

/** A small segmented picker (reuses the .aaseg pills). */
function Seg<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
}) {
  return (
    <div className="segrow">
      {options.map(([v, label]) => (
        <button
          type="button"
          key={v}
          className={value === v ? "aaseg sel" : "aaseg"}
          aria-pressed={value === v}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

// ——— Hotkeys: every registry action, grouped by area + searchable ———

/** Sections derive from the action id prefix ("tabs.new" → Tabs) — no
 * per-action bookkeeping, new actions land in the right group automatically. */
const HK_SECTIONS: { prefix: string; label: string }[] = [
  { prefix: "app", label: "App" },
  { prefix: "capture", label: "Quick capture" },
  { prefix: "quick", label: "Quick note" },
  { prefix: "notes", label: "Notes" },
  { prefix: "chat", label: "Chat" },
  { prefix: "editor", label: "Editor" },
  { prefix: "tabs", label: "Tabs" },
  { prefix: "panes", label: "Panes" },
  { prefix: "chrome", label: "Chrome" },
  { prefix: "palette", label: "Palette" },
  { prefix: "theme", label: "Theme" },
];

function HotkeysPane() {
  const overrides = useBindingsStore((s) => s.overrides);
  const hotkeyPeek = useUiStore((s) => s.hotkeyPeek);
  const setHotkeyPeek = useUiStore((s) => s.setHotkeyPeek);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [query, setQuery] = useState("");

  const chordOf = (a: KeyAction) => resolveChord(overrides, a.id, a.defaultChord);

  // belt-and-braces under the recorder's stopPropagation: while recording, the
  // live dispatcher stands down so a half-typed combo can't fire an action
  useEffect(() => {
    setDispatchSuspended(recordingId !== null);
    return () => setDispatchSuspended(false);
  }, [recordingId]);

  // The recording button captures the next keydown itself (it IS the rebind
  // widget — like a text input handling its own typing); stopPropagation keeps
  // the chord from also reaching the window dispatcher.
  const onRecordKeyDown = (action: KeyAction) => (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecordingId(null); // Esc cancels recording — it is not recordable
      return;
    }
    const chord = chordFromEvent(event.nativeEvent);
    if (!chord) return; // modifiers alone — keep listening
    const key = chord.split("+").pop() ?? "";
    // bare keys must stay typable everywhere: require a real modifier
    // (F-keys excepted) before a chord can be a binding
    if (!(event.ctrlKey || event.altKey || event.metaKey) && !/^F\d{1,2}$/.test(key)) return;
    const taken = conflictFor(action.id, chord);
    if (taken) {
      setNote({ id: action.id, text: `taken by “${taken.title}”` });
      setRecordingId(null);
      return;
    }
    setNote(null);
    setRecordingId(null);
    rebind(action.id, chord).catch(() => {
      // the OS refused the chord (owned by another app) — nothing committed,
      // the old binding stays everywhere; say so quietly, in place
      setNote({ id: action.id, text: "the system kept the previous chord" });
    });
  };

  const q = query.trim().toLowerCase();
  // the whole registry gets re-sectioned only when the search text or a binding
  // moves — recording a chord and showing a conflict note used to redo it too
  // (perf audit 2026-07-30, finding 24)
  const { grouped, ungrouped } = useMemo(() => {
    const matches = (action: KeyAction): boolean => {
      if (!q) return true;
      const chord = resolveChord(overrides, action.id, action.defaultChord);
      return (
        action.title.toLowerCase().includes(q) ||
        action.id.toLowerCase().includes(q) ||
        (chord !== null && formatChord(chord).toLowerCase().includes(q))
      );
    };
    const actions = allActions();
    return {
      grouped: HK_SECTIONS.map((section) => ({
        ...section,
        actions: actions.filter((a) => a.id.startsWith(`${section.prefix}.`) && matches(a)),
      })).filter((section) => section.actions.length > 0),
      ungrouped: actions.filter(
        (a) => !HK_SECTIONS.some((s) => a.id.startsWith(`${s.prefix}.`)) && matches(a),
      ),
    };
  }, [q, overrides]);

  const row = (action: KeyAction) => {
    const recording = recordingId === action.id;
    const chord = chordOf(action);
    return (
      <div className="hkrow" key={action.id}>
        <span className="hklabel">{action.title}</span>
        {note?.id === action.id && <span className="hkconflict">{note.text}</span>}
        <button
          type="button"
          className={recording ? "hkchord recording" : "hkchord"}
          aria-label={`Rebind ${action.title}`}
          onClick={(event) => {
            // WebKit does not focus buttons on click — without this the
            // recorder never hears a key and the row sticks on "press keys…"
            event.currentTarget.focus();
            setRecordingId(action.id);
            setNote(null);
          }}
          onKeyDown={recording ? onRecordKeyDown(action) : undefined}
          onBlur={() => setRecordingId((id) => (id === action.id ? null : id))}
        >
          {recording ? (
            "press keys…"
          ) : chord ? (
            <kbd>{formatChord(chord)}</kbd>
          ) : (
            <span className="hkunset">—</span>
          )}
        </button>
      </div>
    );
  };

  return (
    <>
      <PaneHead title="Hotkeys" char="notes" />
      <p className="lead">Every shortcut in rotli is yours to rebind. Click a chord, press the new keys.</p>
      <section className="hksection">
        <div className="hkhead">Hold ⌘</div>
        <p className="setnote">
          Hold ⌘ for a moment and rotli shows you what you can press — as badges pinned to the controls
          themselves, or as one grouped list.
        </p>
        <Seg
          value={hotkeyPeek}
          options={[
            ["badges", "Badges on the controls"],
            ["panel", "One grouped list"],
            ["off", "Show nothing"],
          ]}
          onPick={setHotkeyPeek}
        />
      </section>
      <input
        type="search"
        className="hksearch"
        placeholder="Search hotkeys…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {grouped.map((section) => (
        <section key={section.prefix} className="hksection">
          <div className="hkhead">{section.label}</div>
          <div className="hkrows">{section.actions.map(row)}</div>
        </section>
      ))}
      {ungrouped.length > 0 && (
        <section className="hksection">
          <div className="hkhead">Other</div>
          <div className="hkrows">{ungrouped.map(row)}</div>
        </section>
      )}
      {grouped.length === 0 && ungrouped.length === 0 && (
        <p className="setnote">Nothing matches “{query}”.</p>
      )}
    </>
  );
}

// ——— General: visitor vs resident, dock visibility (Seth, 2026-06-12) ———

// ——— Updates: the current version + a manual check, plus the one-click
// "Install & relaunch" when the signed feed offers a newer build. The on-mount
// App.tsx check primes updateAvailable/updateVersion; this lets you also check
// on demand and pull the update down (CARL rule 2: nothing auto-downloads). ———

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string | null }
  | { kind: "installing"; pct: number }
  | { kind: "error"; message: string };

function UpdatesSection() {
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const updateVersion = useUiStore((s) => s.updateVersion);
  const setUpdateAvailable = useUiStore((s) => s.setUpdateAvailable);
  const setUpdateVersion = useUiStore((s) => s.setUpdateVersion);
  const [version, setVersion] = useState("0.1.0");
  // seed from the on-mount check so re-opening Settings keeps the badge
  const [state, setState] = useState<CheckState>(
    updateAvailable ? { kind: "available", version: updateVersion } : { kind: "idle" },
  );

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void appVersion()
      .then((v) => {
        if (alive && v) setVersion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const check = () => {
    setState({ kind: "checking" });
    void checkForUpdate()
      .then((status) => {
        if (status.available) {
          const v = status.version ?? null;
          setUpdateAvailable(true);
          setUpdateVersion(v);
          setState({ kind: "available", version: v });
        } else {
          setUpdateAvailable(false);
          setUpdateVersion(null);
          setState({ kind: "current" });
        }
      })
      .catch((err: unknown) => {
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  };

  const install = () => {
    setState({ kind: "installing", pct: 0 });
    // resolves only if the relaunch doesn't happen (it normally does) — on any
    // error surface it; the app stays on the current build
    void downloadAndInstallUpdate((pct) => setState({ kind: "installing", pct })).catch((err: unknown) => {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    });
  };

  const installing = state.kind === "installing";

  return (
    <>
      <h4 className="sethead">Updates</h4>
      <div className="setselect-row">
        <span>
          rotli {version}
          {state.kind === "current" && " — up to date"}
          {state.kind === "available" && ` — update available${state.version ? ` (v${state.version})` : ""}`}
        </span>
        {state.kind === "available" || installing ? (
          <button type="button" className="ghostbtn" onClick={install} disabled={installing}>
            {installing ? `Updating… ${state.pct}%` : "Install & relaunch"}
          </button>
        ) : (
          <button type="button" className="ghostbtn" onClick={check} disabled={state.kind === "checking"}>
            {state.kind === "checking" ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>
      {state.kind === "error" && <p className="setnote err">Couldn’t check for updates: {state.message}</p>}
    </>
  );
}

/** The LIVE chord for an action, formatted for copy — the General blurbs must
 * follow a rebind instead of forever teaching the shipped defaults (#86, audit
 * 2026-07). "unbound" when the user cleared it. */
function chordLabel(overrides: Record<string, string | null>, actionId: string): string {
  const action = getAction(actionId);
  const chord = action ? resolveChord(overrides, actionId, action.defaultChord) : null;
  return chord ? formatChord(chord) : "unbound";
}

function GeneralPane() {
  const bindingOverrides = useBindingsStore((s) => s.overrides);
  const stayOpen = useUiStore((s) => s.stayOpen);
  const setStayOpen = useUiStore((s) => s.setStayOpen);
  const showInDock = useUiStore((s) => s.showInDock);
  const setShowInDock = useUiStore((s) => s.setShowInDock);
  const spellcheck = useUiStore((s) => s.spellcheck);
  const setSpellcheck = useUiStore((s) => s.setSpellcheck);
  const tidyImagesWithNote = useUiStore((s) => s.tidyImagesWithNote);
  const setTidyImagesWithNote = useUiStore((s) => s.setTidyImagesWithNote);
  const fileMetadata = useUiStore((s) => s.fileMetadata);
  const setFileMetadata = useUiStore((s) => s.setFileMetadata);
  const newTabDefault = useUiStore((s) => s.newTabDefault);
  const setNewTabDefault = useUiStore((s) => s.setNewTabDefault);
  const userName = useUiStore((s) => s.userName);
  const setUserName = useUiStore((s) => s.setUserName);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const taskCycle = useUiStore((st) => st.taskCycle);
  const setTaskCycle = useUiStore((st) => st.setTaskCycle);
  const [confirmReset, setConfirmReset] = useState(false);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    void demoMode().then(setDemo);
  }, []);
  const quickFolder = useUiStore((s) => s.quickFolder);
  // The external Vault is read-mostly — quick notes never land there — and the
  // LOCAL memex's curated wiki/** + chats/ refuse note creation at the write
  // gate: offering one here would leave ⌥Q silently dead forever (#6, audit
  // 2026-07). Keep all of them out of the destination picker entirely.
  const folderOpts = (useFolders().data ?? []).filter(
    (f) => !isHidden(f.id) && !isVault(f.id) && !isWikiPath(f.id) && !isChatsPath(f.id),
  );
  const hasCurrent = folderOpts.some((f) => f.id === quickFolder);
  return (
    <>
      <PaneHead title="General" char="base" />
      <p className="lead">
        rotli is a visitor by default — summon it, write, dismiss it. Make it a resident when you&rsquo;re
        living in it.
      </p>
      <div className="swgroup">
        <Toggle
          on={stayOpen}
          title="Stay open"
          desc="Don’t hide when I click away."
          onChange={() => {
            const next = !stayOpen;
            setStayOpen(next);
            void setHideOnBlur(!next);
          }}
        />
        <Toggle
          on={showInDock}
          title="Show in the Dock"
          desc="Otherwise rotli lives in the menu bar only."
          onChange={() => {
            const next = !showInDock;
            setShowInDock(next);
            void setDockVisible(next);
          }}
        />
      </div>
      <p className="setnote">
        Either way the menu-bar icon stays, {chordLabel(bindingOverrides, "app.toggleWindow")} opens the app,
        and {chordLabel(bindingOverrides, "capture.summon")} is the one-breath capture — all rebindable in
        Hotkeys.
      </p>

      <h4 className="sethead">Your name</h4>
      <p className="lead">
        Chat uses it to address you like a person. It lives in your settings file on this Mac — never sent
        anywhere on its own.
      </p>
      <label className="setselect-row">
        <span>Name</span>
        <input
          className="aikey-input"
          type="text"
          placeholder="How should rotli address you?"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>

      <h4 className="sethead">New tabs</h4>
      <p className="lead">
        Choose what {chordLabel(bindingOverrides, "tabs.new")} and the tab-strip plus create. The New menu
        always offers every type.
      </p>
      <label className="setselect-row">
        <span>New tab creates</span>
        <select
          className="setselect"
          value={newTabDefault}
          onChange={(event) => setNewTabDefault(event.target.value as typeof newTabDefault)}
        >
          {NEW_ITEM_DEFINITIONS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="setnote">
        Markdown notes support slash commands and embeds. Documents stay conventional documents; sheets and
        boards use their own focused editors.
      </p>

      <h4 className="sethead">Quick note</h4>
      <p className="lead">
        A floating note you summon with {chordLabel(bindingOverrides, "quick.summon")} — pin up to five notes
        in it, cycle them with ‹ ›, and ⌘K searches every note to swap one in. It always reopens where you
        left off and closes when you click away.
      </p>
      <label className="setselect-row">
        <span>New quick notes go to</span>
        <select
          className="setselect"
          value={quickFolder}
          onChange={(e) => setQuickFolderSynced(e.target.value)}
        >
          {!hasCurrent && <option value={quickFolder}>{quickFolder}</option>}
          {folderOpts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <h4 className="sethead">Writing</h4>
      <p className="lead">How the editor behaves while you type.</p>
      <div className="swgroup">
        <Toggle
          on={spellcheck}
          title="Check spelling"
          desc="Underline misspelled words in red as you write."
          onChange={() => setSpellcheck(!spellcheck)}
        />
        <Toggle
          on={tidyImagesWithNote}
          title="Images follow their note"
          desc="Trashing or archiving a note takes its images along — unless another note also uses them."
          onChange={() => setTidyImagesWithNote(!tidyImagesWithNote)}
        />
        <Toggle
          on={fileMetadata === "show"}
          title="Show file metadata"
          desc="The note's raw frontmatter block at the top of the file, exactly as it sits on disk — editable as plain text."
          onChange={() => setFileMetadata(fileMetadata === "show" ? "hide" : "show")}
        />
      </div>

      <h4 className="sethead">Checkboxes</h4>
      <p className="lead">
        A task can be in progress, not just done or not — write <code>- [/]</code> and rotli draws the box
        half-filled. Choose what a <em>click</em> on the box does.
      </p>
      <Seg
        value={taskCycle}
        options={[
          ["two", "Not started ⇄ done"],
          ["three", "Click once for in progress, again for done"],
        ]}
        onPick={setTaskCycle}
      />
      <p className="setnote">
        Either way, typing <code>[/]</code> yourself always works, and a parent task counts only the finished
        ones in its <code>2/4</code>.
      </p>

      <UpdatesSection />

      <h4 className="sethead">Demo mode</h4>
      <p className="lead">
        Switch to a separate demo library with sample content — for screenshots or trying things out. Your
        real notes are never touched; toggling relaunches rotli.
      </p>
      <Toggle
        on={demo}
        title="Demo mode"
        desc="Read and write a throwaway demo library instead of your real notes."
        onChange={() => void setDemoMode(!demo)}
      />

      <h4 className="sethead">Start fresh</h4>
      <p className="lead">
        Reset your hotkeys, window behavior, and theme back to the defaults and run first-time setup again.
        Your notes are never touched.
      </p>
      <button
        type="button"
        className={confirmReset ? "ghostbtn danger" : "ghostbtn"}
        onClick={() => {
          if (!confirmReset) {
            setConfirmReset(true);
            return;
          }
          void resetAndReonboard().then(() => setSettingsOpen(false));
        }}
        onBlur={() => setConfirmReset(false)}
      >
        {confirmReset ? "Click again to reset & re-onboard" : "Reset & re-onboard…"}
      </button>
    </>
  );
}

// ——— Appearance: four intentional working environments. ———

const THEME_CAPTIONS: Record<string, string> = {
  "Warm Light": "The rotli default — paper under lamplight.",
  "Warm Dark": "Cocoa dark, never clinical.",
  Paper: "Simple white & black.",
  Charcoal: "The SM-suite dark.",
};

const THEME_SWATCH: Record<string, string> = {
  "Warm Light": "var(--swatch-warm-light)",
  "Warm Dark": "var(--swatch-warm-dark)",
  Paper: "var(--swatch-paper)",
  Charcoal: "var(--swatch-charcoal)",
};

/** Dock/app icon options — the quokka re-tiled in a few palettes. "default" is
 * the shipped icon; colors live in themes.css (the appicon-tile-- classes). */
const APP_ICONS: { id: AppIcon; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "paper", label: "Paper" },
  { id: "charcoal", label: "Charcoal" },
  { id: "clay", label: "Clay" },
];

/** The primary-color swatch row — shared by Appearance and onboarding's theme
 * step (Seth, 2026-07-28: "charcoal theme with blue primary color"). Default
 * renders as the current theme's own accent. */
export function AccentRow() {
  const accentColor = useUiStore((s) => s.accentColor);
  const setAccentColor = useUiStore((s) => s.setAccentColor);
  return (
    <div className="accentrow" role="radiogroup" aria-label="Primary color">
      {ACCENT_COLORS.map((accent) => (
        <button
          type="button"
          key={accent}
          role="radio"
          aria-checked={accentColor === accent}
          className={accentColor === accent ? "accentdot sel" : "accentdot"}
          title={accent === "default" ? "Theme default" : accent[0]?.toUpperCase() + accent.slice(1)}
          aria-label={accent === "default" ? "Theme default" : accent}
          style={
            accent === "default"
              ? { background: "var(--accent)" }
              : { background: `var(--accent-swatch-${accent})` }
          }
          onClick={() => setAccentColor(accent)}
        >
          {accent === "default" && <span className="accentdot-auto">A</span>}
        </button>
      ))}
    </div>
  );
}

function AppearancePane() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const setThemeFamily = useUiStore((s) => s.setThemeFamily);
  const matchLightFamily = useUiStore((s) => s.matchLightFamily);
  const setMatchLightFamily = useUiStore((s) => s.setMatchLightFamily);
  const matchDarkFamily = useUiStore((s) => s.matchDarkFamily);
  const setMatchDarkFamily = useUiStore((s) => s.setMatchDarkFamily);
  const syntaxPalette = useUiStore((s) => s.syntaxPalette);
  const setSyntaxPalette = useUiStore((s) => s.setSyntaxPalette);
  const appIcon = useUiStore((s) => s.appIcon);
  const setAppIconState = useUiStore((s) => s.setAppIcon);
  const followingSystem = theme === "system";
  return (
    <>
      <PaneHead title="Appearance" char="board" />
      <p className="lead">Pick a theme. The titlebar sun cycles through these four.</p>
      <div className="famrow">
        {SOLID_THEMES.map(({ family, mode, label }) => {
          const selected = themeFamily === family && theme === mode;
          return (
            <button
              type="button"
              key={label}
              className={selected ? "famcard sel" : "famcard"}
              aria-pressed={selected}
              onClick={() => {
                setThemeFamily(family);
                setTheme(mode);
              }}
            >
              <span className="famswatch" style={{ background: THEME_SWATCH[label] }} aria-hidden="true" />
              <span className="famlabel">{label}</span>
              <span className="famcaption">{THEME_CAPTIONS[label]}</span>
            </button>
          );
        })}
      </div>
      <Toggle
        on={followingSystem}
        title="Match the system"
        desc="Follow macOS light / dark automatically."
        onChange={() => setTheme(followingSystem ? (prefersDark() ? "dark" : "light") : "system")}
      />
      {followingSystem && (
        <div className="matchpick">
          <div className="mprow">
            <span className="mplabel">When light</span>
            <Seg
              value={matchLightFamily}
              options={[
                ["warm", "Warm Light"],
                ["mono", "Paper"],
              ]}
              onPick={setMatchLightFamily}
            />
          </div>
          <div className="mprow">
            <span className="mplabel">When dark</span>
            <Seg
              value={matchDarkFamily}
              options={[
                ["warm", "Warm Dark"],
                ["mono", "Charcoal"],
              ]}
              onPick={setMatchDarkFamily}
            />
          </div>
        </div>
      )}

      <h4 className="sethead">Primary color</h4>
      <p className="lead">
        The active state, folder color, and selection wash. Default keeps each theme’s own — or pick one that
        follows you across themes.
      </p>
      <AccentRow />

      <h4 className="sethead">Markdown source</h4>
      <p className="lead">Choose the syntax colors used in Raw Markdown. This never changes the file.</p>
      <Seg
        value={syntaxPalette}
        options={[
          ["rotli", "Rotli"],
          ["mono", "Monochrome"],
        ]}
        onPick={setSyntaxPalette}
      />

      <h4 className="sethead">App icon</h4>
      <p className="lead">
        Pick the Dock icon — it shows when <b>Show in the Dock</b> is on.
      </p>
      <div className="appicon-row" role="radiogroup" aria-label="App icon">
        {APP_ICONS.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            className={appIcon === id ? "appicon sel" : "appicon"}
            aria-pressed={appIcon === id}
            onClick={() => {
              setAppIconState(id);
              void setAppIcon(id);
            }}
          >
            <span className={`appicon-tile appicon-tile--${id}`}>
              <QuokkaMark size={26} />
            </span>
            <span className="appicon-label">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ——— Storage: where the corpus lives + how to move it. The structure dump
//     (file tree + a sample .md) is gone — the sidebar already IS the tree
//     (Seth, 2026-06-15). What's left is the path, the storage options, and a
//     way to relocate the whole folder. ———

/** One brain card — the active write target or a connected "other brain". Shows
 * perms, and (per the handlers passed) Make active / Check brain / Forget. */
function BrainCard({
  inst,
  isActive,
  isCorpus,
  busy,
  lastValidate,
  onMakeActive,
  onUseAsFolder,
  onPerms,
  onValidate,
  onForget,
}: {
  inst: MemexInstance;
  isActive: boolean;
  isCorpus: boolean;
  busy: boolean;
  lastValidate: MemexValidateReport | null;
  onMakeActive?: (() => void) | undefined;
  onUseAsFolder?: (() => void) | undefined;
  onPerms: (p: Perms) => void;
  onValidate: () => void;
  onForget?: (() => void) | undefined;
}) {
  return (
    <div className={isActive ? "memex-card sel" : "memex-card"}>
      <div className="mc-body">
        <div className="mc-title">
          {inst.label}
          <span className={inst.perms === "chats+inbox" ? "memex-badge write" : "memex-badge"}>
            {inst.perms === "chats+inbox" ? "chats + inbox" : "read-only"}
          </span>
          {isCorpus && <span className="memex-badge">this folder</span>}
          {inst.mode && <span className="memex-badge">{inst.mode}</span>}
          {!inst.brainEnabled && <span className="memex-badge">raw</span>}
        </div>
        <div className="mc-path">{inst.root}</div>
        <div className="mc-meta">{inst.memexId?.slice(0, 14) ?? "—"}</div>
        <Seg
          value={inst.perms}
          options={[
            ["chats+inbox", "Chats + inbox"],
            ["read-only", "Read-only"],
          ]}
          onPick={onPerms}
        />
        <div className="memex-actions">
          {onUseAsFolder && (
            <button type="button" className="ghostbtn" disabled={busy} onClick={onUseAsFolder}>
              Use as notes folder
            </button>
          )}
          {onMakeActive && (
            <button type="button" className="ghostbtn" disabled={busy} onClick={onMakeActive}>
              Make active
            </button>
          )}
          <button type="button" className="ghostbtn" disabled={busy} onClick={onValidate}>
            Check the library
          </button>
          {onForget && (
            <button type="button" className="ghostbtn" disabled={busy} onClick={onForget}>
              Forget
            </button>
          )}
        </div>
        {lastValidate && (
          <div className="memex-validate">
            {lastValidate.skipped
              ? lastValidate.stdout
              : `${lastValidate.ok ? "✓ invariants pass" : "✗ errors"} — ${lastValidate.errors} error(s), ${lastValidate.warnings} warning(s)`}
          </div>
        )}
      </div>
      {isActive && (
        <span className="mc-active">
          <CheckGlyph size={12} />
        </span>
      )}
    </div>
  );
}

function LocationPane() {
  const isDev = import.meta.env.DEV;
  const real = useQuery({
    queryKey: ["corpus", "overview"],
    queryFn: corpusOverview,
    enabled: isTauri(),
  });
  const cfg = useMemexConfig();
  const detect = useDetectMemex(isTauri());
  const chooseMut = useChooseFolder();
  const connectBrainMut = useConnectBrain();
  const forgetMut = useForgetBrain();
  const setActiveMut = useSetActiveMemex();
  const permsMut = useSetMemexPerms();
  const validateMut = useRunValidate();
  // validate result keyed by instance id — so checking an Other brain shows on ITS
  // card, never misattributed under "Your brain".
  const [validation, setValidation] = useState<{ id: string; report: MemexValidateReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const storageGrouping = useUiStore((s) => s.storageGrouping);
  const setStorageGrouping = useUiStore((s) => s.setStorageGrouping);

  const rootPath = real.data?.root ?? "~/Documents/rotli";
  const instances = cfg.data?.instances ?? [];
  const activeId = cfg.data?.activeId ?? null;
  const active = instances.find((i) => i.id === activeId) ?? null;
  const corpusIsBrain = active?.id === CORPUS_INSTANCE_ID;
  // linked libraries = connected memexes (NOT the corpus-as-memex, which is just
  // "your notes folder"). Per the model: the corpus IS your brain; a SECOND memex
  // you reference is a "linked library."
  const linkedLibraries = instances.filter((i) => i.id !== CORPUS_INSTANCE_ID);
  const registered = new Set(instances.map((i) => i.root));
  const candidates = (detect.data ?? []).filter((d) => !registered.has(d.root));

  const run = (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    fn()
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (!isTauri()) {
    return (
      <>
        <PaneHead title="Location" char="local" />
        <p className="lead">
          Your notes folder lives on disk — this connects in the app, not the browser preview.
        </p>
      </>
    );
  }

  return (
    <>
      <PaneHead title="Location" char="local" />
      <p className="lead">
        Your notes are plain Markdown files in <b>one folder</b> on this Mac — and that folder can be your{" "}
        <b>brain</b> (a memex): notes, chats, and knowledge together, kept tidy by AI but always yours to
        arrange. rotli never holds your notes hostage.
      </p>

      {/* —— the one folder —— */}
      <h4 className="sethead">{isDev ? "Production memex" : "Your notes folder"}</h4>
      {!isDev && (
        <div className="store-grid">
          <div className="store sel">
            <div className="on">
              <CheckGlyph size={10} />
            </div>
            <div className="sn">
              <LaptopGlyph size={15} />
              This Mac
            </div>
            <div className="sd">Plain files, works offline, free forever.</div>
          </div>
          <div className="store later">
            <span className="soon">Later</span>
            <div className="sn">
              <CloudGlyph size={15} />
              Your cloud
            </div>
            <div className="sd">iCloud · Google · OneDrive · Proton · WebDAV/NAS</div>
          </div>
        </div>
      )}
      <div className="locrow">
        <div className="loctext">
          <span className="loclabel">{isDev ? "Source" : "Notes folder"}</span>
          <code className="locpath">{rootPath}</code>
          {isDev ? (
            <span className="memex-badge ro">read-only in dev</span>
          ) : (
            corpusIsBrain && <span className="memex-badge write">memex</span>
          )}
          {active && !active.brainEnabled && <span className="memex-badge">raw</span>}
        </div>
        <div className="locact">
          <button type="button" className="ghostbtn" onClick={() => void revealCorpus()}>
            Reveal in Finder
          </button>
          {!isDev && (
            <button
              type="button"
              className="ghostbtn"
              onClick={() => run(() => chooseMut.mutateAsync(undefined))}
              disabled={busy}
            >
              Choose folder…
            </button>
          )}
        </div>
      </div>
      {isDev && (
        <p className="setnote">
          This is the same memex used by production Rotli. Development reads it directly, but cannot change
          notes, chats, inbox, boards, metadata, permissions, or its <code>.rotli/</code> sidecar.
          Development-only appearance and window state stay in the app cache.
        </p>
      )}

      {/* —— Storage organization (Seth, 2026-06-30) —— */}
      <h4 className="sethead">Assets</h4>
      <div className="mprow">
        <span className="mplabel">Organize Storage by</span>
        <Seg
          value={storageGrouping}
          options={[
            ["type", "Type"],
            ["date", "Date"],
            ["folder", "Folder"],
          ]}
          onPick={setStorageGrouping}
        />
      </div>
      <p className="setnote">
        Your files (audio · images · PDFs · …) group this way under the <b>Assets</b> section.
      </p>

      {!isDev && (
        <p className="setnote">
          <b>Choose folder…</b> takes a memex (rotli uses it as your notes folder), an empty folder (your
          notes move there), or any folder (used as-is). The hidden <code>.rotli/</code> is just an index —
          deleting it loses nothing but a rebuild.
        </p>
      )}

      {/* —— linked libraries: a SECOND memex you reference (advanced) —— */}
      {!isDev && (
        <>
          <h4 className="sethead">Linked libraries</h4>
          <p className="lead">
            A <b>linked library</b> is a <em>second</em> memex you reference alongside your notes — a shared
            or team brain, a reference vault. <b>Most people never need one</b> (your notes folder is already
            your memex). rotli reads the whole library and, per its perms, writes only <b>chats</b>,{" "}
            <b>inbox</b>, and new notes; it never touches its history or identity, and its curated wiki is
            read-only.
          </p>
          {candidates.length > 0 && (
            <>
              <h5 className="sethead">Found on this Mac</h5>
              {candidates.map((d) => (
                <div className="memex-card" key={d.root}>
                  <div className="mc-body">
                    <div className="mc-title">{d.label}</div>
                    <div className="mc-path">{d.root}</div>
                    <div className="mc-meta">
                      contract {d.contract ?? "?"} · {d.memexId?.slice(0, 12) ?? "no id"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ghostbtn"
                    disabled={busy}
                    onClick={() => run(() => connectBrainMut.mutateAsync(d.root))}
                  >
                    Link
                  </button>
                </div>
              ))}
            </>
          )}
          {linkedLibraries.length === 0 ? (
            <p className="setnote">
              No linked libraries. Link one only if you want a second, shared memex — otherwise your notes
              folder is all you need.
            </p>
          ) : (
            linkedLibraries.map((inst) => (
              <BrainCard
                key={inst.id}
                inst={inst}
                isActive={inst.id === activeId}
                isCorpus={false}
                busy={busy}
                lastValidate={validation?.id === inst.id ? validation.report : null}
                onMakeActive={
                  inst.id === activeId ? undefined : () => run(() => setActiveMut.mutateAsync(inst.id))
                }
                onUseAsFolder={() => run(() => chooseMut.mutateAsync(inst.root))}
                onPerms={(p) => run(() => permsMut.mutateAsync({ id: inst.id, perms: p }))}
                onValidate={() =>
                  run(() =>
                    validateMut.mutateAsync(inst).then((r) => setValidation({ id: inst.id, report: r })),
                  )
                }
                onForget={() => run(() => forgetMut.mutateAsync(inst.id))}
              />
            ))
          )}
          <div className="memex-actions">
            <button
              type="button"
              className="ghostbtn"
              disabled={busy}
              onClick={() => run(() => connectBrainMut.mutateAsync(undefined))}
            >
              Link a library…
            </button>
            {/* moved here from the sidebar's System section (2026-07-26) —
                browse + edit a plain folder in place, never moved into the vault */}
            <button
              type="button"
              className="ghostbtn"
              disabled={busy}
              onClick={() => run(() => corpusAddFolder())}
            >
              Add a folder…
            </button>
          </div>
        </>
      )}
      {err && <p className="setnote err">{err}</p>}
    </>
  );
}

// ——— Brain: the organizer daemon's trust ladder (design §4.3). Minimal by
// design — Phase 4 ships the 4-level radio + the reassurance copy; capability
// checkboxes, Pause, and Reset Brain are the Phase-5 control panel (§4.8). ———

/** What each rung lets the daemon auto-APPLY — proposals always flow to the
 * Librarian regardless (except Off, which is fully dormant). Tidy vs Organize
 * (Seth, 2026-07-31 — "they look the same"): the ONLY difference today is the
 * per-area overview page — Tidy proposes its refresh, Organize applies it. */
const TRUST_CAPTIONS: Record<OrganizerTrust, string> = {
  off: "Dormant — it does nothing at all.",
  suggest: "Nothing happens by itself. Every change waits in the Librarian for your approval.",
  tidy: "Files new captures and fills in metadata by itself. Each area's overview page still waits for your OK — that's the one thing Organize adds.",
  organize:
    "Everything Tidy does, plus it keeps each area's overview page fresh on its own (the default) — all journaled, all undoable. Metadata suggestions never pile up: leftovers apply themselves.",
};

function BrainPane() {
  const brainOn = useUiStore((s) => s.brainEnabled);
  const setBrainEnabled = useUiStore((s) => s.setBrainEnabled);
  const trust = useUiStore((s) => s.organizerTrust);
  const setTrust = useUiStore((s) => s.setOrganizerTrust);
  const model = useUiStore((s) => s.organizerModel);
  const setModel = useUiStore((s) => s.setOrganizerModel);
  const quiet = useUiStore((s) => s.organizerQuietSecs);
  const setQuiet = useUiStore((s) => s.setOrganizerQuietSecs);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // the Run-now nudge — a quiet inline note instead of an error toast. The
  // note never claims a live state it can't see ("Running a pass…" showed
  // forever — #85, audit 2026-07); errors get the err class other panes use.
  const [ranNote, setRanNote] = useState<{ text: string; err: boolean } | null>(null);
  // the master switch (vault-vs-brain, 2026-07-26). Turning it OFF makes this
  // a RAW vault: the organizer never acts, nothing files or enriches — and
  // nothing moves; existing areas and metadata stay exactly as they are.
  // Turning it back ON resumes at Suggest (never auto-apply on re-entry).
  const toggleBrain = () => {
    if (brainOn) {
      setBrainEnabled(false);
      // the LIVE off signal (pressure-test 2026-07-26): stop an in-flight
      // cycle now — the debounced settings write alone left minutes of
      // modeling after the user's raw choice
      organizerSetBrain(false).catch(() => {});
      return;
    }
    setBrainEnabled(true);
    setTrust("suggest");
    organizerSetTrust("suggest").catch(() => {});
    // the live on signal owes the daemon a sweep — it resumes on the normal
    // gates (idle, plugged in), gently, at Suggest
    organizerSetBrain(true).catch(() => {});
  };
  return (
    <>
      <PaneHead title="The Librarian" char="knowledge" />
      <p className="lead">
        Your vault is just a folder of plain files — complete without any AI. The <b>Librarian</b> is the
        optional caretaker on top: a quiet helper that files your notes into the Library&rsquo;s areas and
        fills in their metadata (area, tags, a one-line summary). It only ever changes{" "}
        <b>where a note lives</b> and its <b>metadata</b> — the words inside your notes are never touched, and
        everything it does is logged in Librarian Activity, undoable.
      </p>
      <Toggle
        on={brainOn}
        onChange={toggleBrain}
        title={brainOn ? "The Librarian is in" : "This is a raw vault"}
        desc={
          brainOn
            ? "The Librarian keeps this vault organized. Turn it off and nothing files, tags, or summarizes — your files stay exactly where they are."
            : "No AI touches this vault. Your existing areas and metadata stayed exactly as they were. Inviting the Librarian back is gentle — it suggests, you approve."
        }
      />
      {!brainOn && (
        <p className="setnote">
          Security never turns off: secure notes stay protected, the secret detector still runs, and the
          Activity pane still offers its secure-note repairs.
        </p>
      )}
      {brainOn && (
        <>
          <span className="mplabel">How much it may do</span>
          <Seg
            value={trust}
            options={[
              ["off", "Off"],
              ["suggest", "Suggest"],
              ["tidy", "Tidy"],
              ["organize", "Organize"],
            ]}
            onPick={(v) => {
              // store first (persists via settings.json — the daemon's backstop),
              // then nudge the in-memory rung so the flip is immediate
              setTrust(v);
              organizerSetTrust(v).catch(() => {});
            }}
          />
          <p className="setnote">{TRUST_CAPTIONS[trust]}</p>
          <p className="setnote">
            It always skips: <b>locked notes</b> (lock a note in its metadata panel and the organizer
            won&rsquo;t touch it at all — not even its metadata) · <b>secure notes</b> · your hand-arranged{" "}
            <b>Main</b>.
          </p>
          <span className="mplabel">Organizing model</span>
          <Seg
            value={model}
            options={[
              ["local", "On this Mac"],
              ["claude", "Claude Sonnet 5"],
              ["gemini35", "Gemini 3.5 Flash"],
            ]}
            onPick={(m) => setModel(m)}
          />
          <p className="setnote">
            {model === "claude" ? (
              <>
                <b>Claude Sonnet 5</b> (via <code>claude -p</code>) does the organizing — your{" "}
                <b>non-secure</b> notes are sent to Anthropic to file. <b>Secure</b> and <b>locked</b> notes
                are never sent anywhere.
              </>
            ) : model === "gemini35" ? (
              <>
                <b>Gemini 3.5 Flash</b> (through the authenticated Antigravity lane) organizes your{" "}
                <b>non-secure</b> notes. <b>Secure</b> and <b>locked</b> notes never enter a remote model.
              </>
            ) : (
              <>A local model on this Mac organizes — nothing ever leaves your machine.</>
            )}
          </p>
          <span className="mplabel">Wait before organizing</span>
          <Seg
            value={String(quiet)}
            options={[
              ["60", "1 min"],
              ["120", "2 min"],
              ["300", "5 min"],
              ["600", "10 min"],
              ["900", "15 min"],
            ]}
            onPick={(v) => setQuiet(Number(v))}
          />
          <p className="setnote">
            After you stop touching a note, the organizer waits this long before it scans it.
          </p>
          <p className="setnote">
            It waits for its moment: only when you&rsquo;re away, plugged in, and the machine is cool — never
            on battery, never over a chat. <b>Run now</b> does one pass immediately.
          </p>
          <button
            type="button"
            className="ghostbtn"
            disabled={trust === "off"}
            onClick={() => {
              organizerRunOnce()
                .then(() =>
                  setRanNote({
                    text: "Pass queued — what it finds lands in Librarian Activity.",
                    err: false,
                  }),
                )
                .catch((e) => setRanNote({ text: e instanceof Error ? e.message : String(e), err: true }));
            }}
          >
            Run now
          </button>{" "}
          <button
            type="button"
            className="ghostbtn"
            onClick={() => {
              // Activity is a pane in the notes surface — leave Settings to show it
              setSettingsOpen(false);
              usePanesStore.getState().openActivity();
            }}
          >
            View activity
          </button>
          {ranNote && <p className={ranNote.err ? "setnote err" : "setnote"}>{ranNote.text}</p>}
        </>
      )}
    </>
  );
}

// ——— AI Models (Seth, 2026-07-02): connected subscription lanes + hybrid presets ———

/** MB → a human size (the catalog's approx, and the live download total). */
function formatSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** An in-flight download: which model, its request id (for cancel), known size. */
interface Installing {
  requestId: string;
  name: string;
  label: string;
  approxMb?: number;
}

/** "On this Mac" — installed local models + the installer. Every installed model
 * is pickable per chat (the shared server swaps on demand, loads lazily, and
 * idle-unloads); "default" marks what no-model callers (Breve) get. */
function LocalModelsSection({ installed, onChanged }: { installed: ChatModelInfo[]; onChanged: () => void }) {
  const [installing, setInstalling] = useState<Installing | null>(null);
  const [repo, setRepo] = useState("");
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null);
  // "Scan my Mac" — chip + RAM + free disk, then fit badges on the picks
  const [scan, setScan] = useState<SystemProfile | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);

  // Poll the byte total while a download runs. Each tick walks a GB-scale dir,
  // so the interval exists ONLY for the life of an install: `enabled` is the
  // gate, and the key is the one Onboarding's starter install uses so the two
  // surfaces can never run two walks over the same dir (perf audit 2026-07-30,
  // finding 23). Nothing polls at rest.
  const progress = useQuery({
    queryKey: ["local-install", installing?.name],
    queryFn: () => (installing ? localModelInstallProgress(installing.name) : Promise.resolve(null)),
    enabled: !!installing,
    refetchInterval: 1000,
  });

  const installedNames = new Set(installed.map((m) => m.id));
  const picks = installableCatalog(installedNames);

  const startInstall = (repoId: string, name: string, label: string, approxMb?: number, vision?: boolean) => {
    if (installing) return;
    const requestId = crypto.randomUUID();
    setInstalling({ requestId, name, label, ...(approxMb ? { approxMb } : {}) });
    setNote(null);
    localModelInstall({
      requestId,
      repo: repoId,
      name,
      ...(approxMb ? { approxMb } : {}),
      ...(vision ? { vision } : {}),
    })
      .then(() => {
        setNote({ text: `${label} installed.`, err: false });
        onChanged();
      })
      .catch((e) => setNote({ text: e instanceof Error ? e.message : String(e), err: true }))
      .finally(() => setInstalling(null));
  };

  const installPick = (e: LocalCatalogEntry) => startInstall(e.repo, e.name, e.label, e.approxMb, e.vision);

  const installRepo = () => {
    const r = repo.trim();
    if (!isValidRepo(r)) {
      setNote({ text: "That isn't a Hugging Face repo id (owner/name).", err: true });
      return;
    }
    const name = nameFromRepo(r);
    if (installedNames.has(name)) {
      setNote({ text: `${name} is already installed.`, err: true });
      return;
    }
    setRepo("");
    startInstall(r, name, r);
  };

  const makeDefault = (id: string) => {
    localModelSetDefault(id)
      .then(() => {
        setNote({ text: "Default updated — the local server is switching over.", err: false });
        onChanged();
      })
      .catch((e) => setNote({ text: e instanceof Error ? e.message : String(e), err: true }));
  };
  const uninstall = (id: string) => {
    localModelUninstall(id)
      .then(() => {
        setNote({ text: "Removed.", err: false });
        onChanged();
      })
      .catch((e) => setNote({ text: e instanceof Error ? e.message : String(e), err: true }));
  };

  const bytes = progress.data?.bytes ?? 0;
  const pct =
    installing?.approxMb && installing.approxMb > 0
      ? Math.min(99, Math.round((bytes / (installing.approxMb * 1_000_000)) * 100))
      : null;

  const fitClass = (mb: number) =>
    !scan
      ? ""
      : {
          "great fit": "fit good",
          workable: "fit warn",
          "too big": "fit bad",
        }[fitLabel(mb, scan.ramGb)];

  return (
    <section className="aisection">
      <h4 className="set-subhead">On this Mac</h4>
      <p className="setnote">
        Models that run entirely on your Mac. Pick any of them per chat — a model loads when asked and unloads
        after a few idle minutes, so nothing runs around the clock. The
        <b> default</b> is what your other memex apps (like Breve) use.
      </p>

      <div className="aiscan-row">
        <button
          type="button"
          className="ghostbtn"
          onClick={() => {
            setScanErr(null);
            systemProfile()
              .then(setScan)
              .catch((e) => setScanErr(e instanceof Error ? e.message : String(e)));
          }}
        >
          Scan my Mac
        </button>
        {scan && (
          <span className="aiscan-fact">
            {scan.chip} · {Math.round(scan.ramGb)} GB memory · {Math.round(scan.freeDiskGb)} GB free
          </span>
        )}
      </div>
      {scan && (
        <p className="setnote">This Mac {scanVerdict(scan.ramGb)} The picks below are badged accordingly.</p>
      )}
      {scanErr && <p className="setnote err">{scanErr}</p>}
      {installed.length > 0 && (
        <div className="localmodel-list">
          {installed.map((m) => {
            const isDefault = m.localDefault === true;
            return (
              <div className="localmodel-row" key={m.id}>
                <span className="localmodel-name">{m.label}</span>
                {isDefault ? (
                  <span className="localmodel-active">default</span>
                ) : (
                  m.provider === "mlx" && (
                    <button type="button" className="ghostbtn primary" onClick={() => makeDefault(m.id)}>
                      Make default
                    </button>
                  )
                )}
                {!isDefault && (
                  <button type="button" className="ghostbtn quiet" onClick={() => uninstall(m.id)}>
                    Uninstall
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {installing ? (
        <div className="localmodel-progress">
          <div className="localmodel-prog-head">
            <span>Downloading {installing.label}…</span>
            <span>{pct !== null ? `${pct}%` : formatSize(Math.round(bytes / 1_000_000))}</span>
          </div>
          <div className="localmodel-track">
            <div className="localmodel-fill" style={{ width: pct !== null ? `${pct}%` : "40%" }} />
          </div>
          <button
            type="button"
            className="ghostbtn"
            onClick={() => {
              localModelInstallCancel(installing.requestId).catch(() => {});
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          {picks.length > 0 && (
            <div className="localmodel-list">
              {picks.map((e) => (
                <div className="localmodel-row" key={e.name}>
                  <span className="localmodel-name">{e.label}</span>
                  {scan && <span className={fitClass(e.approxMb)}>{fitLabel(e.approxMb, scan.ramGb)}</span>}
                  <span className="localmodel-size">
                    {formatSize(e.approxMb)}
                    {e.vision ? " · 👁" : ""}
                  </span>
                  <button type="button" className="ghostbtn primary" onClick={() => installPick(e)}>
                    Install
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="aikey">
            <input
              className="aikey-input"
              placeholder="Advanced: paste a Hugging Face repo id (e.g. mlx-community/…)"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="button" className="ghostbtn primary" disabled={!repo.trim()} onClick={installRepo}>
              Install
            </button>
          </div>
        </>
      )}
      {note && <p className={note.err ? "setnote err" : "setnote"}>{note.text}</p>}
    </section>
  );
}

const PROVIDER_DESC: Record<ProviderId, string> = {
  claude: "Claude Code CLI — rides your Claude Pro/Max subscription.",
  codex: "Codex CLI — rides your ChatGPT subscription.",
  agy: "Antigravity CLI — Gemini through the Google account signed in to agy.",
  gemini: "Advanced Gemini API lane — bring your own API key (stored in the macOS Keychain).",
};

/** How to get a lane working when it isn't installed / signed in. */
const LANE_SETUP: Record<ProviderId, string[]> = {
  claude: [
    "Install Claude Code — claude.com/claude-code (installer or `npm i -g @anthropic-ai/claude-code`).",
    "Run `claude` in Terminal once and sign in with your Claude account (Pro or Max).",
    "Come back here — the status flips to ready on its own.",
  ],
  codex: [
    "Install the Codex CLI: `brew install codex`.",
    "Run `codex login` and sign in with your ChatGPT account.",
    "Come back here — the status flips to ready on its own.",
  ],
  agy: [
    "Install Google's Antigravity CLI (antigravity.google).",
    "Run `agy` once and sign in with your Google account (Google AI Pro/Ultra).",
    "Come back here — the status flips to ready on its own.",
  ],
  gemini: [
    "Create a free API key at aistudio.google.com/apikey.",
    "Paste it below — it's stored in the macOS Keychain, never in a file.",
  ],
};

/** A bare switch (the Toggle row's knob, without the full-width row). */
function LaneSwitch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? "ailane-sw on" : "ailane-sw"}
      onClick={onToggle}
    >
      <SwitchKnob />
    </button>
  );
}

type VerifyState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ms: number; model: string }
  | { state: "fail"; error: string };

/** One connected lane: toggle (validates in the background on enable), live
 * status, a Test button, setup instructions when it isn't ready, and per-model
 * pills — a lane can keep Sonnet but block Opus. */
function LaneCard({ id }: { id: ProviderId }) {
  const enabled = useUiStore((s) => s.aiProviders[id]);
  const setAiProvider = useUiStore((s) => s.setAiProvider);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const toggleBlockedModel = useUiStore((s) => s.toggleBlockedModel);
  const [help, setHelp] = useState(false);
  const [verify, setVerify] = useState<VerifyState>({ state: "idle" });

  const det = useQuery({
    queryKey: ["cli-detect", id],
    queryFn: () => cliDetect(id),
    enabled: isTauri(),
    staleTime: 60_000,
  });
  const d = det.data;
  const ready = !!d && d.installed && d.authenticated;
  // "2.1.199 (Claude Code)" / "codex-cli 0.137.0" → "v2.1.199" / "v0.137.0"
  const version = d?.version?.match(/\d+(?:\.\d+)+/)?.[0];
  const status = !isTauri()
    ? "app only"
    : !d
      ? "checking…"
      : !d.installed
        ? "not installed"
        : !d.authenticated
          ? id === "gemini"
            ? "no key yet"
            : "not signed in"
          : `ready${version ? ` · v${version}` : ""}`;

  const runVerify = () => {
    setVerify({ state: "running" });
    verifyLane(id)
      .then((r) =>
        setVerify(
          r.ok ? { state: "ok", ms: r.ms, model: r.model } : { state: "fail", error: r.error ?? "failed" },
        ),
      )
      .catch((e: unknown) => setVerify({ state: "fail", error: e instanceof Error ? e.message : "failed" }));
  };

  const onToggle = () => {
    const next = !enabled;
    setAiProvider(id, next);
    // the honest check: turning a working lane on runs ONE real (tiny) reply
    // in the background — detection alone only proves a binary + a credential
    if (next && ready) runVerify();
    if (!next) setVerify({ state: "idle" });
  };

  return (
    <div className={enabled ? "ailane on" : "ailane"}>
      <div className="ailane-head">
        <span className="ailane-name">{PROVIDER_LABELS[id]}</span>
        <span className={ready ? "ailane-chip ok" : "ailane-chip"}>{status}</span>
        <span className="chat-box-grow" />
        <LaneSwitch on={enabled} onToggle={onToggle} label={`Use ${PROVIDER_LABELS[id]}`} />
      </div>
      <p className="ailane-desc">{PROVIDER_DESC[id]}</p>

      {id === "gemini" && enabled && <GeminiKeyRow onSaved={runVerify} />}

      {!ready && (
        <div className="ailane-help">
          <button type="button" className="ailane-helptoggle" onClick={() => setHelp((v) => !v)}>
            {help ? "▾" : "▸"} How to set this up
          </button>
          {help && (
            <ol className="ailane-steps">
              {LANE_SETUP[id].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {enabled && ready && (
        <>
          <div className="ailane-verify">
            <button
              type="button"
              className="ghostbtn"
              disabled={verify.state === "running"}
              onClick={runVerify}
            >
              {verify.state === "running" ? "Testing…" : "Test connection"}
            </button>
            {verify.state === "ok" && (
              <span className="ailane-chip ok">
                working ✓ · {verify.model} · {(verify.ms / 1000).toFixed(1)}s
              </span>
            )}
            {verify.state === "fail" && <span className="ailane-chip err">{verify.error}</span>}
          </div>
          <div className="ailane-models">
            <span className="ailane-modelslabel">Models — click one to hide it from the picker:</span>
            {CLI_CATALOG[id].map((m) => {
              const off = blockedModels.includes(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  className={off ? "ailane-model off" : "ailane-model"}
                  aria-pressed={!off}
                  title={off ? "Hidden — click to bring it back" : "In the picker — click to hide"}
                  onClick={() => toggleBlockedModel(m.id)}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** The Gemini key editor — the value goes straight to the Keychain and never
 * comes back out; the row only knows whether one is saved. */
function GeminiKeyRow({ onSaved }: { onSaved?: () => void }) {
  const [val, setVal] = useState("");
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null);
  const saved = useQuery({
    queryKey: ["secret", SECRET_GEMINI_API_KEY],
    queryFn: () => secretExists(SECRET_GEMINI_API_KEY),
    enabled: isTauri(),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["secret", SECRET_GEMINI_API_KEY] });
    void queryClient.invalidateQueries({ queryKey: ["cli-detect", "gemini"] });
  };
  return (
    <div className="aikey">
      <input
        type="password"
        className="aikey-input"
        placeholder={saved.data ? "Key saved — paste a new one to replace it" : "Gemini API key…"}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="ghostbtn primary"
        disabled={!val.trim()}
        onClick={() => {
          secretStore(SECRET_GEMINI_API_KEY, val.trim())
            .then(() => {
              setVal("");
              setNote({ text: "Key saved to the Keychain.", err: false });
              refresh();
              onSaved?.();
            })
            .catch((e) => setNote({ text: e instanceof Error ? e.message : String(e), err: true }));
        }}
      >
        Save key
      </button>
      {saved.data && (
        <button
          type="button"
          className="ghostbtn quiet"
          onClick={() => {
            secretDelete(SECRET_GEMINI_API_KEY)
              .then(() => {
                setNote({ text: "Key removed.", err: false });
                refresh();
              })
              .catch((e) => setNote({ text: e instanceof Error ? e.message : String(e), err: true }));
          }}
        >
          Remove
        </button>
      )}
      {note && <p className={note.err ? "setnote err" : "setnote"}>{note.text}</p>}
    </div>
  );
}

/** One preset's editor — plain controlled fields over a draft copy. */
function PresetEditor({
  draft,
  models,
  onSave,
  onCancel,
}: {
  draft: HybridPreset;
  models: ChatModelInfo[];
  onSave: (p: HybridPreset) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<HybridPreset>(draft);
  const modelOpts = models.map((m) => (
    <option key={m.id} value={m.id}>
      {m.label}
    </option>
  ));
  const setRoute = (i: number, patch: Partial<{ when: string; model: string }>) =>
    setP((prev) => ({
      ...prev,
      routes: prev.routes.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  const valid = p.name.trim() && p.routes.length > 0 && p.routes.every((r) => r.model);
  return (
    <div className="preset-editor">
      <input
        className="aikey-input"
        placeholder="Preset name…"
        value={p.name}
        onChange={(e) => setP((prev) => ({ ...prev, name: e.target.value }))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <label className="preset-field">
        <span>Organizer (routes each message)</span>
        <select
          value={p.organizer}
          onChange={(e) => setP((prev) => ({ ...prev, organizer: e.target.value }))}
        >
          {modelOpts}
        </select>
      </label>
      {p.routes.map((r, i) => (
        // routes are positional (no stable id) — index keys are correct here
        <div className="preset-route" key={i}>
          <input
            className="aikey-input"
            placeholder={`When… (e.g. "quick lookups")`}
            value={r.when}
            onChange={(e) => setRoute(i, { when: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <select value={r.model} onChange={(e) => setRoute(i, { model: e.target.value })}>
            {modelOpts}
          </select>
          <button
            type="button"
            className="ghostbtn"
            disabled={p.routes.length <= 1}
            onClick={() => setP((prev) => ({ ...prev, routes: prev.routes.filter((_, j) => j !== i) }))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="preset-actions">
        <button
          type="button"
          className="ghostbtn"
          onClick={() =>
            setP((prev) => ({
              ...prev,
              routes: [...prev.routes, { when: "", model: models[0]?.id ?? "" }],
            }))
          }
        >
          + Route
        </button>
        <label className="preset-field preset-fallback">
          <span>Fallback</span>
          <select
            value={p.fallback ?? ""}
            onChange={(e) =>
              setP((prev) => {
                const { fallback: _gone, ...rest } = prev;
                return e.target.value ? { ...rest, fallback: e.target.value } : rest;
              })
            }
          >
            <option value="">(none)</option>
            {modelOpts}
          </select>
        </label>
      </div>
      <div className="preset-actions">
        <button type="button" className="ghostbtn primary" disabled={!valid} onClick={() => onSave(p)}>
          Save preset
        </button>
        <button type="button" className="ghostbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ModelsPane() {
  const aiProviders = useUiStore((s) => s.aiProviders);
  const hybridPresets = useUiStore((s) => s.hybridPresets);
  const setHybridPresets = useUiStore((s) => s.setHybridPresets);
  const imageEngine = useUiStore((s) => s.imageEngine);
  const setImageEngine = useUiStore((s) => s.setImageEngine);
  const chatNoteOpen = useUiStore((s) => s.chatNoteOpen);
  const readAloud = useUiStore((s) => s.readAloud);
  const setReadAloud = useUiStore((s) => s.setReadAloud);
  const readAloudVoice = useUiStore((s) => s.readAloudVoice);
  const setReadAloudVoice = useUiStore((s) => s.setReadAloudVoice);
  const setChatNoteOpen = useUiStore((s) => s.setChatNoteOpen);

  const blockedModels = useUiStore((s) => s.blockedModels);
  const local = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  // every model a preset may reference: local + the ENABLED connected lanes,
  // minus anything blocked inside a lane. Memoized: this pane re-renders per
  // keystroke in the "what do you use it for" box, and the merge had no reason
  // to run again (perf audit 2026-07-30, finding 24).
  const available = useMemo(
    () => flattenModels(mergedModels(local.data ?? [], aiProviders, [], blockedModels)),
    [local.data, aiProviders, blockedModels],
  );

  const [draft, setDraft] = useState<HybridPreset | null>(null);
  const [usage, setUsage] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<HybridPreset[]>([]);
  const [genNote, setGenNote] = useState<{ text: string; err: boolean } | null>(null);

  const savePreset = (p: HybridPreset) => {
    const rest = hybridPresets.filter((x) => x.id !== p.id);
    setHybridPresets([...rest, p]);
    setDraft(null);
  };

  const generate = () => {
    const def = (local.data ?? []).find((m) => m.isDefault) ?? available[0];
    if (!def) {
      setGenNote({ text: "No model available to generate with yet.", err: true });
      return;
    }
    setSuggesting(true);
    setGenNote(null);
    suggestPresets(makeTauriHost(def), available, usage.trim() || "general note-taking and research")
      .then((out) => {
        setSuggestions(out);
        if (out.length === 0)
          setGenNote({ text: "The model returned nothing usable — try rewording.", err: true });
      })
      .catch((e) => setGenNote({ text: e instanceof Error ? e.message : String(e), err: true }))
      .finally(() => setSuggesting(false));
  };

  // human model names for the preset cards — "gemma-3-12b-it-qat-4bit · MLX"
  // reads as "gemma-3-12b" (Seth, 2026-07-02: the raw ids were unreadable)
  const pretty = (id: string) =>
    (available.find((x) => x.id === id)?.label ?? id)
      .replace(/ · (MLX|llama\.cpp)$/, "")
      .replace(/-(it-qat|instruct)-4bit$/i, "");

  const breakdown = (p: HybridPreset) => (
    <div className="preset-flow">
      <span className="preset-step">
        <em>{pretty(p.organizer)}</em> reads each message and picks the route:
      </span>
      {p.routes.map((r, i) => (
        // routes are positional — index keys are correct here
        <span className="preset-step" key={i}>
          → {r.when || "everything else"} · <b>{pretty(r.model)}</b>
        </span>
      ))}
      {p.fallback && (
        <span className="preset-step">
          ↩ if a route fails, <b>{pretty(p.fallback)}</b> takes over
        </span>
      )}
    </div>
  );

  return (
    <>
      <PaneHead title="AI Models" char="knowledge" />
      <p className="lead">
        Chat runs on your Mac by default. Install more on-device models below, or connect the subscriptions
        you already have — their models join the picker, and rotli drives the official CLI on this machine. A
        connected model runs remotely: the conversation leaves your Mac, secure notes never do.
      </p>

      <LocalModelsSection
        installed={local.data ?? []}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ["chat", "models"] })}
      />

      <section className="aisection">
        <h4 className="set-subhead">Connected models</h4>
        <p className="setnote">
          Turning a lane on runs one tiny test reply in the background — the honest &ldquo;it works&rdquo;.
          Inside a lane, click a model to block or allow it in the picker.
        </p>
        {PROVIDER_IDS.map((id) => (
          <LaneCard key={id} id={id} />
        ))}
      </section>

      <section className="aisection">
        <h4 className="set-subhead">Hybrid presets</h4>
        <p className="setnote">
          A preset lets one model ORGANIZE each message and route it to the model best suited — e.g. gemma
          routes, Gemini executes, Claude catches failures. Presets show up in the chat&rsquo;s model picker.
        </p>
        {STARTER_PRESETS.some((sp) => !hybridPresets.some((p) => p.id === sp.id)) && (
          <>
            <p className="setnote">Ready-made — add one and tweak it to taste:</p>
            <div className="preset-list">
              {STARTER_PRESETS.filter((sp) => !hybridPresets.some((p) => p.id === sp.id)).map((sp) => (
                <div className="preset-row" key={sp.id}>
                  <div className="preset-rowhead">
                    <span className="preset-name">{sp.name}</span>
                    <span className="chat-box-grow" />
                    <button
                      type="button"
                      className="ghostbtn primary"
                      onClick={() => setHybridPresets([...hybridPresets, sp])}
                    >
                      Add
                    </button>
                  </div>
                  {breakdown(sp)}
                </div>
              ))}
            </div>
          </>
        )}
        {hybridPresets.length > 0 && (
          <div className="preset-list">
            {hybridPresets.map((p) => (
              <div className="preset-row" key={p.id}>
                <div className="preset-rowhead">
                  <span className="preset-name">{p.name}</span>
                  <span className="chat-box-grow" />
                  <button type="button" className="ghostbtn" onClick={() => setDraft(p)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghostbtn quiet"
                    onClick={() => setHybridPresets(hybridPresets.filter((x) => x.id !== p.id))}
                  >
                    Delete
                  </button>
                </div>
                {breakdown(p)}
              </div>
            ))}
          </div>
        )}
        {draft ? (
          <PresetEditor
            draft={draft}
            models={available}
            onSave={savePreset}
            onCancel={() => setDraft(null)}
          />
        ) : (
          <button
            type="button"
            className="ghostbtn primary"
            disabled={available.length === 0}
            onClick={() =>
              setDraft({
                id: crypto.randomUUID(),
                name: "",
                organizer: (local.data ?? []).find((m) => m.isDefault)?.id ?? available[0]?.id ?? "",
                routes: [{ when: "", model: available[0]?.id ?? "" }],
              })
            }
          >
            New preset
          </button>
        )}

        <p className="setnote">Not sure where to start? Say what you mostly use chat for:</p>
        <div className="aikey">
          <input
            className="aikey-input"
            placeholder="e.g. research + summarizing my notes, some coding questions…"
            value={usage}
            onChange={(e) => setUsage(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="button" className="ghostbtn" disabled={suggesting} onClick={generate}>
            {suggesting ? "Generating…" : "Generate templates"}
          </button>
        </div>
        {genNote && <p className={genNote.err ? "setnote err" : "setnote"}>{genNote.text}</p>}
        {suggestions.length > 0 && (
          <div className="preset-list">
            {suggestions.map((p) => (
              <div className="preset-row" key={p.id}>
                <div className="preset-rowhead">
                  <span className="preset-name">{p.name}</span>
                  <span className="chat-box-grow" />
                  <button
                    type="button"
                    className="ghostbtn primary"
                    onClick={() => {
                      setHybridPresets([...hybridPresets, p]);
                      setSuggestions(suggestions.filter((x) => x.id !== p.id));
                    }}
                  >
                    Save
                  </button>
                </div>
                {breakdown(p)}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="aisection">
        <h4 className="set-subhead">Images in chat</h4>
        <p className="setnote">
          Which connected engine draws when a chat generates an image (saved into this chat&rsquo;s assets).
        </p>
        <Seg
          value={imageEngine}
          options={[
            ["codex", "Codex (gpt-image)"],
            ["agy", "Antigravity (Nano Banana)"],
          ]}
          onPick={setImageEngine}
        />
      </section>

      <section className="aisection">
        <h4 className="set-subhead">Chat &amp; its note</h4>
        <p className="setnote">Every chat carries a note. Opening it from the chat header:</p>
        <Seg
          value={chatNoteOpen}
          options={[
            ["tab", "Opens a new tab"],
            ["split", "Splits to the right"],
          ]}
          onPick={setChatNoteOpen}
        />
      </section>

      <section className="aisection">
        <h4 className="set-subhead">Voice</h4>
        <p className="setnote">
          Read replies aloud with a speaker button on each answer. The voice runs on this Mac and is prepared
          the first time you use it — nothing is downloaded until then, and nothing is sent anywhere.
        </p>
        <Seg
          value={readAloud ? "on" : "off"}
          options={[
            ["off", "Off"],
            ["on", "Read replies aloud"],
          ]}
          onPick={(v) => setReadAloud(v === "on")}
        />
        {readAloud && (
          <>
            <p className="setnote">Voice:</p>
            <Seg
              value={readAloudVoice}
              options={VOICES.map((v) => [v.id, v.label] as [string, string])}
              onPick={setReadAloudVoice}
            />
          </>
        )}
      </section>
    </>
  );
}

/** The prompt you paste into Claude Code so a project's docs live in rotli (your
 * memex) instead of the repo — planning + documentation you organize in rotli,
 * the README the only thing that stays in the repo. Copy-first; you refine the
 * wording to taste (Seth, 2026-07-07). */
const CLAUDE_DOCS_COMMAND = `When you create or update documentation for this project, keep it in my rotli
memex — NOT this repo. The README is the ONLY doc that stays in the repo.

• Before writing a new doc, ask me: "rotli or repo?" (the README always → repo).
• When a doc goes to rotli, write the Markdown file into my rotli notes folder
  under wiki/_inbox/<slug>.md with frontmatter:
      ---
      owner: rotli
      shelf: [<Project>]     # this project's name, e.g. Rotli or Memex
      ---
  rotli files it, and I keep it under my <Project> folder in Main.
• Do not create or leave project docs in this repo's docs/ folder.`;

/** The secure-note explainer (decision 2026-07-22, feature C) — plain language
 * distilled from the memex data contract's fail-closed list, plus the ONE knob
 * this boundary has (2026-08-01: the vault-wide secure ⇄ on-device default).
 * Copy lives here; the contract stays the spec. There is deliberately no knob
 * of any kind for remote models — that refusal is not configurable. */
function SecurityPane() {
  const secureLocalAi = useUiStore((s) => s.secureLocalAi);
  const setSecureLocalAi = useUiStore((s) => s.setSecureLocalAi);
  return (
    <>
      <PaneHead title="Security" char="local" />
      <p className="lead">
        A <b>secure note</b> is one rotli treats as private from AI. Some notes become secure on their own —
        quick captures (<b>⌥C</b>) are secure at birth, and a note that looks like it holds a secret (an API
        key, a card number) is flagged when rotli reads it. You can also mark any note secure yourself from
        its metadata panel or the note menu.
      </p>
      <span className="mplabel">What secure means</span>
      <p className="setnote">
        Secure notes live in <b>Secure notes</b> — a real folder in your memex (<code>wiki/_secure/</code>),
        not a hidden vault — and every one is kept out of git automatically.
      </p>
      <p className="setnote">
        <b>Remote models never see them.</b> Not the body, not the title, not a snippet — they are left out of
        everything a remote model receives, including search results and the notes catalog the chat uses. This
        is enforced twice, independently, and there is no setting that overrides it.
      </p>
      <p className="setnote">
        <b>Models running on this Mac can read them.</b> That&rsquo;s the point of a local model: nothing it
        reads can leave. A cloud model behind a localhost proxy still counts as remote and stays blocked.
      </p>
      <Toggle
        on={secureLocalAi}
        onChange={() => setSecureLocalAi(!secureLocalAi)}
        title={secureLocalAi ? "On-device AI can read secure notes" : "Secure notes are hidden from all AI"}
        desc={
          secureLocalAi
            ? "A model running on this Mac sees your secure notes, so you can ask about them without anything leaving the machine. Any single note can still opt out from its own menu."
            : "Not even an on-device model reads them. You can still allow a specific note from its menu."
        }
      />
      <p className="setnote">
        <b>Locked is a different control.</b> Locking a note doesn&rsquo;t hide it — every model can still
        read it. It means <b>no AI may edit it</b>, ever, cloud or on-device. Secure hides; locked protects.
      </p>
      <p className="setnote">
        <b>The Librarian never touches them.</b> rotli&rsquo;s organizer skips secure notes entirely — it
        doesn&rsquo;t read, move, or tag them, even when it&rsquo;s allowed to read other notes. It skips
        locked notes too.
      </p>
      <p className="setnote">
        <b>Secrets are found by patterns, not AI.</b> The detector is on-device pattern matching — key shapes,
        card numbers (checksum-verified), SSNs — so no model ever reads a note to decide whether it&rsquo;s
        sensitive. A model reads a note only to organize or answer about it, and only the model you chose.
      </p>
      <span className="mplabel">Leaving and repairs</span>
      <p className="setnote">
        Removing protection (from the note&rsquo;s menu or its shield control) moves the note back to where it
        lived before and lifts the git ignore — but only after the secret-looking content is gone.
      </p>
      <p className="setnote">
        Older versions of rotli could leave a secure note sitting in intake instead of Secure notes. When
        that&rsquo;s the case, <b>Librarian Activity</b> shows the affected notes and offers a one-click move
        into the protected folder — words untouched, nothing shown to any AI.
      </p>
    </>
  );
}

function PluginsPane() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(CLAUDE_DOCS_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <>
      <PaneHead title="Plugins" char="chat" />
      <p className="lead">Plugins extend rotli over the same corpus.</p>

      {/* Use rotli for your docs — a prompt you paste into Claude Code so a
          project's docs live in rotli, not the repo (Seth, 2026-07-07). */}
      <div className="claudecmd">
        <div className="claudecmd-head">
          <h4>Use rotli for your docs</h4>
          <button type="button" className="claudecmd-copy" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="plugdesc">
          Paste this into Claude Code in any project and your planning + docs land in rotli instead of the
          repo — everything but the README.
        </p>
        <pre className="claudecmd-block">{CLAUDE_DOCS_COMMAND}</pre>
      </div>
    </>
  );
}

export function SettingsSurface() {
  const [pane, setPane] = useState<SettingsPane>("general");
  // a surface elsewhere asked for a SPECIFIC pane (the Librarian's gear →
  // Settings → Librarian, 2026-07-31) — consume the one-shot request
  const paneRequest = useUiStore((s) => s.settingsPaneRequest);
  useEffect(() => {
    if (!paneRequest) return;
    if (NAV.some((p) => p.id === paneRequest)) setPane(paneRequest as SettingsPane);
    useUiStore.getState().setSettingsPaneRequest(null);
  }, [paneRequest]);

  return (
    <div className="settings">
      <nav className="set-nav" aria-label="Settings sections">
        <button type="button" className="set-back" onClick={() => dispatch("app.settings")}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="set-back-label">Back to notes</span>
        </button>
        {NAV.map(({ id, label, glyph: G }) => (
          <button
            type="button"
            key={id}
            className={pane === id ? "frow sel" : "frow"}
            onClick={() => setPane(id)}
          >
            <G size={14.5} />
            <span className="fname">{label}</span>
          </button>
        ))}
      </nav>
      <div className="set-main">
        <div className="set-body">
          {pane === "general" && <GeneralPane />}
          {pane === "hotkeys" && <HotkeysPane />}
          {pane === "appearance" && <AppearancePane />}
          {pane === "brain" && <BrainPane />}
          {pane === "security" && <SecurityPane />}
          {pane === "models" && <ModelsPane />}
          {pane === "location" && <LocationPane />}
          {pane === "plugins" && <PluginsPane />}
        </div>
      </div>
    </div>
  );
}
