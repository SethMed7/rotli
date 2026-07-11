// First-run onboarding (Seth, 2026-06-19). A guided setup that surfaces the
// machinery rotli already has: the three global hotkeys (Open · Quick capture ·
// Quick note), the Dock policy, the visitor-vs-resident window behavior, and the
// theme. It does NOT invent new settings — every choice writes the same stores +
// native commands Settings does, so finishing here == having configured Settings
// by hand. Shown by App.tsx while ui.onboarded is false (Tauri only); "Reset &
// re-onboard" in Settings → General brings it back.

import { type KeyboardEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Character } from "./character";
import { resolveChord, useBindingsStore } from "../keys/bindings";
import { chordFromEvent, formatChord } from "../keys/chords";
import { conflictFor, getAction, rebind, setDispatchSuspended } from "../keys/registry";
import {
  chatModels,
  corpusOverview,
  isTauri,
  localModelInstall,
  localModelInstallProgress,
} from "../lib/tauri";
import { LOCAL_CATALOG } from "../ai/models";
import { LaptopGlyph } from "./glyphs";
import { useDetectMemex } from "../memex/useMemex";
import { pickFolder } from "../memex/service";
import { useMemexStore } from "../state/memex";
import { SOLID_THEMES, type ThemeFamily, useUiStore } from "../state/ui";

// Appearance FIRST (right after the greeting) so you pick a theme before walking the
// rest of setup — never trudge through the flow in a theme that hurts your eyes (Seth).
const STEPS = ["welcome", "appearance", "hotkeys", "dock", "behavior", "memory", "models", "done"] as const;
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

/** The "Your brain" step — the user picks WHERE their notes live: adopt a memex we
 * detect on this Mac (Use), scaffold a fresh one at a folder they choose (Create),
 * or keep a plain ~/Documents/rotli notes folder (later). The choice is RECORDED
 * into the memex store; App.tsx commits it on finish (the same deferred pattern as
 * dock/behavior), so the brain-setting relaunch happens once, after onboarding. */
