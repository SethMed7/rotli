// The browser twin's stand-in for the macOS folder panel (the twin has no
// filesystem). A pick is a fresh empty folder under the example Home, so setup
// can be walked end to end; folders it made read as empty until a vault is
// created there.

export const browserEmptyFolders = new Set<string>();

let picks = 0;

/** What the twin's folder panel returns: a new, empty folder. */
export function browserPickFolder(): string {
  picks += 1;
  const path = `/Users/example/Rotli Vault ${picks}`;
  browserEmptyFolders.add(path);
  return path;
}
