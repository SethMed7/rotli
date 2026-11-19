// What Librarian Activity says when the organizer stopped because the vault's
// settings couldn't be read (fourth review of pull request 267: the refusal
// existed in Rust, but its lastError was never shown). One quiet line and
// what to do; no alarm. Rust owns the first sentence (librarian_rules.rs
// SETTINGS_UNREADABLE); the way out depends on the trouble, so the second
// line names it (fifth review: a malformed file, a hard-linked one and one
// that can't be opened each need different words).

import { isSettingsUnreadable, type SettingsTrouble } from "../lib/settingsTrouble";
import { useSettingsTrouble } from "../services/hooks";

/** The way out, for each trouble, true of what Rotli then does. A malformed
 * file reads, so setting changes still save, and Rust copies it aside before
 * replacing it (fsutil::keep_unreadable_settings). A hard-linked file or one
 * that can't be opened fails the app's own read, so setting changes stay off
 * for the session (state/settingsGuard.ts) and nothing replaces it; the
 * organizer reads the file again on every run. */
export const SETTINGS_HELP: Record<SettingsTrouble, string> = {
  malformed:
    "They’re in .rotli/settings.json inside the vault folder, and what’s there isn’t valid settings. Change any setting to save a new file: Rotli keeps the old one beside it as settings.json.unreadable-…, and never deletes it.",
  hardLinked:
    "They’re in .rotli/settings.json inside the vault folder, and that file has a hard link (a second name for a file that may be outside the vault), so Rotli doesn’t open or change it. Put an independent copy in its place (in Finder, Shift-Command-Period shows the folder: duplicate the file, delete the original, rename the copy); the Librarian starts again on its next run.",
  unreadable:
    "They’re in .rotli/settings.json inside the vault folder, and Rotli couldn’t open that file. Check that it’s readable (its permissions, or the disk it’s on); Rotli doesn’t change it meanwhile. Once it can be read, the Librarian starts again on its next run.",
  readable: "The settings read correctly now; the Librarian uses them on its next run.",
};

export function LibrarianSettingsNotice({
  error,
  trouble,
}: {
  error: string | null | undefined;
  /** Unknown until the file has been read once more: the first line alone. */
  trouble?: SettingsTrouble | undefined;
}) {
  if (!isSettingsUnreadable(error)) return null;
  return (
    <div className="brain-hint act-pad" role="status">
      <p className="act-settings-line">{error}</p>
      {trouble && <p className="act-settings-line">{SETTINGS_HELP[trouble]}</p>}
    </div>
  );
}

/** Activity's notice: reads the file once more to name the trouble. */
export function ActivitySettingsNotice({ error }: { error: string | null | undefined }) {
  const trouble = useSettingsTrouble(error).data;
  return <LibrarianSettingsNotice error={error} trouble={trouble} />;
}
