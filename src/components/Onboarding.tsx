// First-run onboarding (Seth, 2026-06-19). A guided setup that surfaces the
// machinery rotli already has: the three global hotkeys (Open · Quick capture ·
// Quick note), the Dock policy, the visitor-vs-resident window behavior, and the
// theme. It does NOT invent new settings — every choice writes the same stores +
// native commands Settings does, so finishing here == having configured Settings
// by hand. Shown by App.tsx while ui.onboarded is false (Tauri only); "Reset &
// re-onboard" in Settings → General brings it back.

import { type KeyboardEvent, useEffect, useState } from "react";
import rMark from "../brand/logo/r-mark.svg";
import { resolveChord, useBindingsStore } from "../keys/bindings";
import { chordFromEvent, formatChord } from "../keys/chords";
import { conflictFor, getAction, rebind, setDispatchSuspended } from "../keys/registry";
import { useDetectMemex } from "../memex/useMemex";
import { useMemexStore } from "../state/memex";
import { GLASS_TINTS, SOLID_THEMES, type GlassTint, type ThemeFamily, useUiStore } from "../state/ui";

/** Tint swatch tokens (mirrors Settings → Appearance). */
const TINT_SWATCH: Record<string, string> = {
  dusk: "var(--swatch-dusk)",
  blush: "var(--swatch-blush)",
  clay: "var(--swatch-clay)",
  olive: "var(--swatch-olive)",
};

const STEPS = ["welcome", "hotkeys", "dock", "behavior", "appearance", "memory", "done"] as const;
type Step = (typeof STEPS)[number];

const GLOBAL_HOTKEYS: { id: string; label: string; hint: string }[] = [
  { id: "app.toggleWindow", label: "Open rotli", hint: "Summon or hide the window from anywhere." },
  {
    id: "capture.summon",
    label: "Quick capture",
    hint: "One breath into Inbox — without leaving what you’re doing.",
  },
  {
    id: "quick.summon",
    label: "Quick note",
    hint: "A floating note you pin and cycle through.",
  },
];

const THEME_CAPTION: Record<string, string> = {
  "Warm Light": "Paper under lamplight — the default.",
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

/** One hotkey row with the same recorder grammar as Settings → Hotkeys: click
 * to arm, press the next real chord, conflicts noted in place, the live
 * dispatcher stands down while recording. */
function ChordRow({ id, label, hint }: { id: string; label: string; hint: string }) {
  const overrides = useBindingsStore((s) => s.overrides);
  const action = getAction(id);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
    if (!next) return; // modifiers alone — keep listening
    const key = next.split("+").pop() ?? "";
    if (!(event.ctrlKey || event.altKey || event.metaKey) && !/^F\d{1,2}$/.test(key)) return;
    const taken = conflictFor(id, next);
    if (taken) {
      setNote(`taken by “${taken.title}”`);
      setRecording(false);
      return;
    }
    setNote(null);
    setRecording(false);
    rebind(id, next).catch(() => setNote("the system kept the previous chord"));
  };

  return (
    <div className="onb-hk">
      <span className="onb-hk-text">
        <span className="onb-hk-label">{label}</span>
        <span className="onb-hk-hint">{hint}</span>
      </span>
      {note && <span className="onb-hk-note">{note}</span>}
      <button
        type="button"
        className={recording ? "hkchord recording" : "hkchord"}
        aria-label={`Set the ${label} shortcut`}
        onClick={(event) => {
          event.currentTarget.focus(); // WebKit doesn't focus buttons on click
          setRecording(true);
          setNote(null);
        }}
        onKeyDown={recording ? onKeyDown : undefined}
        onBlur={() => setRecording(false)}
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
}

/** A big two-option choice card row (Dock + Behavior steps). */
function Choice<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: { value: T; title: string; desc: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="onb-choices">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          className={value === o.value ? "onb-choice sel" : "onb-choice"}
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
        >
          <span className="onb-choice-title">{o.title}</span>
          <span className="onb-choice-desc">{o.desc}</span>
        </button>
      ))}
    </div>
  );
}

/** The "Memory" step — detect an existing memex (Seth's ~/smBrain auto-appears)
 * and offer to Merge into it, or keep notes-only for now. The choice is RECORDED
 * into the memex store; App.tsx commits it (connect) on finish, the same deferred
 * pattern as dock/behavior. Creating a fresh separate brain lives in Settings →
 * Memory (it needs a folder picker — kept out of the onboarding flow). */
