// First run's own screens, rendered: you and your theme without the quokka's
// wardrobe, the Librarian on its own, and shortcuts that read as changeable.

import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { registerDefaultActions } from "../../keys/actions";
import { ONBOARDING_TOTAL_STEPS } from "../../state/onboarding";
import { Onboarding } from "./onboarding";

registerDefaultActions();

const render = (step: "you" | "librarian" | "shortcuts") =>
  renderToStaticMarkup(<Onboarding step={step} resumed onDone={() => {}} onBack={() => {}} />);

test("the first screen is your name and a theme, and nothing dresses the quokka", () => {
  const html = render("you");
  expect(html).toContain(`1 of ${ONBOARDING_TOTAL_STEPS}`);
  expect(html).toContain("What should Rotli call you?");
  expect(html).toContain('aria-label="Theme"');
  expect(html).not.toContain("Keep my quokka");
  expect(html).not.toContain('aria-label="Accessory"');
  expect(html).toContain(">Choose where notes live<");
  expect(html).toContain(">Skip app setup<");
});

test("the Librarian has a screen of its own; chat models wait for Chat", () => {
  const html = render("librarian");
  expect(html).toContain(`3 of ${ONBOARDING_TOTAL_STEPS}`);
  expect(html).toContain("Who files your notes?");
  // whether first, as two cards; on by default, so where it thinks follows
  expect(html).toContain('aria-label="Librarian"');
  expect(html).toContain("Use the Librarian");
  expect(html).toContain("Not now");
  expect(html.indexOf("Use the Librarian")).toBeLessThan(html.indexOf('aria-label="Librarian model"'));
  expect(html).toContain('aria-label="Librarian model"');
  expect(html).toContain("Models for chat come the first time you open Chat");
  expect(html).not.toContain("Install a model");
  expect(html).not.toContain(">Skip app setup<");
});

test("every shortcut says it can change, and where to change it later", () => {
  const html = render("shortcuts");
  expect(html).toContain(`4 of ${ONBOARDING_TOTAL_STEPS}`);
  expect(html).toContain("Three shortcuts, yours to change.");
  expect(html).toContain("Settings → Keybindings");
  expect(html.match(/class="setup-chord-change"/g)).toHaveLength(3);
  expect(html).toContain('aria-label="Change Quick capture shortcut"');
  // nothing changed yet: no way back to a default it already has
  expect(html).not.toContain("Use default");
  expect(html).toContain(">Finish setup<");
});
