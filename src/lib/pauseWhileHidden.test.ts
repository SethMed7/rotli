import { expect, test } from "bun:test";

import { pauseWhileHidden } from "./pauseWhileHidden";

function unit(active = true) {
  return {
    active,
    isActive() {
      return this.active;
    },
    activate() {
      this.active = true;
    },
    deactivate() {
      this.active = false;
    },
  };
}

function fakeObserver() {
  let report: (visible: boolean) => void = () => {};
  let stopped = false;
  return {
    observe: (_: Element, cb: (visible: boolean) => void) => {
      report = cb;
      return () => {
        stopped = true;
      };
    },
    report: (visible: boolean) => report(visible),
    stopped: () => stopped,
  };
}

test("a hidden editor stops rendering and resumes when shown", () => {
  const units = [unit(), unit()];
  const watch = fakeObserver();
  pauseWhileHidden({} as Element, () => units, watch.observe);
  watch.report(false);
  expect(units.map((u) => u.active)).toEqual([false, false]);
  watch.report(true);
  expect(units.map((u) => u.active)).toEqual([true, true]);
});

test("a unit Univer left inactive is never woken by the pause", () => {
  const units = [unit(true), unit(false)];
  const watch = fakeObserver();
  pauseWhileHidden({} as Element, () => units, watch.observe);
  watch.report(false);
  watch.report(true);
  expect(units.map((u) => u.active)).toEqual([true, false]);
});

test("release stops watching and resumes anything still paused", () => {
  const units = [unit()];
  const watch = fakeObserver();
  const release = pauseWhileHidden({} as Element, () => units, watch.observe);
  watch.report(false);
  release();
  expect(watch.stopped()).toBe(true);
  expect(units[0]?.active).toBe(true);
});
