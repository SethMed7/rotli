// "Work on a copy" (docs/design/vault-copy-and-obsidian-compatibility.md,
// slice 3). Opening a folder that already holds notes asks first: a copy Rotli
// makes and opens (recommended; the original is only ever read), or the
// folder itself, in place and protected. Callers keep their own in-place path.

import { corpusCopyVault, corpusCopyVaultCancel } from "../lib/finderBridge";
import { onVaultCopyProgress } from "../lib/hostEvents";
import { refreshActiveVault } from "../state/activeVault";
import { useVaultImport } from "../state/vaultImport";

export interface FolderInspection {
  label: string;
  source: string;
  markdownFiles: number;
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

async function copyAndOpen(path: string, label: string): Promise<boolean> {
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
