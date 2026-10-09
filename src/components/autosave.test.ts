import { expect, test } from "bun:test";

import { createAutosave } from "./autosave";

/** A hand-cranked clock: `schedule` records the pending run; `fire` runs it. */
function fakeClock() {
  let pending: (() => void) | null = null;
  return {
    schedule: (run: () => void) => {
      pending = run;
      return () => {
        pending = null;
      };
    },
    fire: () => {
      const run = pending;
      pending = null;
      run?.();
    },
    get armed() {
      return pending !== null;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a run of edits saves once, after the pause", async () => {
  const clock = fakeClock();
  const auto = createAutosave(800, clock.schedule);
  let saves = 0;
  auto.setSave(async () => {
    saves += 1;
  });
  auto.edited();
  auto.edited();
  auto.edited();
  expect(saves).toBe(0);
  expect(clock.armed).toBe(true);
  clock.fire();
  await settle();
  expect(saves).toBe(1);
  expect(clock.armed).toBe(false);
});

test("edits during a save run one more save after it, never two at once", async () => {
  const clock = fakeClock();
  const auto = createAutosave(800, clock.schedule);
  let running = 0;
  let most = 0;
  let saves = 0;
  let release: () => void = () => {};
  auto.setSave(
    () =>
      new Promise<void>((resolve) => {
        running += 1;
        most = Math.max(most, running);
        saves += 1;
        release = () => {
          running -= 1;
          resolve();
        };
      }),
  );
  auto.edited();
  clock.fire(); // first save starts and hangs
  auto.edited();
  clock.fire(); // an edit lands mid-save: queued, not concurrent
  auto.flush(); // ⌘S mid-save: still queued
  expect(saves).toBe(1);
  release();
  await settle();
  expect(saves).toBe(2);
  release();
  await settle();
  expect(most).toBe(1);
  expect(saves).toBe(2);
});

test("⌘S saves at once and cancels the pending timer; cancel drops a pending save", async () => {
  const clock = fakeClock();
  const auto = createAutosave(800, clock.schedule);
  let saves = 0;
  auto.setSave(async () => {
    saves += 1;
  });
  auto.edited();
  auto.flush();
  await settle();
  expect(saves).toBe(1);
  expect(clock.armed).toBe(false);
  auto.edited();
  auto.cancel();
  expect(clock.armed).toBe(false);
  expect(saves).toBe(1);
});

test("a failed save doesn't wedge the timer: the next edit saves again", async () => {
  const clock = fakeClock();
  const auto = createAutosave(800, clock.schedule);
  let attempts = 0;
  auto.setSave(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("disk changed");
  });
  auto.edited();
  clock.fire();
  await settle();
  auto.edited();
  clock.fire();
  await settle();
  expect(attempts).toBe(2);
});

// The trap from PR 181's review: useAutosave installs each render's `save`, so
// the rerun after a save runs the closure rendered WHILE it was saving. A save
// that bails on its render-time `saving` flag drops the edits made mid-save;
// the editors gate only on their edit generation (a ref), and this models why.
test("the rerun after a save writes edits made during it, with the closure rendered mid-save", async () => {
  const clock = fakeClock();
  const auto = createAutosave(800, clock.schedule);
  const disk: number[] = [];
  let generation = 0; // a ref: always current
  let release: () => void = () => {};
  // one "render": the editor's save closes over that render's state
  const render = (savingAtRender: boolean) =>
    auto.setSave(async () => {
      void savingAtRender; // the editors no longer read it — that was the bug
      if (generation === 0) return;
      const writing = generation;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      disk.push(writing);
      if (generation === writing) generation = 0;
    });
  render(false);
  generation = 1;
  auto.edited();
  clock.fire(); // the first save starts…
  render(true); // …React re-renders with saving = true and installs that closure
  generation = 2; // an edit lands mid-save
  auto.edited();
  clock.fire();
  release();
  await settle();
  release();
  await settle();
  expect(disk).toEqual([1, 2]);
  expect(generation).toBe(0);
});
