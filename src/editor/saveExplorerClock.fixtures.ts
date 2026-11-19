// The save-state explorer's clock and small helpers (saveExplorer.fixtures.ts):
// time moves only when a move advances it, so every schedule runs the same way
// every time; a copy's title and words; the fake disk copied for a process
// death; and every order of the writes that may still land.
import type { SaveClock, TimerHandle } from "./saveClock";
import { type FakeLane, fakeLane } from "./writeLane.fixtures";

/** A clock that moves only when `fire` runs its earliest timer. */
export class HandClock implements SaveClock {
  t = 0;
  private seq = 0;
  readonly timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number): TimerHandle => {
    this.seq += 1;
    this.timers.set(this.seq, { at: this.t + Math.max(0, ms), fn });
    return this.seq as unknown as TimerHandle;
  };
  clearTimeout = (handle: TimerHandle | undefined) => {
    if (handle !== undefined) this.timers.delete(handle as unknown as number);
  };
  next(): [number, { at: number; fn: () => void }] | undefined {
    let best: [number, { at: number; fn: () => void }] | undefined;
    for (const entry of this.timers) if (!best || entry[1].at < best[1].at) best = entry;
    return best;
  }
  fire(): number {
    const [id, timer] = this.next()!;
    this.timers.delete(id);
    const waited = timer.at - this.t;
    this.t = timer.at;
    timer.fn();
    return waited;
  }
}

export const titleOf = (body: string) =>
  body
    .split("\n")[0]!
    .replace(/^# /, "")
    .replace(/ \(unsaved edits [^)]*\)$/, "");
/** A copy's words as the person typed them (a conflict copy's title is suffixed). */
export const copyWords = (body: string) => body.replace(/^# (.*) \(unsaved edits [^)]*\)$/m, "# $1");

export function cloneLane(lane: FakeLane, prefix: string): FakeLane {
  const copy = fakeLane(prefix);
  for (const [id, file] of lane.files) copy.files.set(id, { ...file, meta: [...file.meta] });
  return copy;
}

/** Every order of every subset of `items`. */
export function* landings<T>(items: T[]): Generator<T[]> {
  yield [];
  for (let i = 0; i < items.length; i += 1)
    for (const rest of landings([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i]!, ...rest];
}
