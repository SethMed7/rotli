// First run's scenery (the owner, 2026-09-30: "make the onboarding just like
// we did in the settings — a full theme, life for the backdrop. The beginning
// can match our theme and even preview the island … once they choose their
// theme everything forward needs to match what they chose"). Welcome shows
// Rotli's island — Rottnest, its lighthouse, the sea — in Rotli Light, the
// environment every first run opens in. From the Appearance step on, the
// backdrop is the chosen family's own scenery (the Settings page's art), so
// it follows each pick live and stays through the vault and model steps.
// The horizon is ground BELOW the setup card, never art behind its footer.
// Like every scene, painted only by `.sc-*` token classes.

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

import { type ThemeFamily, useUiStore } from "../../state/ui";
import { Character } from "../character";
import { cloud } from "../sceneParts";
import { SETTINGS_BACKDROPS } from "../settings/settingsBackdropArt";
import { SceneryLayers } from "../settings/settingsBanner";
import { SkyLife } from "./onboardingSkyLife";

const waves = (y: number, x = 0) => (
  <path className="sc-wave" d={`M${x} ${y}q20-6 40 0t40 0${" 40 0".repeat(29)}`} />
);

/** Rottnest from the mainland shore as a horizon: 1200×150, weighted to the
 * bottom (the band above y ≈ 60 fades into the page). */
const ISLAND_HORIZON = (
  <>
    <path className="sc-far" d="M560 104c40-18 100-26 160-26s120 10 170 26z" />
    <path className="sc-far" d="M140 104c20-8 50-12 80-12s60 6 80 12z" />
    <g className="sc-object">
      <path d="M712 94l2-17h8l2 17z" />
      <rect x="710" y="73" width="16" height="4" />
      <rect x="714" y="66" width="8" height="7" />
    </g>
    <path className="sc-light" d="M720 69l24-3v7z" />
    <path className="sc-sea" d="M0 100h1200v32H0z" />
    <g className="sc-bob">
      <path className="sc-object" d="M300 108h26l-5 6h-16z" />
      <path className="sc-accent-fill" d="M312 106V92l10 13z" />
    </g>
    {waves(114)}
    {waves(125, 20)}
    <path className="sc-sand" d="M0 132h1200v18H0z" />
    <ellipse className="sc-bush" cx="90" cy="134" rx="26" ry="7" />
    <ellipse className="sc-bush" cx="1130" cy="134" rx="30" ry="8" />
  </>
);

/** The island in the sky ornament's corner (320×200): Welcome previews it
 * on any wide window, however short — the horizon only has room to show it
 * on tall ones. */
const ISLAND_SKY = (
  <>
    <circle className="sc-sun" cx="236" cy="70" r="22" />
    {cloud(90, 52, 0.8)}
    <path className="sc-far" d="M104 160c22-18 60-30 100-30s70 12 92 30z" />
    <g className="sc-object">
      <path d="M190 138l2-22h8l2 22z" />
      <rect x="188" y="112" width="16" height="4" />
      <rect x="192" y="104" width="8" height="8" />
    </g>
    <path className="sc-light" d="M200 108l30-5v10z" />
    <ellipse className="sc-sea" cx="176" cy="164" rx="160" ry="9" />
  </>
);

/** The intro's full island: 1200×240, sand from y 212. The island is drawn
 * BEFORE the sea so it rises out of the water. */
const ISLAND_SCENE = (
  <>
    <g className="onb-intro-sky">
      <circle className="sc-sun" cx="880" cy="96" r="40" />
      {cloud(220, 60, 1.2)}
      {cloud(640, 44)}
      {cloud(1040, 74, 0.9)}
    </g>
    <g className="onb-intro-isle">
      <path className="sc-far" d="M680 176c50-34 130-54 220-54s170 22 240 54z" />
      <path className="sc-far" d="M90 176c24-12 70-20 116-20s80 8 104 20z" />
      <g className="sc-object">
        <path d="M893 140l4-46h14l4 46z" />
        <rect x="890" y="88" width="28" height="6" />
        <rect x="897" y="74" width="14" height="14" />
      </g>
      <path className="sc-light onb-intro-beam" d="M908 81l52-8v16z" />
    </g>
    <path className="sc-sea" d="M0 170h1200v42H0z" />
    <g className="sc-bob">
      <path className="sc-object" d="M420 178h34l-6 8h-22z" />
      <path className="sc-accent-fill" d="M436 176V154l14 21z" />
    </g>
    {waves(186)}
    {waves(200, 20)}
    <path className="sc-sand" d="M0 212h1200v28H0z" />
    <ellipse className="sc-bush" cx="1080" cy="214" rx="30" ry="8" />
  </>
);

/** The scene behind a first-run step: the island for Rotli (and on Welcome,
 * before any choice), otherwise the chosen family's Settings horizon. */
export function onboardingSceneName(family: ThemeFamily, welcome: boolean): string {
  return welcome || family === "warm" ? "island" : family;
}

