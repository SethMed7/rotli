// Settings — the r1 frame F window grammar: left nav (Hotkeys · Appearance ·
// Storage · Plugins) + one surface. Esc closes back to notes (the registry's
// app.hide chain). Storage shows the corpus story with the future default path
// ~/Documents/rotli; "Later" cards are quiet and non-interactive. Hotkeys is
// the rebind list: click a chord, press the next combo (a quiet inline note if
// the chord is taken).

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
import { setDockVisible, setHideOnBlur } from "../lib/tauri";
import {
  GLASS_BACKGROUNDS,
  GLASS_BLURS,
  GLASS_TINTS,
  SOLID_THEMES,
  type ThemeFamily,
  useUiStore,
} from "../state/ui";
import {
  CheckGlyph,
  CloudGlyph,
  DatabaseGlyph,
  KeyboardGlyph,
  LaptopGlyph,
  PlusGlyph,
  SunGlyph,
} from "./glyphs";

type SettingsPane = "general" | "hotkeys" | "appearance" | "storage" | "plugins";

const NAV: { id: SettingsPane; label: string; glyph: typeof KeyboardGlyph }[] = [
  { id: "general", label: "General", glyph: LaptopGlyph },
  { id: "hotkeys", label: "Hotkeys", glyph: KeyboardGlyph },
  { id: "appearance", label: "Appearance", glyph: SunGlyph },
  { id: "storage", label: "Storage", glyph: DatabaseGlyph },
  { id: "plugins", label: "Plugins", glyph: PlusGlyph },
];

// ——— Hotkeys: every registry action, grouped by area + searchable ———

/** Sections derive from the action id prefix ("tabs.new" → Tabs) — no
 * per-action bookkeeping, new actions land in the right group automatically. */
const HK_SECTIONS: { prefix: string; label: string }[] = [
  { prefix: "app", label: "App" },
  { prefix: "capture", label: "Quick capture" },
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

function GeneralPane() {
  const stayOpen = useUiStore((s) => s.stayOpen);
  const setStayOpen = useUiStore((s) => s.setStayOpen);
  const showInDock = useUiStore((s) => s.showInDock);
  const setShowInDock = useUiStore((s) => s.setShowInDock);
  return (
    <>
      <h3>General</h3>
      <p className="lead">
        rotli is a visitor by default — summon it, write, dismiss it. Make it a resident when
        you&rsquo;re living in it.
      </p>
      <button
        type="button"
        className={stayOpen ? "sysrow on" : "sysrow"}
        aria-pressed={stayOpen}
        onClick={() => {
          const next = !stayOpen;
          setStayOpen(next);
          void setHideOnBlur(!next);
        }}
      >
        <span className="sysdot" aria-hidden="true" />
        Stay open — don&rsquo;t hide when I click away
      </button>
      <button
        type="button"
        className={showInDock ? "sysrow on" : "sysrow"}
        aria-pressed={showInDock}
        onClick={() => {
          const next = !showInDock;
          setShowInDock(next);
          void setDockVisible(next);
        }}
      >
        <span className="sysdot" aria-hidden="true" />
        Show in the Dock — otherwise rotli lives in the menu bar only
      </button>
      <p className="setnote">
        Either way the menu-bar icon stays, ⌥Space opens the app, and ⌥C is the one-breath
        capture — all rebindable in Hotkeys.
      </p>
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

const FAMILY_PAIR: Record<ThemeFamily, string> = {
  warm: "Warm Light and Warm Dark",
  mono: "Paper and Charcoal",
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
      <button
        type="button"
        className={followingSystem ? "sysrow on" : "sysrow"}
        aria-pressed={followingSystem}
        onClick={() =>
          setTheme(
            followingSystem
              ? window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light"
              : "system",
          )
        }
      >
        <span className="sysdot" aria-hidden="true" />
        Match the system — switch between{" "}
        {glassMode ? "Glass Light and Glass Dark" : FAMILY_PAIR[themeFamily]} with macOS.
      </button>

      <h4 className="sethead">Liquid Glass</h4>
      <p className="lead">
        A mode over your theme: floating glass panels on a background. While it&rsquo;s on, the
        titlebar sun becomes the tint dot — click it to cycle hues.
      </p>
      <button
        type="button"
        className={glassMode ? "sysrow on" : "sysrow"}
        aria-pressed={glassMode}
        onClick={() => setGlassMode(!glassMode)}
      >
        <span className="sysdot" aria-hidden="true" />
        Glass mode
      </button>
      {glassMode && (
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
                  setCustomBackground(URL.createObjectURL(file));
                  setGlassBackground("custom");
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="setnote">
            Your own image stays for this session — it lands with the rest of your stuff when
            files arrive in the next stage.
          </p>
        </>
      )}
    </>
  );
}

// ——— Storage: the corpus story (r1 frame F; path = the future default) ———

function StoragePane() {
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
          <div className="sd">~/Documents/rotli — plain files, works offline, free forever</div>
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
      <div className="corpus">
        <div className="tree">
          <i>~/Documents/rotli/</i>
          <br />
          ├─ <b>Inbox/</b>
          <br />
          │&nbsp;&nbsp; └─ call-the-bank.md
          <br />
          ├─ <b>Work/</b>
          <br />
          │&nbsp;&nbsp; ├─ Myela/
          <br />
          │&nbsp;&nbsp; │&nbsp;&nbsp; └─ pricing-decision.md
          <br />
          │&nbsp;&nbsp; └─ 1-on-1s/
          <br />
          │&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; └─ sarah.md
          <br />
          ├─ <b>Personal/</b>
          <br />
          │&nbsp;&nbsp; └─ Ideas/
          <br />
          │&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; └─ rotli-notes…md
          <br />
          └─ <i>.rotli/&nbsp;&nbsp;(index · settings)</i>
        </div>
        <div className="mdfile">
          <i># Personal/Ideas/rotli-notes-first.md</i>
          <br />
          ---
          <br />
          created: 2026-06-11T09:42
          <br />
          updated: 2026-06-11T10:05
          <br />
          pinned: false
          <br />
          ---
          <br />
          Apple Notes feel, **markdown underneath**.
          <br />
          Local files, one structure the AI can read…
        </div>
      </div>
      <p className="setnote">
        Folders in the sidebar <strong>are</strong> folders on disk — one mental model. The hidden{" "}
        <code>.rotli/</code> holds the search index and settings; deleting it loses nothing but a
        rebuild.
      </p>
    </>
  );
}

function PluginsPane() {
  return (
    <>
      <h3>Plugins</h3>
      <p className="lead">Plugins arrive later — breve will live here.</p>
    </>
  );
}

export function SettingsSurface() {
  const [pane, setPane] = useState<SettingsPane>("hotkeys");

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
          <kbd>esc</kbd>
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
        {pane === "general" && <GeneralPane />}
        {pane === "hotkeys" && <HotkeysPane />}
        {pane === "appearance" && <AppearancePane />}
        {pane === "storage" && <StoragePane />}
        {pane === "plugins" && <PluginsPane />}
      </div>
    </div>
  );
}
