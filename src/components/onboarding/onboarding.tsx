// First-run setup is intentionally short: app feel first, vault activation
// second. A user may skip these preferences without silently accepting a notes
// location; create/open/import remains an explicit next screen.

import { type CSSProperties, type KeyboardEvent, useEffect, useState } from "react";

import {
  DEFAULT_QUOKKA_ACCESSORY_HUE,
  DEFAULT_QUOKKA_CUSTOM_HUE,
  QUOKKA_ACCESSORY_PRESENTATIONS,
  QUOKKA_STYLE_PRESENTATIONS,
  quokkaAccessoryColor,
  quokkaCustomColor,
} from "../../brand/quokka";
import { resolveChord, useBindingsStore } from "../../keys/bindings";
import { chordFromEvent, formatChord, toAccelerator } from "../../keys/chords";
import { setSetupHandle } from "../../keys/handles";
import { allActions, conflictFor, getAction, rebind, setDispatchSuspended } from "../../keys/registry";
import { setGlobalShortcut } from "../../lib/tauri";
import { DEFAULT_APPEARANCE } from "../../state/appearanceDefaults";
import {
  ONBOARDING_STEP_NUMBER,
  ONBOARDING_TOTAL_STEPS,
  startingAppearance,
  windowBehaviorOnSkip,
} from "../../state/onboarding";
import { startSetupDetection } from "../../state/setupDetection";
import { THEME_FAMILY_PRESENTATIONS, type ThemeFamily, type ThemeSetting, useUiStore } from "../../state/ui";
import { Character } from "../character";

/** Compact accessory palette for first-run; Settings owns the full hue dial.
 * Amber first — it is the accessory default. */
const ACCESSORY_HUE_CHOICES = [38, 225, 195, 145, 280, 340, 10] as const;
import { AccentRow } from "../settingsSurface";
import { setupChoiceIndex, SetupBack, SetupChoiceGroup, SetupPrimary } from "./setupControls";
import { SetupSideFriends } from "./setupSideFriends";

const STEPS = ["welcome", "appearance", "behavior", "shortcuts"] as const;
type Step = (typeof STEPS)[number];

const HOTKEYS = [
  { id: "app.toggleWindow", label: "Open Rotli", hint: "Summon or tuck away the main window." },
  { id: "capture.summon", label: "Quick capture", hint: "Catch a thought without changing apps." },
  { id: "quick.summon", label: "Quick note", hint: "Open a small floating note." },
] as const;

