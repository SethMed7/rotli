import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AliasCleanupSettings, cleanupSummary } from "./aliasCleanupSettings";

test("the summary says what a check found and what a clean-up did", () => {
  const found = { notes: 12, aliases: 31, keptLinked: 0 };
  expect(cleanupSummary(found, false)).toBe("31 leftover names in 12 notes.");
  expect(cleanupSummary(found, true)).toBe("Removed 31 leftover names from 12 notes.");
  expect(cleanupSummary({ notes: 1, aliases: 1, keptLinked: 2 }, false)).toBe(
    "1 leftover name in 1 note. 2 names stay because links use them.",
  );
  expect(cleanupSummary({ notes: 0, aliases: 0, keptLinked: 0 }, false)).toBe("No leftover names.");
  expect(cleanupSummary({ notes: 0, aliases: 0, keptLinked: 1 }, true)).toBe(
    "Nothing left to clean up. 1 name stays because a link uses it.",
  );
});

test("outside the Mac app the row says where it works; inside, it checks first", () => {
  expect(renderToStaticMarkup(<AliasCleanupSettings native={false} />)).toContain("In the Mac app.");
  expect(renderToStaticMarkup(<AliasCleanupSettings native />)).toContain("Checking your notes…");
});
