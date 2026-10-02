// First-run setup (the owner, 2026-10-01, after testers' "too many steps
// before I can use the app"): four screens. You and your theme first, your
// vault second (vaultActivation.tsx), then who files your notes and the three
// shortcuts worth knowing. The window, music, quokka, and chat models wait in
// the app, where they're used: Settings, the sidebar player, and Chat.

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  LIBRARIAN_LABELS,
  librarianCaption,
  librarianModelFor,
  librarianOptions,
  suggestedLibrarian,
} from "../../ai/librarianLane";
import { providerCatalog } from "../../ai/models";
import { DEFAULT_QUOKKA_ACCESSORY_HUE, DEFAULT_QUOKKA_CUSTOM_HUE } from "../../brand/quokka";
import { resolveChord, useBindingsStore } from "../../keys/bindings";
import { chordFromEvent, formatChord, toAccelerator } from "../../keys/chords";
import { allActions, conflictFor, getAction, rebind, setDispatchSuspended } from "../../keys/registry";
import { DEFAULT_AMBIENT } from "../../lib/ambient";
import { setDockVisible, setGlobalShortcut } from "../../lib/tauri";
import { readyFrom, useConnectedCatalog } from "../../services/connectedModels";
import { useAmbient } from "../../state/ambient";
import { DEFAULT_APPEARANCE } from "../../state/appearanceDefaults";
import {
  ONBOARDING_STEP_NUMBER,
  ONBOARDING_TOTAL_STEPS,
  firstRunWindow,
  startingAppearance,
} from "../../state/onboarding";
import { flushSettingsNow } from "../../state/persist";
import { startSetupDetection, useSetupDetection } from "../../state/setupDetection";
import { THEME_FAMILY_PRESENTATIONS, type ThemeFamily, type ThemeSetting, useUiStore } from "../../state/ui";
import { Character } from "../character";
import { AccentRow } from "../settingsSurface";
import { OnboardingIntro, OnboardingScenery, introWanted } from "./onboardingScenery";
import { setupChoiceIndex, SetupBack, SetupChoiceGroup, SetupPrimary, useSetupHandle } from "./setupControls";
import { SetupScrollCue, useStageScrollCue } from "./setupScrollCue";

/** The screens this component draws; the vault screen is vaultActivation.tsx. */
export type SetupScreen = "you" | "librarian" | "shortcuts";

const HOTKEYS = [
  { id: "app.toggleWindow", label: "Open Rotli", hint: "Summon or tuck away the main window." },
  { id: "capture.summon", label: "Quick capture", hint: "Catch a thought without changing apps." },
  { id: "quick.summon", label: "Quick note", hint: "Open a small floating note." },
] as const;

const TITLES: Record<SetupScreen, string> = {
  you: "You",
  librarian: "Librarian",
  shortcuts: "Shortcuts",
};

const COMPANION: Record<SetupScreen, { pose: "waving" | "knowledge" | "listening"; line: string }> = {
  you: { pose: "waving", line: "Everything here can change later in Settings." },
  librarian: { pose: "knowledge", line: "I’ll keep the shelves tidy." },
  shortcuts: { pose: "listening", line: "Click any shortcut to make it yours." },
};

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

/** One shortcut, plainly changeable: its keys and a Change label on the same
 * button; recording says how to finish or cancel; a changed one can go back. */
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
  const changed = chord !== (action.defaultChord ?? null);
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
      <span className="setup-shortcut-actions">
        {changed && !recording && (
          <button
            type="button"
            className="setup-shortcut-reset"
            onClick={() => {
              setMessage(null);
              void rebind(id, action.defaultChord ?? null).catch(() =>
                setMessage("macOS kept the previous shortcut."),
              );
            }}
          >
            Use default
          </button>
        )}
        <button
          type="button"
          className={recording ? "hkchord setup-chord recording" : "hkchord setup-chord"}
          aria-label={recording ? `Press the new ${label} shortcut` : `Change ${label} shortcut`}
          onClick={(event) => {
            event.currentTarget.focus();
            setMessage(null);
            setRecording(true);
          }}
          onKeyDown={recording ? onKeyDown : undefined}
          onBlur={() => setRecording(false)}
        >
          {recording ? (
            "Press new keys… Esc cancels"
          ) : (
            <>
              {chord ? <kbd>{formatChord(chord)}</kbd> : "Not set"}
              <span className="setup-chord-change" aria-hidden="true">
                Change
              </span>
            </>
          )}
        </button>
      </span>
    </div>
  );
}