function MemexStep() {
  const detect = useDetectMemex(true);
  const setPendingChoice = useMemexStore((s) => s.setPendingChoice);
  const pending = useMemexStore((s) => s.pendingChoice);
  // On a 0.x RE-onboard the corpus already lives somewhere the user chose — pre-
  // seed a SELECTED "Keep my current location" card so walking through with
  // Continue can never relocate it (#12, audit 2026-07). A true first run
  // (onboarded=false) still requires the explicit choice — no silent default
  // (the v0.8.7 rule). Committing "keep" is a deliberate no-op in App.tsx.
  const onboardedBefore = useUiStore((s) => s.onboarded);
  const overview = useQuery({
    queryKey: ["corpus", "overview"],
    queryFn: corpusOverview,
    enabled: isTauri() && onboardedBefore,
  });
  const currentRoot = onboardedBefore ? (overview.data?.root ?? null) : null;
  useEffect(() => {
    if (!currentRoot) return;
    // never clobber a choice the user already made this session
    if (useMemexStore.getState().pendingChoice) return;
    setPendingChoice({
      kind: "keep",
      path: currentRoot,
      label: currentRoot.split("/").pop() ?? currentRoot,
    });
  }, [currentRoot, setPendingChoice]);
  // only real memexes are adoptable as the corpus — and never offer the one that
  // IS the current location: the "Keep my current location" card already
  // represents it, so a separate "Use …" card is the SAME folder shown twice and
  // choosing it is a no-op relocate-to-where-you-already-are (Seth #6,
  // 2026-07-03). Compare path-normalized (tolerate a trailing slash).
  const samePath = (a: string | null, b: string | null): boolean =>
    !!a && !!b && a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
  const found = (detect.data ?? []).filter(
    (d) => d.kind === "memex" && !samePath(d.root, currentRoot),
  );
  const isKeep = pending?.kind === "keep";
  const isUse = (root: string) => pending?.kind === "use" && pending.path === root;
  const isInit = pending?.kind === "init";
  // a plain-folder pick is kind "use" with a path that ISN'T a detected memex
  const plainPath =
    pending?.kind === "use" && !found.some((d) => d.root === pending.path) ? pending.path : null;

  const createNew = async () => {
    const path = await pickFolder();
    if (path) setPendingChoice({ kind: "init", path });
  };
  const usePlain = async () => {
    const path = await pickFolder();
    if (path) setPendingChoice({ kind: "use", path, label: path.split("/").pop() ?? path });
  };

  return (
    <div className="onb-step">
      <h1 className="onb-title">Your brain</h1>
      <p className="onb-sub">
        rotli keeps your notes in <b>one folder</b> — and that folder is your <b>brain</b> (a memex):
        notes, chats, and knowledge together, organized by AI but always yours to arrange. Pick where
        it lives.
      </p>
      {detect.isLoading ? (
        <p className="onb-sub">Looking for an existing brain…</p>
      ) : (
        <div className="onb-choices">
          {currentRoot && (
            <button
              type="button"
              className={isKeep ? "onb-choice sel" : "onb-choice"}
              aria-pressed={isKeep}
              onClick={() =>
                setPendingChoice({
                  kind: "keep",
                  path: currentRoot,
                  label: currentRoot.split("/").pop() ?? currentRoot,
                })
              }
            >
              <span className="onb-choice-title">Keep my current location</span>
              <span className="onb-choice-desc">
                {currentRoot} · where your notes live now — nothing moves
              </span>
            </button>
          )}
          {found.map((d) => (
            <button
              key={d.root}
              type="button"
              className={isUse(d.root) ? "onb-choice sel" : "onb-choice"}
              aria-pressed={isUse(d.root)}
              onClick={() => setPendingChoice({ kind: "use", path: d.root, label: d.label })}
            >
              <span className="onb-choice-title">Use {d.label}</span>
              <span className="onb-choice-desc">{d.root} · the brain we found on this Mac</span>
            </button>
          ))}
          <button
            type="button"
            className={isInit ? "onb-choice sel" : "onb-choice"}
            aria-pressed={isInit}
            onClick={() => void createNew()}
          >
            <span className="onb-choice-title">Create a new brain…</span>
            <span className="onb-choice-desc">
              {isInit && pending?.path
                ? pending.path
                : "Choose a folder — rotli starts a fresh memex there."}
            </span>
          </button>
          <button
            type="button"
            className={plainPath ? "onb-choice sel" : "onb-choice"}
            aria-pressed={!!plainPath}
            onClick={() => void usePlain()}
          >
            <span className="onb-choice-title">Use a plain folder…</span>
            <span className="onb-choice-desc">
              {plainPath ??
                "Choose a folder — rotli uses the .md files there as-is (make it a brain later)."}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** First-run model setup (Seth, 2026-07-08 model UX pass, phase 3): rotli's chat
 * runs on-device by default — this step lets a fresh user grab a small local model
 * in one click, or skip and connect a subscription later in Settings. Optional:
 * Continue is never gated here, and the download keeps going if you move on. */
function ModelsStep() {
  const qc = useQueryClient();
  const models = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
  });
  const hasModel = (models.data ?? []).length > 0;
  // the smallest capable starter — a fast, low-footprint first model
  const starter = LOCAL_CATALOG[0];

  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const progress = useQuery({
    queryKey: ["onb-install", starter?.name],
    queryFn: () =>
      installing && starter ? localModelInstallProgress(starter.name) : Promise.resolve(null),
    enabled: installing && !!starter,
    refetchInterval: 1000,
  });
  const bytes = progress.data?.bytes ?? 0;
  const pct = starter ? Math.min(99, Math.round((bytes / (starter.approxMb * 1_000_000)) * 100)) : 0;

  const install = () => {
    if (!starter || installing) return;
    setInstalling(true);
    setErr(null);
    localModelInstall({
      requestId: crypto.randomUUID(),
      repo: starter.repo,
      name: starter.name,
      approxMb: starter.approxMb,
    })
      .then(() => {
        setJustInstalled(true);
        void qc.invalidateQueries({ queryKey: ["chat", "models"] });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setInstalling(false));
  };

  const ready = hasModel || justInstalled;
  const gb = starter ? (starter.approxMb / 1000).toFixed(1) : "0";

  return (
    <div className="onb-step">
      <h1 className="onb-title">Its mind</h1>
      <p className="onb-sub">
        rotli’s chat runs a model right on your Mac — private, no account, nothing leaves your
        machine.{" "}
        {ready
          ? "You’re all set."
          : "Grab a small one to start, or connect a subscription later."}
      </p>

      {ready ? (
        <div className="onb-model-ready">
          <LaptopGlyph size={16} />
          <span>
            {justInstalled
              ? `${starter?.label} is installed and ready.`
              : "A local model is ready on this Mac."}
          </span>
        </div>
      ) : installing ? (
        <div className="onb-model-progress">
          <div className="onb-model-proghead">
            <span>Downloading {starter?.label}…</span>
            <span>{pct}%</span>
          </div>
          <div className="onb-model-track">
            <div className="onb-model-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="onb-sub small">This keeps going if you continue — you don’t have to wait.</p>
        </div>
      ) : (
        <div className="onb-model-pick">
          <div className="onb-model-pickinfo">
            <span className="onb-model-name">{starter?.label}</span>
            <span className="onb-model-meta">{gb} GB · runs on your Mac</span>
          </div>
          <button type="button" className="ghostbtn primary" onClick={install}>
            Install
          </button>
        </div>
      )}

      {err && <p className="onb-sub small onb-model-err">{err}</p>}
      <p className="onb-sub small">
        Prefer your own subscription? Connect Claude, ChatGPT, or Gemini any time in Settings → AI
        Models — you can skip this and set it up later.
      </p>
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

  // Record the choice only; App applies the Dock policy + hide-on-blur when
  // onboarding FINISHES — changing either live can kill the frameless window (#1).
  const pickDock = (v: "menu" | "dock") => setShowInDock(v === "dock");
  const pickBehavior = (v: "visitor" | "resident") => setStayOpen(v === "resident");

  const finish = () => onDone();
  const last = STEPS.length - 1;
  // the location step is REQUIRED — you must choose where rotli lives (no silent
  // ~/Documents/rotli default). pending.path is set by use / init / plain.
  const pending = useMemexStore((s) => s.pendingChoice);
  const needsLocation = step === "memory" && !pending?.path;

  return (
    <div className="onb">
      <div className="onb-drag" data-tauri-drag-region />
      <div className="onb-card">
        {step === "welcome" && (
          <div className="onb-step onb-welcome">
            <Character name="waving" size={132} className="onb-mark" />
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
              Four base themes — the titlebar sun cycles between them. Pick the one that feels
              right; you can change it any time in Settings.
            </p>
            <div className="famrow">
              {SOLID_THEMES.map(({ family, mode, label }) => {
                const selected = !glassMode && themeFamily === family && theme === mode;
                return (
                  <button
                    type="button"
                    key={label}
                    className={selected ? "famcard sel" : "famcard"}
                    aria-pressed={selected}
                    onClick={() => {
                      // Onboarding picks a SOLID base look — Liquid Glass is an
                      // advanced mode discovered in Settings, never offered here
                      // (Seth, 2026-07-07). Choosing a card also drops out of glass
                      // so the preview never lies about what you picked.
                      if (glassMode) setGlassMode(false);
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
          </div>
        )}

        {step === "memory" && <MemexStep />}

        {step === "models" && <ModelsStep />}

        {step === "done" && (
          <div className="onb-step onb-welcome">
            <Character name="celebrating" size={132} className="onb-mark" />
            <h1 className="onb-title">You’re set</h1>
            <p className="onb-sub">
              Press your <b>Open</b> shortcut any time to summon rotli, and <b>Quick capture</b> to
              jot without breaking stride. Hold <kbd>⌘</kbd> in the window to see every shortcut.
              Change anything in Settings (<kbd>⌘,</kbd>).
            </p>
          </div>
        )}

        {/* Footer is a locked frame: dots + Skip on the left, Back + the primary
            button pinned right. Back always holds its slot (hidden on welcome) and
            the primary button has a fixed width, so Continue never shifts between
            steps — it sits in exactly the same place the whole way through (Seth,
            2026-07-07). Skip lives on the LEFT so its coming and going can't nudge
            the right cluster either. */}
        <div className="onb-foot">
          <div className="onb-lead">
            <div className="onb-dots" aria-hidden="true">
              {STEPS.map((s, n) => (
                <span key={s} className={n === i ? "onb-dot on" : "onb-dot"} />
              ))}
            </div>
            {i > 0 && i < STEPS.indexOf("memory") && (
              <button type="button" className="onb-skip" onClick={() => setStep("memory")}>
                Skip setup
              </button>
            )}
          </div>
          <div className="onb-actions">
            <button
              type="button"
              className={i > 0 ? "onb-btn ghost" : "onb-btn ghost onb-hidden"}
              onClick={() => go(-1)}
              tabIndex={i > 0 ? 0 : -1}
              aria-hidden={i > 0 ? undefined : true}
            >
              Back
            </button>
            {i < last ? (
              <button
                type="button"
                className="onb-btn onb-primary"
                disabled={needsLocation}
                onClick={() => go(1)}
              >
                {i === 0 ? "Get started" : "Continue"}
              </button>
            ) : (
              <button type="button" className="onb-btn onb-primary" onClick={finish}>
                Start using rotli
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
