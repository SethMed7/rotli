import { describe, expect, test } from "bun:test";
import { flatCssViolations } from "./design-system-policy.mjs";

describe("flat CSS policy", () => {
  test.each([
    ["box-shadow", ".card { box-shadow: 0 8px 24px black; }"],
    ["text-shadow", ".label { text-shadow: 0 1px black; }"],
    ["filter", ".button { filter: brightness(1.1); }"],
    ["backdrop-filter", ".scrim { backdrop-filter: blur(8px); }"],
    ["-webkit-backdrop-filter", ".scrim { -webkit-backdrop-filter: blur(8px); }"],
  ])("rejects %s effects", (_, css) => {
    expect(flatCssViolations(css, "src/styles/example.css")).toHaveLength(1);
  });

  test("rejects effect tokens and fixed palette access from components", () => {
    expect(flatCssViolations(":root { --shadow-card: none; }", "src/styles/example.css")).toHaveLength(1);
    expect(flatCssViolations(".tip { color: var(--rotli-cocoa); }", "src/styles/example.css")).toHaveLength(
      1,
    );
  });

  test("allows flat semantic hierarchy and a class named filter", () => {
    const css =
      ".filter:focus-within { border-color: var(--border-strong); outline: 2px solid var(--accent); }";
    expect(flatCssViolations(css, "src/styles/example.css")).toEqual([]);
  });

  test("allows the foundation to map fixed palette colors into semantic roles", () => {
    expect(flatCssViolations(":root { --icon-clay: var(--rotli-clay); }", "src/styles/base.css")).toEqual([]);
  });
});
