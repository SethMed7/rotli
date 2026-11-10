import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LibrarianSettingsNotice, SETTINGS_HELP } from "./librarianSettingsNotice";

// Fourth review of pull request 267: the organizer refused on unreadable
// settings, but Activity never said so.
test("Activity says the settings couldn't be read, where they are, and what to do; and nothing otherwise", () => {
  const refusal =
    "Rotli couldn’t read this vault’s settings, so the Librarian didn’t classify, organize or file anything. Your notes haven’t changed.";
  const shown = renderToStaticMarkup(<LibrarianSettingsNotice error={refusal} />);
  expect(shown).toContain('role="status"');
  expect(shown).toContain(refusal);
  expect(shown).toContain(SETTINGS_HELP);
  expect(SETTINGS_HELP).toContain(".rotli/settings.json");
  expect(renderToStaticMarkup(<LibrarianSettingsNotice error={null} />)).toBe("");
  expect(renderToStaticMarkup(<LibrarianSettingsNotice error="local model offline" />)).toBe("");
});
