// Share one in-flight request among callers in the same synchronous run. A
// wave of query refetches (one invalidation, one render commit) asks for the
// same whole-vault listing many times in one tick; each separate IPC answer
// was a full copy for the webview to parse and hold (RAM review 2026-10-12:
// 13 corpus_list round trips at launch on a 133k-entry folder).
//
// The share ends at the next microtask checkpoint — before any other task (an
// IPC reply, a timer) can run. A request issued earlier may predate a write
// whose completion triggered this caller, so a later caller always issues its
// own request and never receives a stale answer.

export function sameTaskRequest<T>(request: () => Promise<T>): () => Promise<T> {
  let shared: Promise<T> | null = null;
  return () => {
    if (shared) return shared;
    const current = request();
    shared = current;
    queueMicrotask(() => {
      if (shared === current) shared = null;
    });
    return current;
  };
}
