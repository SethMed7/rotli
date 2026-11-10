// What Librarian Activity says when the organizer stopped because the vault's
// settings couldn't be read (fourth review of pull request 267: the refusal
// existed in Rust, but its lastError was never shown). One quiet line and
// what to do; no alarm. Rust owns the first sentence (librarian_rules.rs
// SETTINGS_UNREADABLE); this recognises it and adds the way out.

/** The start of Rust's SETTINGS_UNREADABLE, as the organizer reports it. */
const SETTINGS_UNREADABLE = "Rotli couldn’t read this vault’s settings";

export const SETTINGS_HELP =
  "They’re in .rotli/settings.json inside the vault folder. Change any setting to save a new file: Rotli keeps an unreadable one beside it as settings.json.unreadable-…, and never deletes it.";

/** Is the organizer's last error the settings refusal? */
export const isSettingsUnreadable = (error: string | null | undefined): error is string =>
  !!error && error.startsWith(SETTINGS_UNREADABLE);

export function LibrarianSettingsNotice({ error }: { error: string | null | undefined }) {
  if (!isSettingsUnreadable(error)) return null;
  return (
    <div className="brain-hint act-pad" role="status">
      <p className="act-settings-line">{error}</p>
      <p className="act-settings-line">{SETTINGS_HELP}</p>
    </div>
  );
}
