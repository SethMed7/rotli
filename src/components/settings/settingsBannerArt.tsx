// Settings banners (the owner, 2026-09-29: "similar themes that come alive in
// the settings areas, including heading banners for the different sections").
// Each banner is the theme's backdrop (one per family) plus the pane's own
// motif (one per pane), on a 640×120 stage with the ground at y 104. The left
// third stays calm for the pane's title; the person's quokka stands at 62%.
// Like the empty pane's scenes (paneEmptyScenes.tsx), every paint is a `.sc-*`
// class reading the theme's tokens, so nothing here holds a color.

import type { ReactNode } from "react";

import type { ThemeFamily } from "../../state/ui";
import { cloud, star } from "../sceneParts";

export type BannerMotif =
  | "general"
  | "hotkeys"
  | "appearance"
  | "browser"
  | "librarian"
  | "security"
  | "models"
  | "chat"
  | "location"
  | "connections"
  | "about";

const sparkle = (x: number, y: number, s = 1) => (
  <path
    className="sc-accent-fill"
    transform={`translate(${x} ${y}) scale(${s})`}
    d="M0-10Q0 0 10 0Q0 0 0 10Q0 0-10 0Q0 0 0-10z"
  />
);

const ground = <path className="sc-ground" d="M0 104h640v16H0z" />;

export const BANNER_BACKDROPS: Record<ThemeFamily, ReactNode> = {
  warm: (
    <>
      <circle className="sc-sun" cx="330" cy="58" r="24" />
      {cloud(200, 28, 0.7)}
      {cloud(610, 22, 0.62)}
      <path className="sc-far" d="M250 104c40-24 110-40 190-38s150 20 200 38z" />
      <path className="sc-hill" d="M0 104c60-10 160-14 260-10s120 6 150 10z" />
      <ellipse className="sc-bush" cx="300" cy="98" rx="18" ry="7" />
      {ground}
    </>
  ),
  mono: (
    <>
      {[28, 52, 76].map((y) => (
        <path key={y} className="sc-line" d={`M20 ${y}h600`} strokeDasharray="2 6" />
      ))}
      <path className="sc-line" d="M300 14v90" />
      {ground}
    </>
  ),
  ocean: (
    <>
      <circle className="sc-sun" cx="330" cy="40" r="16" />
      <path className="sc-line" d="M230 30q4-4 8 0q4-4 8 0M258 42q3-3 6 0q3-3 6 0" />
      <path className="sc-sea" d="M0 70h640v34H0z" />
      <g className="sc-bob">
        <path className="sc-object" d="M276 64h26l-5 6h-16z" />
        <path className="sc-accent-fill" d="M288 62V44l11 17z" />
      </g>
      <path
        className="sc-wave"
        d="M0 82q20-7 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0"
      />
      <path
        className="sc-wave"
        d="M20 94q20-6 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0 40 0"
      />
      <path className="sc-sand" d="M0 104h640v16H0z" />
    </>
  ),
  grove: (
    <>
      {cloud(220, 26, 0.62)}
      <g className="sc-object">
        <rect x="296" y="64" width="6" height="40" />
        <rect x="628" y="54" width="7" height="50" />
      </g>
      <g className="sc-canopy">
        <circle cx="299" cy="54" r="22" />
        <circle cx="282" cy="66" r="14" />
        <circle cx="318" cy="64" r="15" />
        <circle cx="632" cy="42" r="24" />
        <circle cx="612" cy="58" r="15" />
      </g>
      <path className="sc-line" d="M350 104l3-8 3 8M470 104l3-7 3 7M500 104l2-6 3 6" />
      {ground}
    </>
  ),
  iris: (
    <>
      <path className="sc-moon" d="M330 18a16 16 0 1 0 13 25a13 13 0 1 1-13-25z" />
      {star(220, 24, 1.2, 0)}
      {star(262, 12, 1, 1.4)}
      {star(470, 20, 1.3, 2.6)}
      <path className="sc-far" d="M200 104c50-22 120-32 190-28s140 16 250 28z" />
      {[260, 290, 616].map((x, i) => (
        <g key={x} transform={`translate(${x} ${86 - (i % 2) * 5})`}>
          <path className="sc-line" d="M0 18V0" />
          <path className="sc-accent-fill" d="M0 0q-7-5-4-12q4 3 4 7q0-4 4-7q3 7-4 12z" />
        </g>
      ))}
      <circle className="sc-firefly" cx="360" cy="70" r="1.8" />
      <circle className="sc-firefly" cx="480" cy="60" r="1.6" style={{ animationDelay: "2s" }} />
      {ground}
    </>
  ),
  blossom: (
    <>
      <path className="sc-branch" d="M640 8q-80 4-130 24t-80 14M560 18q-6 14 2 28" />
      <g className="sc-blossom">
        {[
          [620, 12],
          [590, 20],
          [562, 44],
          [540, 26],
          [500, 38],
          [460, 44],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="5" />
        ))}
      </g>
      <g className="sc-petals">
        <ellipse className="sc-petal" cx="470" cy="60" rx="3" ry="2" />
        <ellipse className="sc-petal" cx="380" cy="54" rx="3" ry="2" style={{ animationDelay: "3s" }} />
      </g>
      <path className="sc-hill" d="M240 104c80-12 250-16 400-8v8z" />
      {ground}
    </>
  ),
  midnight: (
    <>
      <circle className="sc-moon" cx="320" cy="36" r="14" />
      {star(200, 20, 1.2, 0)}
      {star(250, 46, 1, 1.1)}
      {star(390, 16, 1.5, 2)}
      {star(440, 38, 1.1, 2.9)}
      {star(520, 18, 1.4, 0.6)}
      {star(600, 30, 1.2, 1.7)}
      <path className="sc-line" d="M390 16l50 22 80-20" strokeDasharray="1 5" />
      <path className="sc-far" d="M180 104c80-18 200-26 300-22s130 12 160 22z" />
      {ground}
    </>
  ),
};

