// The clock the editor's saving runs on: every save timer (the debounce, the
// retry, the write bound, flush and quit deadlines, releasing an idle buffer)
// and every "now" goes through it. Production is the real clock; the
// save-state explorer (saveExplorer.fixtures.ts) swaps in one it advances by
// hand, so each schedule it tries runs the same way every time.

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface SaveClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle | undefined): void;
}

const real: SaveClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export const clock: SaveClock = { ...real };

export function setClockForTests(next: SaveClock | null): void {
  Object.assign(clock, next ?? real);
}
