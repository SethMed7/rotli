import type { NoteSummary } from "../types";

export type ActiveItemSinkLane = "note" | "file";

/** Choose the mutation lane for an active item entering Archive or Trash.
 * Boards are opaque files on disk, but their active lifecycle is note-native:
 * Rust's move_note preserves their bytes and records the restorable path. */
export function activeItemSinkLane(kind: NoteSummary["kind"]): ActiveItemSinkLane {
  return kind === "file" ? "file" : "note";
}
