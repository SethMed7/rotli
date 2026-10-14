// Native commands for things that arrive from outside a vault (split out of
// tauri.ts, 2026-10-13): a folder opened from Finder in its own window,
// Finder's opt-in "Open in Rotli" Quick Action, and bringing a vault in as a
// copy. docs/design/open-in-rotli.md, vault-copy-and-obsidian-compatibility.md.

import { invoke } from "@tauri-apps/api/core";

import type { CorpusListPayload } from "./tauri";

/** A folder window's listing: the ONE folder opened from Finder it shows
 * (corpus_raw.rs). Every id comes back prefixed with that folder's mount. */
export function corpusListRoot(root: string): Promise<CorpusListPayload> {
  return invoke<CorpusListPayload>("corpus_list_root", { root });
}

/** Main closes a folder window once its folder opened as a vault. */
export function folderWindowClose(label: string): Promise<void> {
  return invoke<void>("folder_window_close", { label });
}

/** A folder window hands its folder to the main window as a vault. Rust reads
 * the folder from this window's own mount; the page never names a path. */
export function folderWindowAddAsVault(): Promise<void> {
  return invoke<void>("folder_window_add_as_vault");
}

/** What "Work on a copy" made (src-tauri/src/vault_import.rs). */
export interface VaultCopyReport {
  destination: string;
  files: number;
  bytes: number;
  /** Linked items (symlinks) that were not followed, by path. */
  skipped: string[];
  /** What the copy became: an imported vault, the Rotli vault it already was,
   * or — its `memex.json` belongs to another tool — a protected folder. */
  marked: VaultCopyMarked;
}

export type VaultCopyMarked = "imported" | "alreadyRotli" | "foreign";

/** Copy a picked vault into a new `<name> (Rotli)` folder beside the person's
 * vaults (or a picked empty `destination`), verify it, and open the copy. The
 * original is only ever read. */
export function corpusCopyVault(source: string, destination?: string): Promise<VaultCopyReport> {
  return invoke<VaultCopyReport>("corpus_copy_vault", { source, destination: destination ?? null });
}

/** Stop a copy in progress; what it wrote is removed, the original untouched. */
export function corpusCopyVaultCancel(): Promise<void> {
  return invoke<void>("corpus_copy_vault_cancel");
}

/** Finder's "Open in Rotli" Quick Action: `absent` · `installed` · `theirs`
 * (a same-named workflow Rotli didn't make). src-tauri/src/finder_quick_action.rs */
export type QuickActionStatus = "absent" | "installed" | "theirs";

export function finderQuickActionStatus(): Promise<QuickActionStatus> {
  return invoke<QuickActionStatus>("finder_quick_action_status");
}

/** Add or remove the Quick Action (writes ~/Library/Services) — Settings only. */
export function finderQuickActionSet(installed: boolean): Promise<QuickActionStatus> {
  return invoke<QuickActionStatus>("finder_quick_action_set", { installed });
}