function YouScreen({ advance }: { advance: () => void }) {
  const theme = useUiStore((state) => state.theme);
  const family = useUiStore((state) => state.themeFamily);
  const userName = useUiStore((state) => state.userName);
  const setUserName = useUiStore((state) => state.setUserName);
  return (
    <>
      <h1 id="setup-title">Make Rotli yours.</h1>
      <p className="setup-lede">
        Your name and a theme now; your notes folder next. Your quokka, music, and the rest wait in Settings.
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
        <small>Used for greetings only.</small>
      </label>
      <SetupChoiceGroup
        label="Theme"
        value={family}
        onChange={(next: ThemeFamily) => useUiStore.getState().setThemeFamily(next)}
        options={THEME_FAMILY_PRESENTATIONS.map(({ family: optionFamily, label, lightLabel, darkLabel }) => ({
          value: optionFamily,
          title: label,
          // the site's lit orbs, Light and Dark (the owner, 2026-09-30)
          detail: (
            <span className="setup-theme-pair" aria-hidden="true">
              <span className="setup-orb" data-orb={`${optionFamily}-light`} title={lightLabel} />
              <span className="setup-orb" data-orb={`${optionFamily}-dark`} title={darkLabel} />
            </span>
          ),
        }))}
      />
      <div className="setup-mode-row">
        <span>Mode</span>
        <ThemeModeChoice value={theme} onChange={(next) => useUiStore.getState().setTheme(next)} />
        <small>{theme === "system" ? "Follows macOS" : `System is off · ${theme}`}</small>
      </div>
      <div className="setup-accent">
        <span>Accent</span>
        <AccentRow />
      </div>
    </>
  );
}

function LibrarianScreen() {
  const brainEnabled = useUiStore((state) => state.brainEnabled);
  const setBrainEnabled = useUiStore((state) => state.setBrainEnabled);
  const organizerModel = useUiStore((state) => state.organizerModel);
  const setOrganizerModel = useUiStore((state) => state.setOrganizerModel);
  // detection began on the first screen; by now the answers are usually in
  const detections = useSetupDetection((state) => state.detections);

  // Gemini is proposed once (per mount) when it is signed in and nothing was
  // chosen; picking any client below is the consent to use it
  const proposed = useRef(false);
  useEffect(() => {
    if (proposed.current) return;
    const proposal = suggestedLibrarian(detections, organizerModel);
    if (proposal === organizerModel) return;
    proposed.current = true;
    setOrganizerModel(proposal);
  }, [detections, organizerModel, setOrganizerModel]);

  return (
    <>
      <h1 id="setup-title">Who files your notes?</h1>
      <p className="setup-lede">
        The Librarian keeps your Library tidy on its own schedule: it files new notes and suggests moves for
        you to approve. It never rewrites what you wrote, and secure and locked notes never leave this Mac.
      </p>
      {/* the owner, 2026-10-01: whether first, then where it thinks */}
      <SetupChoiceGroup
        label="Librarian"
        value={brainEnabled ? "on" : "off"}
        onChange={(choice) => setBrainEnabled(choice === "on")}
        options={[
          {
            value: "on",
            title: "Use the Librarian",
            description: "It files and tidies for you. Every action is logged and undoable.",
          },
          {
            value: "off",
            title: "Not now",
            description: "You arrange your notes yourself. Turn it on anytime in Settings → Librarian.",
          },
        ]}
      />
      {brainEnabled && <LibrarianModel />}
      <p className="setup-local-note">
        Models for chat come the first time you open Chat. Everything else is in Settings → AI Models.
      </p>
    </>
  );
}

/** Where the Librarian thinks: this Mac or a connected client, and its model. */
function LibrarianModel() {
  const providers = useUiStore((state) => state.aiProviders);
  const setAiProvider = useUiStore((state) => state.setAiProvider);
  const providerDefaults = useUiStore((state) => state.providerDefaults);
  const organizerModel = useUiStore((state) => state.organizerModel);
  const setOrganizerModel = useUiStore((state) => state.setOrganizerModel);
  const organizerModelId = useUiStore((state) => state.organizerModelId);
  const setOrganizerModelId = useUiStore((state) => state.setOrganizerModelId);
  const detections = useSetupDetection((state) => state.detections);
  const { lanes } = useConnectedCatalog(providers, readyFrom(detections));
  return (
    <>
      <section className="setup-librarian" aria-labelledby="librarian-title">
        <strong id="librarian-title">The Librarian thinks</strong>
        <div className="setup-librarian-options" role="group" aria-label="Librarian model">
          {librarianOptions(detections, organizerModel).map((lane) => (
            <button
              key={lane}
              type="button"
              className={`setup-model-action${organizerModel === lane ? " selected" : ""}`}
              aria-pressed={organizerModel === lane}
              onClick={() => {
                setOrganizerModel(lane);
                if (lane !== "local") setAiProvider(lane, true);
              }}
            >
              {LIBRARIAN_LABELS[lane]}
            </button>
          ))}
        </div>
        {organizerModel !== "local" && (
          <label className="setselect-row">
            <span>Model</span>
            <select
              className="setselect"
              aria-label="Librarian model"
              value={librarianModelFor(organizerModel, organizerModelId, providerDefaults)}
              onChange={(event) => setOrganizerModelId(event.currentTarget.value)}
            >
              {providerCatalog(organizerModel, lanes).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="setup-librarian-caption">
          {librarianCaption(organizerModel, organizerModel === "local" || providers[organizerModel])}
        </p>
      </section>
    </>
  );
}

function ShortcutsScreen() {
  return (
    <>
      <h1 id="setup-title">Three shortcuts, yours to change.</h1>
      <p className="setup-lede">
        They work from any app. Keep these, or click one and press the keys you’d rather use. You can change
        them anytime in Settings → Hotkeys.
      </p>
      <div className="setup-shortcuts">
        {HOTKEYS.map((hotkey) => (
          <ChordRow key={hotkey.id} {...hotkey} />
        ))}
      </div>
    </>
  );
}

/** Skip setup: Rotli's defaults, and on a true first run the new-install window. */
function skipToDefaults(): void {
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
    ...firstRunWindow(ui.onboarded, ui.onboardingVersion),
  });
  useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT } });
}

