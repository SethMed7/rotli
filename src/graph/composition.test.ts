import { expect, test } from "bun:test";

import { graphInputsReady } from "./composition";

test("the graph waits for the note lists that name its dots, never drawing an Untitled frame", () => {
  const links = [{ noteId: "a.md", targets: [], suggested: [], secure: false }];
  // the projection alone isn't enough: its rows carry no titles
  expect(graphInputsReady(links, false, [])).toBe(false);
  expect(graphInputsReady(links, true, undefined)).toBe(false);
  expect(graphInputsReady(undefined, true, [])).toBe(false);
  expect(graphInputsReady(null, true, [])).toBe(false);
  expect(graphInputsReady(links, true, [])).toBe(true);
});
