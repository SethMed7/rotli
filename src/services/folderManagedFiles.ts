// Rotli-owned DOCX/XLSX creation and pristine-draft cleanup over a connected
// vault. The registry is session-only: an old file can never become disposable.
import {
  baseName,
  bytesRevision,
  joinVaultPath,
  vaultFolderRoles,
  vaultIsMemex,
  type VaultDir,
} from "./vaultDir";

export const MANAGED_MEMEX_LANE = "storage/rotli";
export const MANAGED_PLAIN_LANE = "Storage";
export const MANAGED_FILE_EXTS = ["xlsx", "docx"] as const;
export const managedCollisionName = (stem: string, ext: string, n: number): string => `${stem}-${n}${ext}`;

const created = new WeakMap<VaultDir, Map<string, string>>();

function validManagedName(name: string): void {
  if (!name || name === "." || name === ".." || name.startsWith(".") || /[/:\\]/.test(name))
    throw new Error(`invalid folder name: ${JSON.stringify(name)}`);
  const ext = name.split(".").pop()?.toLowerCase();
  if (!MANAGED_FILE_EXTS.some((allowed) => allowed === ext))
    throw new Error(`managed files must use one of: ${MANAGED_FILE_EXTS.join(", ")}`);
}

/** Create-only at every candidate, including after another tab wins a race. */
export async function createManagedFile(dir: VaultDir, name: string, bytes: Uint8Array): Promise<string> {
  validManagedName(name);
  // an imported vault keeps Rotli's files in its own storage folder (Rust `create_managed_file`)
  const roles = await vaultFolderRoles(dir);
  const folder = roles
    ? `${roles.storage}/rotli`
    : (await vaultIsMemex(dir))
      ? MANAGED_MEMEX_LANE
      : MANAGED_PLAIN_LANE;
  await dir.mkdir(folder);
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  for (let n = 1; ; n += 1) {
    const id = joinVaultPath(folder, n === 1 ? name : managedCollisionName(stem, ext, n));
    // A case-insensitive disk will find the same file even when the requested
    // case differs. The write gate below is the final race-safe authority.
    const sibling = (await dir.list(folder)).some(
      (entry) => entry.name.toLowerCase() === baseName(id).toLowerCase(),
    );
    if (sibling) continue;
    try {
      await dir.writeBytes(id, bytes, "0");
      let revisions = created.get(dir);
      if (!revisions) created.set(dir, (revisions = new Map()));
      revisions.set(id, bytesRevision(bytes));
      return id;
    } catch (error) {
      if (error instanceof Error && /revision conflict|already exists/i.test(error.message)) continue;
      throw error;
    }
  }
}

/** Hard-discard only a file this session created and whose exact bytes remain. */
export async function discardPristineManagedFile(dir: VaultDir, id: string): Promise<void> {
  const revision = created.get(dir)?.get(id);
  if (!revision) throw new Error(`the document is no longer a pristine draft: ${id}`);
  await dir.remove(id, revision);
  created.get(dir)?.delete(id);
}
