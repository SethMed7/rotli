import { expect, test } from "bun:test";

import { WELCOME_CATALOG, WELCOME_LESSONS, WELCOME_NOTE } from "./welcomeLessons";

test("the catalog is the root welcome note plus nine uniquely titled lessons that read as plain notes", () => {
  expect(WELCOME_NOTE.filename).toBe("Welcome to Rotli.md");
  expect(WELCOME_NOTE.body).toMatch(/^# Welcome to Rotli\n/);
  expect(WELCOME_NOTE.body).toContain("Guided lessons");
  expect(WELCOME_LESSONS).toHaveLength(9);
  expect(new Set(WELCOME_CATALOG.map((entry) => entry.title)).size).toBe(10);
  for (const entry of WELCOME_CATALOG) {
    expect(entry.body.startsWith(`# ${entry.title}\n`)).toBe(true);
    // the old session tab and its Playground branding are gone
    expect(entry.body).not.toMatch(/Playground|Save lesson|Raw Markdown|app-owned/);
  }
});