function ThemeModeChoice({
  value,
  onChange,
}: {
  value: ThemeSetting;
  onChange: (mode: ThemeSetting) => void;
}) {
  const options: readonly { value: ThemeSetting; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];
  return (
    <div
      className="setup-mode-choice"
      role="radiogroup"
      aria-label="Appearance mode"
      onKeyDown={(event) => {
        if (!event.key.startsWith("Arrow") && event.key !== "Home" && event.key !== "End") return;
        const active = options.findIndex((option) => option.value === value);
        const next = setupChoiceIndex(event.key, active, options.length, true);
        if (next === null) return;
        event.preventDefault();
        const option = options[next];
        if (option) onChange(option.value);
      }}
    >
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className={value === option.value ? "selected" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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

export function Onboarding({ onDone, initialStep = "welcome" }: { onDone: () => void; initialStep?: Step }) {
  const [step, setStep] = useState<Step>(initialStep);
  const index = STEPS.indexOf(step);
  const theme = useUiStore((state) => state.theme);
  const family = useUiStore((state) => state.themeFamily);
  const showInDock = useUiStore((state) => state.showInDock);
  const stayOpen = useUiStore((state) => state.stayOpen);
  const userName = useUiStore((state) => state.userName);
  const setUserName = useUiStore((state) => state.setUserName);
  const quokkaCompanionEnabled = useUiStore((state) => state.quokkaCompanionEnabled);
  const setQuokkaCompanionEnabled = useUiStore((state) => state.setQuokkaCompanionEnabled);
  const quokkaStyle = useUiStore((state) => state.quokkaStyle);
  const setQuokkaStyle = useUiStore((state) => state.setQuokkaStyle);
  const quokkaCustomHue = useUiStore((state) => state.quokkaCustomHue);
  const setQuokkaCustomHue = useUiStore((state) => state.setQuokkaCustomHue);
  const quokkaAccessory = useUiStore((state) => state.quokkaAccessory);
  const setQuokkaAccessory = useUiStore((state) => state.setQuokkaAccessory);
  const quokkaAccessoryHue = useUiStore((state) => state.quokkaAccessoryHue);
  const setQuokkaAccessoryHue = useUiStore((state) => state.setQuokkaAccessoryHue);

  const move = (delta: -1 | 1) => {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, index + delta))];
    if (next) setStep(next);
  };
  const advance = () => (step === "shortcuts" ? onDone() : move(1));

  useEffect(() => {
    setSetupHandle({ continue: advance, ...(index > 0 ? { back: () => move(-1) } : {}) });
    return () => setSetupHandle(null);
  });
  // First run always opens in Rotli Light with the bare quokka, even when a
  // version bump re-onboards a personalized install; the appearance step is
  // where the person chooses again. Coming back from the vault step resumes at
  // shortcuts and must keep what was just chosen.
  useEffect(() => {
    if (initialStep === "welcome") useUiStore.setState(startingAppearance());
    // the Models step is six screens away: probe local models and signed-in
    // clients now so it opens already knowing what this Mac has
    startSetupDetection();
  }, [initialStep]);

  const pickFamily = (nextFamily: ThemeFamily) => {
    useUiStore.getState().setThemeFamily(nextFamily);
  };
  const pickMode = (nextTheme: ThemeSetting) => {
    useUiStore.getState().setTheme(nextTheme);
  };
  const behavior = showInDock && stayOpen ? "resident" : showInDock ? "dock" : "visitor";
  const pickBehavior = (value: "visitor" | "dock" | "resident") => {
    useUiStore.getState().setShowInDock(value !== "visitor");
    useUiStore.getState().setStayOpen(value === "resident");
  };
  const skip = () => {
    const ui = useUiStore.getState();
    useBindingsStore.setState({ overrides: {} });
    for (const action of allActions()) {
      if (!action.global) continue;
      void setGlobalShortcut(action.id, action.defaultChord ? toAccelerator(action.defaultChord) : null);
    }
    useUiStore.setState({
      ...DEFAULT_APPEARANCE,
      quokkaCompanionEnabled: false,
      quokkaStyle: "cocoa",
      quokkaCustomHue: DEFAULT_QUOKKA_CUSTOM_HUE,
      quokkaAccessory: "none",
      quokkaAccessoryHue: DEFAULT_QUOKKA_ACCESSORY_HUE,
      quokkaLineColor: "auto",
      quokkaIdlePose: "base",
      ...windowBehaviorOnSkip(ui.onboarded, ui.onboardingVersion),
    });
    onDone();
  };

  const titles: Record<Step, string> = {
    welcome: "Welcome",
    appearance: "Appearance",
    behavior: "Window",
    shortcuts: "Shortcuts",
  };

  return (
    <div className="onb">
      <div className="onb-drag" data-tauri-drag-region />
      <section className="setup-shell" aria-labelledby="setup-title">
        <div className="setup-progress">
          <span>
            {ONBOARDING_STEP_NUMBER[step]} of {ONBOARDING_TOTAL_STEPS}
          </span>
          <span aria-hidden="true">·</span>
          <span>{titles[step]}</span>
        </div>

        <SetupSideFriends />

        <div className="setup-stage" data-step={step} key={step}>
          <aside className={`setup-companion setup-companion--${step}`} aria-hidden="true">
            <Character
              name={
                step === "welcome"
                  ? "waving"
                  : step === "appearance"
                    ? "thoughtful"
                    : step === "behavior"
                      ? "walking"
                      : "listening"
              }
              size={152}
              accessorized={false}
              alwaysVisible
            />
            <p>
              {step === "shortcuts"
                ? "I’ll stay out of the way until you call."
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
                <label className="setup-name-field">
                  <span>
                    What should Rotli call you? <em>Optional</em>
                  </span>
                  <input
                    type="text"
                    value={userName}
                    maxLength={80}
                    autoComplete="name"
                    placeholder="Your first name"
                    onChange={(event) => setUserName(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        advance();
                      }
                    }}
                  />
                  <small>Used for greetings only. Enter continues without a name.</small>
                </label>
              </>
            )}

            {step === "appearance" && (
              <>
                <p className="setup-eyebrow">Start somewhere comfortable</p>
                <h1 id="setup-title">Choose a theme.</h1>
                <p className="setup-lede">Pick its character, then choose Light, Dark, or follow your Mac.</p>
                <SetupChoiceGroup
                  label="Theme"
                  value={family}
                  onChange={pickFamily}
                  options={THEME_FAMILY_PRESENTATIONS.map(
                    ({ family: optionFamily, label, description, lightLabel, darkLabel }) => ({
                      value: optionFamily,
                      title: label,
                      description,
                      detail: (
                        <span className="setup-theme-pair" aria-hidden="true">
                          <span className={`setup-theme-dot ${optionFamily}-light`} title={lightLabel} />
                          <span className={`setup-theme-dot ${optionFamily}-dark`} title={darkLabel} />
                        </span>
                      ),
                    }),
                  )}
                />
                <div className="setup-mode-row">
                  <span>Mode</span>
                  <ThemeModeChoice value={theme} onChange={pickMode} />
                  <small>{theme === "system" ? "Follows macOS" : `System is off · ${theme}`}</small>
                </div>
                <div className="setup-accent">
                  <span>Accent</span>
                  <AccentRow />
                </div>
                <div className="setup-quokka-row">
                  <span className="setup-quokka-preview" aria-hidden="true">
                    <Character name="base" size={66} accessory={quokkaAccessory} alwaysVisible />
                  </span>
                  <div className="setup-quokka-controls">
                    <label className="setup-quokka-mode">
                      <input
                        type="checkbox"
                        checked={quokkaCompanionEnabled}
                        onChange={(event) => setQuokkaCompanionEnabled(event.currentTarget.checked)}
                      />
                      <span>Keep my quokka throughout Rotli</span>
                    </label>
                    {quokkaCompanionEnabled && (
                      <>
                        <div className="setup-quokka-swatches" role="radiogroup" aria-label="Companion color">
                          {QUOKKA_STYLE_PRESENTATIONS.map((choice) => (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={choice.style === quokkaStyle}
                              aria-label={`${choice.label}: ${choice.description}`}
                              className={choice.style === quokkaStyle ? "selected" : ""}
                              key={choice.style}
                              onClick={() => setQuokkaStyle(choice.style)}
                            >
                              {choice.style === "line" ? (
                                <span className="setup-quokka-line-swatch" aria-hidden="true" />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  style={
                                    {
                                      backgroundColor: choice.color ?? quokkaCustomColor(quokkaCustomHue),
                                    } as CSSProperties
                                  }
                                />
                              )}
                            </button>
                          ))}
                          {quokkaStyle === "custom" && (
                            <input
                              type="range"
                              min="0"
                              max="359"
                              aria-label="Custom companion color hue"
                              value={quokkaCustomHue}
                              onChange={(event) => setQuokkaCustomHue(Number(event.currentTarget.value))}
                            />
                          )}
                        </div>
                        <span>Accessory</span>
                        <div className="setup-quokka-accrow">
                          <div className="setup-quokka-accs" role="radiogroup" aria-label="Accessory">
                            {QUOKKA_ACCESSORY_PRESENTATIONS.map((choice) => (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={quokkaAccessory === choice.accessory}
                                aria-label={`${choice.label}: ${choice.description}`}
                                title={choice.label}
                                className={quokkaAccessory === choice.accessory ? "selected" : ""}
                                key={choice.accessory}
                                onClick={() => setQuokkaAccessory(choice.accessory)}
                              >
                                <Character name="base" size={34} accessory={choice.accessory} alwaysVisible />
                              </button>
                            ))}
                          </div>
                          {quokkaAccessory !== "none" && quokkaStyle !== "line" && (
                            <div
                              className="setup-quokka-swatches"
                              role="radiogroup"
                              aria-label="Accessory color"
                            >
                              {ACCESSORY_HUE_CHOICES.map((hue) => (
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={quokkaAccessoryHue === hue}
                                  aria-label={`Accessory hue ${hue}°`}
                                  className={quokkaAccessoryHue === hue ? "selected" : ""}
                                  key={hue}
                                  onClick={() => setQuokkaAccessoryHue(hue)}
                                >
                                  <span
                                    aria-hidden="true"
                                    style={{ backgroundColor: quokkaAccessoryColor(hue) } as CSSProperties}
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <small>Expressions change with the moment. Your look follows them.</small>
                      </>
                    )}
                  </div>
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
                      value: "dock",
                      title: "Dock companion",
                      description: "Appears in the Dock; still tucks away on blur.",
                    },
                    {
                      value: "visitor",
                      title: "Quiet visitor",
                      description: "Menu bar only; hides when you click away.",
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
          </div>
        </div>

        <footer className="setup-footer">
          <button type="button" className="setup-skip" onClick={skip}>
            Skip app setup
          </button>
          <div className="setup-actions">
            {index > 0 && <SetupBack onClick={() => move(-1)} />}
            <SetupPrimary onClick={advance}>
              {step === "welcome"
                ? "Get started"
                : step === "shortcuts"
                  ? "Choose where notes live"
                  : "Continue"}
            </SetupPrimary>
          </div>
        </footer>
      </section>
    </div>
  );
}
