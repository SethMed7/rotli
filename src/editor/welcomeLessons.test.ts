import { expect, test } from "bun:test";

import { WELCOME_CATALOG, WELCOME_LESSONS, WELCOME_NOTE } from "./welcomeLessons";

test("the catalog is the root welcome note plus three uniquely titled lessons that read as plain notes", () => {
  expect(WELCOME_NOTE.filename).toBe("Welcome to Rotli.md");
  expect(WELCOME_NOTE.body).toMatch(/^# Welcome to Rotli\n/);
  expect(WELCOME_NOTE.body).toContain("Guided lessons");
  // three, not nine (tester feedback, 2026-09-29: the tutorial ran across too many files)
  expect(WELCOME_LESSONS.map((lesson) => lesson.title)).toEqual([
    "Writing",
    "Organizing and finding",
    "AI and privacy",
  ]);
  expect(new Set(WELCOME_CATALOG.map((entry) => entry.title)).size).toBe(4);
  for (const entry of WELCOME_CATALOG) {
    expect(entry.body.startsWith(`# ${entry.title}\n`)).toBe(true);
    // the old session tab and its Playground branding are gone
    expect(entry.body).not.toMatch(/Playground|Save lesson|Raw Markdown|app-owned/);
  }
});

test("the welcome note teaches autosave and the real new-note chords", () => {
  // ⌘S does nothing for a note (it saves as you type) and ⌘N opens the
  // new-tab chooser — ⌘T is the chord that creates a note
  expect(WELCOME_NOTE.body).not.toContain("⌘S");
  expect(WELCOME_NOTE.body).toContain("1. Change this sentence. Rotli saves as you type");
  expect(WELCOME_NOTE.body).toContain(
    "2. Press **⌘T** to create a note, or **⌘N** to choose what a new tab becomes.",
  );
});
