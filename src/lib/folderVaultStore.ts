// The VaultStore port over a real folder: `.rotli/` files instead of
// IndexedDB keys, so Main, views, settings, and viewstate land where the Mac
// app keeps them and the same vault opens in both. The optimistic revision
// is the file's modification time and size — a write that presents a stale
// one is refused, never clobbers.

import type { VaultDir } from "../services/vaultDir";
import type { VaultStore } from "./browserVault";

/** Which `.rotli/` file a vault key maps to. Unknown keys live in
 * `.rotli/web/<key>` so the browser build never invents top-level files. */
export function vaultKeyPath(key: string): string {
  switch (key) {
    case "main":
      return ".rotli/main.json";
    case "views":
      return ".rotli/views.json";
    case "settings:settings":
      return ".rotli/settings.json";
    case "settings:viewstate":
      return ".rotli/viewstate.json";
    case "app-settings":
      return ".rotli/web/app-settings.json";
    default:
      return `.rotli/web/${key.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  }
}

const REVISION_SUFFIX = "#rev";

export class FolderVaultStore implements VaultStore {
  constructor(private readonly dir: VaultDir) {}

  private async revisionOf(path: string): Promise<string> {
    const stat = await this.dir.stat(path);
    return stat ? `${stat.lastModified}:${stat.size}` : "0";
  }

  async get(key: string): Promise<string | undefined> {
    if (key.endsWith(REVISION_SUFFIX))
      return this.revisionOf(vaultKeyPath(key.slice(0, -REVISION_SUFFIX.length)));
    const path = vaultKeyPath(key);
    if (!(await this.dir.exists(path))) return undefined;
    return this.dir.readText(path);
  }

  async set(key: string, value: string): Promise<void> {
    if (key.endsWith(REVISION_SUFFIX)) return; // revisions are the file's own
    await this.dir.writeText(vaultKeyPath(key), value);
  }

  async delete(key: string): Promise<void> {
    if (key.endsWith(REVISION_SUFFIX)) return;
    await this.dir.remove(vaultKeyPath(key));
  }

  /** The file's current stamp must equal what the writer read; then write.
   * `nextRevision` is ignored: the next stamp is whatever the file gets. */
  async compareAndSwap(
    key: string,
    value: string,
    _revisionKey: string,
    expectedRevision: string,
  ): Promise<boolean> {
    const path = vaultKeyPath(key);
    const current = await this.revisionOf(path);
    if (current !== expectedRevision) return false;
    await this.dir.writeText(path, value);
    return true;
  }
}
