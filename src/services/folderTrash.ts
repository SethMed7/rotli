import type { NoteSummary } from "../types";

export type FolderTrashPorts = {
  fileStat: (id: string) => Promise<{ lifecycleMutable?: boolean } | null>;
  moveFile: (id: string, sink: "Trash") => Promise<unknown>;
  trashNote: (id: string) => Promise<unknown>;
};

/** Execute the durable half of virtual-folder trash. All conventional files
 * are preflighted before any write; a later I/O failure is reported with exact
 * progress after the remaining independent items have been attempted. */
export async function trashVirtualFolderItems(
  items: NoteSummary[],
  ports: FolderTrashPorts,
): Promise<number> {
  const files = items.filter((item) => item.kind === "file");
  const stats = await Promise.all(files.map((item) => ports.fileStat(item.id)));
  if (stats.some((stat) => stat?.lifecycleMutable !== true)) {
    throw new Error("one or more files are read-only; nothing was moved");
  }

  let moved = 0;
  const failures: string[] = [];
  for (const item of items) {
    try {
      if (item.kind === "file") await ports.moveFile(item.id, "Trash");
      else await ports.trashNote(item.id);
      moved += 1;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length) {
    throw new Error(`${moved} of ${items.length} items moved; ${failures.length} failed (${failures[0]})`);
  }
  return moved;
}
