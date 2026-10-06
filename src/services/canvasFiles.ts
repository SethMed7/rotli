// Where canvas files are read and written this session (2026-10-06): the Mac
// app's corpus commands, Rotli Web's connected folder, or nowhere — decided
// at call time, since the web vault connects after startup. The Canvas
// composition talks only to this port, so a canvas never shows as blank or
// "saved" where nothing can actually hold it.

import {
  corpusCreateCanvas,
  corpusFileStat,
  corpusFileText,
  corpusWriteFileBytes,
  isTauri,
} from "../lib/tauri";
import { FolderCanvasStore } from "./folderCanvases";
import { activeWebVaultDir } from "./webNotes";

export interface CanvasFileIo {
  stat: (id: string) => Promise<{ len: number; revision: string; writable: boolean } | null>;
  /** The whole file (`len` from stat, so no default cap cuts it short), or
   * null when it went away between the stat and the read. */
  read: (id: string, len: number) => Promise<string | null>;
  /** Save over `revision` only; answers the new revision. */
  write: (id: string, text: string, revision: string) => Promise<string>;
}

async function base64Of(text: string): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("couldn’t encode the canvas"));
    reader.readAsDataURL(new Blob([text], { type: "application/json" }));
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

const desktopIo: CanvasFileIo = {
  stat: async (id) => {
    const stat = await corpusFileStat(id);
    return stat ? { len: stat.len, revision: stat.revision, writable: stat.writable } : null;
  },
  read: (id, len) => corpusFileText(id, len),
  write: async (id, text, revision) => corpusWriteFileBytes(id, await base64Of(text), false, revision),
};

function webIo(store: FolderCanvasStore): CanvasFileIo {
  return {
    stat: async (id) => {
      const stat = await store.stat(id);
      return stat ? { ...stat, writable: true } : null;
    },
    read: async (id) => (await store.read(id))?.text ?? null,
    write: (id, text, revision) => store.write(id, text, revision),
  };
}

/** The canvas file port for this session, or null when nothing can hold one. */
export function canvasFileIo(): CanvasFileIo | null {
  if (isTauri()) return desktopIo;
  const dir = activeWebVaultDir();
  return dir ? webIo(new FolderCanvasStore(dir)) : null;
}

/** Create an empty canvas named `name` beside the notes in `folderId`. */
export async function createCanvasFile(folderId: string, name: string): Promise<string> {
  if (isTauri()) return corpusCreateCanvas(folderId, name);
  const dir = activeWebVaultDir();
  if (!dir) throw new Error("Canvases need a vault folder — connect one to make a canvas.");
  return new FolderCanvasStore(dir).create(folderId, name);
}
