import { expect, test } from "bun:test";

import { graphError, graphInputsReady } from "./composition";

test("the graph waits for the note lists that name its dots, never drawing an Untitled frame", () => {
  const links = [{ noteId: "a.md", targets: [], suggested: [], secure: false }];
  // the projection alone isn't enough: its rows carry no titles
  expect(graphInputsReady(links, false, [])).toBe(false);
  expect(graphInputsReady(links, true, undefined)).toBe(false);
  expect(graphInputsReady(undefined, true, [])).toBe(false);
  expect(graphInputsReady(null, true, [])).toBe(false);
  expect(graphInputsReady(links, true, [])).toBe(true);
});

test("a list the graph waits on that fails is reported, never an endless Loading…", () => {
  expect(graphError(null, null, undefined)).toBeNull();
  expect(graphError(null, new Error("vault unreadable"), null)).toBe("vault unreadable");
  expect(graphError(null, null, "archive gone")).toBe("archive gone");
  // the projection's own failure comes first, as before
  expect(graphError(new Error("links"), new Error("notes"), null)).toBe("links");
});
