import { create } from "zustand";

export interface VaultFolderRequestOptions {
  title: string;
  description: string;
  actionLabel: string;
  requireEmpty: boolean;
}

interface PendingVaultFolderRequest extends VaultFolderRequestOptions {
  id: number;
  origin: HTMLElement | null;
  resolve: (path: string | null) => void;
}

interface VaultFolderBrowserStore {
  pending: PendingVaultFolderRequest | null;
}

export const useVaultFolderBrowserStore = create<VaultFolderBrowserStore>(() => ({ pending: null }));

let requestId = 0;

/** Ask the one app-level vault browser for a folder. A newer request cancels
 * an older one so callers never hang behind an invisible modal. */
export function requestVaultFolder(options: VaultFolderRequestOptions): Promise<string | null> {
  const prior = useVaultFolderBrowserStore.getState().pending;
  prior?.resolve(null);
  return new Promise((resolve) => {
    const activeElement = typeof document === "undefined" ? null : document.activeElement;
    useVaultFolderBrowserStore.setState({
      pending: {
        ...options,
        id: ++requestId,
        origin:
          typeof HTMLElement !== "undefined" && activeElement instanceof HTMLElement ? activeElement : null,
        resolve,
      },
    });
  });
}

export function completeVaultFolderRequest(id: number, path: string | null): void {
  const pending = useVaultFolderBrowserStore.getState().pending;
  if (!pending || pending.id !== id) return;
  useVaultFolderBrowserStore.setState({ pending: null });
  pending.resolve(path);
  queueMicrotask(() => pending.origin?.focus());
}
