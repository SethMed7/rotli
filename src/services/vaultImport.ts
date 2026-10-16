// "Connect a copy with the Librarian" (docs/design/vault-copy-and-obsidian-
// compatibility.md). The copy only matters for the Librarian — the one thing
// that moves and renames notes, and never in a person's original. So setup
// just connects a folder in place; adding a vault later confirms: connect the
// folder in place, or connect a copy Rotli makes with the Librarian on. A
// folder already open in place can ask for that copy from Settings → Librarian.
// Callers keep their own in-place path.

import { corpusCopyVault, corpusCopyVaultCancel } from "../lib/finderBridge";
import { onVaultCopyProgress } from "../lib/hostEvents";
import { type VaultInspection, corpusInspectFolder } from "../lib/tauri";
import { refreshActiveVault } from "../state/activeVault";
import { useVaultImport } from "../state/vaultImport";

export interface FolderInspection {
  label: string;
  source: string;
  markdownFiles: number;
}

/** What a picked folder holds (read-only): empty, a vault, or someone's notes. */
export function inspectVaultFolder(path: string): Promise<VaultInspection> {
  return corpusInspectFolder(path);
}

/** Ask how to open `path`, then do it. Resolves true when a vault opened
 * (the copy, or the folder in place) and false when the person said not now. */
export async function openExistingFolder(
  path: string,
  inspection: FolderInspection,
  openInPlace: () => Promise<void>,
): Promise<boolean> {
  const store = useVaultImport.getState();
  const choice = await store.ask({
    label: inspection.label,
    source: inspection.source,
    notes: inspection.markdownFiles,
  });
  if (choice === "cancel") return false;
  if (choice === "in-place") {
    await openInPlace();
    return true;
  }
  return copyAndOpen(path, inspection.label);
}

/** Copy `path` and open the copy with the Librarian on, at Suggest. */
export async function copyAndOpen(path: string, label: string): Promise<boolean> {
  const { set } = useVaultImport.getState();
  set({ kind: "copying", label, files: 0, totalFiles: 0, bytes: 0, totalBytes: 0 });
  const stop = onVaultCopyProgress((progress) => {
    const step = useVaultImport.getState().step;
    if (step.kind === "copying") set({ ...step, ...progress });
  });
  try {
    const report = await corpusCopyVault(path);
    await refreshActiveVault();
    set({ kind: "done", label, report });
    return true;
  } catch (cause) {
    set({ kind: "failed", label, message: cause instanceof Error ? cause.message : String(cause) });
    return false;
  } finally {
    stop();
  }
}

/** Stop the copy; Rust removes what it wrote. The dialog then shows why. */
export function cancelVaultCopy(): void {
  void corpusCopyVaultCancel();
}

export function closeVaultImport(): void {
  useVaultImport.getState().set({ kind: "idle" });
}

export function answerVaultOpen(choice: "copy" | "in-place" | "cancel"): void {
  useVaultImport.getState().choose(choice);
}