/** The sky and horizon a first-run step wears. */
export function onboardingScenery(family: ThemeFamily, welcome: boolean) {
  const name = onboardingSceneName(family, welcome);
  if (name === "island") return { name, sky: ISLAND_SKY, horizon: ISLAND_HORIZON };
  const scenery = SETTINGS_BACKDROPS[family] ?? SETTINGS_BACKDROPS.warm;
  return { name, sky: scenery.sky, horizon: scenery.horizon };
}

export function OnboardingScenery({ welcome = false }: { welcome?: boolean }) {
  const family = useUiStore((s) => s.themeFamily);
  const { name, sky, horizon } = onboardingScenery(family, welcome);
  return (
    <>
      <SceneryLayers className="onb-scenery" name={name} sky={sky} horizon={horizon} />
      <SkyLife family={name === "island" ? "island" : family} />
    </>
  );
}

const INTRO_MS = 1700;
/** The longest an opening waits for its window to come in front. */
const FRONT_WAIT_MS = 5000;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Whether first run opens on the island intro: a fresh Welcome, motion on. */
export function introWanted(welcome: boolean): boolean {
  return welcome && !prefersReducedMotion();
}

/** An opening scene over the app (first run's island intro, and the app's
 * opening on every launch, appOpening.tsx): the scene rises, the quokka hops
 * onto its ground, the word appears, then it gives way. Any key or click skips
 * it; it never takes pointer input, so what's underneath is usable. */
export function SceneIntro({
  art,
  viewBox,
  onDone,
  testId,
  scene = false,
  accessorized = false,
  pace = 1,
  waitForFront = false,
}: {
  art: ReactNode;
  viewBox: string;
  onDone: () => void;
  testId: string;
  /** A theme's small scene (440×200) rather than the wide island. */
  scene?: boolean;
  /** Wear the person's chosen accessory (the app's opening; first run is bare). */
  accessorized?: boolean;
  /** Stretch every beat by this much (the app's opening is unhurried). */
  pace?: number;
  /** Hold still until the window is in front: a launch can start behind others. */
  waitForFront?: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  const [live, setLive] = useState(() => !waitForFront || document.hasFocus());
  useEffect(() => {
    if (live) return;
    const front = () => setLive(true);
    // a click or key means the window is in front, whatever focus says: a web
    // view can sit in front without ever reporting focus (macOS 27)
    const signals = ["focus", "pointerdown", "keydown"] as const;
    for (const signal of signals) window.addEventListener(signal, front, { once: true });
    // focus may have landed between the first render and this effect
    const already = document.hasFocus() ? window.setTimeout(front) : 0;
    // and it never holds the app: unseen this long, it gives way unplayed
    const giveUp = window.setTimeout(onDone, FRONT_WAIT_MS);
    return () => {
      for (const signal of signals) window.removeEventListener(signal, front);
      window.clearTimeout(already);
      window.clearTimeout(giveUp);
    };
  }, [live, onDone]);
  useEffect(() => {
    if (!live) return;
    const leave = window.setTimeout(() => setLeaving(true), (INTRO_MS - 520) * pace);
    const done = window.setTimeout(onDone, INTRO_MS * pace);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(done);
    };
  }, [live, onDone, pace]);
  useEffect(() => {
    // armed once it plays: the click that brings the window forward isn't a skip
    if (!live) return;
    const skip = () => onDone();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [live, onDone]);
  return (
    <div
      className={["onb-intro", scene && "onb-intro--scene", !live && "is-waiting", leaving && "is-leaving"]
        .filter(Boolean)
        .join(" ")}
      style={{ "--intro-t": pace } as CSSProperties}
      data-testid={testId}
      aria-hidden="true"
    >
      <div className="onb-intro-stage">
        <svg className="onb-intro-island" viewBox={viewBox} focusable="false">
          {art}
        </svg>
        <span className="onb-intro-quokka">
          <Character name="waving" size={96} accessorized={accessorized} alwaysVisible />
        </span>
      </div>
      <p className="onb-intro-word">Rotli</p>
    </div>
  );
}

/** The app opened in this launch already (first run's intro, or the opening):
 * shown once per launch, never twice. On the window, so a development hot
 * update doesn't replay it. */
const opening = globalThis as { __rotliOpened?: boolean };
export const openedThisLaunch = (): boolean => opening.__rotliOpened === true;
export function markOpened(): void {
  opening.__rotliOpened = true;
}

/** First run's 1.7-second opening: the island rises out of the sea, the
 * lighthouse turns, the quokka hops onto the sand where Welcome's quokka
 * stands, and the scene opens onto setup. */
export function OnboardingIntro({ onDone }: { onDone: () => void }) {
  useEffect(markOpened, []);
  return <SceneIntro art={ISLAND_SCENE} viewBox="0 0 1200 240" onDone={onDone} testId="onboarding-intro" />;
}

export { ISLAND_SCENE, prefersReducedMotion };
