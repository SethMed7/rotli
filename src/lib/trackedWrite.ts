// Latest-call-wins status tracking around fire-and-forget manifest writes.
// Callers fire setTree/setManifest back-to-back; completions can land out of
// order, so a stale completion must never report over the newest call (the
// views.ts writeSequence pattern, extracted — perf audit 2026-07-30,
// correctness #3 pointed main.json at the same guard).

export type TrackedWrite = (payload: string, report: (ok: boolean, error?: unknown) => void) => void;

/** Wrap a write so only the LATEST call's outcome reaches `report`. */
export function createTrackedWrite(write: (payload: string) => Promise<void>): TrackedWrite {
  let sequence = 0;
  return (payload, report) => {
    const seq = ++sequence;
    write(payload)
      .then(() => {
        if (seq === sequence) report(true);
      })
      .catch((error: unknown) => {
        if (seq === sequence) report(false, error);
      });
  };
}
