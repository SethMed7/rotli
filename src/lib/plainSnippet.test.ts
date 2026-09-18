import { expect, test } from "bun:test";

import { plainSnippet } from "./plainSnippet";

test("wikilinks read as their words, and inline Markdown is stripped", () => {
  expect(plainSnippet("Notes from [[omachary-research]]. Conversation notes")).toBe(
    "Notes from omachary-research. Conversation notes",
  );
  expect(plainSnippet("see [[plans/q3|the Q3 plan]] and **bold**")).toBe("see the Q3 plan and bold");
  expect(plainSnippet("plain words")).toBe("plain words");
});
