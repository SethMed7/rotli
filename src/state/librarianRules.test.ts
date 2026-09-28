import { afterEach, expect, test } from "bun:test";

import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import { useLibrarianRules } from "./librarianRules";

afterEach(() => useLibrarianRules.setState({ rules: DEFAULT_LIBRARIAN_RULES }));

test("the store starts with the default rules and takes a whole new set", () => {
  expect(useLibrarianRules.getState().rules).toEqual(DEFAULT_LIBRARIAN_RULES);
  const rules = { ...DEFAULT_LIBRARIAN_RULES, secureKeywords: ["bank"], filing: ["Recipes go to Cooking"] };
  useLibrarianRules.getState().setRules(rules);
  expect(useLibrarianRules.getState().rules).toEqual(rules);
});