function MemexStep() {
  const detect = useDetectMemex(true);
  const setPendingChoice = useMemexStore((s) => s.setPendingChoice);
  const pending = useMemexStore((s) => s.pendingChoice);
  const found = detect.data ?? [];
  const isMerge = (root: string) => pending?.kind === "merge" && pending.path === root;
  const isLater = pending?.kind === "later";

  return (
    <div className="onb-step">
      <h1 className="onb-title">Your second brain</h1>
      <p className="onb-sub">
        rotli can sit on top of a <b>memex</b> — your local knowledge spine. It reads your whole
        brain and writes your chats and quick captures into it, never your history or self.
      </p>
      {detect.isLoading ? (
        <p className="onb-sub">Looking for an existing brain…</p>
      ) : (
        <div className="onb-choices">
          {found.map((d) => (
            <button
              key={d.root}
              type="button"
              className={isMerge(d.root) ? "onb-choice sel" : "onb-choice"}
              aria-pressed={isMerge(d.root)}
              onClick={() => setPendingChoice({ kind: "merge", path: d.root, label: d.label })}
            >
              <span className="onb-choice-title">Merge into {d.label}</span>
              <span className="onb-choice-desc">
                {d.root} · contract {d.contract ?? "?"}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={isLater ? "onb-choice sel" : "onb-choice"}
            aria-pressed={isLater}
            onClick={() => setPendingChoice({ kind: "later" })}
          >
            <span className="onb-choice-title">{found.length ? "Not now" : "Set it up later"}</span>
            <span className="onb-choice-desc">
              {found.length
                ? "Keep notes only — connect or start a brain anytime in Settings → Memory."
                : "No brain found here. Create or connect one anytime in Settings → Memory."}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const i = STEPS.indexOf(step);
  const go = (delta: 1 | -1) => {
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, i + delta))];
    if (next) setStep(next);
  };

  const showInDock = useUiStore((s) => s.showInDock);
  const setShowInDock = useUiStore((s) => s.setShowInDock);
  const stayOpen = useUiStore((s) => s.stayOpen);
  const setStayOpen = useUiStore((s) => s.setStayOpen);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const setThemeFamily = useUiStore((s) => s.setThemeFamily);
  const glassMode = useUiStore((s) => s.glassMode);
  const setGlassMode = useUiStore((s) => s.setGlassMode);
  const glassTint = useUiStore((s) => s.glassTint);
  const setGlassTint = useUiStore((s) => s.setGlassTint);

  // Record the choice only; App applies the Dock policy + hide-on-blur when
  // onboarding FINISHES — changing either live can kill the frameless window (#1).
  const pickDock = (v: "menu" | "dock") => setShowInDock(v === "dock");
  const pickBehavior = (v: "visitor" | "resident") => setStayOpen(v === "resident");

  const finish = () => onDone();
  const last = STEPS.length - 1;

  return (
    <div className="onb">
      <div className="onb-drag" data-tauri-drag-region />
      <div className="onb-card">
        {step === "welcome" && (
          <div className="onb-step onb-welcome">
            <img className="onb-mark" src={rMark} alt="" width={56} height={56} />
            <h1 className="onb-title">Welcome to rotli</h1>
            <p className="onb-sub">
              A warm, local-first notes app that lives in your menu bar. Let’s set up the few
              things that make it yours — your shortcuts, where it lives, and how it looks. Two
              minutes, and everything here is changeable later in Settings.
            </p>
          </div>
        )}

        {step === "hotkeys" && (
          <div className="onb-step">
            <h1 className="onb-title">Your shortcuts</h1>
            <p className="onb-sub">
              These three work from anywhere on your Mac. Keep the defaults, or click a chord and
              press your own.
            </p>
            <div className="onb-hks">
              {GLOBAL_HOTKEYS.map((h) => (
                <ChordRow key={h.id} {...h} />
              ))}
            </div>
          </div>
        )}

        {step === "dock" && (
          <div className="onb-step">
            <h1 className="onb-title">Where rotli lives</h1>
            <p className="onb-sub">
              The menu-bar icon stays either way — this is just whether rotli also gets a Dock
              icon and a ⌘Tab entry.
            </p>
            <Choice
              value={showInDock ? "dock" : "menu"}
              onPick={pickDock}
              options={[
                {
                  value: "menu",
                  title: "Menu bar only",
                  desc: "A quiet visitor — no Dock icon, no ⌘Tab. The rotli way.",
                },
                {
                  value: "dock",
                  title: "Show in the Dock",
                  desc: "A normal app with a Dock icon and a ⌘Tab entry.",
                },
              ]}
            />
          </div>
        )}

        {step === "behavior" && (
          <div className="onb-step">
            <h1 className="onb-title">When you click away</h1>
            <p className="onb-sub">Should the window tuck itself away, or stay where it is?</p>
            <Choice
              value={stayOpen ? "resident" : "visitor"}
              onPick={pickBehavior}
              options={[
                {
                  value: "visitor",
                  title: "Hide when I click away",
                  desc: "Summon it, write, and it’s gone the moment you leave. The default.",
                },
                {
                  value: "resident",
                  title: "Stay open",
                  desc: "Keep the window put, like a normal app you live in.",
                },
              ]}
            />
          </div>
        )}

        {step === "appearance" && (
          <div className="onb-step">
            <h1 className="onb-title">Pick a look</h1>
            <p className="onb-sub">
              Four base themes — the titlebar sun cycles them. Turn on Liquid Glass for floating
              panels over a tint.
            </p>
            <div className={glassMode ? "famrow dim" : "famrow"}>
              {SOLID_THEMES.map(({ family, mode, label }) => {
                const selected = !glassMode && themeFamily === family && theme === mode;
                return (
                  <button
                    type="button"
                    key={label}
                    className={selected ? "famcard sel" : "famcard"}
                    aria-pressed={selected}
                    onClick={() => {
                      setThemeFamily(family as ThemeFamily);
                      setTheme(mode);
                    }}
                  >
                    <span
                      className="famswatch"
                      style={{ background: THEME_SWATCH[label] }}
                      aria-hidden="true"
                    />
                    <span className="famlabel">{label}</span>
                    <span className="famcaption">{THEME_CAPTION[label]}</span>
                  </button>
                );
              })}
            </div>
            <div className="onb-glass">
              <button
                type="button"
                role="switch"
                aria-checked={glassMode}
                className={glassMode ? "onb-glass-toggle on" : "onb-glass-toggle"}
                onClick={() => setGlassMode(!glassMode)}
              >
                <span className="onb-glass-text">
                  <span className="onb-glass-title">Liquid Glass</span>
                  <span className="onb-glass-desc">
                    Floating glass panels over a tint — a mode layered on your theme.
                  </span>
                </span>
                <span className="sw" aria-hidden="true">
                  <span className="swknob" />
                </span>
              </button>
              {glassMode && (
                <>
                  <div className="onb-glass-modes" role="radiogroup" aria-label="Glass mode">
                    {(["light", "dark"] as const).map((m) => (
                      <button
                        type="button"
                        key={m}
                        className={theme === m ? "onb-glass-mode sel" : "onb-glass-mode"}
                        aria-pressed={theme === m}
                        onClick={() => setTheme(m)}
                      >
                        {m === "light" ? "Glass Light" : "Glass Dark"}
                      </button>
                    ))}
                  </div>
                  <div className="onb-tints" role="radiogroup" aria-label="Glass tint">
                    {GLASS_TINTS.map(({ value, label }) => (
                      <button
                        type="button"
                        key={value}
                        className={glassTint === value ? "onb-tint sel" : "onb-tint"}
                        aria-pressed={glassTint === value}
                        onClick={() => setGlassTint(value as GlassTint)}
                      >
                        <i style={{ background: TINT_SWATCH[value] }} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {step === "memory" && <MemexStep />}

        {step === "done" && (
          <div className="onb-step onb-welcome">
            <img className="onb-mark" src={rMark} alt="" width={56} height={56} />
            <h1 className="onb-title">You’re set</h1>
            <p className="onb-sub">
              Press your <b>Open</b> shortcut any time to summon rotli, and <b>Quick capture</b> to
              jot without breaking stride. Hold <kbd>⌘</kbd> in the window to see every shortcut.
              Change anything in Settings (<kbd>⌘,</kbd>).
            </p>
          </div>
        )}

        <div className="onb-foot">
          <div className="onb-dots" aria-hidden="true">
            {STEPS.map((s, n) => (
              <span key={s} className={n === i ? "onb-dot on" : "onb-dot"} />
            ))}
          </div>
          <div className="onb-actions">
            {i > 0 && i < last && (
              <button type="button" className="onb-skip" onClick={finish}>
                Skip setup
              </button>
            )}
            {i > 0 && (
              <button type="button" className="onb-btn ghost" onClick={() => go(-1)}>
                Back
              </button>
            )}
            {i < last ? (
              <button type="button" className="onb-btn" onClick={() => go(1)}>
                {i === 0 ? "Get started" : "Continue"}
              </button>
            ) : (
              <button type="button" className="onb-btn" onClick={finish}>
                Start using rotli
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
