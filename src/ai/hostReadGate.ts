// The TypeScript mirror of the Rust AI note read gate. The direct read,
// retrieval probe, and local secure-context marker share this location rule.

import { fileName } from "../lib/fileKind";
import {
  type ChatModelInfo,
  corpusList,
  corpusNotePath,
  corpusReadableIds,
  isTauri,
  splitRootId,
} from "../lib/tauri";
import { inSecureHome } from "../security/secureNotes";
import { modelIsOnDevice } from "./guard";
import { aiPathIsProtected } from "./hostFiles";

export async function noteLocationIsProtected(id: string): Promise<boolean> {
  let rel: string;
  if (id.includes("/")) {
    rel = splitRootId(id).rel;
  } else if (isTauri()) {
    rel = splitRootId(await corpusNotePath(id)).rel;
  } else {
    const note = (await corpusList()).notes.find((item) => item.id === id);
    if (!note) throw new Error("blocked: the exact note cannot be resolved safely.");
    rel = note.diskFolderId || note.folderId;
  }
  return aiPathIsProtected(rel, fileName(rel));
}

export async function assertAiNoteLocation(id: string, model: ChatModelInfo): Promise<boolean> {
  const protectedLocation = await noteLocationIsProtected(id);
  if (protectedLocation && !modelIsOnDevice(model)) {
    throw new Error("This note is secure and can never be sent to a remote model.");
  }
  return protectedLocation;
}

export async function aiReadableHits<T extends { id: string }>(
  hits: T[],
  model: ChatModelInfo,
): Promise<T[]> {
  if (hits.length === 0) return hits;
  // One Rust probe for the complete batch; an error yields no readable hits.
  try {
    const readable = new Set(
      await corpusReadableIds(
        hits.map((hit) => hit.id),
        model,
      ),
    );
    return hits.filter((hit) => {
      if (!readable.has(hit.id)) return false;
      if (modelIsOnDevice(model)) return true;
      const located = hit as T & { folderId?: string; diskFolderId?: string; folder?: string };
      return ![hit.id, located.folderId, located.diskFolderId, located.folder].some(
        (path) => path && inSecureHome(path),
      );
    });
  } catch {
    return [];
  }
}
