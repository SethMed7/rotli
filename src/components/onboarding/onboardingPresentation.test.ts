import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const onboardingCss = readFileSync(new URL("../../styles/onboarding.css", import.meta.url), "utf8");
const onboardingSource = readFileSync(new URL("onboarding.tsx", import.meta.url), "utf8");
const skySource = readFileSync(new URL("onboardingSkyLife.tsx", import.meta.url), "utf8");
const vaultSource = readFileSync(new URL("vaultActivation.tsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("../chat/chatModelChoices.tsx", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = onboardingCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  const body = match?.[1];
  if (body === undefined) throw new Error(`Missing onboarding CSS rule: ${selector}`);
  return body;
}

describe("onboarding companion presentation", () => {
  test("every step keeps actions in one fixed frame while only the stage scrolls", () => {
    const shell = ruleBody(".setup-shell");
    const stage = ruleBody(".setup-stage");
    const footer = ruleBody(".setup-footer");

    expect(shell).toContain("height: min(720px, calc(100dvh - 84px))");
    expect(stage).toContain("flex: 1");
    expect(stage).toContain("overflow-y: auto");
    expect(footer).toContain("flex: none");
  });

  test("the character sits directly on the page instead of inside a card", () => {
    const companion = ruleBody(".setup-companion");

    expect(companion).not.toMatch(/\bborder(?:-radius)?\s*:/);
    expect(companion).not.toMatch(/\bbackground\s*:/);
  });

  test("the character motion is brief, state-driven, and reduced-motion safe", () => {
    const character = ruleBody(".setup-companion .quokka");
    const reducedMotion = onboardingCss.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/,
    )?.[1];

    expect(character).toMatch(/animation:\s*setup-character-arrive\s+\d+ms/);
    expect(character).not.toContain("infinite");
    expect(reducedMotion).toContain(".setup-companion .quokka");
  });

  test("the sky is alive instead of edge quokkas: drifting clouds and fliers, still with motion off", () => {
    for (const source of [onboardingSource, vaultSource]) expect(source).not.toContain("SideFriends");
    expect(skySource).toContain("export function SkyLife");
    // motion only when it's welcome; each drifter rests at its own spot otherwise
    expect(onboardingCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[^@]*\.onb-drift[\s\S]*?animation-name:\s*onb-cross/,
    );
    expect(ruleBody(".onb-drift,\n.onb-flyer")).toContain("transform: translateX(var(--rest))");
  });

  test("approved expressions appear in first run, and the quokka's wardrobe waits in Settings", () => {
    expect(onboardingSource).toContain('pose: "waving"');
    expect(onboardingSource).toContain('pose: "knowledge"');
    expect(onboardingSource).toContain('pose: "listening"');
    // the owner, 2026-10-01: a plain quokka in setup; dressing it is a Settings choice
    expect(onboardingSource).not.toContain("QUOKKA_STYLE_PRESENTATIONS");
    expect(onboardingSource).not.toContain("QUOKKA_ACCESSORY_PRESENTATIONS");
  });

  test("chat's model chooser uses compact disclosures and explicit scroll affordances", () => {
    expect(ruleBody(".setup-model-disclosures")).toContain("flex-direction: column");
    expect(onboardingCss).toMatch(/\.setup-install-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(ruleBody(".setup-stage-scroll-cue")).toContain("position: absolute");
    expect(modelSource).toContain('<ChevronRight className="setup-disclosure-chevron"');
    expect(modelSource).toContain("<SetupModelMark");
  });
});
