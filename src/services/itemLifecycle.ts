import { corpusRestoreFile, isTauri } from "../lib/tauri";
import { usePanesStore } from "../state/panes";
import type { NoteSummary } from "../types";
import { invalidateNotes } from "./hooks";

export type ActiveItemSinkLane = "note" | "file";

/** Choose the mutation lane for an active item entering Archive or Trash.
 * Boards are opaque files on disk, but their active lifecycle is note-native:
 * Rust's move_note preserves their bytes and records the restorable path. */
export function activeItemSinkLane(kind: NoteSummary["kind"]): ActiveItemSinkLane {
  return kind === "file" ? "file" : "note";
}

interface LifecycleStat {
  lifecycleMutable: boolean;
  lifecycleReason?: string | null;
}

export type FileLifecycleRead = { ok: true; stat: LifecycleStat | null } | { ok: false; error: string };

/** Keep a failed stat distinct from an immovable file: a caught error must
 * never be presented as read-only. */
export async function readFileLifecycle(
  load: () => Promise<LifecycleStat | null>,
): Promise<FileLifecycleRead> {
  try {
    return { ok: true, stat: await load() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function fileLifecycleRows(read: FileLifecycleRead): {
  movable: boolean;
  archiveLabel: string;
  trashLabel: string;
  error: string | null;
} {
  if (!read.ok || !read.stat) {
    const label = `Couldn’t read file details — ${read.ok ? "no details available" : read.error}`;
    return { movable: false, archiveLabel: label, trashLabel: label, error: read.ok ? null : label };
  }
  if (read.stat.lifecycleMutable) {
    return {
      movable: true,
      archiveLabel: "Move file to Archive",
      trashLabel: "Move file to Trash",
      error: null,
    };
  }
  const label = read.stat.lifecycleReason
    ? `Can’t move file — ${read.stat.lifecycleReason}`
    : "Read-only — can’t move file";
  return { movable: false, archiveLabel: label, trashLabel: label, error: null };
}

/** Bring an item out of Archive or Trash. Files and boards restore BY PATH
 * (they carry no frontmatter breadcrumb; the sink keeps the original path
 * beneath it) and their tabs close; notes go through the lifecycle mutation,
 * which applies the origin rule. The row menu and the editor's Restore chip
 * both call this, so they cannot drift. */
export async function restoreSinkItem(
  item: Pick<NoteSummary, "id" | "kind">,
  restoreNote: (id: string) => Promise<unknown>,
): Promise<void> {
  if (item.kind === "file" || item.kind === "board") {
    // Rotli Web's folder service restores a board by the same prefix strip it
    // uses for notes; only the Mac corpus has the path-restore command
    if (item.kind === "board" && !isTauri()) await restoreNote(item.id);
    else await corpusRestoreFile(item.id);
    usePanesStore.getState().closeFileTabs(item.id);
    await invalidateNotes();
    return;
  }
  await restoreNote(item.id);
}
