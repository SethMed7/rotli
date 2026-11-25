import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { splitTagInput } from "../lib/noteTags";
import { TagFilter, toggledTag } from "./tagFilter";

const tags = [
  { tag: "launch", count: 2, ids: ["a", "b"] },
  { tag: "q3", count: 1, ids: ["a"] },
];

test("clicking the picked chip turns the filter off; another chip switches to it", () => {
  expect(toggledTag("launch", "launch")).toBeNull();
  expect(toggledTag("launch", "q3")).toBe("q3");
  expect(toggledTag(null, "q3")).toBe("q3");
});

test("the filter is a labelled group of pressed-state chips, absent with no tags", () => {
  expect(renderToStaticMarkup(<TagFilter tags={[]} selected={null} onSelect={() => {}} />)).toBe("");
  const markup = renderToStaticMarkup(<TagFilter tags={tags} selected="q3" onSelect={() => {}} />);
  expect(markup).toContain('aria-label="Filter by tag"');
  expect(markup).toContain('aria-pressed="false" aria-label="#launch, 2 notes"');
  expect(markup).toContain('aria-pressed="true" aria-label="#q3, 1 note"');
});

test("typed tags split on spaces and commas; empty input gives none", () => {
  expect(splitTagInput("")).toEqual([]);
  expect(splitTagInput("  ,  ")).toEqual([]);
  expect(splitTagInput("#launch, q3  roadmap,")).toEqual(["#launch", "q3", "roadmap"]);
});
