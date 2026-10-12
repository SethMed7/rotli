// Dirty document session parking + hide/quit flush. Engine-agnostic: it knows
// only the clean EditableDocument and the application session's save closure.

import { PLATFORM } from "../lib/featurePolicy";
import { onQuitFlush } from "../lib/quitFlush";
import { webVaultKey } from "../services/webNotes";
import { snapshotBase64, writeOfficeDraft } from "../services/webOfficeRecovery";
import type { EditableDocument } from "./model";
import type { DocumentEditingOutcome } from "./workflow";

export type ReadyDocumentSession = Extract<DocumentEditingOutcome, { kind: "ready" }>;

export interface ParkedDocumentSession {
  session: ReadyDocumentSession;
  document: EditableDocument;
  diskLen: number;
  diskRevision: string;
  dirtyGen: number;
}

interface LiveDocumentSession {
  fileId: string;
  session: ReadyDocumentSession;
  snapshot: () => EditableDocument;
  diskLen: number;
  diskRevision: string;
  dirtyGen: () => number;
  onFlushed: (gen: number) => void;
}

const parked = new Map<string, ParkedDocumentSession>();
const live = new Map<string, LiveDocumentSession>();
let activeFlush: Promise<void> | null = null;

/** Whether a document is open in a pane now, shown or parked with unsaved
 * work: an AI edit waits until it isn't (panes save on their own). */
export function documentIsOpen(fileId: string): boolean {
  return live.has(fileId) || parked.has(fileId);
}

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

/** Synchronous on each user edit, including the debounce window. */
export function protectDocumentDraft(
  fileId: string,
  session: ReadyDocumentSession,
  document: EditableDocument,
  baseRevision: string,
): string | null {
  if (PLATFORM !== "web") return "";
  const vault = webVaultKey();
  if (!vault) return null;
  try {
    const result = writeOfficeDraft(window.localStorage, vault, {
      fileId,
      kind: "docx",
      baseRevision,
      sourceBase64: session.sourceBase64,
      snapshotBase64: snapshotBase64(document),
    });
    return result.protected ? result.token : null;
  } catch {
    return null;
  }
}

function protectLiveDocuments(): void {
  if (PLATFORM !== "web") return;
  for (const entry of live.values()) {
    if (!entry.dirtyGen()) continue;
    try {
      protectDocumentDraft(entry.fileId, entry.session, entry.snapshot(), entry.diskRevision);
    } catch {
      /* the editor already warns when synchronous storage refuses */
    }
  }
}

export function flushDirtyDocuments(): Promise<void> {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    const failures: string[] = [];
    for (const entry of [...live.values()]) {
      const gen = entry.dirtyGen();
      if (!gen) continue;
      try {
        parked.set(entry.fileId, {
          session: entry.session,
          document: entry.snapshot(),
          diskLen: entry.diskLen,
          diskRevision: entry.diskRevision,
          dirtyGen: gen,
        });
      } catch (error) {
        failures.push(
          `${entry.fileId}: snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const [fileId, entry] of [...parked]) {
      try {
        const revision = await entry.session.save(entry.document);
        entry.diskRevision = revision;
        if (parked.get(fileId) === entry) parked.delete(fileId);
        const current = live.get(fileId);
        if (current && current.dirtyGen() === entry.dirtyGen) {
          current.diskRevision = revision;
          current.onFlushed(entry.dirtyGen);
        }
      } catch (error) {
        failures.push(`${fileId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
  })().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDirtyDocuments().catch(() => {});
  });
  window.addEventListener("pagehide", () => {
    protectLiveDocuments();
    void flushDirtyDocuments().catch(() => {});
  });
}
onQuitFlush(() => flushDirtyDocuments());
