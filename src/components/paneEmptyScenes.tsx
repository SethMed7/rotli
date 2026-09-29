// The empty pane's scenes (the owner, 2026-09-29: "different scenes that
// match the different themes … so even empty state is enjoyable"). One stage
// per theme family, drawn in the site's scene language (soft ellipse clouds,
// hills, a thin outline stroke). Every color is a class that reads the
// theme's own tokens (styles/app.css `.sc-*`), so a scene follows light and
// dark on its own and this file holds no color at all. The person's quokka
// stands on the shared ground line (y 170 of 440×200), drawn over the scene
// by PaneEmptyState.

import type { ReactNode } from "react";

import type { QuokkaPose } from "../brand/quokka";
import type { ThemeFamily } from "../state/ui";

export interface PaneScene {
  /** A short name for the scene (tests, and the stage's data attribute). */
  name: string;
  /** The quokka's pose in this scene. */
  pose: QuokkaPose;
  art: ReactNode;
}

const cloud = (x: number, y: number, s = 1) => (
  <g className="sc-cloud" transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="0" rx="34" ry="10" />
    <ellipse cx="-20" cy="2" rx="20" ry="8" />
    <ellipse cx="16" cy="-5" rx="22" ry="10" />
  </g>
);

const star = (x: number, y: number, r = 1.6, delay = 0) => (
  <circle className="sc-star" cx={x} cy={y} r={r} style={{ animationDelay: `${delay}s` }} />
);

const ground = <path className="sc-ground" d="M0 170h440v30H0z" />;

/** Rotli: Rottnest at golden hour, the lighthouse on the far hill. */
const warm: PaneScene = {
  name: "island",
  pose: "base",
  art: (
    <>
      <circle className="sc-sun" cx="330" cy="120" r="30" />
      {cloud(90, 48)}
      {cloud(250, 30, 0.8)}
      <path className="sc-far" d="M230 170c30-26 70-50 110-52s70 22 100 52z" />
      <g className="sc-object">
        <path d="M352 120l3-44h12l3 44z" />
        <rect x="350" y="70" width="22" height="5" />
        <rect x="355" y="58" width="12" height="12" />
      </g>
      <path className="sc-light" d="M361 64l40-10v20z" />
      <path className="sc-hill" d="M0 170c40-18 90-28 150-24s110 16 150 24z" />
      <ellipse className="sc-bush" cx="60" cy="158" rx="22" ry="9" />
      <ellipse className="sc-bush" cx="92" cy="162" rx="14" ry="6" />
      {ground}
    </>
  ),
};

/** Paper & Charcoal: a writing desk, drawn the way ink draws it. */
const mono: PaneScene = {
  name: "desk",
  pose: "thoughtful",
  art: (
    <>
      <path className="sc-line" d="M20 120h400" strokeDasharray="2 6" />
      <path className="sc-line" d="M20 90h400" strokeDasharray="2 6" />
      <path className="sc-line" d="M20 60h400" strokeDasharray="2 6" />
      <g className="sc-paper">
        <rect x="56" y="118" width="84" height="52" transform="rotate(-4 98 144)" />
        <rect x="62" y="112" width="84" height="58" transform="rotate(3 104 141)" />
      </g>
      <path className="sc-line" d="M76 132h48M76 142h40M76 152h44" />
      <g transform="rotate(-38 330 150)">
        <rect className="sc-object" x="300" y="146" width="58" height="8" rx="1.5" />
        <path className="sc-accent-fill" d="M300 146l-9 4 9 4z" />
        <path className="sc-line" d="M346 146v8" />
      </g>
      <circle className="sc-paper" cx="330" cy="160" r="9" />
      <path className="sc-line" d="M324 156q6 4 11-2M326 164q5-3 9 1" />
      {ground}
    </>
  ),
};

/** Ocean: low tide, a boat on the horizon and gulls overhead. */
const ocean: PaneScene = {
  name: "tide",
  pose: "walking",
  art: (
    <>
      <circle className="sc-sun" cx="92" cy="70" r="22" />
      {cloud(300, 44, 0.9)}
      <path className="sc-line" d="M250 56q5-5 10 0q5-5 10 0M284 70q4-4 8 0q4-4 8 0" />
      <path className="sc-sea" d="M0 112h440v38H0z" />
      <g className="sc-bob">
        <path className="sc-object" d="M322 104h34l-6 8h-22z" />
        <path className="sc-accent-fill" d="M338 102V76l14 24z" />
      </g>
      <path className="sc-wave" d="M0 126q20-8 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0" />
      <path className="sc-wave" d="M20 139q20-7 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0" />
      <path className="sc-sand" d="M0 150q110 6 220 2t220 0v48H0z" />
      <path className="sc-accent-fill" d="M92 180l6-8 6 8zM352 184q5-9 10 0z" />
    </>
  ),
};

