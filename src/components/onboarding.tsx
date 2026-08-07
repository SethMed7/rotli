// First-run setup is intentionally short: app feel first, vault activation
// second. A user may skip these preferences without silently accepting a notes
// location; create/open/import remains an explicit next screen.

import { type KeyboardEvent, useEffect, useState } from "react";

import { resolveChord, useBindingsStore } from "../keys/bindings";
import { chordFromEvent, formatChord, toAccelerator } from "../keys/chords";
import { allActions, conflictFor, getAction, rebind, setDispatchSuspended } from "../keys/registry";
import { setSetupHandle } from "../lib/setupHandle";
import { setGlobalShortcut } from "../lib/tauri";
import { SOLID_THEMES, type ThemeFamily, type ThemeSetting, useUiStore } from "../state/ui";
import { Character } from "./character";
import { AccentRow } from "./settingsSurface";
import { SetupChoiceGroup, SetupPrimary } from "./setupControls";

const STEPS = ["welcome", "appearance", "behavior", "shortcuts", "ready"] as const;
type Step = (typeof STEPS)[number];

const THEME_COPY: Record<string, string> = {
  "Warm Light": "Soft clay and cream.",
  "Warm Dark": "Warm, low-light cocoa.",
  Paper: "Calm black on white.",
  Charcoal: "Quiet near-black contrast.",
};

const HOTKEYS = [
  { id: "app.toggleWindow", label: "Open Rotli", hint: "Summon or tuck away the main window." },
  { id: "capture.summon", label: "Quick capture", hint: "Catch a thought without changing apps." },
  { id: "quick.summon", label: "Quick note", hint: "Open a small floating note." },
] as const;

