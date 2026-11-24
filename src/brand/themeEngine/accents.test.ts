import { expect, test } from "bun:test";

import { seededRandom } from "../../lib/seededRandom";
import { ACCENT_VARIANTS, accentVariants, customHueAccent } from "./accents";
import { audit, failures } from "./gate";
import { MODES } from "./policy";
import { resolveSeeds } from "./resolve";

const hex = (rand: () => number) => () =>
  `#${[0, 0, 0]
    .map(() =>
      Math.floor(rand() * 256)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

test("every Primary-color choice on a custom page passes the gate, Custom hue at any angle", () => {
  const rand = seededRandom(2026);
  const color = hex(rand);
  for (let i = 0; i < 12; i++) {
    const resolved = resolveSeeds({
      light: { page: color(), accent: color() },
      dark: { page: color(), accent: color() },
    })!;
    const hue = Math.floor(rand() * 360);
    for (const mode of MODES) {
      const base = resolved[mode].tokens;
      const variants = accentVariants(mode, resolved[mode].seeds, base, "standard", hue);
      for (const name of ACCENT_VARIANTS) {
        const painted = { ...base, ...variants[name] };
        expect(failures(audit(painted, mode))).toEqual([]);
        // the page never moves under a Primary-color choice
        expect(painted["--ground"]).toBe(base["--ground"]);
      }
    }
  }
});

test("a choice that changes nothing still names the accent roles, so it outranks a static preset", () => {
  const resolved = resolveSeeds({ light: { page: "#f6f1e7", accent: "#3f7d51" } })!;
  const base = resolved.light.tokens;
  // the green preset by day is the forest accent itself
  const variants = accentVariants("light", resolved.light.seeds, base, "standard", 210);
  expect(variants.green).toEqual({
    "--accent": base["--accent"]!,
    "--accent-text": base["--accent-text"]!,
    "--on-accent": base["--on-accent"]!,
  });
  expect(variants.blue["--accent"]).not.toBe(base["--accent"]);
});

test("the Custom hue wraps and refuses a non-number", () => {
  expect(customHueAccent("light", 370)).toBe(customHueAccent("light", 10));
  expect(customHueAccent("dark", Number.NaN)).toBe(customHueAccent("dark", 210));
});
