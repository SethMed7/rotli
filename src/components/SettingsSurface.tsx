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
  rebind,
  setDispatchSuspended,
} from "../keys/registry";
import { GLASS_BG_SRC } from "../lib/glassBackgrounds";
import {
  checkForUpdate,
  corpusOverview,
  corpusSetRoot,
  corpusUseLegacy,
  corpusUseMemex,
  downloadAndInstallUpdate,
  isTauri,
  relocateCorpus,
  revealCorpus,
  setDockVisible,
  setHideOnBlur,
} from "../lib/tauri";
import { useFolders } from "../services/hooks";
import { isHidden, isVault } from "../services/destinations";
import { resetAndReonboard } from "../state/onboarding";
import { setQuickFolderSynced } from "../state/quick";
import {
  GLASS_BACKGROUNDS,
  GLASS_BLURS,
  GLASS_TINTS,
  SOLID_THEMES,
  useUiStore,
} from "../state/ui";
import {
  BrainGlyph,
  CheckGlyph,
  CloudGlyph,
  DatabaseGlyph,
  KeyboardGlyph,
  LaptopGlyph,
  PlusGlyph,
  SunGlyph,
} from "./glyphs";
import { pickFolder } from "../memex/service";
import {
  useConnectMemex,
  useDetectMemex,
  useInitMemex,
  useMemexConfig,
  useRunValidate,
  useSetActiveMemex,
  useSetMemexPerms,
} from "../memex/useMemex";
import { useMemexStore } from "../state/memex";

type SettingsPane = "general" | "hotkeys" | "appearance" | "storage" | "memex" | "plugins";

const NAV: { id: SettingsPane; label: string; glyph: typeof KeyboardGlyph }[] = [
  { id: "general", label: "General", glyph: LaptopGlyph },
  { id: "hotkeys", label: "Hotkeys", glyph: KeyboardGlyph },
  { id: "appearance", label: "Appearance", glyph: SunGlyph },
  { id: "storage", label: "Storage", glyph: DatabaseGlyph },
  { id: "memex", label: "Memory", glyph: BrainGlyph },
  { id: "plugins", label: "Plugins", glyph: PlusGlyph },
];

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
      <h3>Hotkeys</h3>
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

