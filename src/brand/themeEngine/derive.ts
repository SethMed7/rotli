// Seeds in, one mode's full semantic token set out. All in OKLCH, in the order
// the plan lists: page, card/panel/tint, accent, button label, text,
// secondary text, then everything solved against the surfaces it sits on. Each
// step reads only the steps before it. The gate (gate.ts) is separate and
// measures the result independently.

import { clamp, contrast, fromLch, luminance, normHex, over, parseHex, toLch } from "./color";
import {
  ALPHA,
  type ContrastLevel,
  HIERARCHY,
  LABELS,
  LABEL_NAMES,
  LEVELS,
  type Mode,
  PAGE_BAND,
  QUOKKA_LINE,
  SCENES,
  SCENE_NAMES,
  SEAM,
  asContrastLevel,
} from "./policy";

/** One mode's seeds. Colours are `#rrggbb`. */
export interface ModeSeeds {
  page: string;
  accent: string;
  ink?: string;
}

/** A colour Rotli moved to keep the theme readable, for the person to see. */
export interface SeedNote {
  role: "Page" | "Accent";
  from: string;
  to: string;
  why: string;
}

export type TokenSet = Record<string, string>;

export interface DerivedMode {
  mode: Mode;
  tokens: TokenSet;
  notes: SeedNote[];
}

/** A contrast requirement. `bg` is a colour, or a function of the candidate
 * for a layer the colour itself paints (a hover wash of the text). */
interface Requirement {
  bg: string | ((candidate: string) => string);
  min: number;
}

/** Walk lightness from `start` in `dir` until every requirement passes. A
 * colour that already passes (`keep`) is returned as given, not re-rounded.
 * Returns the end of the scale if nothing passes; the gate decides whether
 * that is enough. */
function solve(
  h: number,
  c: number,
  start: number,
  dir: 1 | -1,
  requirements: readonly Requirement[],
  keep?: string,
): string {
  const fixed = requirements.map((r) =>
    typeof r.bg === "string"
      ? { lum: luminance(r.bg), fn: null, min: r.min }
      : { lum: 0, fn: r.bg, min: r.min },
  );
  const passes = (hex: string): boolean => {
    const own = luminance(hex);
    return fixed.every((r) => {
      const other = r.fn ? luminance(r.fn(hex)) : r.lum;
      return (Math.max(own, other) + 0.05) / (Math.min(own, other) + 0.05) >= r.min;
    });
  };
  if (keep && passes(keep)) return keep;
  let l = clamp(start, 0, 1);
  for (let i = 0; i < 400; i++) {
    const hex = fromLch({ l, c, h });
    if (passes(hex)) return hex;
    if ((dir < 0 && l <= 0) || (dir > 0 && l >= 1)) break;
    l = clamp(l + dir * 0.004, 0, 1);
  }
  return dir < 0 ? "#000000" : "#ffffff";
}

