// Settings survive updates (the owner, 2026-10-01: "ensure users' settings
// survive any updates"). Rotli never writes a settings file it couldn't read,
// and never writes down one a newer Rotli saved: an unreadable file (a disk
// error) or a newer `v` keeps its writes off for the session, so the next save
// can't replace it with defaults or an older shape. A file that reads but
// won't parse is copied aside by Rust before it is overwritten
// (app_settings.rs, corpus.rs dot_write). docs/architecture/
// compatibility-and-migrations.md owns the rules.

/** The settings shape this build writes (`v` in both settings files). */
export const SETTINGS_VERSION = 1;

export type SettingsFile = "app" | "vault";

const blocked: Record<SettingsFile, string | null> = { app: null, vault: null };

/** The `v` a settings file was saved with (1 for a file from before `v`). */
export function settingsVersionOf(raw: string): number {
  try {
    const parsed: unknown = JSON.parse(raw);
    const v = parsed && typeof parsed === "object" ? (parsed as { v?: unknown }).v : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : 1;
  } catch {
    return 1;
  }
}

/** Why a settings file stays as it is for the session. */
export const BLOCK = { unreadable: "unreadable", newer: "newer" } as const;

/** Why one settings file stays as it is this session, or null when Rotli may write it. */
export function settingsBlock(raw: string | null): string | null {
  if (raw === null) return BLOCK.unreadable;
  return settingsVersionOf(raw) > SETTINGS_VERSION ? BLOCK.newer : null;
}

/** Record what a read found (null: the read itself failed). */
export function noteSettingsRead(file: SettingsFile, raw: string | null): void {
  blocked[file] = settingsBlock(raw);
  if (blocked[file]) console.warn(`rotli: ${file} settings are ${blocked[file]}; leaving the file as it is`);
}

/** A read that failed: noted, then failed onward as before. */
export const unreadable =
  (file: SettingsFile) =>
  (error: unknown): never => {
    noteSettingsRead(file, null);
    throw error;
  };

export function settingsWritable(file: SettingsFile): boolean {
  return blocked[file] === null;
}
