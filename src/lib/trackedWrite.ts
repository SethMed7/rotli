// Latest-call-wins status tracking around fire-and-forget manifest writes.
// Callers fire setTree/setManifest back-to-back; completions can land out of
// order, so a stale completion must never report over the newest call (the
// views.ts writeSequence pattern, extracted — perf audit 2026-07-30,
// correctness #3 pointed main.json at the same guard).

export type TrackedWrite = (payload: string, report: (ok: boolean, error?: unknown) => void) => void;

export interface RevisionedTrackedWrite {
  write: TrackedWrite;
  /** Adopt a revision read from disk, with the contents that sit at it. */
  setRevision: (revision: string, contents?: string) => void;
  /** The contents at the held revision — the base a conflict merges against. */
  synced: () => string;
}

/** Wrap a write so only the LATEST call's outcome reaches `report`. */
export function createTrackedWrite(write: (payload: string) => Promise<void>): TrackedWrite {
  let sequence = 0;
  let tail: Promise<void> | null = null;
  return (payload, report) => {
    const seq = ++sequence;
    const operation = tail ? tail.then(() => write(payload)) : write(payload);
    // A failed write must not poison the queue: the newest pending manifest
    // still gets its own save attempt after the failure has been reported.
    tail = operation.then(
      () => undefined,
      () => undefined,
    );
    operation
      .then(() => {
        if (seq === sequence) report(true);
      })
      .catch((error: unknown) => {
        if (seq === sequence) report(false, error);
      });
  };
}

/** A serialized manifest writer whose successful response becomes the exact
 * revision used by the next queued payload. Hydration supplies the first
 * revision; a conflict leaves it unchanged and every pending write fails
 * closed instead of guessing which disk version to replace — the owning store
 * answers a conflict with recoverRevisionConflict, never a blind retry. */
export function createRevisionedTrackedWrite(
  persist: (payload: string, expectedRevision: string) => Promise<string>,
): RevisionedTrackedWrite {
  let revision = "";
  let synced = "";
  return {
    setRevision: (next, contents = "") => {
      revision = next;
      synced = contents;
    },
    synced: () => synced,
    write: createTrackedWrite(async (payload) => {
      if (!revision) throw new Error("The vault projection has no revision. Reload it before editing.");
      revision = await persist(payload, revision);
      synced = payload;
    }),
  };
}

/** The host (fsutil.rs) and the browser vault both refuse a stale write with
 * this wording; every other failure is a real save error. */
export function isRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("revision conflict");
}

/** One quiet answer to a revision conflict: re-read the file, adopt its
 * revision, and let the store merge its edit over what changed. `merged` is
 * null when the two edits cannot be combined — the store then shows the disk
 * version. Resolves null when a newer edit owns the outcome: that edit's own
 * write still holds the stale revision, so it conflicts and recovers itself. */
export async function recoverRevisionConflict(input: {
  writer: RevisionedTrackedWrite;
  read: () => Promise<{ contents: string; revision: string }>;
  current: () => boolean;
  merge: (base: string, remote: string) => string | null;
}): Promise<{ remote: string; merged: string | null } | null> {
  const base = input.writer.synced();
  const opened = await input.read();
  if (!input.current()) return null;
  input.writer.setRevision(opened.revision, opened.contents);
  return { remote: opened.contents, merged: input.merge(base, opened.contents) };
}