/** One mode's full token set from its seeds. */
export function deriveMode(mode: Mode, seeds: ModeSeeds, level: ContrastLevel = "standard"): DerivedMode {
  const dark = mode === "dark";
  const dir = dark ? 1 : -1;
  const lv = LEVELS[asContrastLevel(level)];
  const band = PAGE_BAND[mode];
  const notes: SeedNote[] = [];
  const seedPage = normHex(seeds.page) ?? "#808080";
  const seedAccent = normHex(seeds.accent) ?? "#808080";

  // an out-of-band page is pulled just inside the band, so the 8-bit colour
  // it rounds to is itself in band and deriving from it again changes nothing
  const gs = toLch(seedPage);
  const inBand = (x: { l: number; c: number }): boolean =>
    x.l >= band.l[0] && x.l <= band.l[1] && x.c <= band.c;
  let page = seedPage;
  for (let i = 0; i < 6 && !inBand(toLch(page)); i++) {
    const x = toLch(page);
    page = fromLch({
      l: clamp(x.l, band.l[0] + 0.006, band.l[1] - 0.004),
      c: Math.min(x.c, band.c - 0.003),
      h: gs.h,
    });
  }
  const g = toLch(page);
  if (g.c < 1e-4) g.h = gs.h;
  if (page !== seedPage) {
    notes.push({
      role: "Page",
      from: seedPage,
      to: page,
      why: dark ? "kept dark and calm enough to read on" : "kept light and calm enough to read on",
    });
  }

  const step = (dl: number, cm: number): string =>
    fromLch({ l: clamp(g.l + dl, 0, 1), c: Math.min(g.c * cm, band.c * 1.3), h: g.h });
  const surface = dark ? step(0.035, 1) : fromLch({ l: Math.min(0.995, g.l + 0.03), c: g.c * 0.35, h: g.h });
  const surface2 = dark ? step(0.075, 1) : step(-0.03, 1.1);
  const tint = dark ? step(0.105, 1.05) : step(-0.055, 1.25);
  const bases = [page, surface, surface2, tint];
  const cards = [page, surface, surface2];

  // the accent keeps the person's hue and chroma; its lightness moves only if
  // a fill or a focus ring would not stand out from the surfaces it sits on
  const as = toLch(seedAccent);
  const accentChroma = Math.min(as.c, 0.21);
  const accent = solve(
    as.h,
    accentChroma,
    as.l,
    dir,
    [
      { bg: page, min: lv.ui },
      { bg: surface, min: lv.ui },
      { bg: surface2, min: 3 },
      { bg: tint, min: 3 },
    ],
    as.c <= 0.21 + 3e-3 ? seedAccent : undefined,
  );
  if (accent !== seedAccent) {
    notes.push({
      role: "Accent",
      from: seedAccent,
      to: accent,
      why: `${dark ? "lightened" : "darkened"} so buttons and focus rings stand out`,
    });
  }
  const nearWhite = fromLch({ l: 0.985, c: 0.004, h: g.h });
  const nearBlack = fromLch({ l: 0.18, c: 0.015, h: g.h });
  const usual = dark ? nearBlack : nearWhite;
  const other = dark ? nearWhite : nearBlack;
  let onAccent = contrast(usual, accent) >= 4.5 ? usual : other;
  if (contrast(onAccent, accent) < 4.5) {
    onAccent = contrast("#ffffff", accent) >= contrast("#000000", accent) ? "#ffffff" : "#000000";
  }

  const selectedLayers = cards.flatMap((bg) => [
    over(accent, ALPHA.selected, bg),
    over(accent, ALPHA.selectedHover, bg),
  ]);
  const selectionLayers = cards.map((bg) => over(accent, ALPHA.selection, bg));
  const boardContainer = over(accent, ALPHA.boardContainer, surface);

  const ink = seeds.ink && normHex(seeds.ink) ? toLch(seeds.ink) : null;
  const textHue = ink ? ink.h : g.c < 0.004 ? as.h : g.h;
  const textChroma = Math.min(ink ? ink.c : dark ? 0.015 : 0.025, 0.06);
  const hov = ALPHA.hov[mode];
  const act = ALPHA.act[mode];
  // every kind of text meets `main` on the page and a card, 4.5 on the rest
  const onSurfaces = (): Requirement[] => [
    { bg: page, min: lv.main },
    { bg: surface, min: lv.main },
    { bg: surface2, min: 4.5 },
    { bg: tint, min: 4.5 },
  ];
  const textRequirements = (extra: Requirement[] = []): Requirement[] => [
    { bg: page, min: lv.aim },
    ...onSurfaces(),
    ...[...selectedLayers, ...selectionLayers, boardContainer].map((bg) => ({ bg, min: 4.5 })),
    ...bases.map((bg) => ({ bg: (self: string) => over(self, act, bg), min: 4.5 })),
    ...extra,
  ];
  const mutedFor = (textInk: string): string =>
    solve(textHue, Math.min(textChroma * 1.2, 0.06), dark ? 0.72 : 0.56, dir, [
      ...onSurfaces(),
      ...selectedLayers.map((bg) => ({ bg, min: 4.5 })),
      ...cards
        .flatMap((bg) => [over(textInk, hov, bg), over(textInk, act, bg)])
        .map((bg) => ({ bg, min: 4.5 })),
      ...selectionLayers.map((bg) => ({ bg, min: 3 })),
    ]);
  let text = solve(textHue, textChroma, dark ? 0.9 : 0.36, dir, textRequirements());
  let textMuted = mutedFor(text);
  // secondary text stays visibly quieter than text; when the surfaces push it
  // up, text moves further out to keep the step
  for (let i = 0; i < 4 && contrast(text, textMuted) < HIERARCHY; i++) {
    text = solve(
      textHue,
      textChroma,
      toLch(text).l,
      dir,
      textRequirements([{ bg: textMuted, min: HIERARCHY + 0.04 }]),
    );
    textMuted = mutedFor(text);
  }

  // a hairline is a visible seam on the page and a card, never louder
  const border = solve(g.h, Math.min(g.c * 1.1, band.c), g.l + (dark ? 0.09 : -0.08), dir, [
    { bg: page, min: SEAM + 0.05 },
    { bg: surface, min: SEAM + 0.05 },
  ]);

  const accentText = solve(as.h, Math.min(accentChroma, 0.17), toLch(accent).l, dir, [
    ...onSurfaces(),
    ...selectedLayers.map((bg) => ({ bg, min: 4.5 })),
  ]);
  const failure = solve(27, dark ? 0.13 : 0.17, dark ? 0.74 : 0.5, dir, onSurfaces());
  const success = solve(150, dark ? 0.11 : 0.1, dark ? 0.76 : 0.52, dir, onSurfaces());
  const syntaxBlue = solve(245, 0.11, dark ? 0.76 : 0.5, dir, onSurfaces());

  const [tr, tg, tb] = (parseHex(text) ?? [0, 0, 0]).map((ch) => Math.round(ch * 255));
  const rgba = (a: number): string => `rgba(${tr}, ${tg}, ${tb}, ${a})`;

  const tokens: TokenSet = {
    "--ground": page,
    "--surface": surface,
    "--surface-2": surface2,
    "--tint": tint,
    "--text": text,
    "--text-muted": textMuted,
    "--border": border,
    "--accent": accent,
    "--theme-accent-swatch": accent,
    "--accent-text": accentText,
    "--on-accent": onAccent,
    "--theme-on-accent": onAccent,
    "--success": success,
    "--failure": failure,
    "--syntax-blue": syntaxBlue,
    "--hov": rgba(hov),
    "--act": rgba(act),
    "--scrim": dark ? "rgba(0, 0, 0, 0.55)" : rgba(0.42),
    "--quokka-line-auto": QUOKKA_LINE[mode],
  };
  for (const name of LABEL_NAMES) {
    const s = toLch(LABELS[mode][name]);
    tokens[`--accent-swatch-${name}`] = solve(
      s.h,
      s.c,
      s.l,
      dir,
      cards.map((bg) => ({ bg, min: 3 })),
    );
  }
  for (const name of SCENE_NAMES) {
    const [hue, detailHue] = SCENES[name];
    const sky = { l: g.l + (dark ? 0.045 : -0.03), c: 0.03, h: hue };
    tokens[`--chat-welcome-${name}`] = fromLch(sky);
    tokens[`--chat-welcome-${name}-detail`] = fromLch({ l: dark ? 0.72 : 0.64, c: 0.1, h: detailHue });
    tokens[`--chat-welcome-${name}-ground`] = fromLch({
      l: sky.l + (dark ? 0.055 : -0.07),
      c: 0.035,
      h: hue,
    });
  }
  // a magnitude ramp for charts to come: one accent hue, five even lightness
  // steps, the quiet end still visible on a card
  const rampChroma = Math.min(accentChroma, 0.17);
  const quietest = solve(as.h, rampChroma * 0.35, toLch(tint).l + dir * 0.06, dir, [
    { bg: page, min: 2 },
    { bg: surface, min: 2 },
  ]);
  const quiet = toLch(quietest).l;
  const linkL = toLch(accentText).l;
  const strong = dark
    ? Math.max(linkL, Math.min(0.97, quiet + 0.28))
    : Math.min(linkL, Math.max(0.12, quiet - 0.28));
  tokens["--chart-seq-1"] = quietest;
  for (let i = 1; i < 5; i++) {
    const t = i / 4;
    tokens[`--chart-seq-${i + 1}`] = fromLch({
      l: quiet + (strong - quiet) * t,
      c: rampChroma * (0.35 + 0.65 * t),
      h: as.h,
    });
  }
  return { mode, tokens, notes };
}