function ChordRow({ id, label, hint }: (typeof HOTKEYS)[number]) {
  const overrides = useBindingsStore((state) => state.overrides);
  const action = getAction(id);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDispatchSuspended(recording);
    return () => setDispatchSuspended(false);
  }, [recording]);

  if (!action) return null;
  const chord = resolveChord(overrides, id, action.defaultChord);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    const next = chordFromEvent(event.nativeEvent);
    if (!next) return;
    const key = next.split("+").pop() ?? "";
    if (!(event.ctrlKey || event.altKey || event.metaKey) && !/^F\d{1,2}$/.test(key)) return;
    const conflict = conflictFor(id, next);
    if (conflict) {
      setMessage(`Already used by “${conflict.title}”.`);
      setRecording(false);
      return;
    }
    setMessage(null);
    setRecording(false);
    void rebind(id, next).catch(() => setMessage("macOS kept the previous shortcut."));
  };

  return (
    <div className="setup-shortcut-row">
      <span className="setup-shortcut-copy">
        <strong>{label}</strong>
        <span>{hint}</span>
        {message && <em>{message}</em>}
      </span>
      <button
        type="button"
        className={recording ? "hkchord recording" : "hkchord"}
        aria-label={`Change ${label} shortcut`}
        onClick={(event) => {
          event.currentTarget.focus();
          setMessage(null);
          setRecording(true);
        }}
        onKeyDown={recording ? onKeyDown : undefined}
        onBlur={() => setRecording(false)}
      >
        {recording ? "Press keys…" : chord ? <kbd>{formatChord(chord)}</kbd> : "Not set"}
      </button>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const index = STEPS.indexOf(step);
  const theme = useUiStore((state) => state.theme);
  const family = useUiStore((state) => state.themeFamily);
  const showInDock = useUiStore((state) => state.showInDock);
  const stayOpen = useUiStore((state) => state.stayOpen);

  const move = (delta: -1 | 1) => {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, index + delta))];
    if (next) setStep(next);
  };
  const advance = () => (step === "ready" ? onDone() : move(1));

  useEffect(() => {
    setSetupHandle({ continue: advance });
    return () => setSetupHandle(null);
  });

  const pickTheme = (value: string) => {
    const [nextFamily, nextTheme] = value.split(":") as [ThemeFamily, ThemeSetting];
    useUiStore.getState().setThemeFamily(nextFamily);
    useUiStore.getState().setTheme(nextTheme);
  };
  const behavior = showInDock && stayOpen ? "resident" : showInDock ? "dock" : "visitor";
  const pickBehavior = (value: "visitor" | "dock" | "resident") => {
    useUiStore.getState().setShowInDock(value !== "visitor");
    useUiStore.getState().setStayOpen(value === "resident");
  };
  const skip = () => {
    useBindingsStore.setState({ overrides: {} });
    for (const action of allActions()) {
      if (!action.global) continue;
      void setGlobalShortcut(action.id, action.defaultChord ? toAccelerator(action.defaultChord) : null);
    }
    useUiStore.setState({
      theme: "system",
      themeFamily: "mono",
      matchLightFamily: "mono",
      matchDarkFamily: "mono",
      syntaxPalette: "rotli",
      accentColor: "default",
      stayOpen: false,
      showInDock: false,
    });
    onDone();
  };

  const themeValue = `${family}:${theme}`;
  const titles: Record<Step, string> = {
    welcome: "Welcome",
    appearance: "Appearance",
    behavior: "Window",
    shortcuts: "Shortcuts",
    ready: "Ready",
  };

  return (
    <div className="onb">
      <div className="onb-drag" data-tauri-drag-region />
      <section className="setup-shell" aria-labelledby="setup-title">
        <div className="setup-progress">
          <span>
            {index + 1} of {STEPS.length}
          </span>
          <span aria-hidden="true">·</span>
          <span>{titles[step]}</span>
        </div>

        <div className="setup-stage" key={step}>
          <aside className="setup-companion" aria-hidden="true">
            <Character
              name={
                step === "welcome"
                  ? "waving"
                  : step === "appearance"
                    ? "rest"
                    : step === "behavior"
                      ? "base"
                      : step === "shortcuts"
                        ? "searching"
                        : "celebrating"
              }
              size={152}
            />
            <p>
              {step === "shortcuts"
                ? "I’ll stay out of the way until you call."
                : step === "ready"
                  ? "Nice. Now let’s give your notes a home."
                  : "Everything here can change later."}
            </p>
          </aside>

          <div className="setup-content">
            {step === "welcome" && (
              <>
                <p className="setup-eyebrow">Local-first notes for your Mac</p>
                <h1 id="setup-title">Make Rotli feel like yours.</h1>
                <p className="setup-lede">
                  Pick a look, choose how the window behaves, and meet the three shortcuts worth remembering.
                  Your notes folder comes next—and is always an explicit choice.
                </p>
              </>
            )}

            {step === "appearance" && (
              <>
                <p className="setup-eyebrow">Start somewhere comfortable</p>
                <h1 id="setup-title">Choose an environment.</h1>
                <p className="setup-lede">
                  Paper and Charcoal are the calm defaults; the warm pair keeps Rotli’s softer side.
                </p>
                <SetupChoiceGroup
                  label="Environment"
                  value={themeValue}
                  onChange={pickTheme}
                  options={[
                    {
                      value: "mono:system",
                      title: "Match my Mac",
                      description: "Paper by day, Charcoal by night.",
                      detail: <span className="setup-theme-dot mono-system" aria-hidden="true" />,
                    },
                    ...SOLID_THEMES.map(({ family: optionFamily, mode, label }) => ({
                      value: `${optionFamily}:${mode}`,
                      title: label,
                      description: THEME_COPY[label] ?? "",
                      detail: (
                        <span className={`setup-theme-dot ${optionFamily}-${mode}`} aria-hidden="true" />
                      ),
                    })),
                  ]}
                />
                <div className="setup-accent">
                  <span>Accent</span>
                  <AccentRow />
                </div>
              </>
            )}

            {step === "behavior" && (
              <>
                <p className="setup-eyebrow">Choose a rhythm</p>
                <h1 id="setup-title">How should the window live?</h1>
                <p className="setup-lede">
                  The menu-bar icon is always available. This controls the Dock and what happens when you
                  click away.
                </p>
                <SetupChoiceGroup
                  label="Window behavior"
                  value={behavior}
                  onChange={pickBehavior}
                  options={[
                    {
                      value: "visitor",
                      title: "Quiet visitor",
                      description: "Menu bar only; hides when you click away.",
                    },
                    {
                      value: "dock",
                      title: "Dock companion",
                      description: "Appears in the Dock; still tucks away on blur.",
                    },
                    {
                      value: "resident",
                      title: "Stay with me",
                      description: "Dock app that remains open like a normal workspace.",
                    },
                  ]}
                />
                <p className="setup-arrow-note">
                  <kbd>←</kbd>
                  <kbd>→</kbd> moves and selects
                </p>
              </>
            )}

            {step === "shortcuts" && (
              <>
                <p className="setup-eyebrow">Call Rotli from anywhere</p>
                <h1 id="setup-title">Three shortcuts, right where they act.</h1>
                <p className="setup-lede">Keep these defaults or click a shortcut to record your own.</p>
                <div className="setup-shortcuts">
                  {HOTKEYS.map((hotkey) => (
                    <ChordRow key={hotkey.id} {...hotkey} />
                  ))}
                </div>
              </>
            )}

            {step === "ready" && (
              <>
                <p className="setup-eyebrow">App setup complete</p>
                <h1 id="setup-title">Now choose where your notes live.</h1>
                <p className="setup-lede">
                  Create a fresh vault, open an Obsidian or ZenNotes folder in place, or import a copy. Rotli
                  keeps one Main view while preserving every nested folder.
                </p>
              </>
            )}
          </div>
        </div>

        <footer className="setup-footer">
          <button type="button" className="setup-skip" onClick={skip}>
            Skip app setup
          </button>
          <div className="setup-actions">
            {index > 0 && (
              <button type="button" className="setup-button secondary" onClick={() => move(-1)}>
                <kbd aria-hidden="true">←</kbd>
                <span>Back</span>
              </button>
            )}
            <SetupPrimary onClick={advance}>
              {step === "welcome" ? "Get started" : step === "ready" ? "Choose a vault" : "Continue"}
            </SetupPrimary>
          </div>
        </footer>
      </section>
    </div>
  );
}
