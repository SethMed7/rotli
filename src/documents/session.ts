// Dirty document session parking + hide/quit flush. Engine-agnostic: it knows
// only the clean EditableDocument and the application session's save closure.

import { onQuitFlush } from "../lib/quitFlush";
import type { EditableDocument } from "./model";
import type { DocumentEditingOutcome } from "./workflow";

export type ReadyDocumentSession = Extract<DocumentEditingOutcome, { kind: "ready" }>;

export interface ParkedDocumentSession {
  session: ReadyDocumentSession;
  document: EditableDocument;
  diskLen: number;
  dirtyGen: number;
}

interface LiveDocumentSession {
  fileId: string;
  session: ReadyDocumentSession;
  snapshot: () => EditableDocument;
  diskLen: number;
  dirtyGen: () => number;
  onFlushed: (gen: number) => void;
}

const parked = new Map<string, ParkedDocumentSession>();
const live = new Map<string, LiveDocumentSession>();
let flushing = false;

export function getParkedDocument(fileId: string): ParkedDocumentSession | undefined {
  return parked.get(fileId);
}

export function setParkedDocument(fileId: string, entry: ParkedDocumentSession): void {
  parked.set(fileId, entry);
}

export function deleteParkedDocument(fileId: string): void {
  parked.delete(fileId);
}

export function registerLiveDocument(entry: LiveDocumentSession): void {
  live.set(entry.fileId, entry);
}

export function unregisterLiveDocument(fileId: string): void {
  live.delete(fileId);
}

export async function flushDirtyDocuments(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const entry of [...live.values()]) {
      const gen = entry.dirtyGen();
      if (!gen) continue;
      try {
        parked.set(entry.fileId, {
          session: entry.session,
          document: entry.snapshot(),
          diskLen: entry.diskLen,
          dirtyGen: gen,
        });
      } catch {
        /* snapshot failed — leave the live session for the next flush */
      }
    }
    for (const [fileId, entry] of [...parked]) {
      try {
        await entry.session.save(entry.document);
        if (parked.get(fileId) === entry) parked.delete(fileId);
        const current = live.get(fileId);
        if (current && current.dirtyGen() === entry.dirtyGen) current.onFlushed(entry.dirtyGen);
      } catch {
        /* stays parked; explicit Save will show the error */
      }
    }
  } finally {
    flushing = false;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDirtyDocuments();
  });
  window.addEventListener("pagehide", () => void flushDirtyDocuments());
}
onQuitFlush(() => flushDirtyDocuments());