/** The other half of a pair, when a theme gives only one: same hues,
 * lightness flipped. */
export function counterpartSeeds(seeds: ModeSeeds, target: Mode): ModeSeeds {
  const g = toLch(seeds.page);
  const a = toLch(seeds.accent);
  const dark = target === "dark";
  const out: ModeSeeds = {
    page: fromLch({ l: dark ? 0.19 : 0.965, c: Math.min(g.c * (dark ? 1.1 : 0.8), 0.03), h: g.h }),
    accent: fromLch({ l: dark ? 0.77 : 0.5, c: a.c * (dark ? 0.8 : 1), h: a.h }),
  };
  if (seeds.ink) out.ink = seeds.ink;
  return out;
}

/** The chart ramp is a proposal measured by the gate; no stylesheet has chart
 * roles yet, so it is never painted. */
const PROPOSED_ONLY = /^--chart-seq-/;

/** The tokens a theme paints onto the page: every derived role but the
 * proposed chart ramp. */
export function appliedTokens(tokens: TokenSet): TokenSet {
  return Object.fromEntries(Object.entries(tokens).filter(([name]) => !PROPOSED_ONLY.test(name)));
}

/** Every role the engine paints, in emit order (the same for every seed). */
export function appliedTokenNames(): string[] {
  return Object.keys(appliedTokens(deriveMode("light", { page: "#f6f1e7", accent: "#3f7d51" }).tokens));
}
