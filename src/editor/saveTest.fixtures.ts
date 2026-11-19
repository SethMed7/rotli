// Timing helpers the save tests share (saveQueue.test.ts, saveRecovery.test.ts
// and the real-lane harness, realWriteLane.lane.ts).
import { expect } from "bun:test";

/** Let pending promise callbacks and timers run (`rounds` turns of `ms`). */
export async function settle(rounds = 5, ms = 0): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, ms));
}

/** `promise`, or "timed out" after `ms`. */
export const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms))]);

/** "done", or the message it rejected with. */
export const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "done",
    (error: Error) => error.message,
  );

/** Wait until `ready()` (polling every `ms`, at most `tries` times), then require it. */
export async function until(ready: () => boolean, tries = 200, ms = 1): Promise<void> {
  for (let i = 0; i < tries && !ready(); i += 1) await new Promise((resolve) => setTimeout(resolve, ms));
  expect(ready()).toBe(true);
}
