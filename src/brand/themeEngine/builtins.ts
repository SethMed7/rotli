// The built-in environments, read from the token stylesheets and measured by
// the same gate as a custom theme. Their failures are recorded in
// builtinBaseline.json, which may only shrink: tuning the built-ins is its own
// pass, and the gate is never loosened to let them through.

import { normHex } from "./color";
import { type TokenSet, deriveMode } from "./derive";
import { audit } from "./gate";
import { LABELS, LABEL_NAMES, type Mode } from "./policy";

export const BUILT_IN_ENVIRONMENTS = [
  "light",
  "dark",
  "paper",
  "charcoal",
  ...["ocean", "grove", "iris", "blossom", "midnight", "tesven"].flatMap((family) => [
    `${family}-light`,
    `${family}-dark`,
  ]),
] as const;

export const builtInMode = (theme: string): Mode =>
  theme === "dark" || theme === "charcoal" || theme.endsWith("-dark") ? "dark" : "light";

export interface CssBlock {
  selectors: string[];
  decls: Record<string, string>;
}

/** Flat rule blocks with their custom-property declarations. Comments and
 * `@import` lines are dropped; nested at-rules are not used by token files. */
export function cssBlocks(css: string): CssBlock[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+[^;]+;/g, "");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((selector) => selector.trim()),
    decls: Object.fromEntries(
      [...(match[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [
        d[1] ?? "",
        (d[2] ?? "").trim(),
      ]),
    ),
  }));
}

/** A built-in environment's token set as the gate reads it: `:root`, then the
 * environment's own blocks; every hex value as declared. Roles the stylesheets
 * leave to inheritance or formulas are filled by the engine from the
 * environment's page and accent, and the label hues are the shipped palette. */
export function builtInTokens(blocks: readonly CssBlock[], theme: string): TokenSet {
  const mode = builtInMode(theme);
  const decls: Record<string, string> = {};
  for (const block of blocks) if (block.selectors.includes(":root")) Object.assign(decls, block.decls);
  if (theme !== "light")
    for (const block of blocks)
      if (block.selectors.includes(`:root[data-theme="${theme}"]`)) Object.assign(decls, block.decls);
  const tokens: TokenSet = {
    ...deriveMode(mode, { page: decls["--ground"] ?? "", accent: decls["--accent"] ?? "" }).tokens,
  };
  for (const [name, value] of Object.entries(decls)) {
    const hex = normHex(value);
    if (hex) tokens[name] = hex;
  }
  for (const name of LABEL_NAMES) tokens[`--accent-swatch-${name}`] = LABELS[mode][name];
  return tokens;
}

/** One failing pair, as the baseline records it. */
export const pairKey = (row: { role: string; on: string }): string => `${row.role} on ${row.on}`;

/** Every failing pair per built-in environment, at Standard. Chart rows are
 * left out: no built-in has chart roles yet. */
export function builtInFailures(css: string): Record<string, string[]> {
  const blocks = cssBlocks(css);
  const out: Record<string, string[]> = {};
  for (const theme of BUILT_IN_ENVIRONMENTS) {
    out[theme] = audit(builtInTokens(blocks, theme), builtInMode(theme))
      .filter((row) => !row.pass && !row.role.startsWith("Chart"))
      .map(pairKey);
  }
  return out;
}

/** What changed against the recorded baseline: `added` is a regression;
 * `fixed` must be deleted from the baseline so it can never come back. */
export function compareWithBaseline(
  current: Record<string, string[]>,
  baseline: Record<string, string[]>,
): { added: string[]; fixed: string[] } {
  const added: string[] = [];
  const fixed: string[] = [];
  for (const theme of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const now = new Set(current[theme] ?? []);
    const was = new Set(baseline[theme] ?? []);
    for (const pair of now) if (!was.has(pair)) added.push(`${theme}: ${pair}`);
    for (const pair of was) if (!now.has(pair)) fixed.push(`${theme}: ${pair}`);
  }
  return { added, fixed };
}
