import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DISCARD_WORDS, GoneNotesNoticeView, KEEP_WORDS } from "./goneNotesNotice";

const view = (ids: string[]) =>
  renderToStaticMarkup(
    <GoneNotesNoticeView ids={ids} name={() => "“Plan”"} keep={async () => {}} discard={() => {}} />,
  );

test("nothing to say when no deleted note has unsaved words", () => {
  expect(view([])).toBe("");
});

test("each deleted note with unsaved words gets plain words and both choices", () => {
  const shown = view(["n1"]);
  expect(shown).toContain("“Plan” was deleted while it had unsaved words.");
  expect(shown).toContain(KEEP_WORDS);
  expect(shown).toContain(DISCARD_WORDS);
  expect(shown).toContain('aria-label="Unsaved words from deleted notes"');
});
