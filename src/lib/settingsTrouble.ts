// Why the organizer couldn't read a vault's settings (fifth review of pull
// request 267). Rust refuses with one sentence (librarian_rules.rs
// SETTINGS_UNREADABLE) for three different troubles, and each has a different
// way out, so Activity reads the file once more and says which.

import { isHardLinkRefusal } from "./hardLinks";

/** The start of Rust's SETTINGS_UNREADABLE, as the organizer reports it. */
const SETTINGS_UNREADABLE = "Rotli couldn’t read this vault’s settings";

/** Is the organizer's last error the settings refusal? */
export const isSettingsUnreadable = (error: string | null | undefined): error is string =>
  !!error && error.startsWith(SETTINGS_UNREADABLE);

/**
 * - `malformed`: the file reads, but isn't settings (not a JSON object, or its
 *   rules aren't an object);
 * - `hardLinked`: the file has a second name, so Rotli doesn't open it;
 * - `unreadable`: it can't be opened at all (permissions, the disk);
 * - `readable`: it reads correctly now (fixed since the last run).
 */
export type SettingsTrouble = "malformed" | "hardLinked" | "unreadable" | "readable";

/** Mirrors Rust's checked_rules: a JSON object whose librarianRules, when
 * present, is an object. */
function holdsSettings(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const rules = (value as Record<string, unknown>)["librarianRules"];
    return rules === undefined || (typeof rules === "object" && rules !== null && !Array.isArray(rules));
  } catch {
    return false;
  }
}

/** Which trouble, from one more read of the settings file. */
export async function settingsTrouble(read: () => Promise<string>): Promise<SettingsTrouble> {
  let text: string;
  try {
    text = await read();
  } catch (error) {
    return isHardLinkRefusal(error) ? "hardLinked" : "unreadable";
  }
  return holdsSettings(text) ? "readable" : "malformed";
}
