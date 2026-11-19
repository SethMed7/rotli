import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  COPY_WORDS,
  CopiedAsideNoticeView,
  DISCARD_WORDS,
  GoneNotesNoticeView,
  OPEN_COPY,
} from "./goneNotesNotice";

const view = (ids: string[]) =>
  renderToStaticMarkup(
    <GoneNotesNoticeView ids={ids} name={() => "“Plan”"} copy={async () => {}} discard={() => {}} />,
  );

test("nothing to say when no deleted note has unsaved words", () => {
  expect(view([])).toBe("");
});

test("each deleted note with unsaved words gets plain words: copy them, or discard them", () => {
  const shown = view(["n1"]);
  expect(shown).toContain("“Plan” was deleted while it had unsaved words.");
  expect(shown).toContain(COPY_WORDS);
  expect(shown).toContain(DISCARD_WORDS);
  expect(shown).not.toContain("new note");
  expect(shown).toContain('aria-label="Unsaved words from deleted notes"');
});

test("a conflict copy is named, with a way to open it", () => {
  const shown = renderToStaticMarkup(
    <CopiedAsideNoticeView
      entries={[{ copyId: "c1", copyName: "“Plan (unsaved edits 2026-11-10 04:00)”", noteName: "“Plan”" }]}
      open={() => {}}
      dismiss={() => {}}
    />,
  );
  expect(shown).toContain("Another app changed “Plan” while it had unsaved words.");
  expect(shown).toContain("“Plan (unsaved edits 2026-11-10 04:00)”");
  expect(shown).toContain(OPEN_COPY);
  expect(shown).toContain('aria-label="Unsaved words kept as a copy"');
  expect(
    renderToStaticMarkup(<CopiedAsideNoticeView entries={[]} open={() => {}} dismiss={() => {}} />),
  ).toBe("");
});
