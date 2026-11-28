import { expect, test } from "bun:test";

import { seededRandom } from "../../lib/seededRandom";
import { deriveMode, type ModeSeeds } from "./derive";
import { audit, failures } from "./gate";
import { ACCENT_PRESETS, ACCENT_PRESET_NAMES, CONTRAST_LEVELS, LEVELS, MODES } from "./policy";
import { resolveSeeds } from "./resolve";

// Property tests over seeded random seeds, mirroring the plan's sweep.mjs:
// any colour at all, every contrast level, both modes, and every listed pair
// must pass. ROTLI_THEME_SWEEP_N raises the count (the plan ran 4,000).

/** Generous: the sweep is CPU-bound and shares the machine with the suite. */
const BUDGET_MS = 60_000;
const N = Number(process.env.ROTLI_THEME_SWEEP_N ?? 100);

const hexFrom = (rand: () => number) => (): string =>
  `#${[0, 0, 0]
    .map(() =>
      Math.floor(rand() * 256)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

test(
  `${N} random seed sets pass every pair at every level in both modes`,
  () => {
    const rand = seededRandom(20261124);
    const hex = hexFrom(rand);
    const half = (): ModeSeeds => ({ page: hex(), accent: hex(), ...(rand() < 0.5 ? { ink: hex() } : {}) });
    const failing: string[] = [];
    let textOnPageFloor = Infinity;
    for (let i = 0; i < N; i++) {
      const seeds = { light: half(), dark: half() };
      for (const level of CONTRAST_LEVELS) {
        const resolved = resolveSeeds(seeds, level)!;
        for (const mode of MODES) {
          for (const row of failures(resolved[mode].rows))
            failing.push(
              `${JSON.stringify(seeds)} ${level} ${mode}: ${row.role} on ${row.on} ${row.ratio.toFixed(2)}`,
            );
          const onPage = resolved[mode].rows.find((r) => r.role === "Text on the page")!;
          if (level === "standard") textOnPageFloor = Math.min(textOnPageFloor, onPage.ratio);
        }
      }
    }
    expect(failing).toEqual([]);
    expect(textOnPageFloor).toBeGreaterThanOrEqual(LEVELS.standard.aim);
  },
  BUDGET_MS,
);

test(
  "one-sided themes pass too: the worked-out half meets the same gate",
  () => {
    const rand = seededRandom(31);
    const hex = hexFrom(rand);
    for (let i = 0; i < Math.ceil(N / 3); i++) {
      const given = { page: hex(), accent: hex() };
      for (const seeds of [{ light: given }, { dark: given }]) {
        const resolved = resolveSeeds(seeds)!;
        expect(resolved.ok).toBe(true);
      }
    }
  },
  BUDGET_MS,
);

test(
  "the Primary-color presets pass on any custom page once solved",
  () => {
    const rand = seededRandom(7);
    const hex = hexFrom(rand);
    for (let i = 0; i < Math.ceil(N / 5); i++) {
      for (const mode of MODES) {
        const page = deriveMode(mode, { page: hex(), accent: hex() }).tokens["--ground"]!;
        for (const name of ACCENT_PRESET_NAMES) {
          const solved = deriveMode(mode, { page, accent: ACCENT_PRESETS[name][mode] });
          expect(failures(audit(solved.tokens, mode))).toEqual([]);
        }
      }
    }
  },
  BUDGET_MS,
);

test(
  "deriving again from a derived page and accent moves neither",
  () => {
    const rand = seededRandom(99);
    const hex = hexFrom(rand);
    for (let i = 0; i < N; i++) {
      for (const mode of MODES) {
        const first = deriveMode(mode, { page: hex(), accent: hex() }).tokens;
        const again = deriveMode(mode, { page: first["--ground"]!, accent: first["--accent"]! }).tokens;
        expect([again["--ground"], again["--accent"]]).toEqual([first["--ground"], first["--accent"]]);
      }
    }
  },
  BUDGET_MS,
);
