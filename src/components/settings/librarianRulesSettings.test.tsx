import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_LIBRARIAN_RULES, type LibrarianRules } from "../../lib/librarianRules";
import { ENTRY_PROBLEMS, entryProblem, RulesEditor } from "./librarianRulesSettings";

const render = (rules: LibrarianRules, native = true) =>
  renderToStaticMarkup(<RulesEditor native={native} rules={rules} setRules={() => undefined} />);

test("adding says why an entry can't go on the list", () => {
  expect(entryProblem("  ", [], 5)).toBe(ENTRY_PROBLEMS.empty);
  expect(entryProblem("bank", ["Bank"], 5)).toBe(ENTRY_PROBLEMS.duplicate);
  expect(entryProblem("x", ["a", "b"], 2)).toBe("That’s the most this list holds (2).");
  expect(entryProblem("ok", [], 5, () => "nope")).toBe("nope");
  expect(entryProblem("ok", [], 5)).toBeNull();
});

test("the rules start with the People groups and an empty keyword list", () => {
  const markup = render(DEFAULT_LIBRARIAN_RULES);
  for (const group of ["Family", "Friends", "Work", "Acquaintances"])
    expect(markup).toContain(`<span>${group}</span>`);
  expect(markup).toContain('aria-label="Add to Secure keywords"');
  expect(markup).toContain("Only the name is checked, never what the note says");
  // nothing to protect yet, so no button
  expect(markup).not.toContain("Secure matching notes now");
});

test("with keywords, the Mac app offers to protect notes already named that way", () => {
  const rules = { ...DEFAULT_LIBRARIAN_RULES, secureKeywords: ["bank"] };
  expect(render(rules)).toContain("Secure matching notes now");
  expect(render(rules)).toContain("<span>bank</span>");
  expect(render(rules, false)).toContain("works in the Mac app");
});

test("one People list hides the groups", () => {
  const markup = render({ ...DEFAULT_LIBRARIAN_RULES, people: { mode: "simple", groups: ["Family"] } });
  expect(markup).toContain("Every note about a person is filed into one People folder.");
  expect(markup).not.toContain("<span>Family</span>");
});
