import type { NoteSummary } from "../types";

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
