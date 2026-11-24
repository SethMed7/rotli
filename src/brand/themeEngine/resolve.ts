// A theme's seeds to both environments, each derived and then gated.

import { type DerivedMode, type ModeSeeds, counterpartSeeds, deriveMode } from "./derive";
import { type GateRow, audit } from "./gate";
import { type ContrastLevel, MODES, type Mode, asContrastLevel } from "./policy";

export interface ResolvedMode extends DerivedMode {
  seeds: ModeSeeds;
  /** Worked out from the other half because the theme gave none. */
  derivedHalf: boolean;
  rows: GateRow[];
  ok: boolean;
}

export type ResolvedTheme = Record<Mode, ResolvedMode> & { ok: boolean };

/** Both halves. A theme needs at least one; the other is worked out from it. */
export function resolveSeeds(
  seeds: Partial<Record<Mode, ModeSeeds>>,
  level: ContrastLevel = "standard",
): ResolvedTheme | null {
  const contrastLevel = asContrastLevel(level);
  const either = seeds.light ?? seeds.dark;
  if (!either) return null;
  const out = {} as Record<Mode, ResolvedMode>;
  for (const mode of MODES) {
    const given = seeds[mode];
    const other = seeds[mode === "light" ? "dark" : "light"] ?? either;
    const modeSeeds = given ?? counterpartSeeds(other, mode);
    const derived = deriveMode(mode, modeSeeds, contrastLevel);
    const rows = audit(derived.tokens, mode, contrastLevel);
    out[mode] = {
      ...derived,
      seeds: modeSeeds,
      derivedHalf: !given,
      rows,
      ok: rows.every((row) => row.pass),
    };
  }
  return { ...out, ok: out.light.ok && out.dark.ok };
}
