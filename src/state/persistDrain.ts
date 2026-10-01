// The vault writer's drain, out of persist.ts (its size ceiling): pure over
// the write it is handed, so tests drive it without the shell.

/** One drain of the debounced writer. The high-water marks advance ONLY when
 * a write LANDS — advancing before (the pre-audit shape) meant one transient
 * failure marked the payload written and it never retried: theme/keys/panes
 * silently reverted at next launch (perf audit 2026-07-30, correctness #4).
 * Exported for tests (the shell's corpusSettingsWrite doesn't exist under bun). */
export function createPersistDrain(
  write: (key: "settings" | "viewstate", payload: string) => Promise<void>,
  snapshot: { settings: () => string; viewstate: () => string },
  seed: { settings: string; viewstate: string },
  onFailure: () => void,
): () => Promise<void> {
  let lastSettings = seed.settings;
  let lastViewstate = seed.viewstate;
  return () => {
    const writes: Array<Promise<void>> = [];
    const settings = snapshot.settings();
    if (settings !== lastSettings) {
      writes.push(
        write("settings", settings).then(() => {
          lastSettings = settings;
        }),
      );
    }
    const viewstate = snapshot.viewstate();
    if (viewstate !== lastViewstate) {
      writes.push(
        write("viewstate", viewstate).then(() => {
          lastViewstate = viewstate;
        }),
      );
    }
    return Promise.allSettled(writes).then((results) => {
      if (results.some((r) => r.status === "rejected")) onFailure();
    });
  };
}
