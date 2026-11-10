// What Rotli says about files it leaves alone because they have a hard link
// (third review of pull request 267, 2026-11-09). A file with a second name
// can be a file outside the vault, so Rotli never opens, lists, searches or
// repairs one. It used to leave them out silently; now one calm notice says
// so (DESIGN.md: no badge, no alarm), in the sidebar, under search results,
// and in place of a note that turned into one while it was open.

import type { SkippedFile } from "../types";

/** The notice's sentence. */
export function skippedSummary(count: number): string {
  return count === 1
    ? "1 file wasn’t opened because it has a hard link. Your file is still on disk."
    : `${count} files weren’t opened because they have hard links. Your files are still on disk.`;
}

/** The one line on what to do about it. Rotli changes nothing itself. */
export const INDEPENDENT_COPY =
  "To use one in Rotli, make an independent copy: select it in Finder and choose Duplicate. Rotli never changes a linked file.";

/** The line under search results. */
export function searchSkippedLine(count: number): string {
  return count === 1
    ? "1 file wasn’t searched because it has a hard link."
    : `${count} files weren’t searched because they have hard links.`;
}

/** What an open note shows when it can't be read because it has a hard link. */
export const OPEN_NOTE_HARD_LINKED =
  "This note wasn’t opened because it has a hard link. Your file is still on disk.";

/** Is `error` Rust's refusal of a hard-linked file (fsutil::open_own_file)? */
export function isHardLinkRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /has a hard link/.test(message);
}

/** The hard-linked files among `files`, by path. */
export function hardLinked(files: readonly SkippedFile[] | undefined): SkippedFile[] {
  return (files ?? []).filter((file) => file.reason === "hardLink");
}
