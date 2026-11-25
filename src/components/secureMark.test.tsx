// The quiet "Secure note" mark on a note's row: one flag the list already
// carries, read strictly (never "secure unless the list says otherwise").

import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { NoteSummary } from "../types";
import { NoteListRow } from "./noteListRow";
import { SECURE_MARK_LABEL, SecureMark, isMarkedSecure } from "./secureMark";
import { MainNoteLabel } from "./sidebar/mainNoteLabel";

const note = (over: Partial<NoteSummary> = {}): NoteSummary => ({
  id: "n1",
  title: "Passport scan",
  snippet: "numbers",
  folderId: "Inbox",
  createdAt: 1,
  updatedAt: 2,
  pinned: false,
  ...over,
});

test("only a list that says secure marks the row; a missing flag never does", () => {
  expect(isMarkedSecure(note({ secure: true }))).toBe(true);
  expect(isMarkedSecure(note({ secure: false }))).toBe(false);
  expect(isMarkedSecure(note())).toBe(false);
});

test("the mark has a name and a tooltip, and hides its drawing from the reader", () => {
  const html = renderToStaticMarkup(<SecureMark className="x" />);
  expect(html).toContain('role="img"');
  expect(html).toContain(`aria-label="${SECURE_MARK_LABEL}"`);
  expect(html).toContain(`title="${SECURE_MARK_LABEL}"`);
  expect(SECURE_MARK_LABEL).toBe("Secure note");
});

test("a Main tree row wears it only when the note is secure", () => {
  const on = renderToStaticMarkup(
    <MainNoteLabel note={note({ secure: true })} title="Passport scan" slot={undefined} />,
  );
  const off = renderToStaticMarkup(<MainNoteLabel note={note()} title="Passport scan" slot={undefined} />);
  expect(on).toContain(SECURE_MARK_LABEL);
  expect(off).not.toContain(SECURE_MARK_LABEL);
  // the title still owns the row's flexible space, so a long name still truncates
  expect(on.indexOf('class="snt"')).toBeLessThan(on.indexOf("secure-mark"));
});

test("an All notes row wears it beside the title, not in place of anything", () => {
  const row = (n: NoteSummary) => renderToStaticMarkup(<NoteListRow note={n} onOpen={() => {}} />);
  const on = row(note({ secure: true, pinned: true }));
  expect(on).toContain(SECURE_MARK_LABEL);
  // the note's own glyph, the shield and the pin all draw: nothing was displaced
  expect(on.match(/<svg/g)).toHaveLength(3);
  expect(on.indexOf("Passport scan")).toBeLessThan(on.indexOf(SECURE_MARK_LABEL));
  expect(row(note())).not.toContain(SECURE_MARK_LABEL);
});

test("the mark carries no note text", () => {
  const html = renderToStaticMarkup(<SecureMark />);
  expect(html).not.toContain("Passport");
});
