// One trailing debounce timer around an async task, with an awaitable flush —
// the shared shape behind "write soon, but write NOW (and let me await it)
// when the window hides or the quit handshake fires". The run callback is
// responsible for its own dedup/no-op check; flush always invokes it.

export interface DebouncedTask {
  /** (Re)arm the trailing timer. */
  schedule(): void;
  /** Cancel the timer and run immediately; resolves when the run settles.
   * Errors are swallowed — a failed flush must never hang a quit or unload. */
  flush(): Promise<void>;
  /** Drop the pending timer without running. */
  cancel(): void;
}

export function createDebouncedTask(ms: number, run: () => Promise<void> | void): DebouncedTask {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const fire = async (): Promise<void> => {
    try {
      await run();
    } catch {
      // swallowed by design — see flush() doc
    }
  };
  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        void fire();
      }, ms);
    },
    flush(): Promise<void> {
      clear();
      return fire();
    },
    cancel: clear,
  };
}
