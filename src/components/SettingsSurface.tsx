// Settings — the r1 frame F window grammar: left nav (Hotkeys · Appearance ·
// Storage · Plugins) + one surface. Esc closes back to notes (the registry's
// app.hide chain). Storage shows the corpus story with the future default path
// ~/Documents/rotli; "Later" cards are quiet and non-interactive. Hotkeys is
// the rebind list: click a chord, press the next combo (a quiet inline note if
// the chord is taken).

import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useState } from "react";
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
import { GLASS_BG_SRC } from "../lib/glassBackgrounds";
import {
  type ChatModelInfo,
  type MemexValidateReport,
  type SystemProfile,
  chatModels,
  checkForUpdate,
  cliDetect,
  corpusOverview,
  downloadAndInstallUpdate,
  isTauri,
  localModelInstall,
  localModelInstallCancel,
  localModelInstallProgress,
  localModelSetDefault,
  localModelUninstall,
  organizerRunOnce,
  organizerSetTrust,
  revealCorpus,
  secretDelete,
  secretExists,
  secretStore,
  setDockVisible,
  setHideOnBlur,
  systemProfile,
} from "../lib/tauri";
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
import { queryClient } from "../services/query";
import { usePanesStore } from "../state/panes";
import { useFolders } from "../services/hooks";
import { isChatsPath, isHidden, isVault, isWikiPath } from "../services/destinations";
import { resetAndReonboard } from "../state/onboarding";
import { setQuickFolderSynced } from "../state/quick";
import {
  GLASS_BACKGROUNDS,
  GLASS_BLURS,
  GLASS_TINTS,
  type OrganizerTrust,
  SOLID_THEMES,
  useUiStore,
} from "../state/ui";
import {
  CheckGlyph,
  CloudGlyph,
  DatabaseGlyph,
  KeyboardGlyph,
  LaptopGlyph,
  NotesStackGlyph,
  PlusGlyph,
  SunGlyph,
} from "./glyphs";
import { Character, type CharacterName } from "./Character";
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
import { CORPUS_INSTANCE_ID, type MemexInstance, type Perms } from "../memex/config";

type SettingsPane =
  | "general"
  | "hotkeys"
  | "appearance"
  | "brain"
  | "models"
  | "location"
  | "plugins";