function GeneralPane() {
  const stayOpen = useUiStore((s) => s.stayOpen);
  const setStayOpen = useUiStore((s) => s.setStayOpen);
  const showInDock = useUiStore((s) => s.showInDock);
  const setShowInDock = useUiStore((s) => s.setShowInDock);
  const spellcheck = useUiStore((s) => s.spellcheck);
  const setSpellcheck = useUiStore((s) => s.setSpellcheck);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [confirmReset, setConfirmReset] = useState(false);
  const quickFolder = useUiStore((s) => s.quickFolder);
  // The external Vault is read-mostly — quick notes never land there, so keep it
  // (and its wiki/chats subfolders) out of the destination picker entirely.
  const folderOpts = (useFolders().data ?? []).filter((f) => !isHidden(f.id) && !isVault(f.id));
  const hasCurrent = folderOpts.some((f) => f.id === quickFolder);
  return (
    <>
      <h3>General</h3>
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
        Either way the menu-bar icon stays, ⌥Space opens the app, and ⌥C is the one-breath
        capture — all rebindable in Hotkeys.
      </p>

      <h4 className="sethead">Quick note</h4>
      <p className="lead">
        A floating note you summon with ⌥Q — pin up to five notes in it, cycle them with ‹ ›, and
        ⌘K searches every note to swap one in. It always reopens where you left off and closes when
        you click away.
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
      <h3>Appearance</h3>
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

function StoragePane() {
  const real = useQuery({
    queryKey: ["corpus", "overview"],
    queryFn: corpusOverview,
    enabled: isTauri(),
  });
  const rootPath = real.data?.root ?? "~/Documents/rotli";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultErr, setVaultErr] = useState<string | null>(null);

  const change = () => {
    setErr(null);
    setBusy(true);
    relocateCorpus()
      .then((moved) => {
        if (moved) void real.refetch();
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  // Connect the Vault to an external memex (Seth's ~/memex-vault). REGISTERS the
  // picked folder as the vault root — never moves anything. The Rust command
  // opens the native picker, refuses a non-memex, and relaunches on success
  // (so this rarely resolves; a cancel resolves false, an error rejects).
  const connectVault = () => {
    setVaultErr(null);
    setVaultBusy(true);
    corpusSetRoot("vault")
      .catch((e: unknown) => setVaultErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setVaultBusy(false));
  };

  return (
    <>
      <h3>Where your notes live</h3>
      <p className="lead">
        Your notes are plain Markdown files on this Mac. rotli never holds them hostage — open the
        folder any time, point any tool at it, leave whenever you want.
      </p>
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
            rotli sync
          </div>
          <div className="sd">Encrypted, effortless, across your devices</div>
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
        </div>
        <div className="locact">
          <button type="button" className="ghostbtn" onClick={() => void revealCorpus()}>
            Reveal in Finder
          </button>
          <button type="button" className="ghostbtn" onClick={change} disabled={busy}>
            {busy ? "Moving…" : "Move folder…"}
          </button>
        </div>
      </div>
      {err && <p className="setnote err">Couldn’t move the folder: {err}</p>}
      <p className="setnote">
        Move takes every note with it and points rotli at the new home. The hidden{" "}
        <code>.rotli/</code> holds the search index and settings; deleting it loses nothing but a
        rebuild.
      </p>

      <h3>The Vault</h3>
      <p className="lead">
        The Vault is a folder <em>outside</em> rotli that it browses in place — your knowledge base.
        Connect one and its notes appear under the Vault row, read-only, <em>alongside</em> your local
        notes. rotli never moves it, never writes your notes into it: new notes always land in your
        local Inbox. (To make a memex your <em>whole</em> notes corpus instead, see <b>Memory</b>.)
      </p>
      <div className="locrow">
        <div className="loctext">
          <span className="loclabel">Connected folder</span>
          <code className="locpath">{isTauri() ? "— pick a folder to connect" : "—"}</code>
        </div>
        <div className="locact">
          <button type="button" className="ghostbtn" onClick={connectVault} disabled={vaultBusy}>
            {vaultBusy ? "Connecting…" : "Connect a folder…"}
          </button>
        </div>
      </div>
      {vaultErr && <p className="setnote err">Couldn’t connect the Vault: {vaultErr}</p>}
    </>
  );
}

// ——— Memory: the memex seam. Connect to (or initiate) a memex — the shared
//     self/wiki/history/chats/inbox spine (for Seth, ~/memex-vault) — keep multiple
//     separate non-blending instances, set per-instance write access, and run the
//     brain's own validate.ts. rotli OWNS chats/ + inbox; the rest is read-only. ———

/** Whether `instRoot` (an absolute memex path) is what the Notes tree is
 * currently browsing. `overviewRoot` is the live corpus root with `$HOME`
 * shortened to `~` (corpus_overview), so we compare on the shared tail after the
 * home prefix — robust without needing `$HOME` in the browser. */
function isCurrentCorpus(instRoot: string, overviewRoot: string | undefined): boolean {
  if (!overviewRoot) return false;
  const tail = overviewRoot.startsWith("~/") ? overviewRoot.slice(1) : overviewRoot;
  return instRoot === overviewRoot || instRoot.endsWith(tail);
}

function MemexPane() {
  const cfg = useMemexConfig();
  const overview = useQuery({
    queryKey: ["corpus", "overview", "memex-pane"],
    queryFn: () => corpusOverview(),
    enabled: isTauri(),
  });
  const detect = useDetectMemex(isTauri());
  const connectMut = useConnectMemex();
  const initMut = useInitMemex();
  const setActiveMut = useSetActiveMemex();
  const permsMut = useSetMemexPerms();
  const validateMut = useRunValidate();
  const lastValidate = useMemexStore((s) => s.lastValidate);
  const setLastValidate = useMemexStore((s) => s.setLastValidate);
  const captureToBrainInbox = useUiStore((s) => s.captureToBrainInbox);
  const setCaptureToBrainInbox = useUiStore((s) => s.setCaptureToBrainInbox);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const instances = cfg.data?.instances ?? [];
  const activeId = cfg.data?.activeId ?? null;
  const registered = new Set(instances.map((i) => i.root));
  const candidates = (detect.data ?? []).filter((d) => !registered.has(d.root));
  const labelOf = (path: string) => path.split("/").filter(Boolean).pop() || "memex";

  const run = (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    fn()
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const connectExisting = () =>
    run(async () => {
      const path = await pickFolder();
      if (path) await connectMut.mutateAsync({ path, label: labelOf(path) });
    });
  const newSeparate = () =>
    run(async () => {
      const path = await pickFolder();
      if (path) await initMut.mutateAsync({ path, label: labelOf(path) });
    });

  if (!isTauri()) {
    return (
      <>
        <h3>Memory</h3>
        <p className="lead">
          Your memex lives on disk — this connects in the app, not the browser preview.
        </p>
      </>
    );
  }

  return (
    <>
      <h3>Memory</h3>
      <p className="lead">
        rotli <b>mirrors</b> a memex — it never imports it. <b>Memory</b> makes a memex your{" "}
        <em>whole</em> notes corpus (it replaces <code>~/Documents/rotli</code>). To browse a memex{" "}
        <em>alongside</em> your local notes instead — as a row in the sidebar — connect it as{" "}
        <b>Storage → The Vault</b>. Either way rotli reads your whole brain (self · wiki · history ·
        chats · inbox · map) and writes only <b>chats</b> (the chat area, once you start chats) and{" "}
        <b>inbox</b> (quick captures); <b>history</b> and <b>self</b> are never touched, and{" "}
        <b>wiki</b> is read-only.
      </p>

      {candidates.length > 0 && (
        <>
          <h4 className="sethead">Found on this Mac</h4>
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
                onClick={() => run(() => connectMut.mutateAsync({ path: d.root, label: d.label }))}
              >
                Merge
              </button>
            </div>
          ))}
        </>
      )}

      <h4 className="sethead">Connected</h4>
      {instances.length === 0 && <p className="setnote">No memex connected yet.</p>}
      {instances.map((inst) => {
        const isActive = inst.id === activeId;
        const isBrowsing = isCurrentCorpus(inst.root, overview.data?.root);
        return (
          <div key={inst.id} className={isActive ? "memex-card sel" : "memex-card"}>
            <div className="mc-body">
              <div className="mc-title">
                {inst.label}
                <span className={inst.perms === "chats+inbox" ? "memex-badge write" : "memex-badge"}>
                  {inst.perms === "chats+inbox" ? "chats + inbox" : "read-only"}
                </span>
                {inst.mode && <span className="memex-badge">{inst.mode}</span>}
              </div>
              <div className="mc-path">{inst.root}</div>
              <div className="mc-meta">
                {inst.memexId?.slice(0, 14) ?? "—"} · {inst.role}
              </div>
              <Seg
                value={inst.perms}
                options={[
                  ["chats+inbox", "Chats + inbox"],
                  ["read-only", "Read-only"],
                ]}
                onPick={(p) => run(() => permsMut.mutateAsync({ id: inst.id, perms: p }))}
              />
              <div className="memex-actions">
                {!isActive && (
                  <button
                    type="button"
                    className="ghostbtn"
                    disabled={busy}
                    onClick={() => run(() => setActiveMut.mutateAsync(inst.id))}
                  >
                    Make active
                  </button>
                )}
                {/* Browse this memex in the Notes tree — relaunches into it.
                    The brain's memory stays read-only; only chats are writable. */}
                {isBrowsing ? (
                  <button
                    type="button"
                    className="ghostbtn"
                    disabled={busy}
                    onClick={() => run(() => corpusUseLegacy())}
                  >
                    Use ~/Documents/rotli instead
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghostbtn"
                    disabled={busy}
                    onClick={() => run(() => corpusUseMemex(inst.root))}
                  >
                    Browse in Notes
                  </button>
                )}
                <button
                  type="button"
                  className="ghostbtn"
                  disabled={busy}
                  onClick={() => run(() => validateMut.mutateAsync(inst).then(setLastValidate))}
                >
                  Check the brain
                </button>
              </div>
              {lastValidate && isActive && (
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
      })}

      <div className="memex-actions">
        <button type="button" className="ghostbtn" disabled={busy} onClick={connectExisting}>
          Connect to existing…
        </button>
        <button type="button" className="ghostbtn" disabled={busy} onClick={newSeparate}>
          New separate brain…
        </button>
      </div>
      {err && <p className="setnote err">{err}</p>}

      <h4 className="sethead">Quick capture</h4>
      <div className="swgroup">
        <Toggle
          on={captureToBrainInbox}
          title="Send quick captures to the brain inbox"
          desc="⌥C captures append to your active memex's inbox.md instead of the Board."
          onChange={() => setCaptureToBrainInbox(!captureToBrainInbox)}
        />
      </div>
    </>
  );
}

function PluginsPane() {
  return (
    <>
      <h3>Plugins</h3>
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
          {pane === "storage" && <StoragePane />}
          {pane === "memex" && <MemexPane />}
          {pane === "plugins" && <PluginsPane />}
        </div>
      </div>
    </div>
  );
}
