import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const onboardingCss = readFileSync(new URL("../../styles/onboarding.css", import.meta.url), "utf8");
const onboardingSource = readFileSync(new URL("onboarding.tsx", import.meta.url), "utf8");
const vaultSource = readFileSync(new URL("vaultActivation.tsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("modelSetup.tsx", import.meta.url), "utf8");

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
    expect(reducedMotion).toContain(".setup-side-friend { animation: none; opacity: 0; }");
    expect(reducedMotion).toContain(".setup-side-friend--beat-1 { opacity: 0.38;");
    expect(reducedMotion).toContain(".setup-side-friend--beat-2 { opacity: 0.38;");
  });

  test("two shared edge friends remain while the four slowly alternate at staggered heights", () => {
    expect(onboardingSource).toContain("<SetupSideFriends />");
    expect(vaultSource).toContain("<SetupSideFriends />");
    expect(modelSource).toContain("<SetupSideFriends />");
    expect(ruleBody(".setup-side-friend--left")).toMatch(
      /animation:\s*setup-side-lean-left\s+32000ms[\s\S]*infinite/,
    );
    expect(ruleBody(".setup-side-friend--right")).toMatch(
      /animation:\s*setup-side-lean-right\s+32000ms[\s\S]*infinite/,
    );
    expect(onboardingCss).toMatch(
      /@keyframes\s+setup-side-lean-left[\s\S]*?14%\s*\{[^}]*rotate\(72deg\)[\s\S]*?64%\s*\{[^}]*opacity:\s*0/,
    );
    expect(ruleBody(".setup-side-friend .quokka")).toContain("max-width: 82px");
    expect(ruleBody(".setup-side-friend--upper")).toContain("--friend-top: 31%");
    expect(ruleBody(".setup-side-friend--lower")).toContain("--friend-top: 72%");
    expect(ruleBody(".setup-side-friend--beat-2")).toContain("--friend-delay: -8000ms");
    expect(ruleBody(".setup-side-friend--beat-4")).toContain("--friend-delay: -24000ms");
    expect(onboardingCss).toMatch(
      /@media\s*\(max-width:\s*720px\)[\s\S]*\.setup-side-friends\s*\{\s*display:\s*none/,
    );
  });

  test("model setup uses compact disclosures and explicit scroll affordances", () => {
    expect(ruleBody(".setup-model-disclosures")).toContain("flex-direction: column");
    expect(onboardingCss).toMatch(/\.setup-install-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(ruleBody(".setup-stage-scroll-cue")).toContain("position: absolute");
    expect(modelSource).toContain('<ChevronRight className="setup-disclosure-chevron"');
    expect(modelSource).toContain("<SetupModelMark");
  });
});
