// Rotli Web, folder mode: the user picks a real folder on this computer and
// the browser remembers ONLY that (its directory handle, in IndexedDB). Every
// note, the Main tree, and settings then live in the folder — the same files
// the Mac app reads — and nothing else is kept in the browser.
//
// Chromium only (File System Access API). Permission is per origin and per
// visit: the browser grants it on the pick, and asks again next time with one
// click ("Reconnect"). Safari and Firefox have no picker; they keep the
// browser-storage vault and say so.

const DB_NAME = "rotli-web";
const STORE = "vault";
const HANDLE_KEY = "vault-handle";

export type FolderVaultStatus =
  | { kind: "unsupported" }
  | { kind: "none" }
  | { kind: "granted"; name: string; handle: FileSystemDirectoryHandle }
  | { kind: "prompt"; name: string; handle: FileSystemDirectoryHandle };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function folderPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    const value = await done(db.transaction(STORE, "readonly").objectStore(STORE).get(HANDLE_KEY));
    return value && typeof value === "object" && "kind" in value
      ? (value as FileSystemDirectoryHandle)
      : null;
  } catch {
    return null;
  }
}

async function saveVaultHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await open();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  if (handle) await done(store.put(handle, HANDLE_KEY));
  else await done(store.delete(HANDLE_KEY));
}

/** Where the web build stands at boot: no picker, no folder, a folder the
 * browser still trusts, or one that needs a click before it may be read. */
export async function folderVaultStatus(): Promise<FolderVaultStatus> {
  if (!folderPickerSupported()) return { kind: "unsupported" };
  const handle = await loadVaultHandle();
  if (!handle) return { kind: "none" };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return permission === "granted"
    ? { kind: "granted", name: handle.name, handle }
    : { kind: "prompt", name: handle.name, handle };
}

/** Pick a folder (a user gesture must call this), remember it, and reload so
 * the app boots from it. */
export async function connectFolderVault(): Promise<void> {
  if (!window.showDirectoryPicker)
    throw new Error("This browser can't open folders. Chrome, Edge, or Arc can.");
  const handle = await window.showDirectoryPicker({ id: "rotli-vault", mode: "readwrite" });
  await saveVaultHandle(handle);
  window.location.reload();
}

/** Ask the browser for the remembered folder again (a user gesture) and reload. */
export async function reconnectFolderVault(): Promise<boolean> {
  const handle = await loadVaultHandle();
  if (!handle) return false;
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") return false;
  window.location.reload();
  return true;
}

/** Forget the folder and go back to notes in this browser's storage. The
 * folder itself is untouched. */
export async function disconnectFolderVault(): Promise<void> {
  await saveVaultHandle(null);
  window.location.reload();
}
