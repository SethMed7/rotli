import { describe, expect, test } from "bun:test";

import {
  DEFAULT_THEME_CYCLE,
  nextTheme,
  parseThemeCycle,
  parseThemeCyclePicks,
  solidThemeLabel,
} from "./themeCycle";

const warmLight = { theme: "light", themeFamily: "warm" } as const;

describe("what the titlebar sun cycles", () => {
  test("by default it flips light and dark inside the current family", () => {
    expect(DEFAULT_THEME_CYCLE).toBe("family");
    expect(nextTheme(warmLight, false, "family", [])).toEqual({ family: "warm", mode: "dark" });
    expect(nextTheme({ theme: "dark", themeFamily: "ocean" }, false, "family", [])).toEqual({
      family: "ocean",
      mode: "light",
    });
  });

  test("System resolves to the mode the Mac shows, then flips", () => {
    const system = { theme: "system", themeFamily: "grove" } as const;
    expect(nextTheme(system, true, "family", [])).toEqual({ family: "grove", mode: "light" });
    expect(nextTheme(system, false, "family", [])).toEqual({ family: "grove", mode: "dark" });
    // all mode steps from the resolved environment too
    expect(nextTheme(system, true, "all", [])).toEqual({ family: "iris", mode: "light" });
  });

  test("all walks the fourteen in catalog order and wraps", () => {
    expect(nextTheme(warmLight, false, "all", [])).toEqual({ family: "warm", mode: "dark" });
    expect(nextTheme({ theme: "dark", themeFamily: "warm" }, false, "all", [])).toEqual({
      family: "mono",
      mode: "light",
    });
    expect(nextTheme({ theme: "dark", themeFamily: "midnight" }, false, "all", [])).toEqual({
      family: "warm",
      mode: "light",
    });
  });

  test("picks walk the chosen environments in catalog order, wrapping", () => {
    const picks = ["midnight-dark", "mono-light", "ocean-dark"];
    expect(nextTheme(warmLight, false, "picks", picks)).toEqual({ family: "mono", mode: "light" });
    expect(nextTheme({ theme: "light", themeFamily: "mono" }, false, "picks", picks)).toEqual({
      family: "ocean",
      mode: "dark",
    });
    expect(nextTheme({ theme: "dark", themeFamily: "midnight" }, false, "picks", picks)).toEqual({
      family: "mono",
      mode: "light",
    });
    // an environment outside the picks steps to the next pick after it
    expect(nextTheme({ theme: "light", themeFamily: "grove" }, false, "picks", picks)).toEqual({
      family: "midnight",
      mode: "dark",
    });
  });

  test("fewer than two valid picks is not a cycle: it falls back to light and dark", () => {
    expect(nextTheme(warmLight, false, "picks", [])).toEqual({ family: "warm", mode: "dark" });
    expect(nextTheme(warmLight, false, "picks", ["ocean-dark"])).toEqual({ family: "warm", mode: "dark" });
    expect(nextTheme(warmLight, false, "picks", ["sepia-light", "ocean-dark"])).toEqual({
      family: "warm",
      mode: "dark",
    });
  });

  test("saved values are read tolerantly", () => {
    expect(parseThemeCycle("picks")).toBe("picks");
    expect(parseThemeCycle("all")).toBe("all");
    for (const bad of ["rainbow", "", 3, null, undefined, ["all"]])
      expect(parseThemeCycle(bad)).toBe("family");
    expect(parseThemeCyclePicks(["iris-dark", "nope", 7, "warm-light", "iris-dark"])).toEqual([
      "warm-light",
      "iris-dark",
    ]);
    expect(parseThemeCyclePicks("warm-light")).toEqual([]);
    expect(parseThemeCyclePicks(null)).toEqual([]);
  });

  test("environments are named as Appearance names them", () => {
    expect(solidThemeLabel({ family: "mono", mode: "dark" })).toBe("Charcoal");
    expect(solidThemeLabel({ family: "midnight", mode: "light" })).toBe("Moonlight");
  });
});
