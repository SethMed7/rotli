// The sky, alive — first run's whole page and Settings' side margins (the owner, 2026-09-30: "remove the rotlis popping
// out of the sides; better scenery like clouds or birds, so it's fully alive").
// Clouds drift slowly across the page and something crosses the upper sky:
// birds for most themes, a paper plane for Paper & Charcoal, petals for
// Blossom, twinkling stars for Midnight. All `.sc-*` token classes, all CSS
// motion: still under Reduce motion (each rests at its own spot), paused with
// the rest when the window is put away (base.css).

import type { CSSProperties } from "react";

import type { ThemeFamily } from "../../state/ui";
import { cloud, star } from "../sceneParts";

/** Where each drifter sits in the sky, how long its crossing takes, how far
 * along it starts (a negative delay), and where it rests with motion off. */
interface Drift {
  top: string;
  secs: number;
  delay: number;
  rest: string;
  scale?: number;
}

const CLOUDS: readonly Drift[] = [
  { top: "5%", secs: 160, delay: -30, rest: "10vw", scale: 1.1 },
  { top: "15%", secs: 130, delay: -85, rest: "72vw", scale: 0.8 },
  { top: "34%", secs: 190, delay: -140, rest: "88vw", scale: 0.65 },
  { top: "52%", secs: 175, delay: -60, rest: "4vw", scale: 0.7 },
];

const FLYERS: readonly Drift[] = [
  { top: "7%", secs: 52, delay: -10, rest: "30vw" },
  { top: "19%", secs: 68, delay: -44, rest: "82vw" },
];

const drift = (d: Drift): CSSProperties =>
  ({
    top: d.top,
    "--rest": d.rest,
    animationDuration: `${d.secs}s`,
    animationDelay: `${d.delay}s`,
  }) as CSSProperties;

const bird = (x: number, y: number, s: number, i: number) => (
  <path
    key={i}
    className="sc-line onb-wing"
    transform={`translate(${x} ${y}) scale(${s})`}
    style={{ animationDelay: `${i * -0.35}s` }}
    d="M-6 -3q3 1 6 4q3-3 6-4"
  />
);

/** What crosses the upper sky in a family's theme. */
function flyer(family: ThemeFamily | "island") {
  if (family === "mono")
    return <path className="sc-line" d="M-14 2l26-10-8 16-5-6zM-1 2l5 6" transform="scale(1.1)" />;
  if (family === "blossom")
    return (
      <g className="sc-petals">
        <ellipse className="sc-petal" cx="-10" cy="-2" rx="5" ry="3.5" />
        <ellipse className="sc-petal" cx="8" cy="6" rx="4.5" ry="3" />
        <ellipse className="sc-petal" cx="20" cy="-6" rx="4" ry="3" />
      </g>
    );
  return <g>{[bird(-16, 0, 1, 0), bird(3, -8, 0.85, 1), bird(18, 3, 0.75, 2)]}</g>;
}

/** The living sky: first run (`onb-sky-life`, the whole page) and Settings
 * (`set-sky-life`, its side margins). */
export function SkyLife({
  family,
  className = "onb-sky-life",
}: {
  family: ThemeFamily | "island";
  className?: string;
}) {
  return (
    <div className={className} data-sky={family} aria-hidden="true">
      {CLOUDS.map((c) => (
        <svg key={c.top} className="onb-drift" style={drift(c)} viewBox="-60 -18 120 36" focusable="false">
          {cloud(0, 0, c.scale)}
        </svg>
      ))}
      {family === "midnight" ? (
        <svg className="onb-stars" viewBox="0 0 1000 200" preserveAspectRatio="none" focusable="false">
          {star(90, 40, 2, 0)}
          {star(260, 120, 1.6, 1.2)}
          {star(430, 30, 2.2, 2.1)}
          {star(640, 90, 1.6, 0.6)}
          {star(820, 50, 2, 1.7)}
          {star(950, 140, 1.6, 2.8)}
        </svg>
      ) : (
        FLYERS.map((f) => (
          <svg key={f.top} className="onb-flyer" style={drift(f)} viewBox="-30 -16 60 32" focusable="false">
            {flyer(family)}
          </svg>
        ))
      )}
    </div>
  );
}
