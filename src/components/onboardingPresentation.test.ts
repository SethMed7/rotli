import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const onboardingCss = readFileSync(new URL("../styles/onboarding.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = onboardingCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  const body = match?.[1];
  if (body === undefined) throw new Error(`Missing onboarding CSS rule: ${selector}`);
  return body;
}

describe("onboarding companion presentation", () => {
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
});