const NAV: { id: SettingsPane; label: string; glyph: typeof KeyboardGlyph }[] = [
  { id: "general", label: "General", glyph: LaptopGlyph },
  { id: "hotkeys", label: "Hotkeys", glyph: KeyboardGlyph },
  { id: "appearance", label: "Appearance", glyph: SunGlyph },
  // the organizer daemon's trust ladder (design §4.3) — minimal Phase-4 pane;
  // capability checkboxes / Pause / Reset Brain are Phase 5 (§4.8)
  { id: "brain", label: "Brain", glyph: NotesStackGlyph },
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

/** A real on/off switch — label + description on the left, a sliding track on
 * the right. Replaces the old ambiguous dot-in-a-box "sysrow". */
function Toggle({
  on,
  onChange,
  title,
  desc,
}: {
  on: boolean;
  onChange: () => void;
  title: string;
  desc?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={on ? "swrow on" : "swrow"}
      onClick={onChange}
    >
      <span className="swtext">
        <span className="swt">{title}</span>
        {desc && <span className="swd">{desc}</span>}
      </span>
      <span className="sw" aria-hidden="true">
        <span className="swknob" />
      </span>
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
  const matches = (action: KeyAction): boolean => {
    if (!q) return true;
    const chord = chordOf(action);
    return (
      action.title.toLowerCase().includes(q) ||
      action.id.toLowerCase().includes(q) ||
      (chord !== null && formatChord(chord).toLowerCase().includes(q))
    );
  };
  const actions = allActions();
  const grouped = HK_SECTIONS.map((section) => ({
    ...section,
    actions: actions.filter((a) => a.id.startsWith(`${section.prefix}.`) && matches(a)),
  })).filter((section) => section.actions.length > 0);
  const ungrouped = actions.filter(
    (a) => !HK_SECTIONS.some((s) => a.id.startsWith(`${s.prefix}.`)) && matches(a),
  );

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
      <p className="lead">
        Every shortcut in rotli is yours to rebind. Click a chord, press the new keys.
      </p>
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
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (alive) setVersion(v);
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
    void downloadAndInstallUpdate((pct) => setState({ kind: "installing", pct })).catch(
      (err: unknown) => {
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
  };

  const installing = state.kind === "installing";

  return (
    <>
      <h4 className="sethead">Updates</h4>
      <div className="setselect-row">
        <span>
          rotli {version}
          {state.kind === "current" && " — up to date"}
          {state.kind === "available" &&
            ` — update available${state.version ? ` (v${state.version})` : ""}`}
        </span>
        {state.kind === "available" || installing ? (
          <button type="button" className="ghostbtn" onClick={install} disabled={installing}>
            {installing ? `Updating… ${state.pct}%` : "Install & relaunch"}
          </button>
        ) : (
          <button
            type="button"
            className="ghostbtn"
            onClick={check}
            disabled={state.kind === "checking"}
          >
            {state.kind === "checking" ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>
      {state.kind === "error" && (
        <p className="setnote err">Couldn’t check for updates: {state.message}</p>
      )}
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
  const fileMetadata = useUiStore((s) => s.fileMetadata);
  const setFileMetadata = useUiStore((s) => s.setFileMetadata);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [confirmReset, setConfirmReset] = useState(false);
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
        rotli is a visitor by default — summon it, write, dismiss it. Make it a resident when
        you&rsquo;re living in it.
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
        Either way the menu-bar icon stays, {chordLabel(bindingOverrides, "app.toggleWindow")} opens
        the app, and {chordLabel(bindingOverrides, "capture.summon")} is the one-breath capture —
        all rebindable in Hotkeys.
      </p>

      <h4 className="sethead">Quick note</h4>
      <p className="lead">
        A floating note you summon with {chordLabel(bindingOverrides, "quick.summon")} — pin up to
        five notes in it, cycle them with ‹ ›, and ⌘K searches every note to swap one in. It always
        reopens where you left off and closes when you click away.
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
          on={fileMetadata === "show"}
          title="Show file metadata"
          desc="The note's raw frontmatter block at the top of the file, exactly as it sits on disk — editable as plain text."
          onChange={() => setFileMetadata(fileMetadata === "show" ? "hide" : "show")}
        />
      </div>

      <UpdatesSection />

      <h4 className="sethead">Start fresh</h4>
      <p className="lead">
        Reset your hotkeys, window behavior, and theme back to the defaults and run first-time
        setup again. Your notes are never touched.
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

// ——— Appearance: four solid theme cards + Liquid Glass as a MODE on top
// (Seth, 2026-06-12: "the sun toggles the four themes; glass is a toggle") ———

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

const TINT_SWATCH: Record<string, string> = {
  dusk: "var(--swatch-dusk)",
  blush: "var(--swatch-blush)",
  clay: "var(--swatch-clay)",
  olive: "var(--swatch-olive)",
};

function AppearancePane() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const setThemeFamily = useUiStore((s) => s.setThemeFamily);
  const matchLightFamily = useUiStore((s) => s.matchLightFamily);
  const setMatchLightFamily = useUiStore((s) => s.setMatchLightFamily);
  const matchDarkFamily = useUiStore((s) => s.matchDarkFamily);
  const setMatchDarkFamily = useUiStore((s) => s.setMatchDarkFamily);
  const glassMode = useUiStore((s) => s.glassMode);
  const setGlassMode = useUiStore((s) => s.setGlassMode);
  const glassTint = useUiStore((s) => s.glassTint);
  const setGlassTint = useUiStore((s) => s.setGlassTint);
  const glassBackground = useUiStore((s) => s.glassBackground);
  const setGlassBackground = useUiStore((s) => s.setGlassBackground);
  const setCustomBackground = useUiStore((s) => s.setCustomBackground);
  const glassClarity = useUiStore((s) => s.glassClarity);
  const setGlassClarity = useUiStore((s) => s.setGlassClarity);
  const glassBlur = useUiStore((s) => s.glassBlur);
  const setGlassBlur = useUiStore((s) => s.setGlassBlur);
  const followingSystem = theme === "system";
  return (
    <>
      <PaneHead title="Appearance" char="board" />
      <p className="lead">Pick a theme. The titlebar sun cycles through these four.</p>
      <div className={glassMode ? "famrow off" : "famrow"}>
        {SOLID_THEMES.map(({ family, mode, label }) => {
          const selected = !glassMode && themeFamily === family && theme === mode;
          return (
            <button
              type="button"
              key={label}
              className={selected ? "famcard sel" : "famcard"}
              aria-pressed={selected}
              aria-disabled={glassMode}
              onClick={() => {
                if (glassMode) return; // glass owns light/dark below
                setThemeFamily(family);
                setTheme(mode);
              }}
            >
              <span
                className="famswatch"
                style={{ background: THEME_SWATCH[label] }}
                aria-hidden="true"
              />
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
      {followingSystem &&
        (glassMode ? (
          <p className="setnote">macOS picks Glass Light or Glass Dark while glass mode is on.</p>
        ) : (
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
        ))}

      <h4 className="sethead">Liquid Glass</h4>
      <p className="lead">
        A mode over your theme: floating glass panels on a background. While it&rsquo;s on, the
        titlebar sun becomes the tint dot — click it to cycle hues.
      </p>
      <Toggle on={glassMode} title="Glass mode" onChange={() => setGlassMode(!glassMode)} />
      <div className={glassMode ? "glassopts" : "glassopts off"} aria-hidden={!glassMode}>
        <>
          <div className="glassrows">
            <div className="glassrow">
              <span className="glassrow-label">Mode</span>
              {(["light", "dark"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  className={theme === m ? "aaseg sel" : "aaseg"}
                  aria-pressed={theme === m}
                  onClick={() => setTheme(m)}
                >
                  {m === "light" ? "Glass Light" : "Glass Dark"}
                </button>
              ))}
            </div>
            <div className="glassrow">
              <span className="glassrow-label">Clarity</span>
              {(["frosted", "clear"] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  className={glassClarity === c ? "aaseg sel" : "aaseg"}
                  aria-pressed={glassClarity === c}
                  onClick={() => setGlassClarity(c)}
                >
                  {c === "frosted" ? "Frosted" : "Clear"}
                </button>
              ))}
            </div>
            <div className="glassrow">
              <span className="glassrow-label">Blur</span>
              {GLASS_BLURS.map(({ value, label }) => (
                <button
                  type="button"
                  key={value}
                  className={glassBlur === value ? "aaseg sel" : "aaseg"}
                  aria-pressed={glassBlur === value}
                  onClick={() => setGlassBlur(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="tintrow" role="radiogroup" aria-label="Glass tint">
            {GLASS_TINTS.map(({ value, label }) => (
              <button
                type="button"
                key={value}
                className={glassTint === value ? "tintchip sel" : "tintchip"}
                aria-pressed={glassTint === value}
                onClick={() => setGlassTint(value)}
              >
                <i style={{ background: TINT_SWATCH[value] }} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="aalabel bglabel">Background</div>
          <div className="bgrow" role="radiogroup" aria-label="Glass background">
            {GLASS_BACKGROUNDS.map(({ value, label }) => (
              <button
                type="button"
                key={value}
                className={glassBackground === value ? "bgchip sel" : "bgchip"}
                aria-pressed={glassBackground === value}
                onClick={() => setGlassBackground(value)}
              >
                {value === "field" ? (
                  <span className="bgthumb bgthumb--field" aria-hidden="true" />
                ) : (
                  <img className="bgthumb" src={GLASS_BG_SRC[value]} alt="" />
                )}
                {label}
              </button>
            ))}
            <label className={glassBackground === "custom" ? "bgchip sel" : "bgchip"}>
              <span className="bgthumb bgthumb--upload" aria-hidden="true">+</span>
              Your image
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // data URL (not an object URL) so the persistence layer can
                  // write the image itself into .rotli/background.json
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result !== "string") return;
                    setCustomBackground(reader.result);
                    setGlassBackground("custom");
                  };
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="setnote">
            Your own image stays with your settings — quit and relaunch, it&rsquo;s still here.
          </p>
        </>
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
  const [validation, setValidation] = useState<{ id: string; report: MemexValidateReport } | null>(
    null,
  );
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
        Your notes are plain Markdown files in <b>one folder</b> on this Mac — and that folder can be
        your <b>brain</b> (a memex): notes, chats, and knowledge together, kept tidy by AI but always
        yours to arrange. rotli never holds your notes hostage.
      </p>

      {/* —— the one folder —— */}
      <h4 className="sethead">Your notes folder</h4>
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
      <div className="locrow">
        <div className="loctext">
          <span className="loclabel">Notes folder</span>
          <code className="locpath">{rootPath}</code>
          {corpusIsBrain && <span className="memex-badge write">memex</span>}
        </div>
        <div className="locact">
          <button type="button" className="ghostbtn" onClick={() => void revealCorpus()}>
            Reveal in Finder
          </button>
          <button
            type="button"
            className="ghostbtn"
            onClick={() => run(() => chooseMut.mutateAsync(undefined))}
            disabled={busy}
          >
            Choose folder…
          </button>
        </div>
      </div>

      {/* —— Storage organization (Seth, 2026-06-30) —— */}
      <h4 className="sethead">Storage</h4>
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
        Your files (audio · images · PDFs · …) group this way under the <b>Storage</b> section.
      </p>

      <p className="setnote">
        <b>Choose folder…</b> takes a memex (rotli uses it as your notes folder), an empty folder (your
        notes move there), or any folder (used as-is). The hidden <code>.rotli/</code> is just an index —
        deleting it loses nothing but a rebuild.
      </p>

      {/* —— linked libraries: a SECOND memex you reference (advanced) —— */}
      <h4 className="sethead">Linked libraries</h4>
      <p className="lead">
        A <b>linked library</b> is a <em>second</em> memex you reference alongside your notes — a shared or
        team brain, a reference vault. <b>Most people never need one</b> (your notes folder is already your
        memex). rotli reads the whole library and, per its perms, writes only <b>chats</b>, <b>inbox</b>,
        and new notes; it never touches its history or identity, and its curated wiki is read-only.
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
      </div>
      {err && <p className="setnote err">{err}</p>}
    </>
  );
}

// ——— Brain: the organizer daemon's trust ladder (design §4.3). Minimal by
// design — Phase 4 ships the 4-level radio + the reassurance copy; capability
// checkboxes, Pause, and Reset Brain are the Phase-5 control panel (§4.8). ———

/** What each rung lets the daemon auto-APPLY — proposals always flow to
 * Activity regardless (except Off, which is fully dormant). */
const TRUST_CAPTIONS: Record<OrganizerTrust, string> = {
  off: "Dormant — it leaves your notes alone entirely.",
  suggest: "Applies nothing. Everything it wants to do waits in Activity for your OK.",
  tidy: "Files brand-new captures and fills in summaries/tags on its own; bigger moves still wait for you.",
  organize: "Keeps everything organized on its own — every action journaled and undoable.",
};

function BrainPane() {
  const trust = useUiStore((s) => s.organizerTrust);
  const setTrust = useUiStore((s) => s.setOrganizerTrust);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // the Run-now nudge — a quiet inline note instead of an error toast. The
  // note never claims a live state it can't see ("Running a pass…" showed
  // forever — #85, audit 2026-07); errors get the err class other panes use.
  const [ranNote, setRanNote] = useState<{ text: string; err: boolean } | null>(null);
  return (
    <>
      <PaneHead title="Brain" char="knowledge" />
      <p className="lead">
        A small AI on your Mac keeps the Brain organized — it files new notes into areas, writes
        one-line summaries, suggests tags, and keeps each area&rsquo;s overview current. How much
        it does on its own is up to you.
      </p>
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
        Never touches: locked notes · secure notes · your Main arrangement.
      </p>
      <p className="setnote">Local only — never the internet, can&rsquo;t read secrets.</p>
      <p className="setnote">
        It waits for its moment: it works only when you&rsquo;re away, plugged in, and the machine
        is cool — never on battery, never over a chat — and when there&rsquo;s nothing new it sleeps
        outright. Run now does one pass immediately, then it goes back to sleep.
      </p>
      <button
        type="button"
        className="ghostbtn"
        disabled={trust === "off"}
        onClick={() => {
          organizerRunOnce()
            .then(() =>
              setRanNote({
                text: "Pass queued — what it finds lands in Brain Activity.",
                err: false,
              }),
            )
            .catch((e) =>
              setRanNote({ text: e instanceof Error ? e.message : String(e), err: true }),
            );
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
function LocalModelsSection({
  installed,
  onChanged,
}: {
  installed: ChatModelInfo[];
  onChanged: () => void;
}) {
  const [installing, setInstalling] = useState<Installing | null>(null);
  const [repo, setRepo] = useState("");
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null);
  // "Scan my Mac" — chip + RAM + free disk, then fit badges on the picks
  const [scan, setScan] = useState<SystemProfile | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);

  // poll the byte total while a download runs (mirrors the organizer poll)
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
    localModelInstall({ requestId, repo: repoId, name, ...(approxMb ? { approxMb } : {}), ...(vision ? { vision } : {}) })
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
        Models that run entirely on your Mac. Pick any of them per chat — a model loads when
        asked and unloads after a few idle minutes, so nothing runs around the clock. The
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
            {scan.chip} · {Math.round(scan.ramGb)} GB memory · {Math.round(scan.freeDiskGb)} GB
            free
          </span>
        )}
      </div>
      {scan && (
        <p className="setnote">
          This Mac {scanVerdict(scan.ramGb)} The picks below are badged accordingly.
        </p>
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
                    <button type="button" className="ghostbtn" onClick={() => makeDefault(m.id)}>
                      Make default
                    </button>
                  )
                )}
                {!isDefault && (
                  <button type="button" className="ghostbtn" onClick={() => uninstall(m.id)}>
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
            <span>
              {pct !== null ? `${pct}%` : formatSize(Math.round(bytes / 1_000_000))}
            </span>
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
                  <button type="button" className="ghostbtn" onClick={() => installPick(e)}>
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
            <button type="button" className="ghostbtn" disabled={!repo.trim()} onClick={installRepo}>
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
  agy: "Antigravity CLI — your Google AI subscription (bundles Gemini + Claude models).",
  gemini: "Gemini API — bring your own API key (stored in the macOS Keychain).",
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
      <span className="sw" aria-hidden="true">
        <span className="swknob" />
      </span>
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
          : `ready${d.version ? ` · ${d.version.replace(/^[a-z-]+ /i, "")}` : ""}`;

  const runVerify = () => {
    setVerify({ state: "running" });
    verifyLane(id).then((r) =>
      setVerify(
        r.ok
          ? { state: "ok", ms: r.ms, model: r.model }
          : { state: "fail", error: r.error ?? "failed" },
      ),
    );
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
            <span className="ailane-modelslabel">In the picker:</span>
            {CLI_CATALOG[id].map((m) => {
              const off = blockedModels.includes(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  className={off ? "ailane-model off" : "ailane-model"}
                  aria-pressed={!off}
                  title={off ? "Blocked — click to allow" : "Click to block this model"}
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
    queryKey: ["secret", "gemini-api-key"],
    queryFn: () => secretExists("gemini-api-key"),
    enabled: isTauri(),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["secret", "gemini-api-key"] });
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
        className="ghostbtn"
        disabled={!val.trim()}
        onClick={() => {
          secretStore("gemini-api-key", val.trim())
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
          className="ghostbtn"
          onClick={() => {
            secretDelete("gemini-api-key")
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
        // eslint-disable-next-line react/no-array-index-key
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
            onClick={() =>
              setP((prev) => ({ ...prev, routes: prev.routes.filter((_, j) => j !== i) }))
            }
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
        <button type="button" className="ghostbtn" disabled={!valid} onClick={() => onSave(p)}>
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
  const setChatNoteOpen = useUiStore((s) => s.setChatNoteOpen);

  const blockedModels = useUiStore((s) => s.blockedModels);
  const local = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  // every model a preset may reference: local + the ENABLED connected lanes,
  // minus anything blocked inside a lane
  const available = flattenModels(mergedModels(local.data ?? [], aiProviders, [], blockedModels));

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

  const summarize = (p: HybridPreset) => {
    const label = (id: string) => available.find((m) => m.id === id)?.label ?? id;
    const routes = p.routes.map((r) => label(r.model)).join(" · ");
    return `${label(p.organizer)} → ${routes}${p.fallback ? ` (fallback ${label(p.fallback)})` : ""}`;
  };

  return (
    <>
      <PaneHead title="AI Models" char="knowledge" />
      <p className="lead">
        Chat runs on your Mac by default. Install more on-device models below, or connect the
        subscriptions you already have — their models join the picker, and rotli drives the official
        CLI on this machine. A connected model runs remotely: the conversation leaves your Mac,
        secure notes never do.
      </p>

      <LocalModelsSection
        installed={local.data ?? []}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["chat", "models"] })}
      />

      <section className="aisection">
        <h4 className="set-subhead">Connected models</h4>
        <p className="setnote">
          Turning a lane on runs one tiny test reply in the background — the honest &ldquo;it
          works&rdquo;. Inside a lane, click a model to block or allow it in the picker.
        </p>
        {PROVIDER_IDS.map((id) => (
          <LaneCard key={id} id={id} />
        ))}
      </section>

      <section className="aisection">
      <h4 className="set-subhead">Hybrid presets</h4>
      <p className="setnote">
        A preset lets one model ORGANIZE each message and route it to the model best suited — e.g.
        gemma routes, Gemini executes, Claude catches failures. Presets show up in the chat&rsquo;s
        model picker.
      </p>
      {STARTER_PRESETS.some((sp) => !hybridPresets.some((p) => p.id === sp.id)) && (
        <>
          <p className="setnote">Ready-made — add one and tweak it to taste:</p>
          <div className="preset-list">
            {STARTER_PRESETS.filter((sp) => !hybridPresets.some((p) => p.id === sp.id)).map(
              (sp) => (
                <div className="preset-row" key={sp.id}>
                  <span className="preset-name">{sp.name}</span>
                  <span className="preset-sum">{summarize(sp)}</span>
                  <button
                    type="button"
                    className="ghostbtn"
                    onClick={() => setHybridPresets([...hybridPresets, sp])}
                  >
                    Add
                  </button>
                </div>
              ),
            )}
          </div>
        </>
      )}
      {hybridPresets.length > 0 && (
        <div className="preset-list">
          {hybridPresets.map((p) => (
            <div className="preset-row" key={p.id}>
              <span className="preset-name">{p.name}</span>
              <span className="preset-sum">{summarize(p)}</span>
              <button type="button" className="ghostbtn" onClick={() => setDraft(p)}>
                Edit
              </button>
              <button
                type="button"
                className="ghostbtn"
                onClick={() => setHybridPresets(hybridPresets.filter((x) => x.id !== p.id))}
              >
                Delete
              </button>
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
          className="ghostbtn"
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
              <span className="preset-name">{p.name}</span>
              <span className="preset-sum">{summarize(p)}</span>
              <button
                type="button"
                className="ghostbtn"
                onClick={() => {
                  setHybridPresets([...hybridPresets, p]);
                  setSuggestions(suggestions.filter((x) => x.id !== p.id));
                }}
              >
                Save
              </button>
            </div>
          ))}
        </div>
      )}
      </section>

      <section className="aisection">
        <h4 className="set-subhead">Images in chat</h4>
        <p className="setnote">
          Which connected engine draws when a chat generates an image (saved into this
          chat&rsquo;s assets).
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
    </>
  );
}

function PluginsPane() {
  return (
    <>
      <PaneHead title="Plugins" char="chat" />
      <p className="lead">
        Plugins extend rotli over the same corpus. The first one is on the way.
      </p>
      <div className="pluglist">
        <div className="plugrow" aria-disabled="true">
          <span className="plugmark" aria-hidden="true">
            b
          </span>
          <span className="plugtext">
            <span className="plugname">breve</span>
            <span className="plugdesc">Your morning brief, drawn from your notes.</span>
          </span>
          <span className="plugsoon">Soon</span>
        </div>
      </div>
    </>
  );
}

export function SettingsSurface() {
  const [pane, setPane] = useState<SettingsPane>("general");

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
          {pane === "models" && <ModelsPane />}
          {pane === "location" && <LocationPane />}
          {pane === "plugins" && <PluginsPane />}
        </div>
      </div>
    </div>
  );
}
