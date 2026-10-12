// The VaultStore port over a real folder: `.rotli/` files instead of
// IndexedDB keys, so Main, views, settings, and viewstate land where the Mac
// app keeps them and the same vault opens in both. The optimistic revision
// is a hash of the exact bytes read — a write that presents stale content is
// refused by the folder adapter.

import { writeFolderViews } from "../services/folderViewSync";
import { contentRevision, type VaultDir } from "../services/vaultDir";
import type { VaultStore, VersionedValue } from "./browserVault";

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

  writtenRevision(value: string): string {
    return contentRevision(value);
  }

  private async revisionOf(path: string): Promise<string> {
    return (await this.dir.exists(path)) ? contentRevision(await this.dir.readText(path)) : "0";
  }

  async readVersioned(key: string): Promise<VersionedValue> {
    const path = vaultKeyPath(key);
    if (!(await this.dir.exists(path))) return { contents: "", revision: "0" };
    const contents = await this.dir.readText(path);
    return { contents, revision: contentRevision(contents) };
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

  /** Carry the observed content revision into the adapter's write turn. */
  async compareAndSwap(
    key: string,
    value: string,
    _revisionKey: string,
    expectedRevision: string,
  ): Promise<boolean> {
    const path = vaultKeyPath(key);
    // views also carry each note's view_tag: their own transaction
    if (key === "views") return writeFolderViews(this.dir, value, expectedRevision);
    try {
      await this.dir.writeText(path, value, expectedRevision);
      return true;
    } catch (error) {
      if (error instanceof Error && /revision conflict/i.test(error.message)) return false;
      throw error;
    }
  }
}
