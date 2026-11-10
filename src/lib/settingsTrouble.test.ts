import { expect, test } from "bun:test";

import { isSettingsUnreadable, type SettingsTrouble, settingsTrouble } from "./settingsTrouble";

const reads = (text: string) => () => Promise.resolve(text);
const fails = (message: string) => () => Promise.reject(new Error(message));

/** What one more read of the settings finds, by the trouble it names. */
const READS: Record<SettingsTrouble, (() => Promise<string>)[]> = {
  malformed: [reads("{ not json"), reads("[1, 2]"), reads('{"librarianRules": "all"}')],
  // Rust's words for a hard link (fsutil::open_own_file), through dot_read
  hardLinked: [
    fails("read settings: read settings.json: this file has a hard link, so Rotli doesn't open it"),
  ],
  unreadable: [fails("read settings: read settings.json: Permission denied (os error 13)")],
  readable: [reads('{"librarianRules": {}}'), reads("{}")],
};

test("the three troubles, told apart by one more read", async () => {
  for (const [trouble, cases] of Object.entries(READS))
    for (const read of cases) expect(await settingsTrouble(read)).toBe(trouble as SettingsTrouble);
});

test("only the settings refusal counts", () => {
  expect(isSettingsUnreadable("Rotli couldn’t read this vault’s settings, so the Librarian didn’t …")).toBe(
    true,
  );
  expect(isSettingsUnreadable("local model offline")).toBe(false);
  expect(isSettingsUnreadable(null)).toBe(false);
});