/** Each pane's object, standing on the ground at the banner's right. */
export const BANNER_MOTIFS: Record<BannerMotif, ReactNode> = {
  // a signpost: this way, that way
  general: (
    <>
      <rect className="sc-object" x="554" y="46" width="5" height="58" />
      <path className="sc-object" d="M526 52h48l8 7-8 7h-48z" />
      <path className="sc-object" d="M588 72h-44l-8 7 8 7h44z" />
      <circle className="sc-accent-fill" cx="556" cy="44" r="3" />
    </>
  ),
  // three keycaps, one of them lit
  hotkeys: (
    <>
      <rect className="sc-object" x="508" y="78" width="30" height="26" rx="5" />
      <rect className="sc-object" x="544" y="78" width="30" height="26" rx="5" />
      <rect className="sc-object" x="580" y="78" width="30" height="26" rx="5" />
      <rect className="sc-accent-fill" x="549" y="83" width="20" height="16" rx="3" />
      <path className="sc-line" d="M516 91h14M588 91h14" />
    </>
  ),
  // a painter's palette and a brush
  appearance: (
    <>
      <path
        className="sc-object"
        d="M520 92c-6-22 16-38 40-34s34 20 24 30c-6 6-16-2-22 6s4 14-8 16c-16 2-30-4-34-18z"
      />
      <circle className="sc-accent-fill" cx="540" cy="76" r="4" />
      <circle className="sc-blossom" cx="556" cy="68" r="4" />
      <circle className="sc-sun" cx="572" cy="74" r="4" />
      <path className="sc-object" d="M596 104l18-44 4 2-14 43z" />
    </>
  ),
  // a browser window
  browser: (
    <>
      <rect className="sc-paper" x="512" y="50" width="100" height="54" rx="4" />
      <path className="sc-line" d="M512 62h100" />
      <circle className="sc-accent-fill" cx="520" cy="56" r="2" />
      <circle className="sc-line" cx="528" cy="56" r="2" />
      <path className="sc-line" d="M524 74h60M524 84h44M524 94h52" />
    </>
  ),
  // a stack of books and one open
  librarian: (
    <>
      <rect className="sc-object" x="510" y="92" width="58" height="12" rx="2" />
      <rect className="sc-object" x="514" y="80" width="50" height="12" rx="2" />
      <rect className="sc-accent-fill" x="518" y="70" width="44" height="10" rx="2" />
      <path className="sc-paper" d="M578 104l0-26q14-6 22 2q8-8 22-2v26q-14-6-22 2q-8-8-22-2z" />
      <path className="sc-line" d="M600 80v24" />
    </>
  ),
  // a shield with a keyhole
  security: (
    <>
      <path className="sc-object" d="M560 48l30 10v18c0 16-12 24-30 30c-18-6-30-14-30-30V58z" />
      <circle className="sc-accent-fill" cx="560" cy="72" r="5" />
      <path className="sc-accent-fill" d="M557 74h6l2 12h-10z" />
    </>
  ),
  // a chip with sparkles
  models: (
    <>
      <rect className="sc-object" x="530" y="72" width="40" height="32" rx="4" />
      <path className="sc-line" d="M538 72v-6M550 72v-6M562 72v-6M530 84h-6M530 94h-6M570 84h6M570 94h6" />
      <rect className="sc-accent-fill" x="542" y="82" width="16" height="12" rx="2" />
      {sparkle(596, 58, 0.9)}
      {sparkle(612, 80, 0.5)}
      {sparkle(522, 54, 0.6)}
    </>
  ),
  // two speech bubbles
  chat: (
    <>
      <path
        className="sc-paper"
        d="M512 52h58a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-38l-10 10v-10h-10a6 6 0 0 1-6-6V58a6 6 0 0 1 6-6z"
      />
      <path
        className="sc-accent-fill"
        d="M568 70h40a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5h-6v8l-8-8h-26a5 5 0 0 1-5-5V75a5 5 0 0 1 5-5z"
      />
      <path className="sc-line" d="M522 64h40M522 72h28" />
    </>
  ),
  // a folder and a map pin
  location: (
    <>
      <path className="sc-object" d="M512 66h22l6 6h40v32h-68z" />
      <path className="sc-accent-fill" d="M600 104c-10-14-16-22-16-30a16 16 0 0 1 32 0c0 8-6 16-16 30z" />
      <circle className="sc-paper" cx="600" cy="74" r="5" />
    </>
  ),
  // a plug reaching its socket
  connections: (
    <>
      <path className="sc-branch" d="M500 104q20-40 60-30" />
      <rect className="sc-object" x="560" y="66" width="22" height="16" rx="3" />
      <path className="sc-line" d="M582 70h8M582 78h8" />
      <rect className="sc-paper" x="596" y="60" width="22" height="28" rx="4" />
      <path className="sc-accent-fill" d="M602 70h3v8h-3zM609 70h3v8h-3z" />
    </>
  ),
  // Rottnest's lighthouse, home
  about: (
    <>
      <g className="sc-object">
        <path d="M552 104l4-50h14l4 50z" />
        <rect x="550" y="48" width="26" height="6" />
        <rect x="556" y="34" width="14" height="14" />
      </g>
      <path className="sc-light" d="M563 40l50-12v24z" />
      <rect className="sc-accent-fill" x="559" y="88" width="8" height="16" rx="1" />
    </>
  ),
};
