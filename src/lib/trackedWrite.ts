// Latest-call-wins status tracking around fire-and-forget manifest writes.
// Callers fire setTree/setManifest back-to-back; completions can land out of
// order, so a stale completion must never report over the newest call (the
// views.ts writeSequence pattern, extracted — perf audit 2026-07-30,
// correctness #3 pointed main.json at the same guard).

export type TrackedWrite = (payload: string, report: (ok: boolean, error?: unknown) => void) => void;

export interface RevisionedTrackedWrite {
  write: TrackedWrite;
  setRevision: (revision: string) => void;
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
 * closed instead of guessing which disk version to replace. */
export function createRevisionedTrackedWrite(
  persist: (payload: string, expectedRevision: string) => Promise<string>,
): RevisionedTrackedWrite {
  let revision = "";
  return {
    setRevision: (next) => {
      revision = next;
    },
    write: createTrackedWrite(async (payload) => {
      if (!revision) throw new Error("The vault projection has no revision. Reload it before editing.");
      revision = await persist(payload, revision);
    }),
  };
}
