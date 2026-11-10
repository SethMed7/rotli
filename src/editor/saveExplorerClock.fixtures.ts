// The save-state explorer's clock (saveExplorer.fixtures.ts): time moves only
// when a move advances it, so every schedule runs the same way every time.
import type { SaveClock, TimerHandle } from "./saveClock";

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
