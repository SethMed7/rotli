// The Settings page's own scenery (the owner, 2026-09-29: "add full bg so the
// banner blends into the background and whole setting pages feel alive, not
// just top banners"). Behind the scrolling content: a corner of the theme's
// sky at the top right (320×200) and its horizon along the bottom of the pane
// (1200×150, drawn to the bottom edge). Faint by design — the rows and text
// sit on top — and, like every scene, painted only by `.sc-*` token classes.

import type { ReactNode } from "react";

import type { ThemeFamily } from "../../state/ui";
import { cloud, star } from "../sceneParts";

export interface SettingsBackdrop {
  sky: ReactNode;
  horizon: ReactNode;
}

const petals = (spots: readonly [number, number][]) => (
  <g className="sc-petals">
    {spots.map(([x, y], i) => (
      <ellipse
        key={`${x}-${y}`}
        className="sc-petal"
        cx={x}
        cy={y}
        rx="5"
        ry="3.5"
        style={{ animationDelay: `${i * 1.7}s` }}
      />
    ))}
  </g>
);

const ground = <path className="sc-ground" d="M0 132h1200v18H0z" />;

export const SETTINGS_BACKDROPS: Record<ThemeFamily, SettingsBackdrop> = {
  warm: {
    sky: (
      <>
        {cloud(120, 60)}
        {cloud(250, 140, 0.7)}
      </>
    ),
    horizon: (
      <>
        <path className="sc-far" d="M0 132c140-40 320-58 520-52s380 30 680 52z" />
        <path className="sc-hill" d="M0 132c200-18 420-24 640-18s360 12 560 18z" />
        <ellipse className="sc-bush" cx="180" cy="126" rx="26" ry="9" />
        <ellipse className="sc-bush" cx="980" cy="124" rx="30" ry="10" />
        {ground}
      </>
    ),
  },
  mono: {
    sky: (
      <>
        {[40, 70, 100].map((y) => (
          <path key={y} className="sc-line" d={`M80 ${y}h220`} strokeDasharray="2 6" />
        ))}
        <path className="sc-line" d="M150 150l60-26-24 34-8-14z" />
      </>
    ),
    horizon: (
      <>
        <path className="sc-line" d="M0 104h1200" strokeDasharray="2 6" />
        <path className="sc-line" d="M0 118h1200" strokeDasharray="2 6" />
        <circle className="sc-paper" cx="220" cy="124" r="8" />
        <circle className="sc-paper" cx="940" cy="126" r="6" />
        {ground}
      </>
    ),
  },
  ocean: {
    sky: (
      <>
        {cloud(110, 150, 0.7)}
        <path className="sc-line" d="M120 60q5-5 10 0q5-5 10 0M150 80q4-4 8 0q4-4 8 0" />
      </>
    ),
    horizon: (
      <>
        <path className="sc-sea" d="M0 70h1200v62H0z" />
        {[88, 104, 120].map((y, i) => (
          <path key={y} className="sc-wave" d={`M${i * 20} ${y}q20-7 40 0t40 0${" 40 0".repeat(29)}`} />
        ))}
        <path className="sc-sand" d="M0 132h1200v18H0z" />
      </>
    ),
  },
  grove: {
    sky: (
      <>
        {cloud(200, 60)}
        {cloud(90, 130, 0.7)}
      </>
    ),
    horizon: (
      <>
        {/* gum trees: a trunk under each crown, so they read as trees */}
        <g className="sc-trunk">
          {[60, 150, 250, 900, 1000, 1110].map((x) => (
            <rect key={x} x={x - 3} y={104} width="6" height="30" />
          ))}
        </g>
        <g className="sc-canopy">
          {[60, 150, 250, 900, 1000, 1110].map((x, i) => (
            <circle key={x} cx={x} cy={96 - (i % 2) * 8} r={18 + (i % 3) * 4} />
          ))}
        </g>
        <path className="sc-hill" d="M0 132c240-22 600-28 900-18s200 12 300 18z" />
        {ground}
      </>
    ),
  },
  iris: {
    sky: (
      <>
        {star(110, 50, 2.4, 0)}
        {star(160, 110, 2, 1.3)}
        {star(80, 150, 2.4, 2.4)}
        <circle className="sc-firefly" cx="200" cy="160" r="2" />
      </>
    ),
    horizon: (
      <>
        <path className="sc-far" d="M0 132c160-40 380-56 600-50s420 26 600 50z" />
        {[120, 180, 980, 1030, 1080].map((x, i) => (
          <g key={x} transform={`translate(${x} ${112 - (i % 2) * 6})`}>
            <path className="sc-line" d="M0 20V0" />
            <path className="sc-accent-fill" d="M0 0q-7-5-4-12q4 3 4 7q0-4 4-7q3 7-4 12z" />
          </g>
        ))}
        <circle className="sc-firefly" cx="300" cy="96" r="2" style={{ animationDelay: "1.6s" }} />
        <circle className="sc-firefly" cx="880" cy="90" r="2" style={{ animationDelay: "3.2s" }} />
        {ground}
      </>
    ),
  },
  blossom: {
    sky: petals([
      [170, 60],
      [230, 110],
      [120, 150],
    ]),
    horizon: (
      <>
        <path className="sc-hill" d="M0 132c260-24 700-30 1200-10v10z" />
        {petals([
          [400, 90],
          [760, 100],
        ])}
        <g className="sc-blossom">
          {[300, 312, 620, 632, 1040, 1052].map((x, i) => (
            <circle key={x} cx={x} cy={126 - (i % 2) * 4} r="5" />
          ))}
        </g>
        {ground}
      </>
    ),
  },
  midnight: {
    sky: (
      <>
        {star(90, 40, 1.6, 0)}
        {star(140, 90, 1.2, 0.9)}
        {star(180, 30, 1.4, 1.8)}
        {star(290, 130, 1.2, 2.7)}
        {star(110, 160, 1.4, 3.4)}
        <path className="sc-line" d="M90 40l50 50 40-60" strokeDasharray="1 5" />
      </>
    ),
    horizon: (
      <>
        <path className="sc-far" d="M0 132c200-34 480-48 740-42s320 22 460 42z" />
        {ground}
      </>
    ),
  },
};