/** Grove: an afternoon under the gum trees. */
const grove: PaneScene = {
  name: "grove",
  pose: "listening",
  art: (
    <>
      {cloud(220, 30, 0.8)}
      <g className="sc-object">
        <rect x="62" y="110" width="7" height="60" />
        <rect x="368" y="96" width="8" height="74" />
      </g>
      <g className="sc-canopy">
        <circle cx="66" cy="96" r="30" />
        <circle cx="44" cy="112" r="20" />
        <circle cx="90" cy="110" r="22" />
        <circle cx="372" cy="80" r="34" />
        <circle cx="346" cy="100" r="22" />
        <circle cx="398" cy="98" r="24" />
      </g>
      <path className="sc-hill" d="M120 170c30-12 70-18 110-16s70 8 90 16z" />
      <path className="sc-line" d="M140 170l4-10 3 10M292 170l3-8 4 8M180 170l3-7 3 7" />
      <g className="sc-accent-fill">
        <path d="M112 164a8 6 0 0 1 16 0z" />
        <path d="M312 166a6 5 0 0 1 12 0z" />
      </g>
      <path className="sc-line" d="M120 164v6M318 166v4" />
      {ground}
    </>
  ),
};

/** Iris: an iris field at dusk, a crescent moon and fireflies. */
const iris: PaneScene = {
  name: "dusk",
  pose: "attention",
  art: (
    <>
      <path className="sc-moon" d="M352 30a22 22 0 1 0 18 34a18 18 0 1 1-18-34z" />
      {star(90, 36, 1.4, 0)}
      {star(150, 22, 1.2, 1.4)}
      {star(262, 40, 1.4, 2.6)}
      <path className="sc-far" d="M0 170c50-30 110-44 170-40s120 24 150 40z" />
      <path className="sc-hill" d="M180 170c40-20 110-32 170-26s70 14 90 26z" />
      {[70, 110, 330, 372].map((x, i) => (
        <g key={x} transform={`translate(${x} ${150 - (i % 2) * 6})`}>
          <path className="sc-line" d="M0 20V0" />
          <path className="sc-accent-fill" d="M0 0q-8-6-4-14q4 4 4 8q0-4 4-8q4 8-4 14z" />
        </g>
      ))}
      <circle className="sc-firefly" cx="140" cy="120" r="2" />
      <circle className="sc-firefly" cx="300" cy="104" r="2" style={{ animationDelay: "1.8s" }} />
      <circle className="sc-firefly" cx="250" cy="134" r="1.6" style={{ animationDelay: "3.1s" }} />
      {ground}
    </>
  ),
};

/** Blossom: a blossom branch and a paper lantern, petals drifting down. */
const blossom: PaneScene = {
  name: "blossom",
  pose: "celebrating",
  art: (
    <>
      <path className="sc-branch" d="M0 30q70 6 110 26t50 14M60 38q10 16 6 34M130 64q18-2 28-16" />
      <g className="sc-blossom">
        {[
          [40, 34],
          [74, 44],
          [68, 70],
          [112, 58],
          [146, 70],
          [158, 50],
          [168, 72],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="6" />
        ))}
      </g>
      <path className="sc-line" d="M330 0v40" />
      <rect className="sc-paper" x="316" y="40" width="28" height="36" rx="12" />
      <path className="sc-line" d="M320 52h20M320 64h20" />
      <g className="sc-petals">
        <ellipse className="sc-petal" cx="110" cy="100" rx="3" ry="2" />
        <ellipse className="sc-petal" cx="150" cy="112" rx="3" ry="2" style={{ animationDelay: "2.2s" }} />
        <ellipse className="sc-petal" cx="260" cy="96" rx="3" ry="2" style={{ animationDelay: "4.1s" }} />
      </g>
      <path className="sc-hill" d="M200 170c50-14 150-18 240-10v10z" />
      {ground}
    </>
  ),
};

/** Midnight: stargazing from the hill, the telescope beside the quokka. */
const midnight: PaneScene = {
  name: "stars",
  pose: "attention",
  art: (
    <>
      <circle className="sc-moon" cx="80" cy="46" r="18" />
      {star(140, 28, 1.6, 0)}
      {star(200, 54, 1.2, 0.9)}
      {star(248, 20, 1.8, 1.8)}
      {star(300, 44, 1.2, 2.7)}
      {star(380, 26, 1.6, 3.6)}
      {star(410, 70, 1.2, 1.2)}
      {star(170, 86, 1, 2.2)}
      <path className="sc-line" d="M248 20l52 24 80-18" strokeDasharray="1 5" />
      <path className="sc-far" d="M0 170c60-24 140-34 220-30s150 18 220 30z" />
      <g className="sc-object">
        <path d="M290 132l40-22 4 7-40 22z" />
        <path d="M300 136l-10 34M306 136l6 34M303 136v34" className="sc-line" />
      </g>
      {ground}
    </>
  ),
};

export const PANE_SCENES: Record<ThemeFamily, PaneScene> = {
  warm,
  mono,
  ocean,
  grove,
  iris,
  blossom,
  midnight,
};
