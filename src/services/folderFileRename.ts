import { extOf, fileName, userFileName } from "../lib/fileKind";
import { joinVaultPath, parentPath, type VaultDir } from "./vaultDir";

/** Rename a surfaced file and carry its one-time first-save backup. */
export async function renameFolderFile(
  dir: VaultDir,
  path: string,
  name: string,
  id: string,
  move: (from: string, to: string) => Promise<string>,
): Promise<string> {
  const next = userFileName(name, extOf(fileName(path)));
  const newPath = joinVaultPath(parentPath(path), next);
  if (newPath === path) return id;
  if (newPath.toLowerCase() !== path.toLowerCase() && (await dir.exists(newPath)))
    throw new Error(`a file named “${next}” already exists here`);
  const movedId = await move(path, newPath);
  const oldBackup = `${path}.bak`;
  const newBackup = `${movedId}.bak`;
  if (await dir.exists(oldBackup)) {
    try {
      if (newBackup.toLowerCase() === oldBackup.toLowerCase() || !(await dir.exists(newBackup)))
        await dir.move(oldBackup, newBackup);
    } catch {
      // Rust treats this carry as best-effort after the primary rename.
    }
  }
  return movedId;
}
