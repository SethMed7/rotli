import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { SettingsTrouble } from "../lib/settingsTrouble";
import { LibrarianSettingsNotice, SETTINGS_HELP } from "./librarianSettingsNotice";

const refusal =
  "Rotli couldn’t read this vault’s settings, so the Librarian didn’t classify, organize or file anything. Your notes haven’t changed.";

// Fourth review of pull request 267: the organizer refused on unreadable
// settings, but Activity never said so.
test("Activity says the settings couldn't be read, where they are, and what to do; and nothing otherwise", () => {
  const shown = renderToStaticMarkup(<LibrarianSettingsNotice error={refusal} trouble="malformed" />);
  expect(shown).toContain('role="status"');
  expect(shown).toContain(refusal);
  expect(shown).toContain(SETTINGS_HELP.malformed);
  expect(renderToStaticMarkup(<LibrarianSettingsNotice error={null} trouble="malformed" />)).toBe("");
  expect(renderToStaticMarkup(<LibrarianSettingsNotice error="local model offline" />)).toBe("");
});

// Fifth review: one help line was wrong for two of the three troubles. A hard
// link or a file that can't be opened fails the app's own read, so setting
// changes stay off for the session (settingsGuard) and nothing is copied aside.
test("each trouble gets its own way out, and none claims what Rotli won't do", () => {
  expect(SETTINGS_HELP.malformed).toContain("settings.json.unreadable-");
  expect(SETTINGS_HELP.hardLinked).toContain("hard link");
  expect(SETTINGS_HELP.hardLinked).toContain("independent copy");
  expect(SETTINGS_HELP.malformed).toContain("Change any setting");
  for (const blocked of [SETTINGS_HELP.hardLinked, SETTINGS_HELP.unreadable]) {
    expect(blocked).not.toContain("unreadable-");
    expect(blocked).not.toContain("Change any setting");
    expect(blocked).toMatch(/doesn’t (open or )?change it/);
  }
  for (const help of [SETTINGS_HELP.malformed, SETTINGS_HELP.hardLinked, SETTINGS_HELP.unreadable])
    expect(help).toContain(".rotli/settings.json");
  for (const [trouble, help] of Object.entries(SETTINGS_HELP) as [SettingsTrouble, string][])
    expect(renderToStaticMarkup(<LibrarianSettingsNotice error={refusal} trouble={trouble} />)).toContain(
      help,
    );
  // before the second read: the refusal alone
  const pending = renderToStaticMarkup(<LibrarianSettingsNotice error={refusal} />);
  expect(pending).toContain(refusal);
  expect(pending.match(/act-settings-line/g)).toHaveLength(1);
});
