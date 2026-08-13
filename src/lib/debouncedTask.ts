// One trailing debounce timer around an async task, with an awaitable flush —
// the shared shape behind "write soon, but write NOW (and let me await it)
// when the window hides or the quit handshake fires". The run callback is
// responsible for its own dedup/no-op check; flush always invokes it.

// Declared as function PROPERTIES, not method shorthand: these are passed
// around unbound (`store.subscribe(saver.schedule)`), so they must never depend
// on `this`, and property syntax is what makes the compiler check them
// contravariantly under strictFunctionTypes.
export interface DebouncedTask {
  /** (Re)arm the trailing timer. */
  schedule: () => void;
  /** Cancel the timer and run immediately; resolves when the run settles.
   * Errors propagate so the native quit handshake can keep unsaved state open. */
  flush: () => Promise<void>;
  /** Drop the pending timer without running. */
  cancel: () => void;
}

export function createDebouncedTask(ms: number, run: () => Promise<void> | void): DebouncedTask {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const fire = async (): Promise<void> => {
    await run();
  };
  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        // Background debounce failures are surfaced by each owning subsystem;
        // only an explicit flush needs the rejection for the quit handshake.
        void fire().catch(() => {});
      }, ms);
    },
    flush(): Promise<void> {
      clear();
      return fire();
    },
    cancel: clear,
  };
}
