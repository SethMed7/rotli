// Settings — the r1 frame F window grammar: left nav (Hotkeys · Appearance ·
// Storage · Plugins) + one surface. Esc closes back to notes (the registry's
// app.hide chain). Storage shows the corpus story with the future default path
// ~/Documents/rotli; "Later" cards are quiet and non-interactive. Hotkeys is
// the rebind list: click a chord, press the next combo (a quiet inline note if
// the chord is taken).

import { type KeyboardEvent, useState } from "react";
import { resolveChord, useBindingsStore } from "../keys/bindings";
import { chordFromEvent, formatChord } from "../keys/chords";
import { type KeyAction, allActions, conflictFor, rebind } from "../keys/registry";
import { GLASS_TINTS, type ThemeFamily, type ThemeSetting, useUiStore } from "../state/ui";
import {
  CheckGlyph,
  CloudGlyph,
  DatabaseGlyph,
  KeyboardGlyph,
  LaptopGlyph,
  PlusGlyph,
  SunGlyph,
} from "./glyphs";

type SettingsPane = "hotkeys" | "appearance" | "storage" | "plugins";

const NAV: { id: SettingsPane; label: string; glyph: typeof KeyboardGlyph }[] = [
  { id: "hotkeys", label: "Hotkeys", glyph: KeyboardGlyph },
  { id: "appearance", label: "Appearance", glyph: SunGlyph },
  { id: "storage", label: "Storage", glyph: DatabaseGlyph },
  { id: "plugins", label: "Plugins", glyph: PlusGlyph },
];

// ——— Hotkeys: every registry action, label + chord, click-to-record ———

function HotkeysPane() {
  const overrides = useBindingsStore((s) => s.overrides);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; withTitle: string } | null>(null);

  const chordOf = (a: KeyAction) => resolveChord(overrides, a.id, a.defaultChord);

  // The recording button captures the next keydown itself (it IS the rebind
  // widget — like a text input handling its own typing); stopPropagation keeps
  // the chord from also reaching the window dispatcher.
  const onRecordKeyDown = (action: KeyAction) => (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const chord = chordFromEvent(event.nativeEvent);
    if (!chord) return; // modifiers alone — keep listening
    const taken = conflictFor(action.id, chord);
    if (taken) {
      setConflict({ id: action.id, withTitle: taken.title });
      setRecordingId(null);
      return;
    }
    setConflict(null);
    setRecordingId(null);
    void rebind(action.id, chord);
  };

  return (
    <>
      <h3>Hotkeys</h3>
      <p className="lead">
        Every shortcut in rotli is yours to rebind. Click a chord, press the new keys.
      </p>
      <div className="hkrows">
        {allActions().map((action) => {
          const recording = recordingId === action.id;
          const chord = chordOf(action);
          return (
            <div className="hkrow" key={action.id}>
              <span className="hklabel">{action.title}</span>
              {conflict?.id === action.id && (
                <span className="hkconflict">taken by “{conflict.withTitle}”</span>
              )}
              <button
                type="button"
                className={recording ? "hkchord recording" : "hkchord"}
                aria-label={`Rebind ${action.title}`}
                onClick={() => {
                  setRecordingId(action.id);
                  setConflict(null);
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
        })}
      </div>
    </>
  );
}

// ——— Appearance: family (warm / mono) + the explicit three-way mode ———

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const FAMILIES: {
  value: ThemeFamily;
  label: string;
  caption: string;
  swatches: [string, string];
}[] = [
  {
    value: "warm",
    label: "Warm",
    caption: "Paper under lamplight — the rotli default.",
    swatches: ["var(--swatch-warm-light)", "var(--swatch-warm-dark)"],
  },
  {
    value: "mono",
    label: "Mono",
    caption: "Simple white & black. Charcoal after dark.",
    swatches: ["var(--swatch-paper)", "var(--swatch-charcoal)"],
  },
  {
    value: "glass",
    label: "Liquid Glass",
    caption: "Translucent chrome, one hue at a time.",
    swatches: ["var(--swatch-dusk)", "var(--swatch-blush)"],
  },
];

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
  const glassTint = useUiStore((s) => s.glassTint);
  const setGlassTint = useUiStore((s) => s.setGlassTint);
  return (
    <>
      <h3>Appearance</h3>
      <p className="lead">Pick your light. Light, Dark, and System work inside every family.</p>
      <div className="famrow">
        {FAMILIES.map(({ value, label, caption, swatches }) => (
          <button
            type="button"
            key={value}
            className={themeFamily === value ? "famcard sel" : "famcard"}
            aria-pressed={themeFamily === value}
            onClick={() => setThemeFamily(value)}
          >
            <span className="famswatches" aria-hidden="true">
              <i style={{ background: swatches[0] }} />
              <i style={{ background: swatches[1] }} />
            </span>
            <span className="famlabel">{label}</span>
            <span className="famcaption">{caption}</span>
          </button>
        ))}
      </div>
      {themeFamily === "glass" && (
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
      )}
      <div className="themerow">
        {THEMES.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={theme === value ? "aaseg sel" : "aaseg"}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            {label}
          </button>
        ))}
      </div>
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
        {pane === "hotkeys" && <HotkeysPane />}
        {pane === "appearance" && <AppearancePane />}
        {pane === "storage" && <StoragePane />}
        {pane === "plugins" && <PluginsPane />}
      </div>
    </div>
  );
}