export function Onboarding({
  step,
  onDone,
  onBack,
  resumed = false,
}: {
  step: SetupScreen;
  onDone: () => void;
  onBack?: () => void;
  /** Back from a later screen: keep what was chosen, no intro, no reset. */
  resumed?: boolean;
}) {
  // a fresh first run opens on the island (onboardingScenery.tsx)
  const [intro, setIntro] = useState(() => introWanted(step === "you" && !resumed));
  // a short window: the step scrolls, and says so
  const [stageRef, showScrollCue, stageScrolls] = useStageScrollCue();
  const advance = onDone;

  useSetupHandle(advance, onBack);
  // A fresh first run starts in Rotli Light with the plain quokka, and a new
  // install is in the Dock from this screen on (testers lost a menu-bar-only
  // app mid-setup); saved at once, so a quit here relaunches in the Dock too.
  useEffect(() => {
    if (step !== "you" || resumed) return;
    const ui = useUiStore.getState();
    const firstWindow = firstRunWindow(ui.onboarded, ui.onboardingVersion);
    useUiStore.setState({ ...startingAppearance(), ...firstWindow });
    if (firstWindow.showInDock) {
      void setDockVisible(true).catch(() => {});
      void flushSettingsNow().catch(() => {});
    }
    // the Librarian screen is two screens away: probe local models and
    // signed-in clients now so it opens already knowing what this Mac has
    startSetupDetection();
  }, [step, resumed]);

  const companion = COMPANION[step];
  return (
    <div className="onb" data-intro={intro ? "" : undefined}>
      <div className="onb-drag" data-tauri-drag-region />
      {/* Rotli's own theme is the island; another pick previews its scenery live */}
      <OnboardingScenery />
      <section className="setup-shell" aria-labelledby="setup-title">
        <div className="setup-progress">
          <span>
            {ONBOARDING_STEP_NUMBER[step]} of {ONBOARDING_TOTAL_STEPS}
          </span>
          <span aria-hidden="true">·</span>
          <span>{TITLES[step]}</span>
        </div>

        <div
          className={["setup-stage", stageScrolls && "is-scrolling", showScrollCue && "has-more"]
            .filter(Boolean)
            .join(" ")}
          data-step={step}
          key={step}
          ref={stageRef}
        >
          <aside className={`setup-companion setup-companion--${step}`} aria-hidden="true">
            <Character name={companion.pose} size={152} alwaysVisible />
            <p>{companion.line}</p>
          </aside>

          <div className="setup-content">
            {step === "you" && <YouScreen advance={advance} />}
            {step === "librarian" && <LibrarianScreen />}
            {step === "shortcuts" && <ShortcutsScreen />}
          </div>
        </div>

        {showScrollCue && <SetupScrollCue />}

        <footer className="setup-footer">
          {step === "you" ? (
            <button
              type="button"
              className="setup-skip"
              onClick={() => {
                skipToDefaults();
                onDone();
              }}
            >
              Skip app setup
            </button>
          ) : (
            <span />
          )}
          <div className="setup-actions">
            {onBack && <SetupBack onClick={onBack} />}
            <SetupPrimary onClick={advance}>
              {step === "you"
                ? "Choose where notes live"
                : step === "shortcuts"
                  ? "Finish setup"
                  : "Continue"}
            </SetupPrimary>
          </div>
        </footer>
      </section>
      {intro && <OnboardingIntro onDone={() => setIntro(false)} />}
    </div>
  );
}
